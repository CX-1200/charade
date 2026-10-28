import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { HttpError } from './errors';
import { normalizeTicket } from './election';
import { ticketLimiter, clientIp } from './ratelimit';
import type { Election } from './types';

/**
 * Who is voting. There are no accounts, so "one person" has to be pinned to
 * something the person holds:
 *
 * - device mode: a random id this server hands the browser, kept both in an
 *   httpOnly cookie and in localStorage (sent back as a header), so clearing
 *   one of them is not enough. A private window or wiping both starts fresh —
 *   that is the honest limit of any no-login scheme.
 * - ticket mode: the code on a personal printed pass. Each code votes once per
 *   poll whichever phone uses it; guessing codes is rate-limited.
 *
 * IP addresses are deliberately NOT used to block votes: at a venue everyone
 * shares one Wi-Fi (and phone carriers share IPs too), so an IP rule would
 * block real guests long before it stopped a cheat.
 */
const DEVICE_COOKIE = 'bd_device';
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // the longest browsers allow

export type Voter = { key: string; ticket: string | null };

function hash(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function deviceOf(request: NextRequest): { id: string; fresh: boolean } {
  const fromCookie = request.cookies.get(DEVICE_COOKIE)?.value;
  if (fromCookie && DEVICE_ID.test(fromCookie)) return { id: fromCookie, fresh: false };
  const fromStorage = request.headers.get('x-device-id');
  if (fromStorage && DEVICE_ID.test(fromStorage)) return { id: fromStorage, fresh: true };
  return { id: randomBytes(16).toString('base64url'), fresh: true };
}

export function rememberDevice(request: NextRequest, response: NextResponse, deviceId: string) {
  const https =
    request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  response.cookies.set(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: https,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export const deviceVoterKey = (deviceId: string) => `d:${hash(deviceId)}`;

/**
 * Checks the pass code sent with this request. A wrong code counts towards the
 * per-IP guessing limit, so codes cannot be found by trying them.
 */
export async function checkTicket(request: Request, election: Election): Promise<string> {
  const raw = request.headers.get('x-ticket');
  if (!raw) throw new HttpError(401, 'Enter the code on your voting pass first');
  const ip = clientIp(request);
  await ticketLimiter.assertAllowed(ip);
  const code = normalizeTicket(raw);
  if (!code || !election.tickets[code]) {
    await ticketLimiter.recordFailure(ip);
    throw new HttpError(403, 'That pass code is not valid — check it and try again');
  }
  return code;
}

/** Resolves the voter casting a ballot. */
export async function identify(request: NextRequest, election: Election): Promise<Voter> {
  if (election.mode === 'ticket') {
    const ticket = await checkTicket(request, election);
    return { key: `t:${ticket}`, ticket };
  }
  const device = deviceOf(request);
  // A vote must come from a browser that loaded the page and got its id; a
  // request carrying neither the cookie nor the stored id is not a voter.
  if (device.fresh && !request.headers.get('x-device-id')) {
    throw new HttpError(400, 'Please reload the page and try again');
  }
  return { key: deviceVoterKey(device.id), ticket: null };
}
