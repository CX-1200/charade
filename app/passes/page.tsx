'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdmin } from '@/components/AdminUnlock';
import { Qr } from '@/components/Qr';
import { TopBar } from '@/components/TopBar';
import { adminHeaders, api, formatCode } from '@/lib/client';
import type { AdminView } from '@/lib/view';

/** A printable sheet of personal voting passes: cut along the dashed lines. */
export default function PassesPage() {
  const [admin] = useAdmin();
  const [view, setView] = useState<AdminView | null>(null);
  const [error, setError] = useState('');
  const [onlyUnused, setOnlyUnused] = useState(true);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    if (!admin) return;
    api<AdminView>('/api/admin/election', { headers: adminHeaders() })
      .then(setView)
      .catch((e) => setError((e as Error).message));
  }, [admin]);

  if (admin === false) {
    return (
      <>
        <TopBar />
        <main className="page">
          <h1>Admin only</h1>
          <p className="status-line">Unlock with the admin password first.</p>
        </main>
      </>
    );
  }

  const tickets = (view?.tickets ?? []).filter((t) => !onlyUnused || !Object.keys(t.used).length);

  return (
    <>
      <TopBar />
      <main className="page wide">
        <div className="no-print">
          <p className="eyebrow">Voting passes</p>
          <h1>Print and hand out</h1>
          <p className="status-line">
            {tickets.length} {tickets.length === 1 ? 'pass' : 'passes'} on this sheet. Each one
            votes once for King and once for Queen.
          </p>
          {error && <div className="err">{error}</div>}
          <div className="row" style={{ marginTop: 16 }}>
            <button
              className="btn primary"
              onClick={() => window.print()}
              disabled={!tickets.length}
            >
              Print
            </button>
            <label className="row" style={{ gap: 6, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={onlyUnused}
                onChange={(e) => setOnlyUnused(e.target.checked)}
              />
              Only passes that haven&rsquo;t voted
            </label>
            <Link className="btn ghost" href="/manage">
              Back to Manage
            </Link>
          </div>
        </div>
        <div className="passes">
          {origin &&
            tickets.map((t) => (
              <div key={t.code} className="pass">
                <div className="title">{view?.title}</div>
                <div className="small">Personal voting pass</div>
                <Qr
                  value={`${origin}/?t=${t.code}`}
                  size={150}
                  label={`Voting pass ${formatCode(t.code)}`}
                />
                <div className="code">{formatCode(t.code)}</div>
                <div className="small">Scan to vote · 1 vote for King · 1 vote for Queen</div>
              </div>
            ))}
        </div>
      </main>
    </>
  );
}
