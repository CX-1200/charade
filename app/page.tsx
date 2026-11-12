'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdmin } from '@/components/AdminUnlock';
import { useConfirm } from '@/components/ConfirmDialog';
import {
  Backdrop,
  Countdown,
  Crown,
  Finale,
  OpenList,
  Result,
  useSceneTransition,
  VotingBoard,
  WATERMARK,
  Welcome,
  type PollView,
} from '@/components/Show';
import { TopBar } from '@/components/TopBar';
import { useLiveState, useRemaining, type ShowState } from '@/components/useLiveState';
import { post, session, voterHeaders } from '@/lib/client';
import type { PollId } from '@/lib/types';

/**
 * The guest's phone. Outside the admin's session it is a holding page with
 * nothing to tap. Inside it, the phone follows the show: the list, then a
 * countdown to pick and confirm one name, then the live count, the result,
 * and the finale.
 */
export default function GuestPage() {
  const [admin] = useAdmin();
  const router = useRouter();
  useEffect(() => {
    if (admin) router.replace('/manage');
  }, [admin, router]);

  const { state, setState, skew, error, setError, refresh } = useLiveState(2000);

  // The join QR opens /?s=SESSION, a personal pass /?t=CODE. Keep them, then
  // clean the URL so they don't linger in the address bar or get shared on.
  useEffect(() => {
    const url = new URL(window.location.href);
    const joined = url.searchParams.get('s');
    const ticket = url.searchParams.get('t');
    if (!joined && !ticket) return;
    if (joined) session.setSession(joined);
    if (ticket) session.setTicket(ticket);
    url.searchParams.delete('s');
    url.searchParams.delete('t');
    window.history.replaceState(null, '', url.pathname + url.search);
    void refresh();
  }, [refresh]);

  // A stored pass the server rejects is dropped, so it is not retried forever.
  const pass = state?.invited ? state.pass : 'none';
  useEffect(() => {
    if (pass === 'invalid') {
      session.clearTicket();
      setError('That pass code is not valid — check it and try again');
    }
  }, [pass, setError]);

  const show = state?.invited ? state : null;
  const votingPoll = show?.stage.endsWith('-voting')
    ? show.polls.find((p) => show.stage === `${p.id}-voting`)
    : undefined;
  const remaining = useRemaining(votingPoll?.status === 'open' ? votingPoll.endsAt : null, skew);
  const picking = !!show && !!votingPoll && remaining > 0 && !show.myVotes[votingPoll.id];
  const { shown, leaving } = useSceneTransition(
    show ? `${show.stage}${picking ? ':pick' : ''}` : undefined,
  );

  if (admin !== false || !state) {
    return (
      <>
        <TopBar />
        <main className="page">
          {error ? <div className="err">{error}</div> : <p className="muted">Loading…</p>}
        </main>
      </>
    );
  }

  if (!show) return <Holding title={state.title} />;

  const stage = show.stage;
  return (
    <>
      <TopBar />
      <main className="page live phone">
        <Backdrop word={WATERMARK[stage]} />
        {error && <div className="err">{error}</div>}
        {shown && (
          <div className={`scene${leaving ? ' out' : ''}`} key={shown}>
            {votingPoll && shown.endsWith(':pick') ? (
              <Picker
                state={show}
                poll={votingPoll}
                remaining={remaining}
                onVoted={(data) => setState(data)}
                onError={setError}
                refresh={refresh}
              />
            ) : (
              <GuestScene state={show} skew={skew} />
            )}
          </div>
        )}
      </main>
    </>
  );
}

