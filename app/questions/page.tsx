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
          <span className="logo">📚</span> Prompt bank
        </div>
        <Link className="btn sm ghost" href="/">
          ← Back home
        </Link>
      </div>

      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="spread" style={{ marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0 }}>Categories</h2>
            <p className="muted">
              {bank?.categories.length ?? 0} categories · {total} prompts
            </p>
          </div>
        </div>

        <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 14 }}>
          <input
            type="text"
            value={newCategory}
            maxLength={30}
            placeholder="New category name, e.g. “Sports”"
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
          />
          <button className="btn primary" onClick={addCategory} disabled={busy}>
            + Add
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
                    <span className="count">{category.items.length}</span>
                    <button
                      className="btn sm danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete “${category.name}” and all of its prompts?`)) {
                          void mutate({ action: 'deleteCategory', categoryId: category.id });
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {bank && !bank.categories.length && (
                <div className="empty">No categories yet — create one above.</div>
              )}
              {!bank && <div className="empty">Loading…</div>}
            </div>
          </div>

          <div>
            {active ? (
              <>
                <h3>
                  Prompts in “{active.name}” ({active.items.length})
                </h3>
                <label className="field">
                  <span>Bulk add — one per line, commas work too</span>
                  <textarea
                    value={draft}
                    placeholder={'Giraffe\nPlaying basketball\nTitanic'}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                </label>
                <button
                  className="btn primary block"
                  onClick={addItems}
                  disabled={busy || !draft.trim()}
                >
                  + Add to “{active.name}”
                </button>

                <div className="log-list" style={{ marginTop: 14 }}>
                  {active.items.map((item) => (
                    <div key={item.id} className="q-item">
                      <span>{item.text}</span>
                      <button
                        className="btn sm ghost"
                        title="Remove"
                        onClick={() =>
                          mutate({ action: 'deleteItem', categoryId: active.id, itemId: item.id })
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {!active.items.length && <div className="empty">No prompts in here yet.</div>}
                </div>
              </>
            ) : (
              <div className="empty">Pick a category on the left to edit its prompts.</div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          💡 When a round starts, every category the host selected is <b>shuffled into one deck</b>.
          Players draw from it in turn, so nobody gets the same prompt twice.
        </p>
      </div>
    </main>
  );
}
