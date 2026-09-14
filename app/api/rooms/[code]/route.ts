import { NextResponse } from 'next/server';
import {
  answer,
  applySettings,
  buildDeck,
  clean,
  clearHistory,
  finishRound,
  getBank,
  getRoom,
  HttpError,
  joinRoom,
  removePlayer,
  requireHost,
  requirePlayer,
  resetRoom,
  saveRoom,
  setTeams,
  startRound,
  touch,
  withRoom,
} from '@/lib/game';
import { publicRoom, settleAndSerialize } from '@/lib/serialize';
import type { AnswerResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 500;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : '服务器错误' },
    { status },
  );
}

/** Poll endpoint: returns the whole room view and keeps the caller's presence warm. */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { code } = await ctx.params;
    const playerId = new URL(request.url).searchParams.get('playerId');
    const room = await getRoom(code);
    if (!room) throw new HttpError(404, '房间不存在或已过期');

    const before = room.state;
    touch(room, playerId);
    const view = settleAndSerialize(room, playerId);
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
          const player = joinRoom(draft, clean(body.name, 20), clean(body.team, 16));
          joinedId = player.id;
          break;
        }
        case 'leave': {
          if (playerId) removePlayer(draft, playerId);
          break;
        }
        case 'setTeam': {
          const player = requirePlayer(draft, playerId ?? '');
          const team = clean(body.team, 16);
          if (!draft.teams.includes(team)) throw new HttpError(400, '这个组别不存在');
          player.team = team;
          break;
        }
        case 'setTeams': {
          requireHost(draft, playerId ?? '');
          if (draft.state === 'playing') throw new HttpError(409, '游戏进行中不能修改组别');
          setTeams(draft, Array.isArray(body.teams) ? (body.teams as string[]) : []);
          break;
        }
        case 'settings': {
          requireHost(draft, playerId ?? '');
          if (draft.state === 'playing') throw new HttpError(409, '游戏进行中不能修改设置');
          applySettings(draft, {
            durationSec: body.durationSec as number,
            categoryIds: body.categoryIds as string[],
            skipPenalty: body.skipPenalty as boolean,
          });
          break;
        }
        case 'start': {
          requireHost(draft, playerId ?? '');
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
          requireHost(draft, playerId ?? '');
          finishRound(draft);
          break;
        }
        case 'reset': {
          requireHost(draft, playerId ?? '');
          resetRoom(draft);
          break;
        }
        case 'clearHistory': {
          requireHost(draft, playerId ?? '');
          clearHistory(draft);
          resetRoom(draft);
          break;
        }
        case 'kick': {
          requireHost(draft, playerId ?? '');
          removePlayer(draft, String(body.targetId ?? ''));
          break;
        }
        case 'ping':
          break;
        default:
          throw new HttpError(400, `未知操作：${action}`);
      }
    });

    const viewer = joinedId ?? playerId;
    return NextResponse.json({ ...publicRoom(room, viewer), playerId: viewer });
  } catch (error) {
    return fail(error);
  }
}
