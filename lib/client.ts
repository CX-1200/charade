'use client';

/** An error thrown by `api`, carrying the status and the server's payload. */
export type ApiError = Error & {
  status?: number;
  body?: Record<string, unknown>;
};

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const error: ApiError = new Error(data?.error || `Request failed (${res.status})`);
    error.status = res.status;
    // Routes attach diagnostics (e.g. which store driver is live) — keep them.
    error.body = data as Record<string, unknown>;
    throw error;
  }
  return data;
}

export const post = <T>(url: string, body: unknown) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(body) });

const NAME_KEY = 'charade:name';
const ADMIN_KEY = 'charade:admin';
/**
 * A seat is what a browser holds for one room: the public player id plus the
 * private secret that proves it. (Older builds stored only the id, under
 * `charade:pid:` — an id alone proves nothing, so those are simply ignored.)
 */
const seatKey = (code: string) => `charade:seat:${code.toUpperCase()}`;
export type Seat = { playerId: string; secret: string };

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

type AdminToken = { token: string; expiresAt: number };

export const session = {
  getName: () => safe(() => localStorage.getItem(NAME_KEY) ?? '', ''),
  setName: (name: string) => safe(() => localStorage.setItem(NAME_KEY, name), undefined),

  getSeat: (code: string): Seat | null =>
    safe(() => {
      const parsed = JSON.parse(localStorage.getItem(seatKey(code)) ?? 'null') as Seat | null;
      return parsed?.playerId && parsed?.secret ? parsed : null;
    }, null),
  setSeat: (code: string, seat: { playerId?: string | null; secret?: string | null }) => {
    if (!seat.playerId || !seat.secret) return;
    const value: Seat = { playerId: seat.playerId, secret: seat.secret };
    safe(() => localStorage.setItem(seatKey(code), JSON.stringify(value)), undefined);
  },
  clearSeat: (code: string) => safe(() => localStorage.removeItem(seatKey(code)), undefined),

  /** Returns the stored admin token, dropping it once it has expired. */
  getAdminToken: (): string | null =>
    safe(() => {
      const raw = localStorage.getItem(ADMIN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AdminToken;
      if (!parsed?.token || parsed.expiresAt < Date.now()) {
        localStorage.removeItem(ADMIN_KEY);
        return null;
      }
      return parsed.token;
    }, null),
  setAdminToken: (value: AdminToken) =>
    safe(() => localStorage.setItem(ADMIN_KEY, JSON.stringify(value)), undefined),
  clearAdminToken: () => safe(() => localStorage.removeItem(ADMIN_KEY), undefined),
};

/** Credentials for a room request body: who you are, and the proof. */
export function roomAuth(code: string) {
  const seat = session.getSeat(code);
  return {
    playerId: seat?.playerId ?? null,
    secret: seat?.secret ?? null,
    adminToken: session.getAdminToken(),
  };
}

/**
 * The same credentials as headers, for GET requests. Headers rather than the
 * URL, because URLs end up in browser history and server logs.
 */
export function authHeaders(code?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const seat = code ? session.getSeat(code) : null;
  const token = session.getAdminToken();
  if (seat) {
    headers['x-player-id'] = seat.playerId;
    headers['x-player-secret'] = seat.secret;
  }
  if (token) headers['x-admin-token'] = token;
  return headers;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** How long a team took: "48.2s" under a minute, "3:05" after. */
export function formatElapsed(ms: number): string {
  const secs = Math.max(0, ms) / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
