'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, post, session } from '@/lib/client';
import { parseQuestionsCsv, toQuestionsCsv } from '@/lib/csv';
import { AdminUnlock, useAdmin } from '@/components/AdminUnlock';
import type { Bank } from '@/lib/types';

type Storage = { driver: 'turso' | 'redis' | 'file' | 'memory'; durable: boolean; shared?: boolean };
type Backup = { path: string; categories: number; questions: number } | null;
type Report = { rows: number; skipped: number; categories: number } | null;

/** A file the admin picked, parsed in the browser so they see it before it lands. */
type PendingImport = {
  fileName: string;
  kind: 'csv' | 'json';
  text: string;
  categories: number;
  questions: number;
  skipped: number;
};

const STORE_LABEL: Record<Storage['driver'], string> = {
  turso: 'Turso',
  redis: 'Redis',
  file: 'a file on this server',
  memory: 'this server’s memory',
};

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
type BankResponse = { bank: Bank; storage?: Storage; backup?: Backup; report?: Report };

export default function QuestionsPage() {
  const [admin, setAdmin] = useAdmin();
  const [bank, setBank] = useState<Bank | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [draft, setDraft] = useState('');
  const [storage, setStorage] = useState<Storage | null>(null);
  const [backup, setBackup] = useState<Backup>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastReport = useRef<Report>(null);
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
        setBackup(data.backup ?? null);
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
      if (data.backup !== undefined) setBackup(data.backup);
      lastReport.current = data.report ?? null;
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

  /** Opens in Excel, Numbers or Google Sheets, and is exactly what the repo backup expects. */
  function exportCsv() {
    if (!bank) return;
    const csv = toQuestionsCsv(
      bank.categories.map((c) => ({ name: c.name, items: c.items.map((i) => i.text) })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'questions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Reads the chosen file and shows what is in it; nothing is written yet. */
  async function pickFile(file: File) {
    setError('');
    setNote('');
    const text = await file.text();
    const kind = /\.json$/i.test(file.name) ? 'json' : 'csv';
    try {
      if (kind === 'json') {
        // Older exports were JSON; they still import.
        const data = JSON.parse(text) as { categories?: Array<{ items?: unknown[] }> };
        const cats = Array.isArray(data.categories) ? data.categories : [];
        if (!cats.length) throw new Error('That file is not a question bank export');
        setPending({
          fileName: file.name,
          kind,
          text,
          categories: cats.length,
          questions: cats.reduce((sum, c) => sum + (Array.isArray(c.items) ? c.items.length : 0), 0),
          skipped: 0,
        });
        return;
      }
      const parsed = parseQuestionsCsv(text);
      if (!parsed.categories.length) {
        throw new Error('No questions found — the file needs a category column and a question column');
      }
      setPending({
        fileName: file.name,
        kind,
        text,
        categories: parsed.categories.length,
        questions: parsed.rows,
        skipped: parsed.skipped,
      });
    } catch (e) {
      setError(e instanceof SyntaxError ? 'That file is not valid JSON' : (e as Error).message);
    }
  }

  async function confirmImport(mode: 'merge' | 'replace') {
    if (!pending) return;
    const next = await mutate(
      pending.kind === 'csv'
        ? { action: 'importCsv', csv: pending.text, mode }
        : { action: 'import', data: JSON.parse(pending.text), mode },
    );
    if (next) {
      setPending(null);
      const total = next.categories.reduce((sum, c) => sum + c.items.length, 0);
      const skipped = lastReport.current?.skipped ?? 0;
      setNote(
        `${mode === 'replace' ? 'Replaced' : 'Merged'} — the bank now holds ${next.categories.length} categories and ${total} questions` +
          (skipped ? ` (${skipped} empty ${skipped === 1 ? 'row was' : 'rows were'} skipped)` : '') +
          '.',
      );
    }
  }

  async function restoreFromRepo(mode: 'replace' | 'merge') {
    const warning =
      mode === 'replace'
        ? 'Replace the whole bank with the copy saved in the repository? Questions added on this site since then are removed.'
        : 'Merge the repository copy into the current bank? Nothing is removed.';
    if (!confirm(warning)) return;
    const next = await mutate({ action: 'restoreFromRepo', mode });
    if (next) {
      const total = next.categories.reduce((sum, c) => sum + c.items.length, 0);
      setNote(
        `Restored from the repository — the bank now holds ${next.categories.length} categories and ${total} questions.`,
      );
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
        <h2>Spreadsheet &amp; backup</h2>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          {storage
            ? storage.shared
              ? `Saved in ${STORE_LABEL[storage.driver]} — shared by every server and kept across deploys.`
              : storage.durable
                ? `Saved in ${STORE_LABEL[storage.driver]} — kept across restarts on this one server.`
                : `Held in ${STORE_LABEL[storage.driver]} only — a restart loses it. Keep a CSV copy.`
            : 'Checking where the bank is stored…'}
        </p>

        <div className="section">
          <h3>Edit in a spreadsheet</h3>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            Two columns — <b>category</b> and <b>question</b>, one question per row. Export, edit in
            Excel or Google Sheets, then import it back.
          </p>
          <div className="row tight">
            <button className="btn sm" onClick={exportCsv} disabled={!bank}>
              ⬇ Export CSV
            </button>
            <button className="btn sm" onClick={() => fileInput.current?.click()} disabled={busy}>
              ⬆ Import CSV
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,.json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void pickFile(file);
              }}
            />
          </div>

          {pending && (
            <div className="notice" style={{ marginTop: 12 }}>
              <b>{pending.fileName}</b> — {pending.questions}{' '}
              {pending.questions === 1 ? 'question' : 'questions'} in {pending.categories}{' '}
              {pending.categories === 1 ? 'category' : 'categories'}
              {pending.skipped
                ? `, ${pending.skipped} empty ${pending.skipped === 1 ? 'row' : 'rows'} will be skipped`
                : ''}
              .
              <div className="row tight" style={{ marginTop: 10 }}>
                <button
                  className="btn sm primary"
                  disabled={busy}
                  onClick={() => confirmImport('merge')}
                  title="Keeps everything already here and adds what is new"
                >
                  Merge in
                </button>
                <button
                  className="btn sm"
                  disabled={busy}
                  onClick={() =>
                    confirm('Replace the whole bank with this file? Anything not in it is removed.') &&
                    confirmImport('replace')
                  }
                >
                  Replace everything
                </button>
                <button className="btn sm ghost" disabled={busy} onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="section">
          <h3>Permanent copy in the repository</h3>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {backup
              ? `${backup.path} holds ${backup.categories} categories and ${backup.questions} questions. `
              : 'No backup file found in the repository yet. '}
            It ships with every deploy, and an empty database loads it automatically. To update it,
            export CSV and upload the file over <code>{backup?.path ?? 'data/questions.csv'}</code>{' '}
            on GitHub. Deploys never overwrite the questions you edit here.
          </p>
          <div className="row tight">
            <button
              className="btn sm"
              disabled={busy || !backup}
              onClick={() => restoreFromRepo('replace')}
            >
              ↺ Restore from repository
            </button>
            <button
              className="btn sm ghost"
              disabled={busy || !backup}
              onClick={() => restoreFromRepo('merge')}
            >
              Merge repository copy in
            </button>
          </div>
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
