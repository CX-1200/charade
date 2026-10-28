'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Vote' },
  { href: '/live', label: 'Live' },
  { href: '/manage', label: 'Manage' },
];

/** Brand left, plain text tabs centred, page actions right. */
export function TopBar({ actions }: { actions?: React.ReactNode }) {
  const path = usePathname();
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        Best Dress<small>Vote</small>
      </Link>
      <nav className="tabs" aria-label="Main">
        {TABS.map((tab) => (
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
      <div className="top-actions">{actions}</div>
    </header>
  );
}
