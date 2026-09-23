import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { HttpError } from '@/lib/errors';
import { closeRoom, listRooms, roundScores } from '@/lib/game';

export const dynamic = 'force-dynamic';

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 500;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Server error' },
    { status },
  );
}

/** Every open room, for the admin's Manage rooms page. */
export async function GET(request: Request) {
  try {
    requireAdmin(new URL(request.url).searchParams.get('adminToken'));
    const now = Date.now();
    const rooms = (await listRooms()).map((room) => ({
      code: room.code,
      state: room.state,
      players: room.players.length,
      online: room.players.filter((p) => now - p.lastSeen < 20_000).length,
      teams: room.teams,
      rounds: room.history.length,
      answered: room.log.length,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      endsAt: room.endsAt,
      leader: roundScores(room).find((s) => s.score > 0)?.team ?? null,
    }));
    return NextResponse.json({ rooms });
  } catch (error) {
    return fail(error);
  }
}

/** Closing a room here is the only thing in the app that destroys one. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { adminToken?: string; code?: string; action?: string };
    requireAdmin(body.adminToken);
    if (body.action !== 'close') throw new HttpError(400, `Unknown action: ${body.action}`);
    const code = String(body.code ?? '').toUpperCase();
    if (!code) throw new HttpError(400, 'Which room?');
    const existed = await closeRoom(code);
    if (!existed) throw new HttpError(404, 'That room is already gone');
    return NextResponse.json({ closed: code });
  } catch (error) {
    return fail(error);
  }
}
