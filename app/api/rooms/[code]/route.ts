import { NextResponse } from 'next/server';
import { isAdmin, requireAdmin } from '@/lib/admin';
import { HttpError } from '@/lib/errors';
import {
  answer,
  applySettings,
  buildDeck,
  clean,
  clearHistory,
  createTeam,
  finishRound,
  getBank,
  getRoomForRead,
  joinRoom,
  joinTeam,
  removePlayer,
  removeTeam,
  renamePlayer,
  requirePlayer,
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

/** Poll endpoint: returns the whole room view and keeps the caller's presence warm. */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { code } = await ctx.params;
    const params = new URL(request.url).searchParams;
    const playerId = params.get('playerId');
    const admin = isAdmin(params.get('adminToken'));

    let room = await getRoomForRead(code);
    if (!room) throw new HttpError(404, 'Room not found');

    const me = playerId ? room.players.find((p) => p.id === playerId) : null;
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
    const playerId = typeof body.playerId === 'string' ? body.playerId : null;
    const admin = isAdmin(body.adminToken);
    if (ADMIN_ACTIONS.has(action)) requireAdmin(body.adminToken);

    let joinedId: string | null = null;

    const room = await withRoom(code, async (draft) => {
      touch(draft, playerId);

      switch (action) {
        case 'join': {
          const existing = playerId ? draft.players.find((p) => p.id === playerId) : null;
          if (existing) {
            joinedId = existing.id;
            break;
          }
          const player = joinRoom(draft, clean(body.name, 20));
          joinedId = player.id;
          break;
        }
        case 'leave': {
          if (playerId) removePlayer(draft, playerId);
          break;
        }
        case 'rename': {
          renamePlayer(draft, playerId ?? '', clean(body.name, 20));
          break;
        }
        case 'joinTeam': {
          joinTeam(draft, playerId ?? '', clean(body.team, 16));
          break;
        }
        case 'createTeam': {
          requirePlayer(draft, playerId ?? '');
          createTeam(draft, playerId ?? '', clean(body.team, 16));
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
          answer(draft, playerId ?? '', result as AnswerResult);
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
          removePlayer(draft, String(body.targetId ?? ''));
          break;
        }
        case 'ping':
          break;
        default:
          throw new HttpError(400, `Unknown action: ${action}`);
      }
    });

    const viewer = joinedId ?? playerId;
    const bank = admin && room.state === 'lobby' ? await getBank() : null;
    return NextResponse.json({
      ...publicRoom(room, viewer, { admin, bank }),
      playerId: viewer,
    });
  } catch (error) {
    return fail(error);
  }
}
