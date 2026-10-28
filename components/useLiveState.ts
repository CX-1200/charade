'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, session, voterHeaders } from '@/lib/client';
import type { PublicView } from '@/lib/view';

export type StateResponse = PublicView & { pass: 'none' | 'valid' | 'invalid'; device: string };

/**
 * Polls the public state. Hidden tabs slow right down, and a tab coming back
 * into view refreshes at once.
 */
export function useLiveState(everyMs: number) {
  const [state, setState] = useState<StateResponse | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await api<StateResponse>('/api/state', { headers: voterHeaders() });
      // Keep a second copy of the device id, so clearing cookies alone is not a fresh voter.
      if (data.device && session.getDevice() !== data.device) session.setDevice(data.device);
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

  return { state, setState, error, setError, refresh };
}
