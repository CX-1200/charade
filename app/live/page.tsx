'use client';

import { useEffect, useMemo, useState } from 'react';
import { Qr } from '@/components/Qr';
import { TopBar } from '@/components/TopBar';
import { useLiveState, type StateResponse } from '@/components/useLiveState';

type PollView = StateResponse['polls'][number];

type View = 'king' | 'queen' | 'both';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'king', label: 'King' },
  { id: 'queen', label: 'Queen' },
  { id: 'both', label: 'King & Queen' },
];

/**
 * The big-screen dashboard. It shows one vote at a time — King, then Queen —
 * and finally King & Queen together for the reveal. The admin drives which
 * from Manage; anyone at a screen can also tap the view row to look at another,
 * until the admin changes it again.
 */
export default function LivePage() {
  const { state, error } = useLiveState(2000);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const driven = useMemo<View | undefined>(() => (state ? viewFor(state) : undefined), [state]);
  const [picked, setPicked] = useState<View | null>(null);
  // A new choice from the admin wins over a local tap.
  const serverDisplay = state?.display;
  useEffect(() => setPicked(null), [serverDisplay]);
  const view = picked ?? driven ?? 'king';

  const qr = state && (
    <aside className="qr-panel">
      {origin && <Qr value={`${origin}/`} size={280} label="QR code to open the voting page" />}
      <p className="cta">{state.mode === 'ticket' ? 'Scan the QR on your pass' : 'Scan to vote'}</p>
      <p className="url">{origin.replace(/^https?:\/\//, '')}</p>
      <p className="muted" style={{ fontSize: 13 }}>
        {state.mode === 'ticket' ? 'One vote per personal voting pass.' : 'One vote per phone.'}
      </p>
    </aside>
  );

  return (
    <>
      <TopBar actions={<FullscreenButton />} />
      <main className="page wide">
        {!state ? (
          error ? (
            <div className="err">{error}</div>
          ) : (
            <p className="muted">Loading…</p>
          )
        ) : (
          <>
            <div className="live-head">
              <div>
                <h1>{state.title}</h1>
                <p className="status-line">{statusLine(state.polls)}</p>
              </div>
              <nav className="view-tabs" aria-label="Show">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    className={view === v.id ? 'on' : undefined}
                    aria-pressed={view === v.id}
                    onClick={() => setPicked(v.id)}
                  >
                    {v.label}
                  </button>
                ))}
              </nav>
            </div>
            {error && <div className="err">{error}</div>}
            <hr className="rule" />
            {view === 'both' ? (
              <BothView
                polls={state.polls}
                qr={state.polls.some((p) => p.status === 'open') && qr}
              />
            ) : (
              <div className="board">
                {qr}
                <div className="charts">
                  <PollChart poll={state.polls.find((p) => p.id === view)!} focused />
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

/** What the admin asked for; "auto" follows the open vote, and both once both are closed. */
function viewFor(state: StateResponse): View {
  if (state.display !== 'auto') return state.display;
  const open = state.polls.filter((p) => p.status === 'open');
  if (open.length === 1) return open[0].id;
  if (open.length > 1) return 'both';
  if (state.polls.every((p) => p.status === 'closed')) return 'both';
  const closed = state.polls
    .filter((p) => p.status === 'closed')
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  return closed[0]?.id ?? 'king';
}

/** The finale: both winners side by side, each over its own chart. */
function BothView({ polls, qr }: { polls: PollView[]; qr: React.ReactNode }) {
  return (
    <>
      {qr && <div className="both-qr">{qr}</div>}
      <div className="both">
        {polls.map((poll) => (
          <PollChart key={poll.id} poll={poll} focused compact />
        ))}
      </div>
    </>
  );
}

function statusLine(polls: PollView[]): string {
  return polls
    .map((p) => {
      const state =
        p.status === 'open' ? 'voting open' : p.status === 'closed' ? 'closed' : 'opens soon';
      return `${p.title}: ${state}${p.total ? ` · ${p.total} ${p.total === 1 ? 'vote' : 'votes'}` : ''}`;
    })
    .join('   ·   ');
}

function PollChart({
  poll,
  focused,
  compact = false,
}: {
  poll: PollView;
  focused: boolean;
  compact?: boolean;
}) {
  const rows = poll.nominees
    .map((n) => ({ ...n, votes: poll.tally[n.id] ?? 0 }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  const max = Math.max(1, ...rows.map((r) => r.votes));
  const top = rows[0]?.votes ?? 0;
  const leaders = top > 0 ? rows.filter((r) => r.votes === top) : [];
  const closed = poll.status === 'closed';

  return (
    <section aria-label={poll.title} className={compact ? 'chart compact' : 'chart'}>
      <div className="chart-head">
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>
            {poll.status === 'open' ? 'Voting open' : closed ? 'Final' : 'Opens soon'}
          </p>
          <h2>{poll.title}</h2>
        </div>
        <div className="total">
          <b>{poll.total}</b>
          {poll.total === 1 ? 'vote' : 'votes'}
        </div>
      </div>

      {closed && leaders.length > 0 && (
        <p className={compact ? 'winner big' : 'winner'}>
          <span className="label">{leaders.length > 1 ? 'Tie' : 'Winner'}</span>
          {leaders.map((l) => l.name).join(' & ')}
        </p>
      )}

      {rows.length ? (
        <div className="bars" role="list">
          {rows.map((row) => {
            const lead = leaders.some((l) => l.id === row.id);
            const share = poll.total ? Math.round((row.votes / poll.total) * 100) : 0;
            return (
              <div key={row.id} role="listitem" style={{ display: 'contents' }}>
                <div className="bar-label">
                  <b>{row.name}</b>
                  {lead && !closed && <span className="tag">Leading</span>}
                  {row.note && <small>{row.note}</small>}
                </div>
                <div
                  className="bar-track"
                  title={`${row.name} — ${row.votes} ${row.votes === 1 ? 'vote' : 'votes'} (${share}%)`}
                >
                  <div
                    className={`bar${lead && focused ? ' lead' : ''}`}
                    style={{ width: `calc(${(row.votes / max) * 100}% - 90px)` }}
                  />
                  <span className="bar-value">
                    <b>{row.votes}</b>
                    <span>{share}%</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="chart-empty">Nominees appear here once they are added.</p>
      )}
    </section>
  );
}

type FullscreenDoc = Document & { webkitFullscreenElement?: Element | null };

/** For the big screen. Hidden where the browser can't do it (iPhone Safari). */
function FullscreenButton() {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    setSupported(!!document.fullscreenEnabled);
    const sync = () =>
      setOn(!!(document.fullscreenElement || (document as FullscreenDoc).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  if (!supported) return null;
  return (
    <button
      className="btn sm ghost"
      onClick={() =>
        on
          ? void document.exitFullscreen().catch(() => undefined)
          : void document.documentElement.requestFullscreen().catch(() => undefined)
      }
    >
      {on ? 'Exit full screen' : 'Full screen'}
    </button>
  );
}
