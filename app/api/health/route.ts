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

export async function GET() {
  const ping = await storePing();
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
