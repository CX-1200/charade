'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AdminUnlock, useAdmin } from '@/components/AdminUnlock';

const ADMIN_TABS = [
  { href: '/live', label: 'Live' },
  { href: '/manage', label: 'Manage' },
];

/**
 * Brand left, plain text tabs centred, page actions right. Guests get no tabs
 * at all — their one page follows the show. Live and Manage appear once this
 * browser is unlocked through the hidden lock (the faint mark at the far right). Hiding the tab is a courtesy, not
 * the security: every admin request still needs a password-issued token.
 */
export function TopBar({ actions }: { actions?: React.ReactNode }) {
  const path = usePathname();
  const [admin] = useAdmin();
  const [unlocking, setUnlocking] = useState(false);
  const tabs = admin ? ADMIN_TABS : [];

  return (
    <header className="topbar">
      <Link href={admin ? '/manage' : '/'} className="brand">
        Best Dress<small>Vote</small>
      </Link>
      <nav className="tabs" aria-label="Main">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={path === tab.href ? 'on' : undefined}
            aria-current={path === tab.href ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="top-actions">
        {actions}
        {admin === false && (
          <button className="secret-lock" aria-label="Admin" onClick={() => setUnlocking(true)}>
            <LockGlyph />
          </button>
        )}
      </div>
      {unlocking && <UnlockDialog onClose={() => setUnlocking(false)} />}
    </header>
  );
}

function LockGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function UnlockDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
        <h2 id="unlock-title">Admin</h2>
        <p className="sub" style={{ marginBottom: 16 }}>
          Enter the admin password to manage the vote.
        </p>
        <AdminUnlock
          onUnlocked={() => {
            onClose();
            router.push('/manage');
          }}
        />
        <button className="btn link" style={{ marginTop: 14 }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
