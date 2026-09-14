'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, post, session } from '@/lib/client';

type CreateResponse = { code: string; playerId: string };
type JoinResponse = { playerId: string };

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);

  useEffect(() => {
    setName(session.getName());
    // On a serverless host the in-memory fallback is not shared between
    // instances, so warn instead of letting a game mysteriously fall apart.
    api<{ storeDriver: string }>('/api/health')
      .then(({ storeDriver }) => {
        const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
        setStorageWarning(storeDriver === 'memory' && !local);
      })
      .catch(() => undefined);
  }, []);

  async function createRoom() {
    setError('');
    if (!name.trim()) return setError('Enter your name first');
    setBusy('create');
    try {
      session.setName(name.trim());
      const data = await post<CreateResponse>('/api/rooms', { name: name.trim() });
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
        <Link className="btn sm ghost" href="/questions">
          📚 Prompt bank
        </Link>
      </div>

      <div className="card">
        <h1>Start a game, everybody guesses</h1>
        <p className="sub">
          Build your own categories, mix every prompt into one deck, gather your friends in a room,
          then race a timer you set yourself. Scores land on the dashboard by team.
        </p>

        {error && <div className="err">{error}</div>}
        {storageWarning && (
          <div className="notice">
            ⚠️ Running on the in-memory store. On serverless hosting rooms can vanish between
            instances — add the Upstash Redis / Vercel KV environment variables (see the README).
          </div>
        )}

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
            <h3>Create a room</h3>
            <button className="btn primary block" onClick={createRoom} disabled={busy !== null}>
              {busy === 'create' ? 'Creating…' : '🎉 Create room'}
            </button>
            <p className="muted" style={{ marginTop: 8 }}>
              You become the host and control the timer, categories and teams.
            </p>
          </div>

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
              <button className="btn" onClick={joinRoom} disabled={busy !== null}>
                {busy === 'join' ? '…' : 'Join'}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Share the code — anyone on the same link can join the lobby.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>How it works</h2>
        <div className="grid-2">
          <div>
            <h3>1 · Write prompts</h3>
            <p className="muted">
              In the prompt bank, create categories (Animals, Movies, Actions…) and drop prompts into
              each one.
            </p>
          </div>
          <div>
            <h3>2 · Gather</h3>
            <p className="muted">
              Everyone signs in with a name, lands in the same lobby and picks a team. The host sets
              the countdown.
            </p>
          </div>
          <div>
            <h3>3 · Play</h3>
            <p className="muted">
              When the clock starts everyone answers at once — hit Correct when they guess it, Skip
              when you are stuck.
            </p>
          </div>
          <div>
            <h3>4 · Dashboard</h3>
            <p className="muted">
              Time is up, scores settle automatically. Team standings and every answer on one screen,
              then run another round.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
