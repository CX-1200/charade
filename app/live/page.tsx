'use client';

import { useEffect, useRef, useState } from 'react';
import { Qr } from '@/components/Qr';
import { TopBar } from '@/components/TopBar';
import { useLiveState, type StateResponse } from '@/components/useLiveState';
import type { PollId, Stage } from '@/lib/types';

type PollView = StateResponse['polls'][number];

/**
 * The big screen. It has no controls of its own: the admin steps through the
 * show in Manage and this follows — King votes, King's result, Queen votes,
 * Queen's result, then the Best Dress finale. Every change eases in (scenes
 * cross-fade, bars glide, rows slide into their new order, numbers count up),
 * so the room sees a show rather than a page reloading.
 */
export default function LivePage() {
  const { state, error } = useLiveState(2000);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const { shown, leaving } = useSceneTransition(state?.stage);

  return (
    <>
      <TopBar actions={<FullscreenButton />} />
      <main className="page wide live">
        {shown && <Backdrop word={WATERMARK[shown]} />}
        {!state || !shown ? (
          error ? (
            <div className="err">{error}</div>
          ) : (
            <p className="muted">Loading…</p>
          )
        ) : (
          <div className={`scene${leaving ? ' out' : ''}`} key={shown}>
            <Scene stage={shown} state={state} origin={origin} />
          </div>
        )}
      </main>
    </>
  );
}

/** Holds the old scene for a moment while it fades out, then swaps in the new one. */
function useSceneTransition(stage: Stage | undefined) {
  const [shown, setShown] = useState<Stage | undefined>(stage);
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

function Scene({ stage, state, origin }: { stage: Stage; state: StateResponse; origin: string }) {
  const poll = (id: PollId) => state.polls.find((p) => p.id === id)!;
  switch (stage) {
    case 'welcome':
      return <Welcome state={state} />;
    case 'king-voting':
    case 'queen-voting':
      return (
        <Voting
          poll={poll(stage === 'king-voting' ? 'king' : 'queen')}
          state={state}
          origin={origin}
        />
      );
    case 'king-result':
    case 'queen-result':
      return <Result poll={poll(stage === 'king-result' ? 'king' : 'queen')} />;
    case 'finale':
      return <Finale state={state} king={poll('king')} queen={poll('queen')} />;
  }
}

/* ---------------------------------------------------------- ornaments */

const WATERMARK: Record<Stage, string> = {
  welcome: 'Best Dress',
  'king-voting': 'King',
  'king-result': 'King',
  'queen-voting': 'Queen',
  'queen-result': 'Queen',
  finale: 'Best Dress',
};

/**
 * Behind every scene: two soft glows that drift very slowly, and the scene's
 * word set huge in outline. Enough texture that the screen never looks blank,
 * quiet enough that the names and bars stay the subject.
 */
function Backdrop({ word }: { word: string }) {
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

function Crown({ size = 44, className = '' }: { size?: number; className?: string }) {
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
function Ornament({ delay = 0 }: { delay?: number }) {
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
function Confetti({ delay, count = 70 }: { delay: number; count?: number }) {
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
  ).toUpperCase();
}

/* -------------------------------------------------------------- scenes */

function Welcome({ state }: { state: StateResponse }) {
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
function Nominees({ state }: { state: StateResponse }) {
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

function Voting({ poll, state, origin }: { poll: PollView; state: StateResponse; origin: string }) {
  const total = useCountUp(poll.total);
  return (
    <>
      <div className="scene-head rise">
        <div>
          <p className="eyebrow">
            <span className="live-dot" aria-hidden="true" />
            Voting now
          </p>
          <h1>{poll.title}</h1>
        </div>
        <div className="total">
          <b>{total}</b>
          {poll.total === 1 ? 'vote' : 'votes'}
        </div>
      </div>
      <hr className="rule" />
      <div className="board">
        <aside className="qr-panel qr-card rise" style={{ animationDelay: '0.15s' }}>
          {origin && <Qr value={`${origin}/`} size={280} label="QR code to open the voting page" />}
          <p className="cta">
            {state.mode === 'ticket' ? 'Scan the QR on your pass' : 'Scan to vote'}
          </p>
          <p className="url">{origin.replace(/^https?:\/\//, '')}</p>
          <p className="qr-note">
            {state.mode === 'ticket' ? 'One vote per personal voting pass.' : 'One vote per phone.'}
          </p>
        </aside>
        <div className="rise" style={{ animationDelay: '0.3s' }}>
          <Bars poll={poll} />
        </div>
      </div>
    </>
  );
}

/** Bars grow in one by one, last place first, and the winner is named last. */
function Result({ poll }: { poll: PollView }) {
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

function Finale({ state, king, queen }: { state: StateResponse; king: PollView; queen: PollView }) {
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

function ranked(poll: PollView) {
  return poll.nominees
    .map((n) => ({ ...n, votes: poll.tally[n.id] ?? 0 }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}

function leadersOf<T extends { votes: number }>(rows: T[]): T[] {
  const top = rows[0]?.votes ?? 0;
  return top > 0 ? rows.filter((r) => r.votes === top) : [];
}

/**
 * Rows sit at fixed heights and slide (transform) to their new rank, so an
 * overtake reads as movement, not as the list jumping. With `reveal`, every
 * bar starts empty and grows in turn, from last place up to first.
 */
function Bars({ poll, reveal = false }: { poll: PollView; reveal?: boolean }) {
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
function useCountUp(value: number, ms = 700): number {
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

/* ---------------------------------------------------------- fullscreen */

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
