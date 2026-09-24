import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { storeDriver, storeIsShared, storePing } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Called once a day by Vercel Cron (see vercel.json).
 *
 * Free-tier databases are archived when nobody touches them — Turso after 10
 * days, Upstash after 30 — and a party game can easily sit unused that long.
 * One real read and write a day keeps the database counted as active, so it is
 * awake the next time you want to play.
 *
 * When CRON_SECRET is set, Vercel sends it as a bearer token and anything else
 * is refused, so strangers cannot spend your free-tier writes.
 */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  return (
    header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  );
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  if (!storeIsShared) {
    // Nothing remote to keep awake: local drivers never get archived.
    return NextResponse.json({ ok: true, skipped: `nothing to keep alive on ${storeDriver}` });
  }
  const ping = await storePing();
  return NextResponse.json(
    { ok: ping.ok, driver: storeDriver, at: new Date().toISOString(), error: ping.error ?? null },
    { status: ping.ok ? 200 : 503 },
  );
}
