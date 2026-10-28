import { NextResponse } from 'next/server';
import { adminConfigured, checkPassword, issueToken } from '@/lib/admin';
import { HttpError } from '@/lib/errors';
import { fail, readJson } from '@/lib/http';
import { clientIp, loginLimiter } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!adminConfigured) {
      throw new HttpError(503, 'Admin is switched off: set ADMIN_PASSWORD on the server');
    }
    const ip = clientIp(request);
    await loginLimiter.assertAllowed(ip);
    const body = await readJson(request, 2_000);
    if (!checkPassword(body.password)) {
      await loginLimiter.recordFailure(ip);
      throw new HttpError(401, 'Wrong password');
    }
    await loginLimiter.clear(ip);
    return NextResponse.json(issueToken());
  } catch (error) {
    return fail(error);
  }
}
