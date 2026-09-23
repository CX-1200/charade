'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, formatClock, post, session, type ApiError } from '@/lib/client';
import { DURATION_PRESETS, MAX_DURATION, MIN_DURATION, teamColor } from '@/lib/ui';
import type { RoomView } from '@/lib/serialize';
import type { Bank } from '@/lib/types';

type ViewResponse = RoomView & { playerId?: string | null };
type Storage = { driver: string; durable: boolean };

const storageOf = (error: ApiError): Storage | null =>
  (error.body?.storage as Storage | undefined) ?? null;
type Act = (body: Record<string, unknown>) => Promise<ViewResponse | null>;

const POLL_PLAYING = 900;
const POLL_IDLE = 1600;

export default function RoomClient({ code }: { code: string }) {
  const router = useRouter();
  const [view, setView] = useState<RoomView | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);
  const [storage, setStorage] = useState<Storage | null>(null);
  // One 404 can be an unlucky instance hop on a non-shared store; two is real.
  const missesRef = useRef(0);
  const [joinName, setJoinName] = useState('');
  const [needsJoin, setNeedsJoin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const offsetRef = useRef(0);

  /* ------------------------------------------------------------ bootstrap */

  useEffect(() => setJoinName(session.getName()), []);

  const applyView = useCallback((data: RoomView) => {
    offsetRef.current = data.now - Date.now();
    setView(data);
    setNeedsJoin(!data.you);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const pid = session.getPlayerId(code);
      const token = session.getAdminToken();
      const query = new URLSearchParams();
      if (pid) query.set('playerId', pid);
      if (token) query.set('adminToken', token);
      const data = await api<RoomView>(`/api/rooms/${code}?${query}`);
      missesRef.current = 0;
      applyView(data);
      setError('');
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 404) {
        const hint = storageOf(err);
        if (hint) setStorage(hint);
        missesRef.current += 1;
        if (missesRef.current >= 2) {
          session.clearPlayerId(code);
          setClosed(true);
        }
        return; // stay put and retry on the next poll
      }
      setError(err.message);
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
    if (closed) return;
    const delay = view?.room.state === 'playing' ? POLL_PLAYING : POLL_IDLE;
    const timer = setInterval(() => void refresh(), delay);
    return () => clearInterval(timer);
  }, [refresh, view?.room.state, closed]);

  // Local clock so the countdown stays smooth between polls.
  useEffect(() => {
    if (view?.room.state !== 'playing') return;
    const timer = setInterval(() => setTick(Date.now()), 200);
    return () => clearInterval(timer);
  }, [view?.room.state]);

  /* --------------------------------------------------------------- actions */

  const act = useCallback<Act>(
    async (body) => {
      setBusy(true);
      try {
        const data = await post<ViewResponse>(`/api/rooms/${code}`, {
          ...body,
          playerId: session.getPlayerId(code),
          adminToken: session.getAdminToken(),
        });
        if (data.playerId) session.setPlayerId(code, data.playerId);
        applyView(data);
        setError('');
        return data;
      } catch (e) {
        const err = e as ApiError;
        const hint = err.status === 404 ? storageOf(err) : null;
        if (hint) setStorage(hint);
        setError(err.message);
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

  /** Leaving takes you out of the room entirely, back to the home page. */
  const leave = useCallback(async () => {
    setBusy(true);
    try {
      await post(`/api/rooms/${code}`, {
        action: 'leave',
        playerId: session.getPlayerId(code),
        adminToken: session.getAdminToken(),
      }).catch(() => undefined);
    } finally {
      session.clearPlayerId(code);
      router.push('/');
    }
  }, [code, router]);

  /* ---------------------------------------------------------------- derived */

  const room = view?.room;
  const you = view?.you ?? null;
  const admin = !!view?.admin;

  const remainingMs = useMemo(() => {
    if (!room?.endsAt || room.state !== 'playing') return 0;
    return Math.max(0, room.endsAt - (tick + offsetRef.current));
  }, [room?.endsAt, room?.state, tick]);

  const timeUp = room?.state === 'playing' && remainingMs <= 0;
  useEffect(() => {
    if (timeUp) void refresh();
  }, [timeUp, refresh]);

  /* ----------------------------------------------------------------- render */

  if (closed) {
    return (
      <main className="shell">
        <Header code={code} />
        <div className="card">
          <h1>No such room</h1>
          {storage && !storage.durable ? (
            <>
              <p className="sub">
                This deployment has <b>no shared storage</b>, so each server instance keeps its own
                copy of the rooms. A room created on one instance is invisible to the next request —
                which is what just happened to {code}.
              </p>
              <div className="notice">
                This is a one-time deployment setup, not a bug in the game.{' '}
                <Link href="/setup">Open storage setup</Link> for the exact steps and a live check.
              </div>
            </>
          ) : (
            <p className="sub">
              Nothing is running under the code {code}. Check the code, or ask an admin to create
              the room.
            </p>
          )}
          <Link className="btn primary" href="/">
            ← Back home
          </Link>
        </div>
      </main>
    );
  }

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
            Enter room
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <Header
        code={code}
        you={you.name}
        team={you.team}
        color={you.team ? teamColor(room.teams, you.team) : undefined}
        admin={admin}
        onLeave={leave}
      />
      {error && <div className="err">{error}</div>}

      {!you.team && !admin ? (
        <TeamGate view={view} busy={busy} act={act} />
      ) : (
        <>
          {room.state === 'lobby' && (
            <Lobby
              view={view}
              bank={bank}
              busy={busy}
              act={act}
              code={code}
              admin={admin}
            />
          )}
          {room.state === 'playing' &&
            (view.you?.spectating ? (
              <LiveDashboard view={view} remainingMs={remainingMs} busy={busy} act={act} />
            ) : (
              <Play view={view} remainingMs={remainingMs} busy={busy} act={act} admin={admin} />
            ))}
          {room.state === 'finished' && <Dashboard view={view} admin={admin} busy={busy} act={act} />}
        </>
      )}

      <p className="muted" style={{ marginTop: 20, textAlign: 'center' }}>
        Room {code} ·{' '}
        {admin && (
          <>
            <Link href="/questions">Question Bank</Link> ·{' '}
            <Link href="/rooms">Manage rooms</Link> ·{' '}
          </>
        )}
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
  admin,
  onLeave,
}: {
  code: string;
  you?: string;
  team?: string;
  color?: string;
  admin?: boolean;
  onLeave?: () => void;
}) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo">🎭</span> Room <span className="code-pill">{code}</span>
      </div>
      {you && (
        <div className="row tight">
          {admin && <span className="chip on">🔓 Admin</span>}
          <div className="player-pill">
            <span className="status" />
            {you}
            {team && <span style={{ color, fontWeight: 700 }}>· {team}</span>}
          </div>
          {/* Always reachable — lobby, mid-round and on the dashboard alike. */}
          {onLeave && (
            <button className="btn sm ghost" onClick={onLeave}>
              Leave game
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Nobody plays without a team — this is the first thing a new arrival sees. */
function TeamGate({ view, busy, act }: { view: RoomView; busy: boolean; act: Act }) {
  const { room } = view;
  const [name, setName] = useState('');
  const first = room.teams.length === 0;

  const create = () => {
    if (!name.trim()) return;
    void act({ action: 'createTeam', team: name.trim() }).then((ok) => ok && setName(''));
  };

  return (
    <div className="card">
      <h1>{first ? 'Create the first team' : 'Pick your team'}</h1>
      <p className="sub">
        {first
          ? 'Nobody has made a team yet. Name one and you are in it — players build the teams, the admin just runs the round.'
          : 'Join one of the teams below, or start a new one of your own.'}
      </p>

      {!first && (
        <div className="section">
          <h3>Join an existing team</h3>
          <div className="row">
            {room.teams.map((team) => {
              const size = room.players.filter((p) => p.team === team).length;
              return (
                <button
                  key={team}
                  className="chip"
                  disabled={busy}
                  onClick={() => act({ action: 'joinTeam', team })}
                >
                  <i className="dot" style={{ background: teamColor(room.teams, team) }} />
                  {team}
                  <span className="muted">{size}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="section">
        <h3>{first ? 'Team name' : 'Or create a new team'}</h3>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input
            type="text"
            value={name}
            maxLength={16}
            autoFocus
            placeholder="e.g. Red Team"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button className="btn primary" onClick={create} disabled={busy || !name.trim()}>
            Create &amp; join
          </button>
        </div>
      </div>
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
  busy,
  act,
  code,
  admin,
}: {
  view: RoomView;
  bank: Bank | null;
  busy: boolean;
  act: Act;
  code: string;
  admin: boolean;
}) {
  const { room } = view;
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(view.you?.name ?? '');
  const [newTeam, setNewTeam] = useState('');

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

  const createTeam = () => {
    if (!newTeam.trim()) return;
    void act({ action: 'createTeam', team: newTeam.trim() }).then((ok) => ok && setNewTeam(''));
  };

  return (
    <>
      <div className="card">
        <div className="spread" style={{ marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0 }}>
              Lobby · {room.players.length} {room.players.length === 1 ? 'player' : 'players'}
            </h2>
            <p className="muted">Share the room code or link and everyone lands in this game.</p>
          </div>
          <button className="btn sm" onClick={copyInvite}>
            {copied ? '✓ Copied' : '🔗 Copy invite link'}
          </button>
        </div>

        <div className="section">
          <div className="section-head">
            <h3>You</h3>
            <button className="btn sm ghost" onClick={() => setRenaming((v) => !v)}>
              {renaming ? 'Cancel' : 'Change name'}
            </button>
          </div>
          {renaming ? (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input
                type="text"
                value={newName}
                maxLength={20}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' &&
                  act({ action: 'rename', name: newName }).then((ok) => ok && setRenaming(false))
                }
              />
              <button
                className="btn primary"
                disabled={busy || !newName.trim()}
                onClick={() =>
                  act({ action: 'rename', name: newName }).then((ok) => ok && setRenaming(false))
                }
              >
                Save
              </button>
            </div>
          ) : (
            <div className="row">
              <div className="player-pill">
                <span className="status" />
                {view.you?.name}
                <span style={{ color: teamColor(room.teams, view.you?.team ?? ''), fontSize: 12 }}>
                  {view.you?.team}
                </span>
              </div>
              {!view.you?.playing && <span className="muted">Your team sits out this round</span>}
            </div>
          )}
        </div>

        {view.you?.spectating && (
          <div className="notice" style={{ marginBottom: 16 }}>
            👁 <b>You are watching, not playing.</b> Stay out of the teams and your screen becomes a
            live scoreboard once the round starts. Join a team below if you would rather play.
          </div>
        )}

        <div className="section">
          <h3>{view.you?.team ? 'Your team' : 'Teams'}</h3>
          <div className="row">
            {room.teams.map((team) => (
              <button
                key={team}
                className={`chip${view.you?.team === team ? ' on' : ''}`}
                disabled={busy}
                onClick={() => act({ action: 'joinTeam', team })}
              >
                <i
                  className="dot"
                  style={{
                    background:
                      view.you?.team === team ? 'currentColor' : teamColor(room.teams, team),
                  }}
                />
                {team}
                <span className="muted">{room.players.filter((p) => p.team === team).length}</span>
              </button>
            ))}
          </div>
          <div className="row" style={{ flexWrap: 'nowrap', marginTop: 10 }}>
            <input
              type="text"
              value={newTeam}
              maxLength={16}
              placeholder="New team name"
              onChange={(e) => setNewTeam(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createTeam()}
            />
            <button className="btn" onClick={createTeam} disabled={busy || !newTeam.trim()}>
              + Create team
            </button>
          </div>
        </div>

        <div className="section">
          <h3>Everyone here</h3>
          <div className="row">
            {room.players.map((player) => (
              <div key={player.id} className="player-pill">
                <span className={`status${player.online ? '' : ' off'}`} />
                {player.name}
                {player.isHost && ' 👑'}
                <span style={{ color: teamColor(room.teams, player.team), fontSize: 12 }}>
                  {player.team || (player.id === room.hostId ? 'watching' : 'no team')}
                </span>
                {admin && player.id !== view.you?.id && (
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
      </div>

      {admin ? (
        <AdminPanel view={view} bank={bank} busy={busy} act={act} />
      ) : (
        <div className="card">
          <h2>Waiting for the admin…</h2>
          <p className="muted">
            This round runs for {room.settings.durationSec} seconds
            {room.settings.skipPenalty ? ', skips cost a point' : ''}. Teams playing:{' '}
            {room.settings.activeTeams.join(', ') || 'none selected yet'}.
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

function AdminPanel({
  view,
  bank,
  busy,
  act,
}: {
  view: RoomView;
  bank: Bank | null;
  busy: boolean;
  act: Act;
}) {
  const { room } = view;
  const [duration, setDuration] = useState(room.settings.durationSec);
  const [custom, setCustom] = useState(String(room.settings.durationSec));

  useEffect(() => {
    setDuration(room.settings.durationSec);
    setCustom(String(room.settings.durationSec));
  }, [room.settings.durationSec]);

  const selected = room.settings.categoryIds;
  const promptCount = room.promptCount ?? 0;
  const allIds = useMemo(() => bank?.categories.map((c) => c.id) ?? [], [bank]);

  function toggleCategory(id: string) {
    const next = selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id];
    void act({ action: 'settings', categoryIds: next });
  }

  function commitCustom() {
    const value = Number(custom);
    if (!Number.isFinite(value)) return setCustom(String(room.settings.durationSec));
    void act({ action: 'settings', durationSec: value });
  }

  return (
    <div className="card">
      <h2>Host settings</h2>

      <div className="section">
        <h3>Countdown — {duration}s</h3>
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
        <div className="row" style={{ marginTop: 10 }}>
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
              value={custom}
              placeholder={`${MIN_DURATION}-${MAX_DURATION}`}
              style={{ width: 78, padding: '4px 8px', borderRadius: 8 }}
              // Clearing on focus means you type the number instead of editing it.
              onFocus={() => setCustom('')}
              onChange={(e) => setCustom(e.target.value)}
              onBlur={commitCustom}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            s
          </span>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>Categories in play</h3>
          <span className="muted">
            {selected.length}/{allIds.length} selected · {promptCount} questions
          </span>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          {bank?.categories.map((category) => {
            const on = selected.includes(category.id);
            return (
              <button
                key={category.id}
                className={`chip${on ? ' on' : ' off'}`}
                onClick={() => toggleCategory(category.id)}
                disabled={busy}
                title={on ? 'Included — click to exclude' : 'Excluded — click to include'}
              >
                <i className="dot" style={{ background: on ? 'currentColor' : category.color }} />
                {category.name}
                <span className="muted">{category.items.length}</span>
              </button>
            );
          })}
          {bank && !bank.categories.length && (
            <Link className="btn sm" href="/questions">
              The bank is empty → add questions
            </Link>
          )}
        </div>
        <div className="row tight">
          <button
            className="btn sm ghost"
            onClick={() => act({ action: 'settings', categoryIds: allIds })}
          >
            Select all
          </button>
          <button
            className="btn sm ghost"
            onClick={() => act({ action: 'settings', categoryIds: [] })}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>Teams in this round</h3>
          <span className="muted">{room.settings.activeTeams.length} playing</span>
        </div>
        <div className="board">
          {room.teams.map((team) => {
            const active = room.settings.activeTeams.includes(team);
            const size = room.players.filter((p) => p.team === team).length;
            return (
              <div key={team} className={`team-row${active ? '' : ' out'}`}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: teamColor(room.teams, team),
                    flex: 'none',
                  }}
                />
                <span className="grow">
                  <b>{team}</b>
                  <span className="muted">
                    {size} {size === 1 ? 'player' : 'players'} · {active ? 'playing' : 'sitting out'}
                  </span>
                </span>
                <button
                  className={`chip${active ? ' on' : ''}`}
                  disabled={busy}
                  onClick={() => act({ action: 'setTeamActive', team, active: !active })}
                >
                  {active ? 'In' : 'Out'}
                </button>
                <button
                  className="btn sm ghost"
                  title={`Delete ${team}`}
                  disabled={busy}
                  onClick={() =>
                    confirm(`Delete team “${team}”? Its players go back to picking a team.`) &&
                    act({ action: 'removeTeam', team })
                  }
                >
                  ✕
                </button>
              </div>
            );
          })}
          {!room.teams.length && <div className="empty">No teams yet — players create their own.</div>}
        </div>
      </div>

      <label className="switch" style={{ marginBottom: 18 }}>
        <input
          type="checkbox"
          checked={room.settings.skipPenalty}
          onChange={(e) => act({ action: 'settings', skipPenalty: e.target.checked })}
        />
        <span className="track" />
        <span className="switch-label">
          Skips cost 1 point
          <span className="switch-hint">
            {room.settings.skipPenalty
              ? 'A skip takes a point off the team score.'
              : 'A skip is simply worth nothing.'}
          </span>
        </span>
      </label>

      <button
        className="btn primary block"
        disabled={busy || !promptCount || !room.settings.activeTeams.length}
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
  );
}

function Play({
  view,
  remainingMs,
  busy,
  act,
  admin,
}: {
  view: RoomView;
  remainingMs: number;
  busy: boolean;
  act: Act;
  admin: boolean;
}) {
  const { room, card, myStats } = view;
  const total = room.settings.durationSec * 1000;
  const pct = Math.max(0, Math.min(100, (remainingMs / total) * 100));
  const low = remainingMs <= 10_000;
  const playing = !!view.you?.playing;

  return (
    <>
      <div className="card">
        <div className="spread">
          <div>
            <div className={`timer${low ? ' low' : ''}`}>{formatClock(remainingMs)}</div>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {playing
                ? `${view.you?.team} · ${myStats?.correct ?? 0} correct · ${myStats?.skipped ?? 0} skipped`
                : 'Your team is sitting this round out'}
            </p>
          </div>
          {admin && (
            <button className="btn sm danger" onClick={() => act({ action: 'finish' })}>
              End now
            </button>
          )}
        </div>
        <div className="progress">
          <i style={{ width: `${pct}%` }} />
        </div>

        {playing ? (
          <>
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
          </>
        ) : (
          <div className="empty">Watching this round — the scores update live below.</div>
        )}
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

/** What a spectating admin sees while the round runs: scores, live. */
function LiveDashboard({
  view,
  remainingMs,
  busy,
  act,
}: {
  view: RoomView;
  remainingMs: number;
  busy: boolean;
  act: Act;
}) {
  const { room, scores, log } = view;
  const total = room.settings.durationSec * 1000;
  const pct = Math.max(0, Math.min(100, (remainingMs / total) * 100));
  const low = remainingMs <= 10_000;
  const playingTeams = scores.round.filter((s) => room.settings.activeTeams.includes(s.team));
  const best = Math.max(0, ...playingTeams.map((s) => s.score));
  const answering = room.players.filter(
    (p) => p.team && room.settings.activeTeams.includes(p.team),
  ).length;

  return (
    <>
      <div className="card">
        <div className="spread">
          <div>
            <div className={`timer${low ? ' low' : ''}`}>{formatClock(remainingMs)}</div>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              👁 Live scoreboard · {answering} playing · {room.answered} answered
            </p>
          </div>
          <button className="btn sm danger" disabled={busy} onClick={() => act({ action: 'finish' })}>
            End now
          </button>
        </div>
        <div className="progress">
          <i style={{ width: `${pct}%` }} />
        </div>

        <div className="live-grid">
          {playingTeams.map((team) => (
            <div
              key={team.team}
              className={`live-card${team.score === best && best > 0 ? ' lead' : ''}`}
            >
              <div className="team">
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background:
                      team.score === best && best > 0
                        ? 'var(--cream)'
                        : teamColor(room.teams, team.team),
                  }}
                />
                {team.team}
              </div>
              <div className="num">{team.correct}</div>
              <div className="detail">
                correct{room.settings.skipPenalty ? ` · ${team.score} pts` : ''} · {team.skipped}{' '}
                skipped
              </div>
              <div className="detail">
                {team.players.length} {team.players.length === 1 ? 'player' : 'players'}
              </div>
            </div>
          ))}
          {!playingTeams.length && <div className="empty">No teams are playing this round.</div>}
        </div>
      </div>

      <div className="card">
        <h2>As it happens</h2>
        <div className="ticker">
          {log.map((entry, index) => (
            <div key={`${entry.at}-${index}`} className="ticker-row">
              <span>
                <b style={{ color: teamColor(room.teams, entry.team) }}>{entry.playerName}</b>{' '}
                {entry.text}
              </span>
              <span className={`res ${entry.result}`}>
                {entry.result === 'correct' ? '✓' : '⏭'}
              </span>
            </div>
          ))}
          {!log.length && <div className="empty">Waiting for the first answer…</div>}
        </div>
      </div>
    </>
  );
}

function Dashboard({
  view,
  admin,
  busy,
  act,
}: {
  view: RoomView;
  admin: boolean;
  busy: boolean;
  act: Act;
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
        {admin ? (
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
          <p className="muted">Waiting for the admin to start the next round…</p>
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
