'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { post, session } from '@/lib/client';

type CreateResponse = { code: string; playerId: string };
type JoinResponse = { playerId: string };
type UnlockResponse = { token: string; expiresAt: number };

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | 'unlock' | null>(null);
  const [error, setError] = useState('');

  const [admin, setAdmin] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [password, setPassword] = useState('');

  useEffect(() => {
    setName(session.getName());
    setAdmin(!!session.getAdminToken());
  }, []);

  async function unlock() {
    setError('');
    setBusy('unlock');
    try {
      const data = await post<UnlockResponse>('/api/admin', { password });
      session.setAdminToken(data);
      setAdmin(true);
      setShowUnlock(false);
      setPassword('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function lock() {
    session.clearAdminToken();
    setAdmin(false);
  }

  async function createRoom() {
    setError('');
    if (!name.trim()) return setError('Enter your name first');
    setBusy('create');
    try {
      session.setName(name.trim());
      const data = await post<CreateResponse>('/api/rooms', {
        name: name.trim(),
        adminToken: session.getAdminToken(),
      });
      session.setPlayerId(data.code, data.playerId);
      router.push(`/room/${data.code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function joinRoom() {
    setError('');
    const target = code.trim().toUpperCase();
    if (!name.trim()) return setError('Enter your name first');
    if (target.length !== 4) return setError('A room code is 4 characters');
    setBusy('join');
    try {
      session.setName(name.trim());
      const data = await post<JoinResponse>(`/api/rooms/${target}`, {
        action: 'join',
        name: name.trim(),
        playerId: session.getPlayerId(target),
      });
      session.setPlayerId(target, data.playerId);
      router.push(`/room/${target}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="logo">🎭</span> Charade Party
        </div>
        {admin ? (
          <button className="chip on" onClick={lock} title="Lock admin again">
            🔓 Admin unlocked
          </button>
        ) : (
          <button className="chip" onClick={() => setShowUnlock((v) => !v)}>
            🔒 Admin
          </button>
        )}
      </div>

      {showUnlock && !admin && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Unlock admin</h3>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            Admins create rooms and control the round settings. Everyone else just picks a name and
            joins.
          </p>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              type="password"
              value={password}
              placeholder="Admin password"
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && unlock()}
            />
            <button className="btn primary" onClick={unlock} disabled={busy === 'unlock'}>
              Unlock
            </button>
          </div>
        </div>
      )}

      <Link href="/questions" className="cta">
        <span className="cta-icon">📚</span>
        <span className="cta-body">
          <b>Question Bank</b>
          <span>Create categories and write the questions every round draws from</span>
        </span>
        <span className="cta-arrow">→</span>
      </Link>

      <div className="card">
        <h1>Start a game, everybody guesses</h1>
        <p className="sub">
          Pick a name, gather in one room, split into teams, then race a timer the admin sets.
          Scores land on the dashboard by team.
        </p>

        {error && <div className="err">{error}</div>}

        <label className="field">
          <span>Your name</span>
          <input
            type="text"
            value={name}
            maxLength={20}
            placeholder="e.g. Alex"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="grid-2">
          <div>
            <h3>Join a room</h3>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input
                type="text"
                value={code}
                maxLength={4}
                placeholder="CODE"
                style={{ textTransform: 'uppercase', letterSpacing: 4, fontWeight: 700 }}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
              />
              <button className="btn primary" onClick={joinRoom} disabled={busy !== null}>
                {busy === 'join' ? '…' : 'Join'}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Anyone with the 4-character code can play.
            </p>
          </div>

          <div>
            <h3>Create a room</h3>
            <button
              className="btn block"
              onClick={createRoom}
              disabled={busy !== null || !admin}
              title={admin ? undefined : 'Unlock admin first'}
            >
              {busy === 'create' ? 'Creating…' : '🎉 Create room'}
            </button>
            <p className="muted" style={{ marginTop: 8 }}>
              {admin
                ? 'You will control the timer, categories and teams.'
                : 'Admins only — unlock admin at the top right.'}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
