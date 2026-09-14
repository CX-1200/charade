'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, formatClock, post, session } from '@/lib/client';
import { DURATION_PRESETS, MAX_DURATION, MIN_DURATION, teamColor } from '@/lib/ui';
import type { RoomView } from '@/lib/serialize';
import type { Bank } from '@/lib/types';

type ViewResponse = RoomView & { playerId?: string | null };

const POLL_PLAYING = 900;
const POLL_IDLE = 1600;

export default function RoomClient({ code }: { code: string }) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [view, setView] = useState<RoomView | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [error, setError] = useState('');
  const [joinName, setJoinName] = useState('');
  const [needsJoin, setNeedsJoin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const offsetRef = useRef(0);

  /* ------------------------------------------------------------ bootstrap */

  useEffect(() => {
    setPlayerId(session.getPlayerId(code));
    setJoinName(session.getName());
  }, [code]);

  const applyView = useCallback((data: RoomView) => {
    offsetRef.current = data.now - Date.now();
    setView(data);
    setNeedsJoin(!data.you);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const pid = session.getPlayerId(code);
      const data = await api<RoomView>(
        `/api/rooms/${code}${pid ? `?playerId=${encodeURIComponent(pid)}` : ''}`,
      );
      applyView(data);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [code, applyView]);

  useEffect(() => {
    void refresh();
    api<{ bank: Bank }>('/api/bank')
      .then((data) => setBank(data.bank))
      .catch(() => undefined);
  }, [refresh]);

  // Poll the room; faster while a round is running.
  useEffect(() => {
    const delay = view?.room.state === 'playing' ? POLL_PLAYING : POLL_IDLE;
    const timer = setInterval(() => void refresh(), delay);
    return () => clearInterval(timer);
  }, [refresh, view?.room.state]);

  // Local clock so the countdown stays smooth between polls.
  useEffect(() => {
    if (view?.room.state !== 'playing') return;
    const timer = setInterval(() => setTick(Date.now()), 200);
    return () => clearInterval(timer);
  }, [view?.room.state]);

  /* --------------------------------------------------------------- actions */

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const data = await post<ViewResponse>(`/api/rooms/${code}`, {
          ...body,
          playerId: session.getPlayerId(code),
        });
        if (data.playerId) {
          session.setPlayerId(code, data.playerId);
          setPlayerId(data.playerId);
        }
        applyView(data);
        setError('');
        return data;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [code, applyView],
  );

  async function join() {
    const name = joinName.trim();
    if (!name) return setError('Enter your name');
    session.setName(name);
    await act({ action: 'join', name });
  }

  /* ---------------------------------------------------------------- derived */

  const room = view?.room;
  const you = view?.you ?? null;
  const isHost = !!you?.isHost;

  const remainingMs = useMemo(() => {
    if (!room?.endsAt || room.state !== 'playing') return 0;
    return Math.max(0, room.endsAt - (tick + offsetRef.current));
  }, [room?.endsAt, room?.state, tick]);

  const timeUp = room?.state === 'playing' && remainingMs <= 0;
  useEffect(() => {
    if (timeUp) void refresh();
  }, [timeUp, refresh]);

  /* ----------------------------------------------------------------- render */

  if (!room) {
    return (
      <main className="shell">
        <Header code={code} />
        {error ? <div className="err">{error}</div> : <div className="empty">Loading…</div>}
        <Link className="btn ghost" href="/">
          ← Back home
        </Link>
      </main>
    );
  }

  if (needsJoin || !you) {
    return (
      <main className="shell">
        <Header code={code} />
        <div className="card">
          <h1>Join room {code}</h1>
          <p className="sub">
            {room.players.length} {room.players.length === 1 ? 'player is' : 'players are'} already
            here.
          </p>
          {error && <div className="err">{error}</div>}
          <label className="field">
            <span>Your name</span>
            <input
              type="text"
              value={joinName}
              maxLength={20}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
            />
          </label>
          <button className="btn primary block" onClick={join} disabled={busy}>
            Enter lobby
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <Header code={code} you={you.name} team={you.team} color={teamColor(room.teams, you.team)} />
      {error && <div className="err">{error}</div>}

      {room.state === 'lobby' && (
        <Lobby
          view={view}
          bank={bank}
          isHost={isHost}
          busy={busy}
          act={act}
          code={code}
          onLeave={() => {
            session.clearPlayerId(code);
            void act({ action: 'leave' });
            setPlayerId(null);
            setNeedsJoin(true);
          }}
        />
      )}

      {room.state === 'playing' && (
        <Play view={view} remainingMs={remainingMs} busy={busy} act={act} isHost={isHost} />
      )}

      {room.state === 'finished' && <Dashboard view={view} isHost={isHost} busy={busy} act={act} />}

      <p className="muted" style={{ marginTop: 20, textAlign: 'center' }}>
        {playerId ? 'Signed in · ' : ''}Room {code} · <Link href="/questions">Prompt bank</Link> ·{' '}
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}

/* ============================================================== components */

function Header({
  code,
  you,
  team,
  color,
}: {
  code: string;
  you?: string;
  team?: string;
  color?: string;
}) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo">🎭</span> Room <span className="code-pill">{code}</span>
      </div>
      {you && (
        <div className="player-pill">
          <span className="status" />
          {you}
          <span style={{ color, fontWeight: 700 }}>· {team}</span>
        </div>
      )}
    </div>
  );
}

