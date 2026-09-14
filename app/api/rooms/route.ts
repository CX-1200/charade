import { NextResponse } from 'next/server';
import { createRoom, HttpError, clean } from '@/lib/game';
import { publicRoom } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string; team?: string };
    const name = clean(body.name, 20);
    if (!name) throw new HttpError(400, '请输入你的名字');
    const room = await createRoom(name, clean(body.team, 16));
    const host = room.players[0];
    return NextResponse.json({ ...publicRoom(room, host.id), playerId: host.id, code: room.code });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '服务器错误' },
      { status },
    );
  }
}
