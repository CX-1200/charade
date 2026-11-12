'use client';

/** An error thrown by `api`, carrying the status and the server's payload. */
export type ApiError = Error & { status?: number };

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
    throw error;
  }
  return data;
}

export const post = <T>(url: string, body: unknown, headers?: Record<string, string>) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(body), headers });

const ADMIN_KEY = 'bestdress:admin';
const DEVICE_KEY = 'bestdress:device';
const TICKET_KEY = 'bestdress:ticket';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

type AdminToken = { token: string; expiresAt: number };

/** Fired in this tab when the admin token changes (the `storage` event covers other tabs). */
export const ADMIN_EVENT = 'bestdress:admin-change';
const announce = () => safe(() => window.dispatchEvent(new Event(ADMIN_EVENT)), undefined);

export const session = {
  /** Returns the stored admin token, dropping it once it has expired. */
  getAdminToken: (): string | null =>
    safe(() => {
      const parsed = JSON.parse(localStorage.getItem(ADMIN_KEY) ?? 'null') as AdminToken | null;
      if (!parsed?.token || parsed.expiresAt < Date.now()) {
        localStorage.removeItem(ADMIN_KEY);
        return null;
      }
      return parsed.token;
    }, null),
  setAdminToken: (value: AdminToken) => {
    safe(() => localStorage.setItem(ADMIN_KEY, JSON.stringify(value)), undefined);
    announce();
  },
  clearAdminToken: () => {
    safe(() => localStorage.removeItem(ADMIN_KEY), undefined);
    announce();
  },

  /** The second copy of the device id (the first is an httpOnly cookie). */
  getDevice: () => safe(() => localStorage.getItem(DEVICE_KEY), null),
  setDevice: (id: string) => safe(() => localStorage.setItem(DEVICE_KEY, id), undefined),

  getTicket: () => safe(() => localStorage.getItem(TICKET_KEY), null),
  setTicket: (code: string) => safe(() => localStorage.setItem(TICKET_KEY, code), undefined),
  clearTicket: () => safe(() => localStorage.removeItem(TICKET_KEY), undefined),
};

/** What identifies this phone as a voter. */
export function voterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const device = session.getDevice();
  const ticket = session.getTicket();
  if (device) headers['x-device-id'] = device;
  if (ticket) headers['x-ticket'] = ticket;
  return headers;
}

export function adminHeaders(): Record<string, string> {
  const token = session.getAdminToken();
  return token ? { 'x-admin-token': token } : {};
}

/** "ABCD2345" → "ABCD-2345", easier to read off a printed pass. */
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
