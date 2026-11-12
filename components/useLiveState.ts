'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminHeaders, api, session, voterHeaders } from '@/lib/client';
import type { GuestView, PublicView } from '@/lib/view';

/** The show, as the admin or a guest in the session sees it. */
export type ShowState = PublicView & { pass: 'none' | 'valid' | 'invalid'; device: string | null };
export type StateResponse = ShowState | GuestView;

/**
 * Polls the state. Hidden tabs slow right down, and a tab coming back into
 * view refreshes at once. `skew` is server time minus this device's clock, so
 * every screen counts down to the same moment.
 */
export function useLiveState(everyMs: number) {
  const [state, setState] = useState<StateResponse | null>(null);
  const [skew, setSkew] = useState(0);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const sent = Date.now();
      const data = await api<StateResponse>('/api/state', {
        headers: { ...voterHeaders(), ...adminHeaders() },
      });
      setSkew(data.now - (sent + Date.now()) / 2);
      // Keep a second copy of the device id, so clearing cookies alone is not a fresh voter.
      if (data.invited && data.device && session.getDevice() !== data.device) {
        session.setDevice(data.device);
      }
      setState(data);
      setError('');
      return data;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setInterval>;
    const schedule = () => {
      clearInterval(timer);
      const hidden = document.visibilityState === 'hidden';
      timer = setInterval(() => void refresh(), hidden ? 15_000 : everyMs);
      if (!hidden) void refresh();
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [refresh, everyMs]);

  return { state, setState, skew, error, setError, refresh };
}

/** Milliseconds left until `endsAt` on the server's clock, ticking. */
export function useRemaining(endsAt: number | null | undefined, skew: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [endsAt]);
  return endsAt ? Math.max(0, endsAt - (now + skew)) : 0;
}
