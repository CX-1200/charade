import { NextResponse } from 'next/server';
import { storeDriver, storeIsDurable, storeLocation } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, storeDriver, durable: storeIsDurable, storeLocation });
}