function Holding({ title }: { title: string }) {
  return (
    <>
      <TopBar />
      <main className="page live phone">
        <Backdrop word="Best Dress" />
        <div className="scene">
          <div className="hero">
            <div className="rise">
              <Crown size={56} className="float" />
            </div>
            <p className="eyebrow rise" style={{ animationDelay: '0.1s' }}>
              Best Dress
            </p>
            <h1 className="rise" style={{ animationDelay: '0.2s' }}>
              {title}
            </h1>
            <p className="muted rise" style={{ animationDelay: '0.4s', maxWidth: 360 }}>
              Voting hasn’t opened yet. When the host starts, scan the QR code they show to join.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

function GuestScene({ state, skew }: { state: ShowState; skew: number }) {
  const poll = (id: PollId) => state.polls.find((p) => p.id === id)!;
  const stage = state.stage;
  switch (stage) {
    case 'welcome':
      return <Welcome state={state} />;
    case 'king-open':
    case 'queen-open':
      return (
        <OpenList
          poll={poll(stage === 'king-open' ? 'king' : 'queen')}
          note="Voting starts soon — get ready to pick"
        />
      );
    case 'king-voting':
    case 'queen-voting': {
      const p = poll(stage === 'king-voting' ? 'king' : 'queen');
      const mine = p.nominees.find((n) => n.id === state.myVotes[p.id]);
      return (
        <VotingBoard
          poll={p}
          skew={skew}
          label="Live count"
          aside={
            mine && (
              <div className="voted rise">
                <span className="tick" aria-hidden="true">
                  ✓
                </span>
                <span>
                  You voted for <b>{mine.name}</b>
                </span>
              </div>
            )
          }
        />
      );
    }
    case 'king-result':
    case 'queen-result':
      return <Result poll={poll(stage === 'king-result' ? 'king' : 'queen')} />;
    case 'finale':
      return <Finale state={state} king={poll('king')} queen={poll('queen')} />;
  }
}

type VoteResponse = ShowState & { votedFor: string };

/** Pick one name, then confirm — before the countdown runs out. */
function Picker({
  state,
  poll,
  remaining,
  onVoted,
  onError,
  refresh,
}: {
  state: ShowState;
  poll: PollView;
  remaining: number;
  onVoted: (data: ShowState) => void;
  onError: (message: string) => void;
  refresh: () => Promise<unknown>;
}) {
  const confirm = useConfirm();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const needsPass = state.mode === 'ticket' && state.pass !== 'valid';
  const chosen = poll.nominees.find((n) => n.id === picked);
  const role = poll.id === 'king' ? 'King' : 'Queen';

  async function submit() {
    if (!chosen) return;
    const ok = await confirm({
      icon: '👑',
      title: `Vote for ${chosen.name}?`,
      message: `You can vote for only one person as Best Dress ${role}, and you can’t change it afterwards.`,
      confirmLabel: 'Yes, vote',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const data = await post<VoteResponse>(
        '/api/vote',
        { poll: poll.id, nomineeId: chosen.id },
        voterHeaders(),
      );
      onVoted({ ...data, pass: state.pass, device: state.device });
      onError('');
    } catch (e) {
      onError((e as Error).message);
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="picker">
      <div className="picker-head rise">
        <div>
          <p className="eyebrow">
            <span className="live-dot" aria-hidden="true" />
            Vote now
          </p>
          <h1>{poll.title}</h1>
          <p className="muted">Tap one name, then confirm.</p>
        </div>
        <Countdown
          ms={remaining}
          totalMs={poll.endsAt && poll.openedAt ? poll.endsAt - poll.openedAt : 0}
        />
      </div>

      {needsPass ? (
        <section className="focus" style={{ marginTop: 18 }}>
          <p className="eyebrow">Your voting pass</p>
          <h2>Enter the code on your pass</h2>
          <div className="row" style={{ flexWrap: 'nowrap', marginTop: 14 }}>
            <input
              type="text"
              value={code}
              placeholder="ABCD-2345"
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => setCode(e.target.value)}
              style={{ color: 'var(--ink)' }}
            />
            <button
              className="btn accent"
              disabled={!code.trim()}
              onClick={() => {
                session.setTicket(code.trim());
                setCode('');
                void refresh();
              }}
            >
              Use pass
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="nominees pick-list" role="radiogroup" aria-label={poll.title}>
            {poll.nominees.map((n, i) => (
              <button
                key={n.id}
                role="radio"
                aria-checked={picked === n.id}
                className={`nominee${picked === n.id ? ' picked' : ''} rise`}
                style={{ animationDelay: `${0.1 + i * 0.05}s` }}
                disabled={busy}
                onClick={() => setPicked(n.id)}
              >
                <span>
                  <span className="name">{n.name}</span>
                  {n.note && <span className="sub">{n.note}</span>}
                </span>
                <span className="check" aria-hidden="true">
                  {picked === n.id ? '✓' : ''}
                </span>
              </button>
            ))}
          </div>
          <div className="confirm-bar">
            <button className="btn accent big" disabled={!chosen || busy} onClick={submit}>
              {chosen ? `Confirm vote for ${chosen.name}` : 'Pick a name first'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
