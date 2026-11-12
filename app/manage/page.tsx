'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAdmin } from '@/components/AdminUnlock';
import { useConfirm } from '@/components/ConfirmDialog';
import { TopBar } from '@/components/TopBar';
import { adminHeaders, api, post, session } from '@/lib/client';
import { STAGES, type PollId, type Stage, type VoteMode } from '@/lib/types';
import type { AdminView } from '@/lib/view';

type Response = AdminView & { message?: string | null };
type PollView = AdminView['polls'][number];

export default function ManagePage() {
  const [admin, setAdmin] = useAdmin();
  const [view, setView] = useState<AdminView | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // Guests never see this page: without a token it quietly goes back to Vote.
  useEffect(() => {
    if (admin === false) router.replace('/');
  }, [admin, router]);

  const load = useCallback(async () => {
    try {
      setView(await api<AdminView>('/api/admin/election', { headers: adminHeaders() }));
    } catch (e) {
      if ((e as { status?: number }).status === 403) {
        session.clearAdminToken();
        setAdmin(false);
      }
      setError((e as Error).message);
    }
  }, [setAdmin]);

  // Live counts while voting runs.
  useEffect(() => {
    if (!admin) return;
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [admin, load]);

  const act = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const data = await post<Response>('/api/admin/election', body, adminHeaders());
      setView(data);
      setNote(data.message ?? '');
      return true;
    } catch (e) {
      setError((e as Error).message);
      setNote('');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = (
    <button
      className="btn sm ghost"
      onClick={() => {
        session.clearAdminToken();
        setAdmin(false);
        setView(null);
      }}
    >
      Lock
    </button>
  );

  if (!admin) return <TopBar />;

  return (
    <>
      <TopBar actions={signOut} />
      <main className="page">
        <p className="eyebrow">Manage</p>
        <h1>{view?.title ?? '…'}</h1>
        {view && <p className="status-line">{nextStep(view)}</p>}
        {error && <div className="err">{error}</div>}
        {note && <div className="note">{note}</div>}

        {view && (
          <>
            <div className="row" style={{ marginTop: 18 }}>
              <Link className="btn primary" href="/live">
                Open live dashboard
              </Link>
              <TitleEditor
                label="Rename event"
                value={view.title}
                busy={busy}
                onSave={(title) => act({ action: 'setTitle', title })}
              />
            </div>

            <ShowSection view={view} busy={busy} act={act} />

            {view.polls.map((poll) => (
              <PollSection key={poll.id} poll={poll} busy={busy} act={act} />
            ))}

            <RulesSection view={view} busy={busy} act={act} />
          </>
        )}
      </main>
    </>
  );
}

/** The one thing to do next, so the admin never has to hunt for it. */
function nextStep(view: AdminView): string {
  const empty = view.polls.find((p) => !p.nominees.length);
  if (empty) return `Next: add the nominees for ${empty.title}.`;
  if (view.mode === 'ticket' && !view.tickets.length)
    return 'Next: make and print the voting passes.';
  const open = view.polls.filter((p) => p.status === 'open');
  if (open.length) {
    return open
      .map((p) => `${p.title} is live — ${p.total} ${p.total === 1 ? 'vote' : 'votes'}`)
      .join(' · ');
  }
  if (view.stage === 'finale') return 'The show is complete — both winners are on the Live screen.';
  return 'Ready. Use the show steps below to move the Live screen on.';
}

type Act = (body: Record<string, unknown>) => Promise<boolean>;

function TitleEditor({
  label,
  value,
  busy,
  onSave,
}: {
  label: string;
  value: string;
  busy: boolean;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (!editing) {
    return (
      <button
        className="btn ghost sm"
        onClick={() => {
          setText(value);
          setEditing(true);
        }}
      >
        {label}
      </button>
    );
  }
  const save = async () => (await onSave(text)) && setEditing(false);
  return (
    <div className="row" style={{ flexWrap: 'nowrap', flex: 1, minWidth: 260 }}>
      <input
        type="text"
        value={text}
        maxLength={60}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <button className="btn primary sm" disabled={busy || !text.trim()} onClick={save}>
        Save
      </button>
      <button className="btn ghost sm" onClick={() => setEditing(false)}>
        Cancel
      </button>
    </div>
  );
}

function PollSection({ poll, busy, act }: { poll: PollView; busy: boolean; act: Act }) {
  const confirm = useConfirm();
  const [text, setText] = useState('');
  const pollId: PollId = poll.id;

  const remove = async (id: string, name: string) => {
    const votes = poll.tally[id] ?? 0;
    const ok = await confirm({
      danger: true,
      title: `Remove ${name}?`,
      message: votes
        ? `${votes} ${votes === 1 ? 'vote' : 'votes'} for ${name} are cancelled; those guests can vote again.`
        : 'They come off the list on every screen.',
      confirmLabel: 'Remove',
    });
    if (ok) await act({ action: 'removeNominee', poll: pollId, nomineeId: id });
  };

  const reset = async () => {
    const ok = await confirm({
      danger: true,
      title: `Reset ${poll.title}?`,
      message: `All ${poll.total} ${poll.total === 1 ? 'vote is' : 'votes are'} deleted, ${poll.title} goes back to "not open yet", and everyone can vote again. The nominee list stays. This cannot be undone.`,
      confirmLabel: 'Reset votes',
    });
    if (ok) await act({ action: 'resetVotes', poll: pollId });
  };

  const clearList = async () => {
    const ok = await confirm({
      danger: true,
      title: `Clear the ${poll.title} list?`,
      message: `All ${poll.nominees.length} ${poll.nominees.length === 1 ? 'nominee is' : 'nominees are'} removed${
        poll.total ? `, with all ${poll.total} ${poll.total === 1 ? 'vote' : 'votes'}` : ''
      }, and this vote goes back to "not open yet". This cannot be undone.`,
      confirmLabel: 'Clear list',
    });
    if (ok) await act({ action: 'clearNominees', poll: pollId });
  };

  const setStatus = async (status: 'open' | 'closed') => {
    if (status === 'closed') {
      const ok = await confirm({
        title: `Close ${poll.title}?`,
        message:
          'No more votes are accepted and the live dashboard shows the winner. You can reopen it.',
        confirmLabel: 'Close voting',
      });
      if (!ok) return;
    }
    await act({ action: 'setStatus', poll: pollId, status });
  };

  return (
    <section className="section" style={{ marginTop: 18 }}>
      <div className="section-head">
        <div>
          <span className={`pill-status${poll.status === 'open' ? ' open' : ''}`}>
            {poll.status === 'open'
              ? 'Voting open'
              : poll.status === 'closed'
                ? 'Closed'
                : 'Not open yet'}
            {' · '}
            {poll.total} {poll.total === 1 ? 'vote' : 'votes'}
          </span>
          <h2>{poll.title}</h2>
        </div>
        <div className="row">
          {poll.status === 'open' ? (
            <button className="btn" disabled={busy} onClick={() => setStatus('closed')}>
              Close voting
            </button>
          ) : (
            <button
              className="btn"
              disabled={busy || !poll.nominees.length}
              onClick={() => setStatus('open')}
            >
              {poll.status === 'closed' ? 'Reopen voting' : 'Open voting'}
            </button>
          )}
          <button
            className="btn"
            disabled={busy || (!poll.total && poll.status === 'draft')}
            onClick={reset}
          >
            Reset votes
          </button>
          <TitleEditor
            label="Rename"
            value={poll.title}
            busy={busy}
            onSave={(title) => act({ action: 'setPollTitle', poll: pollId, title })}
          />
        </div>
      </div>

      <div className="list">
        {poll.nominees.map((n) => (
          <NomineeRow
            key={n.id}
            name={n.name}
            note={n.note}
            votes={poll.tally[n.id] ?? 0}
            busy={busy}
            onSave={(name, note) =>
              act({ action: 'updateNominee', poll: pollId, nomineeId: n.id, name, note })
            }
            onRemove={() => remove(n.id, n.name)}
          />
        ))}
        {!poll.nominees.length && <p className="muted">No nominees yet.</p>}
      </div>
      {poll.nominees.length > 0 && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn link" disabled={busy} onClick={clearList}>
            Clear list
          </button>
        </div>
      )}

      <label style={{ display: 'block', marginTop: 18 }}>
        <span className="eyebrow">Add nominees — one per line, optional note after a |</span>
        <textarea
          value={text}
          placeholder={'Alex Tan | Table 4\nBen Lim | Finance\nChloe Wong'}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="btn primary"
          disabled={busy || !text.trim()}
          onClick={async () =>
            (await act({ action: 'addNominees', poll: pollId, text })) && setText('')
          }
        >
          Add to list
        </button>
      </div>
    </section>
  );
}

function NomineeRow({
  name,
  note,
  votes,
  busy,
  onSave,
  onRemove,
}: {
  name: string;
  note: string;
  votes: number;
  busy: boolean;
  onSave: (name: string, note: string) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftNote, setDraftNote] = useState(note);

  if (editing) {
    const save = async () => (await onSave(draftName, draftNote)) && setEditing(false);
    return (
      <div className="list-row" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
        <input
          type="text"
          value={draftName}
          maxLength={40}
          onChange={(e) => setDraftName(e.target.value)}
        />
        <input
          type="text"
          value={draftNote}
          maxLength={60}
          placeholder="Note (optional)"
          onChange={(e) => setDraftNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <button className="btn primary sm" disabled={busy || !draftName.trim()} onClick={save}>
            Save
          </button>
          <button className="btn ghost sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="list-row">
      <button
        className="name-btn"
        title="Edit"
        onClick={() => {
          setDraftName(name);
          setDraftNote(note);
          setEditing(true);
        }}
      >
        <span>
          <b style={{ fontFamily: 'var(--serif)', fontSize: 18 }}>{name}</b>
          {note && (
            <span className="muted" style={{ display: 'block', fontSize: 13 }}>
              {note}
            </span>
          )}
        </span>
      </button>
      <span className="votes">
        {votes} {votes === 1 ? 'vote' : 'votes'}
      </span>
      <button
        className="x"
        disabled={busy}
        aria-label={`Remove ${name}`}
        title={`Remove ${name}`}
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}

const MODES: Array<{ id: VoteMode; title: string; body: string }> = [
  {
    id: 'device',
    title: 'One vote per phone',
    body: 'Everyone scans the same QR code. Each phone gets a private id (kept in a cookie and in the browser), so a second vote from the same phone is refused. Easiest for guests; someone determined could vote again from a private window or a second phone.',
  },
  {
    id: 'ticket',
    title: 'One vote per voting pass',
    body: 'Print a personal pass for each guest — each has its own QR code that votes once for King and once for Queen, whichever phone scans it. The strictest option without logins; you hand out one pass per person.',
  },
];

function RulesSection({ view, busy, act }: { view: AdminView; busy: boolean; act: Act }) {
  const confirm = useConfirm();
  const [count, setCount] = useState('50');
  const used = (poll: PollId) => view.tickets.filter((t) => t.used[poll]).length;
  const unused = view.tickets.filter((t) => !Object.keys(t.used).length).length;

  return (
    <section className="section" style={{ marginTop: 18 }}>
      <h2>Voting rules</h2>
      <p className="muted" style={{ margin: '6px 0 16px' }}>
        Choose before voting starts — this cannot change once votes are in.
      </p>
      <div style={{ display: 'grid', gap: 10 }}>
        {MODES.map((mode) => (
          <label key={mode.id} className={`choice${view.mode === mode.id ? ' on' : ''}`}>
            <input
              type="radio"
              name="mode"
              checked={view.mode === mode.id}
              disabled={busy}
              onChange={() => act({ action: 'setMode', mode: mode.id })}
            />
            <span>
              <b>{mode.title}</b>
              <p>{mode.body}</p>
            </span>
          </label>
        ))}
      </div>

      {view.mode === 'ticket' && (
        <div className="quiet-card" style={{ marginTop: 18 }}>
          <h3>Voting passes</h3>
          <p className="muted" style={{ margin: '6px 0 14px' }}>
            {view.tickets.length} made · {used('king')} voted for King · {used('queen')} voted for
            Queen
          </p>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              style={{ maxWidth: 120 }}
            />
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => act({ action: 'generateTickets', count: Number(count) })}
            >
              Make passes
            </button>
            {view.tickets.length > 0 && (
              <Link className="btn" href="/passes">
                Print passes
              </Link>
            )}
          </div>
          {unused > 0 && (
            <button
              className="btn link"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={async () =>
                (await confirm({
                  danger: true,
                  title: `Delete ${unused} unused passes?`,
                  message:
                    'Printed copies of them stop working. Passes that already voted are kept.',
                  confirmLabel: 'Delete passes',
                })) && act({ action: 'deleteUnusedTickets' })
              }
            >
              Delete unused passes
            </button>
          )}
        </div>
      )}
    </section>
  );
}

type Step = { stage: Stage; title: string; action: string; confirm?: string };

function stepsFor(view: AdminView): Step[] {
  const [king, queen] = view.polls;
  return [
    { stage: 'welcome', title: 'Welcome screen', action: 'Show the welcome screen' },
    { stage: 'king-voting', title: `${king.title} — voting`, action: 'Open King voting' },
    {
      stage: 'king-result',
      title: `${king.title} — result`,
      action: 'Close voting & show King result',
      confirm: `Close ${king.title}? No more votes are accepted, and the Live screen reveals the result.`,
    },
    { stage: 'queen-voting', title: `${queen.title} — voting`, action: 'Open Queen voting' },
    {
      stage: 'queen-result',
      title: `${queen.title} — result`,
      action: 'Close voting & show Queen result',
      confirm: `Close ${queen.title}? No more votes are accepted, and the Live screen reveals the result.`,
    },
    {
      stage: 'finale',
      title: 'Best Dress — King & Queen',
      action: 'Reveal Best Dress King & Queen',
    },
  ];
}

/** The show, as a fixed run of steps: one button moves the Live screen on. */
function ShowSection({ view, busy, act }: { view: AdminView; busy: boolean; act: Act }) {
  const confirm = useConfirm();
  const steps = stepsFor(view);
  const at = STAGES.indexOf(view.stage);
  const next = steps[at + 1];
  const back = steps[at - 1];

  const go = async (step: Step, backwards: boolean) => {
    let ok = true;
    if (!backwards && step.confirm) {
      ok = await confirm({
        title: step.action + '?',
        message: step.confirm,
        confirmLabel: 'Yes, go',
      });
    } else if (backwards && step.stage.endsWith('-voting')) {
      ok = await confirm({
        title: 'Go back and reopen voting?',
        message: 'The Live screen goes back to the voting screen and votes are accepted again.',
        confirmLabel: 'Reopen voting',
      });
    }
    if (ok) await act({ action: 'setStage', stage: step.stage });
  };

  return (
    <section className="section" style={{ marginTop: 18 }}>
      <h2>The show</h2>
      <p className="muted" style={{ margin: '6px 0 16px' }}>
        The Live screen follows these steps. Press the button for the next one.
      </p>
      <ol className="steps">
        {steps.map((step, i) => (
          <li key={step.stage} className={i < at ? 'done' : i === at ? 'now' : undefined}>
            <span className="dot" aria-hidden="true">
              {i < at ? '✓' : i + 1}
            </span>
            <span>
              {step.title}
              {i === at && <em> — on screen now</em>}
            </span>
          </li>
        ))}
      </ol>
      <div className="row" style={{ marginTop: 16 }}>
        {next ? (
          <button className="btn accent big" disabled={busy} onClick={() => go(next, false)}>
            {next.action} →
          </button>
        ) : null}
        {back && (
          <button className="btn ghost" disabled={busy} onClick={() => go(back, true)}>
            ← Back
          </button>
        )}
      </div>
    </section>
  );
}
