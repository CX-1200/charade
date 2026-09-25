import { NextResponse } from 'next/server';
import { isAdmin, requireAdmin } from '@/lib/admin';
import { authenticate, newSecret, requireAuthenticated } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import {
  answer,
  applySettings,
  buildDeck,
  clean,
  clearHistory,
  createTeam,
  findUnclaimedPlayer,
  finishRound,
  getBank,
  getRoomForRead,
  joinRoom,
  joinTeam,
  removePlayer,
  removeTeam,
  renamePlayer,
  resetRoom,
  setTeamActive,
  startRound,
  touch,
  withRoom,
} from '@/lib/game';
import { publicRoom, settleAndSerialize } from '@/lib/serialize';
import { storeDriver, storeIsDurable } from '@/lib/store';
import type { AnswerResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Presence only drives an online dot, so re-writing the room on every poll is
 * pure cost — with 60 people in a room that is ~60 writes a second. Refresh a
 * player's timestamp at most this often, and never during a round: answering
 * already refreshes it, and a write here would fight the answers for the lock.
 */
const PRESENCE_WRITE_MS = 15_000;

type Ctx = { params: Promise<{ code: string }> };

/** Actions only an unlocked admin may perform. */
const ADMIN_ACTIONS = new Set([
  'settings',
  'removeTeam',
  'setTeamActive',
  'start',
  'finish',
  'reset',
  'clearHistory',
  'kick',
]);

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 500;
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : 'Server error',
      // A 404 on a code the player just used usually means the request landed
      // on an instance that never saw the room, not that the room is gone.
      ...(status === 404 ? { storage: { driver: storeDriver, durable: storeIsDurable } } : {}),
    },
    { status },
  );
}

/**
 * Poll endpoint: returns the room view and keeps the caller's presence warm.
 *
 * Credentials come in headers, not the query string — URLs end up in server
 * and proxy logs. Without a valid player secret the caller gets the public view
 * only: no "you", and no card.
 */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { code } = await ctx.params;
    const admin = isAdmin(request.headers.get('x-admin-token'));

    let room = await getRoomForRead(code);
    if (!room) throw new HttpError(404, 'Room not found');

    const me = authenticate(
      room,
      request.headers.get('x-player-id'),
      request.headers.get('x-player-secret'),
    );
    const playerId = me?.id ?? null;
    const presenceStale =
      !!me && room.state !== 'playing' && Date.now() - me.lastSeen > PRESENCE_WRITE_MS;
    const clockRanOut = room.state === 'playing' && !!room.endsAt && Date.now() >= room.endsAt;

    // Any write goes through withRoom, which holds the room lock. Writing here
    // unlocked would read-modify-write the whole document and silently drop
    // answers that landed in between — at 50 players that happens constantly.
    if (presenceStale || clockRanOut) {
      room = await withRoom(code, (draft) => touch(draft, playerId));
    } else {
      // Read-only response: freshen the view in memory, persist nothing.
      touch(room, playerId);
    }

    // The bank is only needed for the admin's category counts in the lobby.
    const bank = admin && room.state === 'lobby' ? await getBank() : null;
    return NextResponse.json(settleAndSerialize(room, playerId, { admin, bank }));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { code } = await ctx.params;
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const admin = isAdmin(body.adminToken);
    if (ADMIN_ACTIONS.has(action)) requireAdmin(body.adminToken);

    // Who is asking. Resolved against the fresh room inside the lock.
    let viewerId: string | null = null;
    // A secret is returned only by the call that creates it.
    let issued: { playerId: string; secret: string } | null = null;

    const room = await withRoom(code, async (draft) => {
      const me = authenticate(draft, body.playerId, body.secret);
      viewerId = me?.id ?? null;
      if (me) touch(draft, me.id);

      /** Everything a player does as themselves needs their secret. */
      const self = () => me ?? requireAuthenticated(draft, body.playerId, body.secret);

      switch (action) {
        case 'join': {
          if (me) break; // already in, credentials still good
          const name = clean(body.name, 20);
          const { secret, hash } = newSecret();
          const legacy = findUnclaimedPlayer(draft, name);
          const player = legacy ?? joinRoom(draft, name, hash);
          player.secretHash = hash;
          player.lastSeen = Date.now();
          viewerId = player.id;
          issued = { playerId: player.id, secret };
          break;
        }
        case 'leave': {
          removePlayer(draft, self().id);
          viewerId = null;
          break;
        }
        case 'rename': {
          renamePlayer(draft, self().id, clean(body.name, 20));
          break;
        }
        case 'joinTeam': {
          joinTeam(draft, self().id, clean(body.team, 16));
          break;
        }
        case 'createTeam': {
          createTeam(draft, self().id, clean(body.team, 16));
          break;
        }
        case 'removeTeam': {
          if (draft.state === 'playing') throw new HttpError(409, 'Not while a round is running');
          removeTeam(draft, clean(body.team, 16));
          break;
        }
        case 'setTeamActive': {
          if (draft.state === 'playing') throw new HttpError(409, 'Not while a round is running');
          setTeamActive(draft, clean(body.team, 16), body.active !== false);
          break;
        }
        case 'settings': {
          if (draft.state === 'playing') {
            throw new HttpError(409, 'Settings cannot be changed mid-round');
          }
          applySettings(draft, {
            durationSec: body.durationSec as number,
            categoryIds: body.categoryIds as string[],
            skipPenalty: body.skipPenalty as boolean,
          });
          break;
        }
        case 'start': {
          const bank = await getBank();
          startRound(draft, buildDeck(bank, draft.settings.categoryIds));
          break;
        }
        case 'answer': {
          const result = body.result === 'skip' ? 'skip' : 'correct';
          answer(draft, self().id, result as AnswerResult);
          break;
        }
        case 'finish': {
          finishRound(draft);
          break;
        }
        case 'reset': {
          resetRoom(draft);
          break;
        }
        case 'clearHistory': {
          clearHistory(draft);
          resetRoom(draft);
          break;
        }
        case 'kick': {
          // The target is named by public id; the admin token is the authority.
          removePlayer(draft, String(body.targetId ?? ''));
          break;
        }
        case 'ping':
          self();
          break;
        default:
          throw new HttpError(400, `Unknown action: ${action}`);
      }
    });

    const bank = admin && room.state === 'lobby' ? await getBank() : null;
    return NextResponse.json({
      ...publicRoom(room, viewerId, { admin, bank }),
      ...(issued ?? {}),
    });
  } catch (error) {
    return fail(error);
  }
}
