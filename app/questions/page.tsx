'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, post } from '@/lib/client';
import type { Bank } from '@/lib/types';

type BankResponse = { bank: Bank };

export default function QuestionsPage() {
  const [bank, setBank] = useState<Bank | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const active = useMemo(
    () => bank?.categories.find((c) => c.id === activeId) ?? bank?.categories[0] ?? null,
    [bank, activeId],
  );
  const total = useMemo(
    () => bank?.categories.reduce((sum, c) => sum + c.items.length, 0) ?? 0,
    [bank],
  );

  useEffect(() => {
    api<BankResponse>('/api/bank')
      .then((data) => setBank(data.bank))
      .catch((e) => setError((e as Error).message));
  }, []);

  async function mutate(body: Record<string, unknown>) {
    setError('');
    setBusy(true);
    try {
      const data = await post<BankResponse>('/api/bank', body);
      setBank(data.bank);
      return data.bank;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    const next = await mutate({ action: 'addCategory', name });
    if (next) {
      setNewCategory('');
      const created = next.categories.find((c) => c.name === name);
      if (created) setActiveId(created.id);
    }
  }

  async function addItems() {
    if (!active || !draft.trim()) return;
    const ok = await mutate({ action: 'addItems', categoryId: active.id, texts: [draft] });
    if (ok) setDraft('');
  }

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">
          <span className="logo">📚</span> 题库管理
        </div>
        <Link className="btn sm ghost" href="/">
          ← 回首页
        </Link>
      </div>

      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="spread" style={{ marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0 }}>分类</h2>
            <p className="muted">共 {bank?.categories.length ?? 0} 个分类 · {total} 道题目</p>
          </div>
        </div>

        <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 14 }}>
          <input
            type="text"
            value={newCategory}
            maxLength={30}
            placeholder="新分类名称，例如「成语」"
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
          />
          <button className="btn primary" onClick={addCategory} disabled={busy}>
            + 新建
          </button>
        </div>

        <div className="grid-2">
          <div>
            <div className="cat-list">
              {bank?.categories.map((category) => (
                <div
                  key={category.id}
                  className={`cat-item${active?.id === category.id ? ' on' : ''}`}
                  onClick={() => setActiveId(category.id)}
                >
                  <div className="row tight">
                    <span
                      className="dot"
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: category.color,
                        display: 'inline-block',
                      }}
                    />
                    <b>{category.name}</b>
                  </div>
                  <div className="row tight">
                    <span className="count">{category.items.length} 题</span>
                    <button
                      className="btn sm danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`删除分类「${category.name}」和它的全部题目？`)) {
                          void mutate({ action: 'deleteCategory', categoryId: category.id });
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
              {bank && !bank.categories.length && (
                <div className="empty">还没有分类，先在上面新建一个吧。</div>
              )}
              {!bank && <div className="empty">加载中…</div>}
            </div>
          </div>

          <div>
            {active ? (
              <>
                <h3>
                  「{active.name}」的题目（{active.items.length}）
                </h3>
                <label className="field">
                  <span>批量添加 · 一行一题，也可以用逗号、顿号分隔</span>
                  <textarea
                    value={draft}
                    placeholder={'长颈鹿\n打篮球\n泰坦尼克号'}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                </label>
                <button className="btn primary block" onClick={addItems} disabled={busy || !draft.trim()}>
                  + 添加到「{active.name}」
                </button>

                <div className="log-list" style={{ marginTop: 14 }}>
                  {active.items.map((item) => (
                    <div key={item.id} className="q-item">
                      <span>{item.text}</span>
                      <button
                        className="btn sm ghost"
                        onClick={() =>
                          mutate({ action: 'deleteItem', categoryId: active.id, itemId: item.id })
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {!active.items.length && <div className="empty">这个分类还没有题目。</div>}
                </div>
              </>
            ) : (
              <div className="empty">选择左边的一个分类来编辑题目。</div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          💡 开始游戏时，房主选中的所有分类会被<b>打乱混合成一副牌</b>，每位玩家依次抽题，不会重复。
        </p>
      </div>
    </main>
  );
}
