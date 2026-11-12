'use client';

import { useEffect, useRef, useState } from 'react';
import type { ShowState } from '@/components/useLiveState';
import { useRemaining } from '@/components/useLiveState';
import type { Stage } from '@/lib/types';

/**
 * The scenes of the show, shared by the Live screen and guests' phones. Every
 * change eases in (scenes cross-fade, bars glide, rows slide into their new
 * order, numbers count up) so a room full of screens changes calmly.
 */

export type PollView = ShowState['polls'][number];

/** Holds the old scene for a moment while it fades out, then swaps in the new one. */
export function useSceneTransition<T extends string>(stage: T | undefined) {
  const [shown, setShown] = useState<T | undefined>(stage);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!stage || stage === shown) return;
    if (!shown) {
      setShown(stage);
      return;
    }
    setLeaving(true);
    const timer = setTimeout(() => {
      setShown(stage);
      setLeaving(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [stage, shown]);
  return { shown, leaving };
}

/* ---------------------------------------------------------- ornaments */

export const WATERMARK: Record<Stage, string> = {
  welcome: 'Best Dress',
  'king-open': 'King',
  'king-voting': 'King',
  'king-result': 'King',
  'queen-open': 'Queen',
  'queen-voting': 'Queen',
  'queen-result': 'Queen',
  finale: 'Best Dress',
};

/**
 * Behind every scene: two soft glows that drift very slowly, and the scene's
 * word set huge in outline. Enough texture that the screen never looks blank,
 * quiet enough that the names and bars stay the subject.
 */
export function Backdrop({ word }: { word: string }) {
  return (
    <div className="backdrop" aria-hidden="true">
      <span className="glow one" />
      <span className="glow two" />
      <span className="watermark" key={word}>
        {word}
      </span>
    </div>
  );
}

export function Crown({ size = 44, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`crown ${className}`}
      width={size}
      height={size * 0.72}
      viewBox="0 0 50 36"
      aria-hidden="true"
    >
      <path
        d="M4 30 L2 8 L14 18 L25 3 L36 18 L48 8 L46 30 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="2" cy="8" r="2.4" fill="currentColor" />
      <circle cx="25" cy="3" r="2.4" fill="currentColor" />
      <circle cx="48" cy="8" r="2.4" fill="currentColor" />
      <line x1="5" y1="33.5" x2="45" y2="33.5" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

/** A rule with a small diamond in the middle. */
export function Ornament({ delay = 0 }: { delay?: number }) {
  return (
    <div className="ornament grow" style={{ animationDelay: `${delay}s` }} aria-hidden="true">
      <span />
      <i />
      <span />
    </div>
  );
}

const CONFETTI = ['#de2c00', '#2d1947', '#c7becc', '#e0dace', '#de2c00', '#8c7f9c'];

/** One burst of paper confetti, falling once, timed to a reveal. */
export function Confetti({ delay, count = 70 }: { delay: number; count?: number }) {
  const [pieces] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      left: Math.random() * 100,
      drift: (Math.random() - 0.5) * 220,
      spin: (Math.random() - 0.5) * 1080,
      wait: delay + Math.random() * 0.7,
      fall: 2.6 + Math.random() * 2.2,
      w: 6 + Math.random() * 6,
      h: 10 + Math.random() * 8,
      color: CONFETTI[i % CONFETTI.length],
    })),
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={
            {
              left: `${p.left}%`,
              width: p.w,
              height: p.h,
              background: p.color,
              animationDelay: `${p.wait}s`,
              animationDuration: `${p.fall}s`,
              '--drift': `${p.drift}px`,
              '--spin': `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
  ).toUpperCase();
}

/* -------------------------------------------------------------- scenes */

export function Welcome({ state }: { state: ShowState }) {
  return (
    <div className="hero">
      <div className="rise" style={{ animationDelay: '0.05s' }}>
        <Crown size={64} className="float" />
      </div>
      <p className="eyebrow rise" style={{ animationDelay: '0.15s' }}>
        Tonight
      </p>
      <h1 className="rise" style={{ animationDelay: '0.3s' }}>
        {state.title}
      </h1>
      <Ornament delay={0.55} />
      <p className="hero-sub rise" style={{ animationDelay: '0.75s' }}>
        Best Dress — King &amp; Queen
      </p>
      <p className="muted rise" style={{ animationDelay: '0.9s' }}>
        Voting opens soon.
      </p>
      <Nominees state={state} />
    </div>
  );
}

/** Tonight's nominees, gliding past along the bottom of the welcome screen. */
function Nominees({ state }: { state: ShowState }) {
  const names = state.polls.flatMap((p) =>
    p.nominees.map((n) => ({ id: n.id, name: n.name, role: p.id === 'king' ? 'King' : 'Queen' })),
  );
  if (names.length < 2) return null;
  const run = names.map((n) => (
    <span key={n.id} className="ticker-item">
      {n.name}
      <small>{n.role}</small>
    </span>
  ));
  return (
    <div className="ticker rise" style={{ animationDelay: '1.2s' }} aria-label="Nominees">
      <p className="eyebrow">The nominees</p>
      <div className="ticker-window">
        <div
          className="ticker-track"
          style={{ animationDuration: `${Math.max(24, names.length * 4)}s` }}
        >
          {run}
          <span aria-hidden="true" style={{ display: 'contents' }}>
            {run}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Bars grow in one by one, last place first, and the winner is named last. */
export function Result({ poll }: { poll: PollView }) {
  const rows = ranked(poll);
  const winners = leadersOf(rows);
  const revealAt = 0.6 + rows.length * 0.22 + 0.9;
  return (
    <div className="result">
      {winners.length > 0 && <Confetti delay={revealAt + 0.2} />}
      <div className="scene-head rise">
        <div>
          <p className="eyebrow">Result</p>
          <h1>{poll.title}</h1>
        </div>
        <div className="total">
          <b>{poll.total}</b>
          {poll.total === 1 ? 'vote' : 'votes'}
        </div>
      </div>
      <hr className="rule" />
      <div className="reveal" style={{ animationDelay: `${revealAt}s` }}>
        {winners.length ? (
          <>
            <span className="label">
              <Crown size={30} />
              {winners.length > 1 ? 'It’s a tie' : 'Winner'}
            </span>
            <span className="name">{winners.map((w) => w.name).join(' & ')}</span>
          </>
        ) : (
          <span className="name quiet">No votes were cast</span>
        )}
      </div>
      <Bars poll={poll} reveal />
    </div>
  );
}

export function Finale({
  state,
  king,
  queen,
}: {
  state: ShowState;
  king: PollView;
  queen: PollView;
}) {
  return (
    <div className="finale">
      <Confetti delay={1.1} count={60} />
      <Confetti delay={1.9} count={60} />
      <p className="eyebrow rise" style={{ animationDelay: '0.1s' }}>
        {state.title}
      </p>
      <h1 className="rise" style={{ animationDelay: '0.25s' }}>
        Best Dress
      </h1>
      <Ornament delay={0.5} />
      <div className="crowns">
        <Crowned poll={king} role="King" delay={1.1} />
        <Crowned poll={queen} role="Queen" delay={1.9} />
      </div>
    </div>
  );
}

function Crowned({ poll, role, delay }: { poll: PollView; role: string; delay: number }) {
  const winners = leadersOf(ranked(poll));
  const votes = winners[0]?.votes ?? 0;
  return (
    <section className="crowned" style={{ animationDelay: `${delay}s` }} aria-label={poll.title}>
      <Crown size={52} />
      <p className="eyebrow">{role}</p>
      <p className="name">{winners.length ? winners.map((w) => w.name).join(' & ') : '—'}</p>
      {winners.length > 0 && (
        <p className="muted">
          {winners.length > 1 ? 'Tied · ' : ''}
          {votes} {votes === 1 ? 'vote' : 'votes'} of {poll.total}
        </p>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- bars */

const ROW = 58;

export function ranked(poll: PollView) {
  return poll.nominees
    .map((n) => ({ ...n, votes: poll.tally[n.id] ?? 0 }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}

export function leadersOf<T extends { votes: number }>(rows: T[]): T[] {
  const top = rows[0]?.votes ?? 0;
  return top > 0 ? rows.filter((r) => r.votes === top) : [];
}

/**
 * Rows sit at fixed heights and slide (transform) to their new rank, so an
 * overtake reads as movement, not as the list jumping. With `reveal`, every
 * bar starts empty and grows in turn, from last place up to first.
 */
export function Bars({ poll, reveal = false }: { poll: PollView; reveal?: boolean }) {
  const rows = ranked(poll);
  const leaders = leadersOf(rows);
  const max = Math.max(1, rows[0]?.votes ?? 0);
  const [grown, setGrown] = useState(!reveal);
  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => setGrown(true), 80);
    return () => clearTimeout(timer);
  }, [reveal]);

  // Rows keep their DOM order (by id) and only their position changes, so they glide.
  const order = new Map(rows.map((row, index) => [row.id, index]));
  if (!rows.length) return <p className="chart-empty">Nominees appear here once they are added.</p>;
  return (
    <div className="lbars" role="list" style={{ height: rows.length * ROW }}>
      {poll.nominees.map((nominee) => {
        const index = order.get(nominee.id)!;
        const row = rows[index];
        const lead = leaders.some((l) => l.id === row.id);
        const share = poll.total ? Math.round((row.votes / poll.total) * 100) : 0;
        const delay = reveal ? 0.6 + (rows.length - 1 - index) * 0.22 : 0;
        return (
          <div
            key={row.id}
            role="listitem"
            className="lrow"
            style={{ transform: `translateY(${index * ROW}px)`, height: ROW }}
          >
            <div className="bar-label">
              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
              <span className={`avatar${lead ? ' lead' : ''}`}>{initials(row.name)}</span>
              <span className="who">
                <b>{row.name}</b>
                {lead && !reveal && <span className="tag">Leading</span>}
                {row.note && <small>{row.note}</small>}
              </span>
            </div>
            <div className="bar-track">
              <div
                className={`bar${lead ? ' lead' : ''}`}
                style={{
                  width: grown ? `calc(${(row.votes / max) * 100}% - 90px)` : 0,
                  transitionDelay: `${delay}s`,
                  transitionDuration: reveal ? '1.1s' : undefined,
                }}
              />
              <span
                className={`bar-value${reveal ? ' delayed' : ''}`}
                style={reveal ? { animationDelay: `${delay + 0.7}s` } : undefined}
              >
                <b>
                  <CountUp value={row.votes} />
                </b>
                <span>{share}%</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}

/** Eases a number to its new value instead of letting it jump. */
export function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(start + (value - start) * eased);
      setShown(next);
      from.current = next;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

/* ------------------------------------------------- open / voting scenes */

/** The list is up, voting has not started: every nominee, waiting. */
export function OpenList({ poll, note }: { poll: PollView; note: string }) {
  return (
    <>
      <div className="scene-head rise">
        <div>
          <p className="eyebrow">Up next</p>
          <h1>{poll.title}</h1>
        </div>
      </div>
      <hr className="rule" />
      <p className="waiting rise" style={{ animationDelay: '0.1s' }}>
        <span className="live-dot" aria-hidden="true" />
        {note}
      </p>
      <div className="nominee-grid">
        {poll.nominees.map((n, i) => (
          <div
            key={n.id}
            className="nominee-card rise"
            style={{ animationDelay: `${0.2 + i * 0.07}s` }}
          >
            <span className="avatar">{initials(n.name)}</span>
            <span>
              <b>{n.name}</b>
              {n.note && <small>{n.note}</small>}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Voting under way: the countdown and the live count. */
export function VotingBoard({
  poll,
  skew,
  label = 'Voting now',
  aside,
}: {
  poll: PollView;
  skew: number;
  label?: string;
  aside?: React.ReactNode;
}) {
  const total = useCountUp(poll.total);
  const remaining = useRemaining(poll.status === 'open' ? poll.endsAt : null, skew);
  const locked = poll.status !== 'open' || remaining <= 0;
  return (
    <>
      <div className="scene-head rise">
        <div>
          <p className="eyebrow">
            {!locked && <span className="live-dot" aria-hidden="true" />}
            {locked ? 'Votes locked — counting…' : label}
          </p>
          <h1>{poll.title}</h1>
        </div>
        <div className="total">
          <b>{total}</b>
          {poll.total === 1 ? 'vote' : 'votes'}
        </div>
      </div>
      <hr className="rule" />
      <div className="voting-board">
        <Countdown
          ms={remaining}
          totalMs={poll.endsAt && poll.openedAt ? poll.endsAt - poll.openedAt : 0}
        />
        {aside}
        <div className="rise" style={{ animationDelay: '0.2s' }}>
          <Bars poll={poll} />
        </div>
      </div>
    </>
  );
}

/** Big mm:ss with a ring that empties; the last ten seconds turn the accent colour. */
export function Countdown({ ms, totalMs }: { ms: number; totalMs: number }) {
  const seconds = Math.ceil(ms / 1000);
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const share = totalMs > 0 ? Math.max(0, Math.min(1, ms / totalMs)) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div
      className={`countdown rise${seconds <= 10 ? ' urgent' : ''}`}
      role="timer"
      aria-label={`${seconds} seconds left`}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} className="track" />
        <circle
          cx="60"
          cy="60"
          r={r}
          className="left"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - share)}
        />
      </svg>
      <span className="digits">{text}</span>
      <small>{seconds > 0 ? 'left to vote' : 'time’s up'}</small>
    </div>
  );
}
