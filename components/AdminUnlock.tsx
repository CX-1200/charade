'use client';

import { useEffect, useState } from 'react';
import { post, session } from '@/lib/client';
import { DEMO_EVENT, isDemoMode } from '@/lib/demo';

type UnlockResponse = { token: string; expiresAt: number };

/** Whether this browser may use admin features: a live token, or demo mode. */
export function useAdmin() {
  const [admin, setAdmin] = useState<boolean | null>(null); // null = still checking
  useEffect(() => {
    const sync = () => setAdmin(isDemoMode() || !!session.getAdminToken());
    sync();
    window.addEventListener(DEMO_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(DEMO_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return [admin, setAdmin] as const;
}

export function AdminUnlock({
  onUnlocked,
  autoFocus = true,
}: {
  onUnlocked: () => void;
  autoFocus?: boolean;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function unlock() {
    setError('');
    setBusy(true);
    try {
      const data = await post<UnlockResponse>('/api/admin', { password });
      session.setAdminToken(data);
      setPassword('');
      onUnlocked();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div className="err">{error}</div>}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input
          type="password"
          value={password}
          placeholder="Admin password"
          autoFocus={autoFocus}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && unlock()}
        />
        <button className="btn primary" onClick={unlock} disabled={busy}>
          {busy ? '…' : 'Unlock'}
        </button>
      </div>
    </>
  );
}
