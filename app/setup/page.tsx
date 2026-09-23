'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/client';

type Health = {
  ok: boolean;
  storeDriver: 'redis' | 'file' | 'memory';
  durable: boolean;
  storeLocation: string;
  detected: { url: string | null; token: string | null; looksLikeRedisUrl: boolean };
  error: string | null;
};

const STEPS = [
  {
    title: 'Create a Redis database',
    body: (
      <>
        In your Vercel project, open the <b>Storage</b> tab → <b>Create Database</b> →{' '}
        <b>Upstash for Redis</b> (the free plan is plenty). Vercel connects it to the project and
        injects the credentials for you.
        <br />
        Prefer to do it yourself? Create a database at <b>upstash.com</b> and copy its{' '}
        <b>REST URL</b> and <b>REST token</b> from the database page.
      </>
    ),
  },
  {
    title: 'Check the environment variables',
    body: (
      <>
        Project → <b>Settings</b> → <b>Environment Variables</b>. You need a URL and a token, under
        any of these names:
        <br />
        <code>UPSTASH_REDIS_REST_URL</code> + <code>UPSTASH_REDIS_REST_TOKEN</code>, or{' '}
        <code>KV_REST_API_URL</code> + <code>KV_REST_API_TOKEN</code>.
        <br />
        The URL must start with <code>https://</code> — a <code>redis://</code> connection string is
        a different protocol and will not work here. Tick <b>Production</b> (and Preview, if you use
        it).
      </>
    ),
  },
  {
    title: 'Redeploy',
    body: (
      <>
        Environment variables are read at boot, so a running deployment keeps its old values.
        Deployments → the latest one → <b>⋯</b> → <b>Redeploy</b>. Then reload this page.
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
  const misconfigured = !!health?.durable && !health.ok;

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
            <Row label="Driver" value={health.storeDriver} good={health.storeDriver === 'redis'} />
            <Row
              label="Survives a redeploy"
              value={health.durable ? 'yes' : 'no'}
              good={health.durable}
            />
            <Row
              label="Shared between instances"
              value={health.storeDriver === 'redis' ? 'yes' : 'no'}
              good={health.storeDriver === 'redis'}
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
