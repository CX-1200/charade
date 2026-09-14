'use client';

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status})`) as Error & {
      status?: number;
    };
    error.status = res.status;
    throw error;
  }
  return data;
}

export const post = <T>(url: string, body: unknown) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(body) });

const NAME_KEY = 'charade:name';
const ADMIN_KEY = 'charade:admin';
const pidKey = (code: string) => `charade:pid:${code.toUpperCase()}`;

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

  getPlayerId: (code: string) => safe(() => localStorage.getItem(pidKey(code)), null),
  setPlayerId: (code: string, id: string) =>
    safe(() => localStorage.setItem(pidKey(code), id), undefined),
  clearPlayerId: (code: string) => safe(() => localStorage.removeItem(pidKey(code)), undefined),

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

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "2h 41m" / "12m" — used for how long a room has left. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
