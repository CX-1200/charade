'use client';

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `请求失败 (${res.status})`);
  return data;
}

export const post = <T>(url: string, body: unknown) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(body) });

const NAME_KEY = 'charade:name';
const pidKey = (code: string) => `charade:pid:${code.toUpperCase()}`;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export const session = {
  getName: () => safe(() => localStorage.getItem(NAME_KEY) ?? '', ''),
  setName: (name: string) => safe(() => localStorage.setItem(NAME_KEY, name), undefined),
  getPlayerId: (code: string) => safe(() => localStorage.getItem(pidKey(code)), null),
  setPlayerId: (code: string, id: string) => safe(() => localStorage.setItem(pidKey(code), id), undefined),
  clearPlayerId: (code: string) => safe(() => localStorage.removeItem(pidKey(code)), undefined),
};

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
