'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';

type Health = {
  ok: boolean;
  storeDriver: 'turso' | 'redis' | 'file' | 'memory';
  shared: boolean;
  durable: boolean;
  storeLocation: string;
  detected: {
    provider: 'turso' | 'redis' | null;
    url: string | null;
    token: string | null;
    looksLikeRedisUrl: boolean;
  };
  error: string | null;
};

const STEPS = [
  {
    title: 'Create a free Turso database',
    body: (
      <>
        Sign up at <b>turso.tech</b> (free, no card) and create a database — pick the region
        closest to your Vercel project. The free plan allows 500 million reads and 10 million
        writes a month, which this game will not come near.
        <br />
        Or from Vercel: project → <b>Storage</b> → <b>Create Database</b> → <b>Turso</b>, which
        connects it and injects the variables for you.
      </>
    ),
  },
  {
    title: 'Add two environment variables',
    body: (
      <>
        Project → <b>Settings</b> → <b>Environment Variables</b>:
        <br />
        <code>TURSO_DATABASE_URL</code> — the database URL, starting with <code>libsql://</code>
        <br />
        <code>TURSO_AUTH_TOKEN</code> — a token from the database page (<b>Generate Token</b>)
        <br />
        Tick <b>Production</b> (and Preview, if you use it). If Redis variables are also set, Turso
        takes priority.
      </>
    ),
  },
  {
    title: 'Redeploy',
    body: (
      <>
        Environment variables are read at boot, so a running deployment keeps its old values.
        Deployments → the latest one → <b>⋯</b> → <b>Redeploy</b>. Then reload this page. Your
        questions load automatically from <code>data/questions.csv</code> in the repository.
      </>
    ),
  },
];

export default function SetupPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setHealth(await api<Health>('/api/health'));
    } catch {
      setHealth(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const good = !!health?.durable && !!health?.ok;
  // A configured-but-failing store is a different problem from having none.
  const misconfigured = !!health?.shared && !health.ok;

  const headline = good
    ? '✅ Storage is ready'
    : misconfigured
      ? '⚠️ Storage is configured but not working'
      : '⚠️ Storage is not shared';

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="logo">🛠</span> Storage setup
        </div>
        <Link className="btn sm ghost" href="/">
          ← Back home
        </Link>
      </div>

      <div className="card">
        <h1>{headline}</h1>
        <p className="sub">
          {good
            ? 'Rooms, scores and the question bank are stored durably and shared by every server instance. Nothing else to do.'
            : misconfigured
              ? `The credentials are set, but the app cannot use the store: ${health?.error}. Check the values against the database page, then redeploy.`
              : 'Every server instance is keeping its own copy of the data. On Vercel that means a room created by one request is invisible to the next, so players get “no such room”, and the question bank resets on every cold start.'}
        </p>

        {health ? (
          <div className="board">
            <Row label="Driver" value={health.storeDriver} good={health.shared} />
            <Row
              label="Survives a redeploy"
              value={health.durable ? 'yes' : 'no'}
              good={health.durable}
            />
            <Row
              label="Shared between instances"
              value={health.shared ? 'yes' : 'no'}
              good={health.shared}
            />
            <Row
              label="Live read/write test"
              value={health.ok ? 'passed' : (health.error ?? 'failed')}
              good={health.ok}
            />
            <Row
              label="URL variable"
              value={health.detected.url ?? 'none found'}
              good={!!health.detected.url}
            />
            <Row
              label="Token variable"
              value={health.detected.token ?? 'none found'}
              good={!!health.detected.token}
            />
          </div>
        ) : (
          <div className="empty">{checking ? 'Checking…' : 'Could not reach the server.'}</div>
        )}

        {health?.detected.provider === 'turso' && !health.detected.token && (
          <div className="err" style={{ marginTop: 14 }}>
            <code>{health.detected.url}</code> is set but <code>TURSO_AUTH_TOKEN</code> is missing,
            so the app ignored the database and fell back to {health.storeDriver}. On the Turso
            database page, <b>Generate Token</b> and add it as <code>TURSO_AUTH_TOKEN</code>, then
            redeploy.
          </div>
        )}

        {health?.detected.looksLikeRedisUrl && (
          <div className="err" style={{ marginTop: 14 }}>
            The URL you set starts with <code>redis://</code>. This app speaks the <b>REST</b> API,
            so it needs the <code>https://…</code> endpoint from the same database page.
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={check} disabled={checking}>
            {checking ? 'Checking…' : '↻ Re-test'}
          </button>
        </div>
      </div>

      {!good && (
        <div className="card">
          <h2>Three steps to fix it</h2>
          {STEPS.map((step, index) => (
            <div key={step.title} className="section">
              <h3>
                {index + 1} · {step.title}
              </h3>
              <p className="muted" style={{ margin: 0, lineHeight: 1.7 }}>
                {step.body}
              </p>
            </div>
          ))}
          <p className="muted" style={{ margin: 0 }}>
            Running locally instead? No setup needed — the app writes to{' '}
            <code>.data/charade.json</code> on disk.
          </p>
        </div>
      )}
    </main>
  );
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="team-row">
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          flex: 'none',
          background: good ? '#4a7c3f' : 'var(--accent)',
        }}
      />
      <span className="grow">
        <b>{label}</b>
      </span>
      <span className="muted" style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
        {value}
      </span>
    </div>
  );
}
