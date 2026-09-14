import { NextResponse } from 'next/server';
import { storeDriver } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, storeDriver });
}
