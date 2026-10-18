import { NextResponse } from 'next/server';
import {
  detectedVars,
  storeDriver,
  storeIsDurable,
  storeIsShared,
  storeLocation,
  storePing,
} from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * The ping writes to the database, and this endpoint is public (the /setup
 * page uses it). One real check per instance every 30s is plenty for setup
 * and keeps anyone refreshing it in a loop from spending free-tier writes.
 */
const PING_CACHE_MS = 30_000;
let lastPing: { at: number; result: Awaited<ReturnType<typeof storePing>> } | null = null;

export async function GET() {
  if (!lastPing || Date.now() - lastPing.at > PING_CACHE_MS) {
    lastPing = { at: Date.now(), result: await storePing() };
  }
  const ping = lastPing.result;
  return NextResponse.json({
    ok: ping.ok,
    storeDriver,
    durable: storeIsDurable,
    shared: storeIsShared,
    storeLocation,
    // Names only — never the values.
    detected: detectedVars,
    error: ping.error ?? null,
  });
}
