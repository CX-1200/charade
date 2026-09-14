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
    if (!name.trim()) return setError('请先输入你的名字');
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
    if (!name.trim()) return setError('请先输入你的名字');
    if (target.length !== 4) return setError('房间号是 4 位字符');
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
          <span className="logo">🎭</span> 你比划我猜
        </div>
        <Link className="btn sm ghost" href="/questions">
          📚 题库管理
        </Link>
      </div>

      <div className="card">
        <h1>开一局，大家一起猜</h1>
        <p className="sub">
          自建分类题库 → 出题时全部混合 → 多人同一个房间登录 → 倒计时一起作答 → 分组成绩直接上看板。
        </p>

        {error && <div className="err">{error}</div>}
        {storageWarning && (
          <div className="err" style={{ background: 'rgba(245,158,11,0.14)', borderColor: 'rgba(245,158,11,0.4)', color: '#fde68a' }}>
            ⚠️ 当前用的是内存存储，部署在 Serverless 上时房间可能在实例之间丢失。请在项目里配置
            Upstash Redis / Vercel KV 的环境变量（见 README）。
          </div>
        )}

        <label className="field">
          <span>你的名字</span>
          <input
            type="text"
            value={name}
            maxLength={20}
            placeholder="例如：小明"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="grid-2">
          <div>
            <h3>创建新房间</h3>
            <button className="btn primary block" onClick={createRoom} disabled={busy !== null}>
              {busy === 'create' ? '创建中…' : '🎉 创建房间'}
            </button>
            <p className="muted" style={{ marginTop: 8 }}>
              你会成为房主，可以设定时间、分类和组别。
            </p>
          </div>

          <div>
            <h3>加入已有房间</h3>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input
                type="text"
                value={code}
                maxLength={4}
                placeholder="房间号"
                style={{ textTransform: 'uppercase', letterSpacing: 4, fontWeight: 700 }}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
              />
              <button className="btn" onClick={joinRoom} disabled={busy !== null}>
                {busy === 'join' ? '…' : '加入'}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              把房间号发给朋友，他们打开同一个网址就能进来。
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>玩法</h2>
        <div className="grid-2">
          <div>
            <h3>1 · 出题</h3>
            <p className="muted">在「题库管理」里新建分类（动物、电影、动作…），往每个分类里加题目。</p>
          </div>
          <div>
            <h3>2 · 集合</h3>
            <p className="muted">大家用名字登录进同一个房间，选好自己的组别，房主设定倒计时长度。</p>
          </div>
          <div>
            <h3>3 · 作答</h3>
            <p className="muted">开始后所有人同时抢答，猜对按「正确 ✓」，卡住按「跳过 ⏭」。</p>
          </div>
          <div>
            <h3>4 · 看板</h3>
            <p className="muted">时间到自动结算，各组分数、答题明细一屏看完，可以直接再来一轮。</p>
          </div>
        </div>
      </div>
    </main>
  );
}