function Scoreboard({
  title,
  scores,
  teams,
  hint,
}: {
  title: string;
  scores: RoomView['scores']['round'];
  teams: string[];
  hint?: string;
}) {
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {hint && <span className="muted">{hint}</span>}
      </div>
      <div className="board">
        {scores.map((row, index) => {
          const lead = index === 0 && row.score > 0;
          return (
          <div key={row.team} className={`board-row${lead ? ' lead' : ''}`}>
            <div className="rank">{medals[index] ?? index + 1}</div>
            <div>
              <div className="team-name">
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    // On the red leader row a red dot would disappear.
                    background: lead ? 'var(--cream)' : teamColor(teams, row.team),
                  }}
                />
                {row.team}
              </div>
              <div className="roster">{row.players.join(', ') || 'No members yet'}</div>
            </div>
            <div className="pts">
              <b>{row.score}</b>
              <small>
                ✓ {row.correct} · ⏭ {row.skipped}
              </small>
            </div>
          </div>
          );
        })}
        {!scores.length && <div className="empty">No scores yet.</div>}
      </div>
    </div>
  );
}

function Lobby({
  view,
  bank,
  isHost,
  busy,
  act,
  code,
  onLeave,
}: {
  view: RoomView;
  bank: Bank | null;
  isHost: boolean;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<unknown>;
  code: string;
  onLeave: () => void;
}) {
  const { room } = view;
  const [duration, setDuration] = useState(room.settings.durationSec);
  const [newTeam, setNewTeam] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => setDuration(room.settings.durationSec), [room.settings.durationSec]);

  const selected = room.settings.categoryIds;
  const selectedCount = useMemo(() => {
    if (!bank) return 0;
    const pool = selected.length
      ? bank.categories.filter((c) => selected.includes(c.id))
      : bank.categories;
    return pool.reduce((sum, c) => sum + c.items.length, 0);
  }, [bank, selected]);

  function toggleCategory(id: string) {
    if (!bank) return;
    const current = selected.length ? selected : bank.categories.map((c) => c.id);
    const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
    void act({ action: 'settings', categoryIds: next.length === bank.categories.length ? [] : next });
  }

  async function copyInvite() {
    const url = `${window.location.origin}/room/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link and share it:', url);
    }
  }

  return (
    <>
      <div className="card">
        <div className="spread" style={{ marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0 }}>
              Lobby · {room.players.length} {room.players.length === 1 ? 'player' : 'players'}
            </h2>
            <p className="muted">Share the room code or link and everyone lands in this game.</p>
          </div>
          <div className="row tight">
            <button className="btn sm" onClick={copyInvite}>
              {copied ? '✓ Copied' : '🔗 Copy invite link'}
            </button>
            <button className="btn sm ghost" onClick={onLeave}>
              Leave
            </button>
          </div>
        </div>

        <h3>Pick your team</h3>
        <div className="row" style={{ marginBottom: 16 }}>
          {room.teams.map((team) => (
            <button
              key={team}
              className={`chip${view.you?.team === team ? ' on' : ''}`}
              onClick={() => act({ action: 'setTeam', team })}
              disabled={busy}
            >
              <i
                className="dot"
                style={{
                  background:
                    view.you?.team === team ? 'currentColor' : teamColor(room.teams, team),
                }}
              />
              {team}
            </button>
          ))}
        </div>

        <h3>Players</h3>
        <div className="row">
          {room.players.map((player) => (
            <div key={player.id} className="player-pill">
              <span className={`status${player.online ? '' : ' off'}`} />
              {player.name}
              {player.isHost && ' 👑'}
              <span style={{ color: teamColor(room.teams, player.team), fontSize: 12 }}>
                {player.team}
              </span>
              {isHost && !player.isHost && (
                <button
                  className="btn sm ghost"
                  title="Remove player"
                  style={{ padding: '2px 6px' }}
                  onClick={() => act({ action: 'kick', targetId: player.id })}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {isHost ? (
        <div className="card">
          <h2>Host settings</h2>

          <label className="field">
            <span>Countdown: {duration} seconds</span>
            <input
              type="range"
              min={MIN_DURATION}
              max={300}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              onMouseUp={() => act({ action: 'settings', durationSec: duration })}
              onTouchEnd={() => act({ action: 'settings', durationSec: duration })}
            />
          </label>
          <div className="row" style={{ marginBottom: 16 }}>
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset}
                className={`chip${room.settings.durationSec === preset ? ' on' : ''}`}
                onClick={() => act({ action: 'settings', durationSec: preset })}
              >
                {preset}s
              </button>
            ))}
            <span className="chip" style={{ cursor: 'default', gap: 8 }}>
              Custom
              <input
                type="number"
                min={MIN_DURATION}
                max={MAX_DURATION}
                value={duration}
                style={{ width: 72, padding: '4px 8px', borderRadius: 8 }}
                onChange={(e) => setDuration(Number(e.target.value))}
                onBlur={() => act({ action: 'settings', durationSec: duration })}
                onKeyDown={(e) =>
                  e.key === 'Enter' && act({ action: 'settings', durationSec: duration })
                }
              />
              s
            </span>
          </div>

          <div className="spread" style={{ alignItems: 'baseline' }}>
            <h3>Categories</h3>
            <span className="muted">
              {selectedCount} prompts{!selected.length && ' · all selected'}
            </span>
          </div>
          <div className="row" style={{ marginBottom: 16 }}>
            {bank?.categories.map((category) => {
              const on = !selected.length || selected.includes(category.id);
              return (
                <button
                  key={category.id}
                  className={`chip${on ? ' on' : ''}`}
                  onClick={() => toggleCategory(category.id)}
                  disabled={busy}
                >
                  <i className="dot" style={{ background: on ? 'currentColor' : category.color }} />
                  {category.name}
                  <span className="muted">{category.items.length}</span>
                </button>
              );
            })}
            {bank && !bank.categories.length && (
              <Link className="btn sm" href="/questions">
                The bank is empty → add prompts
              </Link>
            )}
          </div>

          <h3>Teams</h3>
          <div className="row" style={{ marginBottom: 12 }}>
            {room.teams.map((team) => (
              <span key={team} className="chip" style={{ cursor: 'default' }}>
                <i className="dot" style={{ background: teamColor(room.teams, team) }} />
                {team}
                {room.teams.length > 1 && (
                  <b
                    style={{ cursor: 'pointer', color: 'var(--muted)' }}
                    title={`Remove ${team}`}
                    onClick={() =>
                      act({ action: 'setTeams', teams: room.teams.filter((t) => t !== team) })
                    }
                  >
                    ✕
                  </b>
                )}
              </span>
            ))}
          </div>
          <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 16 }}>
            <input
              type="text"
              value={newTeam}
              maxLength={16}
              placeholder="New team name"
              onChange={(e) => setNewTeam(e.target.value)}
            />
            <button
              className="btn"
              disabled={!newTeam.trim() || room.teams.length >= 6}
              onClick={() => {
                void act({ action: 'setTeams', teams: [...room.teams, newTeam.trim()] });
                setNewTeam('');
              }}
            >
              + Add
            </button>
          </div>

          <label className="row" style={{ marginBottom: 18, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={room.settings.skipPenalty}
              onChange={(e) => act({ action: 'settings', skipPenalty: e.target.checked })}
            />
            <span>Skips cost 1 point (off by default)</span>
          </label>

          <button
            className="btn primary block"
            disabled={busy || !selectedCount}
            onClick={() => act({ action: 'start' })}
          >
            🚀 Start game ({room.settings.durationSec}s)
          </button>
          {room.rounds > 0 && (
            <button
              className="btn ghost block"
              style={{ marginTop: 10 }}
              onClick={() => act({ action: 'clearHistory' })}
            >
              Clear overall scores
            </button>
          )}
        </div>
      ) : (
        <div className="card">
          <h2>Waiting for the host…</h2>
          <p className="muted">
            This round runs for {room.settings.durationSec} seconds
            {room.settings.skipPenalty ? ', skips cost a point' : ''}. Everyone answers at the same
            time.
          </p>
        </div>
      )}

      {room.rounds > 0 && (
        <Scoreboard
          title="Overall standings"
          scores={view.scores.total}
          teams={room.teams}
          hint={`${room.rounds} ${room.rounds === 1 ? 'round' : 'rounds'} played`}
        />
      )}
    </>
  );
}

function Play({
  view,
  remainingMs,
  busy,
  act,
  isHost,
}: {
  view: RoomView;
  remainingMs: number;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<unknown>;
  isHost: boolean;
}) {
  const { room, card, myStats } = view;
  const total = room.settings.durationSec * 1000;
  const pct = Math.max(0, Math.min(100, (remainingMs / total) * 100));
  const low = remainingMs <= 10_000;

  return (
    <>
      <div className="card">
        <div className="spread">
          <div>
            <div className={`timer${low ? ' low' : ''}`}>{formatClock(remainingMs)}</div>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {view.you?.team} · {myStats?.correct ?? 0} correct · {myStats?.skipped ?? 0} skipped
            </p>
          </div>
          {isHost && (
            <button className="btn sm danger" onClick={() => act({ action: 'finish' })}>
              End now
            </button>
          )}
        </div>
        <div className="progress">
          <i style={{ width: `${pct}%` }} />
        </div>

        <div className="word-card">
          {card ? (
            <div>
              <div className="word">{card.text}</div>
              <span className="tag" style={{ color: card.color }}>
                {card.categoryName}
              </span>
            </div>
          ) : (
            <div className="word" style={{ fontSize: 24 }}>
              Deck finished 🎉
            </div>
          )}
        </div>

        <div className="answer-buttons">
          <button
            className="correct"
            disabled={busy || !card}
            onClick={() => act({ action: 'answer', result: 'correct' })}
          >
            ✓ Correct
          </button>
          <button
            className="skip"
            disabled={busy || !card}
            onClick={() => act({ action: 'answer', result: 'skip' })}
          >
            ⏭ Skip
          </button>
        </div>
      </div>

      <Scoreboard
        title="Live scores"
        scores={view.scores.round}
        teams={room.teams}
        hint={`${room.answered} answered this round`}
      />
    </>
  );
}

function Dashboard({
  view,
  isHost,
  busy,
  act,
}: {
  view: RoomView;
  isHost: boolean;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const { room, scores, log } = view;
  const [tab, setTab] = useState<'round' | 'total'>('round');
  const winner = scores.round[0];

  return (
    <>
      <div className="card">
        <h1>🏁 Time&rsquo;s up</h1>
        <p className="sub">
          {winner && winner.score > 0
            ? `${winner.team} leads this round with ${winner.score} ${winner.score === 1 ? 'point' : 'points'}.`
            : 'Nobody scored this round.'}
        </p>
        <div className="tabs">
          <button className={tab === 'round' ? 'on' : ''} onClick={() => setTab('round')}>
            This round
          </button>
          <button className={tab === 'total' ? 'on' : ''} onClick={() => setTab('total')}>
            Overall ({room.rounds})
          </button>
        </div>
        {isHost ? (
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => act({ action: 'start' })}>
              🔁 Play again
            </button>
            <button className="btn" disabled={busy} onClick={() => act({ action: 'reset' })}>
              ⚙️ Back to lobby
            </button>
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() => act({ action: 'clearHistory' })}
            >
              Clear overall
            </button>
          </div>
        ) : (
          <p className="muted">Waiting for the host to start the next round…</p>
        )}
      </div>

      <Scoreboard
        title={tab === 'round' ? 'Round dashboard' : 'Overall dashboard'}
        scores={tab === 'round' ? scores.round : scores.total}
        teams={room.teams}
        hint={room.settings.skipPenalty ? 'Skip = −1' : 'Skip = 0'}
      />

      <div className="card">
        <h2>Answer log</h2>
        <div className="log-list">
          {log.map((entry, index) => (
            <div key={`${entry.at}-${index}`} className="log-item">
              <span>
                <b style={{ color: teamColor(room.teams, entry.team) }}>{entry.playerName}</b>{' '}
                <span className="muted">[{entry.categoryName}]</span> {entry.text}
              </span>
              <span className={`res ${entry.result}`}>
                {entry.result === 'correct' ? '✓ Correct' : '⏭ Skip'}
              </span>
            </div>
          ))}
          {!log.length && <div className="empty">No answers recorded.</div>}
        </div>
      </div>
    </>
  );
}
