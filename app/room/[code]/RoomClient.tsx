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
    if (!name) return setError('请输入你的名字');
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
        {error ? <div className="err">{error}</div> : <div className="empty">加载中…</div>}
        <Link className="btn ghost" href="/">
          ← 回首页
        </Link>
      </main>
    );
  }

  if (needsJoin || !you) {
    return (
      <main className="shell">
        <Header code={code} />
        <div className="card">
          <h1>加入房间 {code}</h1>
          <p className="sub">房间里已经有 {room.players.length} 位玩家。</p>
          {error && <div className="err">{error}</div>}
          <label className="field">
            <span>你的名字</span>
            <input
              type="text"
              value={joinName}
              maxLength={20}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
            />
          </label>
          <button className="btn primary block" onClick={join} disabled={busy}>
            进入大厅
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
        {playerId ? '已登录' : ''} · 房间 {code} · <Link href="/questions">题库管理</Link> ·{' '}
        <Link href="/">首页</Link>
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
        <span className="logo">🎭</span> 房间 <span className="code-pill">{code}</span>
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
        {scores.map((row, index) => (
          <div key={row.team} className={`board-row${index === 0 && row.score > 0 ? ' lead' : ''}`}>
            <div className="rank">{medals[index] ?? index + 1}</div>
            <div>
              <div className="team-name">
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: teamColor(teams, row.team),
                  }}
                />
                {row.team}
              </div>
              <div className="roster">{row.players.join('、') || '暂无成员'}</div>
            </div>
            <div className="pts">
              <b>{row.score}</b>
              <small>
                ✓ {row.correct} · ⏭ {row.skipped}
              </small>
            </div>
          </div>
        ))}
        {!scores.length && <div className="empty">还没有分数。</div>}
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
      window.prompt('复制这个链接分享给朋友：', url);
    }
  }

  return (
    <>
      <div className="card">
        <div className="spread" style={{ marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0 }}>大厅 · {room.players.length} 人在线</h2>
            <p className="muted">把房间号或链接发给朋友，他们就能加入同一局。</p>
          </div>
          <div className="row tight">
            <button className="btn sm" onClick={copyInvite}>
              {copied ? '✓ 已复制' : '🔗 复制邀请链接'}
            </button>
            <button className="btn sm ghost" onClick={onLeave}>
              退出
            </button>
          </div>
        </div>

        <h3>选择你的组别</h3>
        <div className="row" style={{ marginBottom: 16 }}>
          {room.teams.map((team) => (
            <button
              key={team}
              className={`chip${view.you?.team === team ? ' on' : ''}`}
              style={{ color: teamColor(room.teams, team) }}
              onClick={() => act({ action: 'setTeam', team })}
              disabled={busy}
            >
              <i className="dot" /> <span style={{ color: 'var(--text)' }}>{team}</span>
            </button>
          ))}
        </div>

        <h3>玩家</h3>
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
          <h2>房主设置</h2>

          <label className="field">
            <span>倒计时时长：{duration} 秒</span>
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
                {preset} 秒
              </button>
            ))}
            <span className="chip" style={{ cursor: 'default', gap: 8 }}>
              自定义
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
              秒
            </span>
          </div>

          <h3>
            出题分类 · 本轮题库 {selectedCount} 题
            {!selected.length && '（全部分类）'}
          </h3>
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
                  <i className="dot" style={{ color: category.color }} />
                  {category.name}
                  <span className="muted">{category.items.length}</span>
                </button>
              );
            })}
            {bank && !bank.categories.length && (
              <Link className="btn sm" href="/questions">
                题库是空的 → 去添加题目
              </Link>
            )}
          </div>

          <h3>组别</h3>
          <div className="row" style={{ marginBottom: 12 }}>
            {room.teams.map((team) => (
              <span key={team} className="chip" style={{ color: teamColor(room.teams, team) }}>
                <i className="dot" />
                <span style={{ color: 'var(--text)' }}>{team}</span>
                {room.teams.length > 1 && (
                  <b
                    style={{ cursor: 'pointer', color: 'var(--muted)' }}
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
              placeholder="新组别名称"
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
              + 添加
            </button>
          </div>

          <label className="row" style={{ marginBottom: 18, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={room.settings.skipPenalty}
              onChange={(e) => act({ action: 'settings', skipPenalty: e.target.checked })}
            />
            <span>跳过扣 1 分（默认不扣分）</span>
          </label>

          <button
            className="btn primary block"
            disabled={busy || !selectedCount}
            onClick={() => act({ action: 'start' })}
          >
            🚀 开始游戏（{room.settings.durationSec} 秒）
          </button>
          {room.rounds > 0 && (
            <button
              className="btn ghost block"
              style={{ marginTop: 10 }}
              onClick={() => act({ action: 'clearHistory' })}
            >
              清空累计成绩
            </button>
          )}
        </div>
      ) : (
        <div className="card">
          <h2>等待房主开始…</h2>
          <p className="muted">
            本轮时长 {room.settings.durationSec} 秒
            {room.settings.skipPenalty ? ' · 跳过扣分' : ''}。开始后大家同时作答。
          </p>
        </div>
      )}

      {room.rounds > 0 && (
        <Scoreboard
          title="累计成绩"
          scores={view.scores.total}
          teams={room.teams}
          hint={`已进行 ${room.rounds} 轮`}
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
              本组：{view.you?.team} · 我答对 {myStats?.correct ?? 0} 题 · 跳过 {myStats?.skipped ?? 0}
            </p>
          </div>
          {isHost && (
            <button className="btn sm danger" onClick={() => act({ action: 'finish' })}>
              提前结束
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
              题目已抽完 🎉
            </div>
          )}
        </div>

        <div className="answer-buttons">
          <button
            className="correct"
            disabled={busy || !card}
            onClick={() => act({ action: 'answer', result: 'correct' })}
          >
            ✓ 正确
          </button>
          <button
            className="skip"
            disabled={busy || !card}
            onClick={() => act({ action: 'answer', result: 'skip' })}
          >
            ⏭ 跳过
          </button>
        </div>
      </div>

      <Scoreboard
        title="实时比分"
        scores={view.scores.round}
        teams={room.teams}
        hint={`本轮已作答 ${room.answered} 次`}
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
        <h1>🏁 时间到！</h1>
        <p className="sub">
          {winner && winner.score > 0
            ? `本轮领先：${winner.team}（${winner.score} 分）`
            : '本轮还没有人得分。'}
        </p>
        <div className="tabs">
          <button className={tab === 'round' ? 'on' : ''} onClick={() => setTab('round')}>
            本轮成绩
          </button>
          <button className={tab === 'total' ? 'on' : ''} onClick={() => setTab('total')}>
            累计成绩（{room.rounds} 轮）
          </button>
        </div>
        {isHost ? (
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => act({ action: 'start' })}>
              🔁 再来一轮
            </button>
            <button className="btn" disabled={busy} onClick={() => act({ action: 'reset' })}>
              ⚙️ 回到大厅调设置
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => act({ action: 'clearHistory' })}>
              清空累计
            </button>
          </div>
        ) : (
          <p className="muted">等待房主开始下一轮…</p>
        )}
      </div>

      <Scoreboard
        title={tab === 'round' ? '本轮看板' : '累计看板'}
        scores={tab === 'round' ? scores.round : scores.total}
        teams={room.teams}
        hint={room.settings.skipPenalty ? '跳过 -1 分' : '跳过不扣分'}
      />

      <div className="card">
        <h2>答题明细</h2>
        <div className="log-list">
          {log.map((entry, index) => (
            <div key={`${entry.at}-${index}`} className="log-item">
              <span>
                <b style={{ color: teamColor(room.teams, entry.team) }}>{entry.playerName}</b>{' '}
                <span className="muted">[{entry.categoryName}]</span> {entry.text}
              </span>
              <span className={`res ${entry.result}`}>
                {entry.result === 'correct' ? '✓ 正确' : '⏭ 跳过'}
              </span>
            </div>
          ))}
          {!log.length && <div className="empty">本轮没有作答记录。</div>}
        </div>
      </div>
    </>
  );
}
