import { HttpError } from './errors';
import { kvDel, kvGet, kvSet } from './store';

/**
 * Slows down password guessing on the admin login. Failures are counted per
 * client IP in the shared store, so the limit holds across every server
 * instance; a correct password clears the count.
 */
const MAX_FAILURES = 10;
const WINDOW_SECONDS = 15 * 60;

const failKey = (ip: string) => `charade:login-fail:${ip}`;

/** The caller's IP as Vercel's edge reports it (first hop of x-forwarded-for). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (forwarded || request.headers.get('x-real-ip') || 'unknown').slice(0, 64);
}

export async function assertLoginAllowed(ip: string): Promise<void> {
  const failures = (await kvGet<{ n: number }>(failKey(ip)))?.n ?? 0;
  if (failures >= MAX_FAILURES) {
    throw new HttpError(429, 'Too many wrong passwords — wait 15 minutes and try again');
  }
}

export async function recordLoginFailure(ip: string): Promise<void> {
  const failures = (await kvGet<{ n: number }>(failKey(ip)))?.n ?? 0;
  await kvSet(failKey(ip), { n: failures + 1 }, WINDOW_SECONDS);
}

export async function clearLoginFailures(ip: string): Promise<void> {
  await kvDel(failKey(ip));
}
