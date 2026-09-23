'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, post, session } from '@/lib/client';
import { AdminUnlock, useAdmin } from '@/components/AdminUnlock';

type RoomRow = {
  code: string;
  state: 'lobby' | 'playing' | 'finished';
  players: number;
  online: number;
  teams: string[];
  rounds: number;
  answered: number;
  createdAt: number;
  updatedAt: number;
  leader: string | null;
};

const STATE_LABEL: Record<RoomRow['state'], string> = {
  lobby: 'In the lobby',
  playing: 'Round running',
  finished: 'Showing results',
};

function ago(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export default function ManageRoomsPage() {
  const [admin, setAdmin] = useAdmin();
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const token = session.getAdminToken();
    if (!token) return;
    try {
      const data = await api<{ rooms: RoomRow[] }>(
        `/api/admin/rooms?adminToken=${encodeURIComponent(token)}`,
      );
      setRooms(data.rooms);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!admin) return;
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [admin, load]);

  async function close(room: RoomRow) {
    const warning =
      room.online > 0
        ? `Close room ${room.code}? ${room.online} ${room.online === 1 ? 'person is' : 'people are'} in it right now and will be dropped.`
        : `Close room ${room.code}? Its teams and scores are deleted for good.`;
    if (!confirm(warning)) return;
    setBusy(room.code);
    try {
      await post('/api/admin/rooms', {
        action: 'close',
        code: room.code,
        adminToken: session.getAdminToken(),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const header = (
    <div className="topbar">
      <div className="brand">
        <span className="logo">🗂</span> Manage rooms
      </div>
      <Link className="btn sm ghost" href="/">
        ← Back home
      </Link>
    </div>
  );

  if (admin === null) {
    return (
      <main className="shell">
        {header}
        <div className="empty">Loading…</div>
      </main>
    );
  }

  if (!admin) {
    return (
      <main className="shell">
        {header}
        <div className="card">
          <h1>🔒 Admins only</h1>
          <p className="sub">Unlock admin to see and close open rooms.</p>
          <AdminUnlock onUnlocked={() => setAdmin(true)} />
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      {header}
      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="spread" style={{ marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0 }}>Open rooms</h2>
            <p className="muted">
              {rooms ? `${rooms.length} open` : 'Loading…'} · refreshes every 5s
            </p>
          </div>
        </div>

        <div className="board">
          {rooms?.map((room) => (
            <div key={room.code} className="team-row">
              <span className="grow">
                <b>
                  <Link href={`/room/${room.code}`}>{room.code}</Link>{' '}
                  <span className={`state-tag ${room.state}`}>{STATE_LABEL[room.state]}</span>
                </b>
                <span className="muted">
                  {room.online}/{room.players} online · {room.teams.length}{' '}
                  {room.teams.length === 1 ? 'team' : 'teams'}
                  {room.teams.length ? ` (${room.teams.join(', ')})` : ''} · {room.rounds}{' '}
                  {room.rounds === 1 ? 'round' : 'rounds'} · active {ago(room.updatedAt)}
                </span>
              </span>
              <button
                className="btn sm danger"
                disabled={busy === room.code}
                onClick={() => close(room)}
              >
                {busy === room.code ? '…' : 'Close'}
              </button>
            </div>
          ))}
          {rooms && !rooms.length && (
            <div className="empty">No open rooms. Create one from the home page.</div>
          )}
        </div>
      </div>

      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          ⚠️ Closing here is the <b>only</b> way a room is ever destroyed — nothing expires on its
          own, and an empty room keeps its code, teams and scores until you close it.
        </p>
      </div>
    </main>
  );
}
