import { HttpError } from './errors';
import { kvDel, kvGet, kvSet } from './store';

/**
 * Counts failures per client IP in the shared store, so a limit holds across
 * every server instance. Used where a wrong guess is the only way in: the admin
 * password and voting-pass codes. Successful attempts are never limited — a
 * whole venue sharing one Wi-Fi IP can vote at once.
 */
function limiter(name: string, maxFailures: number, windowSeconds: number, message: string) {
  const key = (ip: string) => `vote:fail:${name}:${ip}`;
  const count = async (ip: string) => (await kvGet<{ n: number }>(key(ip)))?.n ?? 0;
  return {
    async assertAllowed(ip: string) {
      if ((await count(ip)) >= maxFailures) throw new HttpError(429, message);
    },
    async recordFailure(ip: string) {
      await kvSet(key(ip), { n: (await count(ip)) + 1 }, windowSeconds);
    },
    async clear(ip: string) {
      await kvDel(key(ip));
    },
  };
}

export const loginLimiter = limiter(
  'login',
  10,
  15 * 60,
  'Too many wrong passwords — wait 15 minutes and try again',
);

/**
 * Generous on purpose: a whole venue may share one IP, and a typo is not an
 * attack. Codes are 8 characters from 31 (~850 billion), so even this many
 * guesses per IP gets nowhere.
 */
export const ticketLimiter = limiter(
  'ticket',
  60,
  10 * 60,
  'Too many wrong pass codes — wait 10 minutes and try again',
);

/** The caller's IP as Vercel's edge reports it (first hop of x-forwarded-for). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (forwarded || request.headers.get('x-real-ip') || 'unknown').slice(0, 64);
}
