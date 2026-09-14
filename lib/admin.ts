import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors';

/**
 * Minimal admin gate: one shared password unlocks an HMAC-signed bearer token.
 * There are no accounts here — the token only says "someone knew the password",
 * which is exactly the trust level a party game needs.
 */
const PASSWORD = process.env.ADMIN_PASSWORD || 'charade';
const SECRET = process.env.ADMIN_SECRET || `charade-admin:${PASSWORD}`;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function checkPassword(input: unknown): boolean {
  return typeof input === 'string' && safeEqual(input, PASSWORD);
}

export function issueToken(): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  return { token: `${expiresAt}.${sign(String(expiresAt))}`, expiresAt };
}

export function isAdmin(token: unknown): boolean {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [exp, signature] = token.split('.', 2);
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  return safeEqual(signature, sign(exp));
}

export function requireAdmin(token: unknown): void {
  if (!isAdmin(token)) throw new HttpError(403, 'Admin access required');
}
