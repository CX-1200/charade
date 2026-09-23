'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, post, session } from '@/lib/client';
import { AdminUnlock, useAdmin } from '@/components/AdminUnlock';
import type { Bank } from '@/lib/types';

type Storage = { driver: 'redis' | 'file' | 'memory'; durable: boolean };

/**
 * Demo mode is gone, but a browser that ran one may still hold the bank it
 * built there. Offer to rescue it once, then the key is cleared for good.
 * Safe to delete this and its card once no browser has one left.
 */
const LEGACY_DEMO_BANK_KEY = 'charade:demo:bank';

function readDemoBank(): Bank | null {
  try {
    const raw = localStorage.getItem(LEGACY_DEMO_BANK_KEY);
    const bank = raw ? (JSON.parse(raw) as Bank) : null;
    return bank?.categories?.length ? bank : null;
  } catch {
    return null;
  }
}

function clearDemoBank(): void {
  try {
    localStorage.removeItem(LEGACY_DEMO_BANK_KEY);
    localStorage.removeItem('charade:demoMode');
  } catch {
    /* nothing to clear */
  }
}
type BankResponse = { bank: Bank; storage?: Storage };

export default function QuestionsPage() {
  const [admin, setAdmin] = useAdmin();
  const [bank, setBank] = useState<Bank | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [draft, setDraft] = useState('');
  const [storage, setStorage] = useState<Storage | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // A bank left behind by the old demo mode, if this browser ran one.
  const [strandedBank, setStrandedBank] = useState<Bank | null>(null);

  const active = useMemo(
    () => bank?.categories.find((c) => c.id === activeId) ?? bank?.categories[0] ?? null,
    [bank, activeId],
  );
  const total = useMemo(
    () => bank?.categories.reduce((sum, c) => sum + c.items.length, 0) ?? 0,
    [bank],
  );

  useEffect(() => {
    setStrandedBank(readDemoBank());
    api<BankResponse>('/api/bank')
      .then((data) => {
        setBank(data.bank);
        setStorage(data.storage ?? null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  async function mutate(body: Record<string, unknown>) {
    setError('');
    setBusy(true);
    try {
      const data = await post<BankResponse>('/api/bank', {
        ...body,
        adminToken: session.getAdminToken(),
      });
      setBank(data.bank);
      if (data.storage) setStorage(data.storage);
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

  function exportBank() {
    if (!bank) return;
    const payload = {
      format: 'charade-question-bank',
      version: 1,
      exportedAt: new Date().toISOString(),
      categories: bank.categories.map((c) => ({
        name: c.name,
        color: c.color,
        items: c.items.map((i) => i.text),
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `charade-question-bank-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importBank(file: File, mode: 'merge' | 'replace') {
    setNote('');
    try {
      const data = JSON.parse(await file.text());
      const next = await mutate({ action: 'import', data, mode });
      if (next) {
        const total = next.categories.reduce((sum, c) => sum + c.items.length, 0);
        setNote(
          `Imported — the bank now holds ${next.categories.length} categories and ${total} questions.`,
        );
      }
    } catch (e) {
      setError(e instanceof SyntaxError ? 'That file is not valid JSON' : (e as Error).message);
    }
  }

  async function adoptDemoBank(mode: 'merge' | 'replace') {
    if (!strandedBank) return;
    const next = await mutate({
      action: 'import',
      mode,
      data: {
        categories: strandedBank.categories.map((c) => ({
          name: c.name,
          color: c.color,
          items: c.items.map((i) => i.text),
        })),
      },
    });
    if (next) {
      clearDemoBank();
      setStrandedBank(null);
      const total = next.categories.reduce((sum, c) => sum + c.items.length, 0);
      setNote(
        `Moved over — the server bank now holds ${next.categories.length} categories and ${total} questions.`,
      );
    }
  }

  async function addItems() {
    if (!active || !draft.trim()) return;
    const ok = await mutate({ action: 'addItems', categoryId: active.id, texts: [draft] });
    if (ok) setDraft('');
  }

  const header = (
    <div className="topbar">
      <div className="brand">
        <span className="logo">📚</span> Question Bank
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
          <p className="sub">
            The question bank is shared by every room, so only admins can edit it. Unlock admin to
            add categories and questions.
          </p>
          <AdminUnlock onUnlocked={() => setAdmin(true)} />
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      {header}

      {error && <div className="err">{error}</div>}
      {note && <div className="notice">{note}</div>}

      {strandedBank && (
        <div className="card">
          <h2>📦 A question bank from demo mode</h2>
          <p className="sub" style={{ marginBottom: 14 }}>
This browser still holds the bank it built back when demo mode existed —{' '}
            <b>
              {strandedBank.categories.length} categories,{' '}
              {strandedBank.categories.reduce((sum, c) => sum + c.items.length, 0)} questions
            </b>
            . The server has its own copy now, so move this one over or discard it.
          </p>
          <div className="row tight">
            <button className="btn primary sm" disabled={busy} onClick={() => adoptDemoBank('merge')}>
              Merge into the server bank
            </button>
            <button
              className="btn sm"
              disabled={busy}
              onClick={() =>
                confirm('Replace the server bank entirely with the demo one?') &&
                adoptDemoBank('replace')
              }
            >
              Replace the server bank
            </button>
            <button
              className="btn ghost sm"
              disabled={busy}
              onClick={() => {
                if (confirm('Discard the demo bank? This cannot be undone.')) {
                  clearDemoBank();
                  setStrandedBank(null);
                }
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Backup</h2>
            <p className="muted">
              {storage?.durable
                ? `Saved in ${storage.driver === 'redis' ? 'Redis' : 'a file on the server'} — it survives restarts and redeploys.`
                : 'Stored in memory on this server: a restart or redeploy wipes it. Export a copy, and see the README on configuring Redis.'}
            </p>
          </div>
        </div>
        <div className="row tight">
          <button className="btn sm" onClick={exportBank} disabled={!bank}>
            ⬇ Export JSON
          </button>
          <button className="btn sm" onClick={() => fileInput.current?.click()} disabled={busy}>
            ⬆ Import JSON
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const replace = confirm(
                'OK — replace the whole bank with this file.\n\n' +
                  'Cancel — merge it into what is already here.',
              );
              void importBank(file, replace ? 'replace' : 'merge');
            }}
          />
        </div>
      </div>

      <div className="card">
        <div className="spread" style={{ marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0 }}>Categories</h2>
            <p className="muted">
              {bank?.categories.length ?? 0} categories · {total} questions
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
                        if (confirm(`Delete “${category.name}” and all of its questions?`)) {
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
                  Questions in “{active.name}” ({active.items.length})
                </h3>
                <label className="field">
                  <span>Bulk add — one question per line, commas work too</span>
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
                  {!active.items.length && <div className="empty">No questions in here yet.</div>}
                </div>
              </>
            ) : (
              <div className="empty">Pick a category on the left to edit its questions.</div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          💡 When a round starts, every category the admin selected is <b>shuffled into one deck</b>.
          Players draw from it in turn, so nobody gets the same question twice.
        </p>
      </div>
    </main>
  );
}
