import { NextResponse } from 'next/server';
import { checkPassword, issueToken } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  if (!checkPassword(body.password)) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }
  return NextResponse.json(issueToken());
}
