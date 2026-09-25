import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { newSecret } from '@/lib/auth';
import { clean, createRoom, getBank } from '@/lib/game';
import { HttpError } from '@/lib/errors';
import { publicRoom } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      adminToken?: string;
    };
    // Only an unlocked admin opens rooms.
    requireAdmin(body.adminToken);
    const name = clean(body.name, 20);
    if (!name) throw new HttpError(400, 'Please enter your name');
    const { secret, hash } = newSecret();
    const room = await createRoom(name, hash);
    const host = room.players[0];
    const bank = await getBank();
    return NextResponse.json({
      ...publicRoom(room, host.id, { admin: true, bank }),
      playerId: host.id,
      // Handed to the host alone, once; the server keeps only its hash.
      secret,
      code: room.code,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Server error' },
      { status },
    );
  }
}
