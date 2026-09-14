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
  getRoom,
  joinRoom,
  joinTeam,
  removePlayer,
  removeTeam,
  renamePlayer,
  requirePlayer,
  resetRoom,
  saveRoom,
  setTeamActive,
  startRound,
  touch,
  withRoom,
} from '@/lib/game';
import { publicRoom, settleAndSerialize } from '@/lib/serialize';
import type { AnswerResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

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
    { error: error instanceof Error ? error.message : 'Server error' },
    { status },
  );
}

const roomClosed = () =>
  NextResponse.json({ error: 'Room closed — everybody left', closed: true }, { status: 410 });

/** Poll endpoint: returns the whole room view and keeps the caller's presence warm. */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { code } = await ctx.params;
    const params = new URL(request.url).searchParams;
    const playerId = params.get('playerId');
    const admin = isAdmin(params.get('adminToken'));

    const room = await getRoom(code);
    if (!room) throw new HttpError(404, 'Room not found or closed');

    const before = room.state;
    touch(room, playerId);
    const bank = await getBank();
    const view = settleAndSerialize(room, playerId, { admin, bank });
    // Presence + auto-finish are cheap writes; only persist when something moved.
    if (playerId || before !== room.state) await saveRoom(room);
    return NextResponse.json(view);
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

    // withRoom returns null when the last player left and the room shut down.
    if (!room) return roomClosed();

    const viewer = joinedId ?? playerId;
    const bank = await getBank();
    return NextResponse.json({
      ...publicRoom(room, viewer, { admin, bank }),
      playerId: viewer,
    });
  } catch (error) {
    return fail(error);
  }
}
