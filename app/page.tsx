'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useConfirm } from '@/components/ConfirmDialog';
import { TopBar } from '@/components/TopBar';
import { useLiveState, type StateResponse } from '@/components/useLiveState';
import { post, session, voterHeaders } from '@/lib/client';

type PollView = StateResponse['polls'][number];
type VoteResponse = StateResponse & { votedFor: string };

/** The phone screen a guest lands on after scanning the QR code. */
export default function VotePage() {
  const { state, setState, error, setError, refresh } = useLiveState(4000);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [hasTicket, setHasTicket] = useState(false);

  // A personal pass opens this page as /?t=CODE: keep the code, then clean the
  // URL so it does not linger in the address bar or get shared by accident.
  useEffect(() => {
    const url = new URL(window.location.href);
    const fromLink = url.searchParams.get('t');
    if (fromLink) {
      session.setTicket(fromLink);
      url.searchParams.delete('t');
      window.history.replaceState(null, '', url.pathname + url.search);
      void refresh();
    }
    setHasTicket(!!session.getTicket());
  }, [refresh]);

  // A stored code the server rejects is dropped, so it is not retried forever.
  useEffect(() => {
    if (state?.pass === 'invalid') {
      session.clearTicket();
      setHasTicket(false);
      setError('That pass code is not valid — check it and try again');
    }
  }, [state?.pass, setError]);

  async function applyPass() {
    if (!code.trim()) return;
    session.setTicket(code.trim());
    setHasTicket(true);
    setCode('');
    await refresh();
  }

  async function vote(poll: PollView, nomineeId: string, name: string) {
    const ok = await confirm({
      icon: poll.id === 'king' ? '🤵' : '👗',
      title: `Vote for ${name}?`,
      message: `${poll.title}. You can only vote once, and it can’t be changed.`,
      confirmLabel: 'Vote',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const data = await post<VoteResponse>(
        '/api/vote',
        { poll: poll.id, nomineeId },
        voterHeaders(),
      );
      setState({ ...data, pass: state?.pass ?? 'none', device: state?.device ?? '' });
      setError('');
    } catch (e) {
      setError((e as Error).message);
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <>
        <TopBar />
        <main className="page">
          {error ? <div className="err">{error}</div> : <p className="muted">Loading…</p>}
        </main>
      </>
    );
  }

  const needsPass = state.mode === 'ticket' && state.pass !== 'valid';
  // The single thing to act on: the first open vote this phone hasn't cast.
  const focus = needsPass
    ? null
    : state.polls.find((p) => p.status === 'open' && !state.myVotes[p.id]);

  return (
    <>
      <TopBar />
      <main className="page">
        <p className="eyebrow">Tonight</p>
        <h1>{state.title}</h1>
        <p className="status-line">{summary(state, needsPass)}</p>
        {error && <div className="err">{error}</div>}

        {needsPass && (
          <section className="focus" style={{ marginTop: 28 }}>
            <p className="eyebrow">Your voting pass</p>
            <h2>Scan the QR on your pass</h2>
            <p className="muted" style={{ margin: '8px 0 16px' }}>
              Each guest has a personal pass. Scan its QR code, or type the code printed on it.
            </p>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input
                type="text"
                value={code}
                placeholder="ABCD-2345"
                autoCapitalize="characters"
                autoComplete="off"
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyPass()}
                style={{ color: 'var(--ink)' }}
              />
              <button className="btn accent" onClick={applyPass} disabled={!code.trim()}>
                Use pass
              </button>
            </div>
            {hasTicket && <p className="muted">Checking your pass…</p>}
          </section>
        )}

        <div style={{ display: 'grid', gap: 18, marginTop: 28 }}>
          {state.polls.map((poll) => (
            <PollCard
              key={poll.id}
              poll={poll}
              myVote={state.myVotes[poll.id]}
              focused={focus?.id === poll.id}
              locked={needsPass}
              busy={busy}
              onVote={vote}
            />
          ))}
        </div>

        <p className="muted" style={{ marginTop: 32, fontSize: 14 }}>
          Results are on the big screen — or <Link href="/live">follow them live</Link>.
        </p>
      </main>
    </>
  );
}

function summary(state: StateResponse, needsPass: boolean): string {
  if (needsPass) return 'Use your personal voting pass to vote.';
  const open = state.polls.filter((p) => p.status === 'open');
  const todo = open.filter((p) => !state.myVotes[p.id]);
  if (todo.length) return `${todo.map((p) => p.title).join(' and ')} — voting is open.`;
  if (open.length) return 'Thanks — your vote is in. Watch the results on the big screen.';
  if (state.polls.every((p) => p.status === 'closed')) return 'Voting has closed. Thank you!';
  return 'Voting opens soon — keep this page open.';
}

function PollCard({
  poll,
  myVote,
  focused,
  locked,
  busy,
  onVote,
}: {
  poll: PollView;
  myVote: string | null;
  focused: boolean;
  locked: boolean;
  busy: boolean;
  onVote: (poll: PollView, nomineeId: string, name: string) => void;
}) {
  const chosen = myVote ? poll.nominees.find((n) => n.id === myVote) : null;
  const canVote = poll.status === 'open' && !myVote && !locked;
  const state = myVote
    ? 'Your vote is in'
    : poll.status === 'open'
      ? focused
        ? 'Now voting — tap your pick'
        : 'Open'
      : poll.status === 'closed'
        ? 'Voting closed'
        : 'Opens soon';

  return (
    <section className={focused ? 'focus' : 'quiet-card'}>
      <p className="eyebrow">{state}</p>
      <h2>{poll.title}</h2>
      {chosen && (
        <div className="voted">
          <span className="tick" aria-hidden="true">
            ✓
          </span>
          <span>
            You voted for <b>{chosen.name}</b>
          </span>
        </div>
      )}
      {canVote && (
        <div className="nominees">
          {poll.nominees.map((n) => (
            <button
              key={n.id}
              className="nominee"
              disabled={busy}
              onClick={() => onVote(poll, n.id, n.name)}
            >
              <span>
                <span className="name">{n.name}</span>
                {n.note && <span className="sub">{n.note}</span>}
              </span>
              <span className="go">Vote</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
