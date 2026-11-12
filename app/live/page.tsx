'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdmin } from '@/components/AdminUnlock';
import {
  Backdrop,
  Finale,
  OpenList,
  Result,
  useSceneTransition,
  VotingBoard,
  WATERMARK,
  Welcome,
} from '@/components/Show';
import { TopBar } from '@/components/TopBar';
import { useLiveState, type ShowState } from '@/components/useLiveState';
import type { PollId, Stage } from '@/lib/types';

/**
 * The big screen, for the admin to put on the projector. It has no controls
 * and no QR code: the admin runs the show from Manage (where the join QR
 * lives) and this follows, countdown included.
 */
export default function LivePage() {
  const [admin] = useAdmin();
  const router = useRouter();
  useEffect(() => {
    if (admin === false) router.replace('/');
  }, [admin, router]);

  const { state, skew, error } = useLiveState(1500);
  const show = state?.invited ? state : null;
  const { shown, leaving } = useSceneTransition(show?.stage);

  if (!admin) return <TopBar />;
  return (
    <>
      <TopBar actions={<FullscreenButton />} />
      <main className="page wide live">
        {shown && <Backdrop word={WATERMARK[shown]} />}
        {!show || !shown ? (
          error ? (
            <div className="err">{error}</div>
          ) : (
            <p className="muted">Loading…</p>
          )
        ) : (
          <div className={`scene${leaving ? ' out' : ''}`} key={shown}>
            <Scene stage={shown} state={show} skew={skew} />
          </div>
        )}
      </main>
    </>
  );
}

function Scene({ stage, state, skew }: { stage: Stage; state: ShowState; skew: number }) {
  const poll = (id: PollId) => state.polls.find((p) => p.id === id)!;
  switch (stage) {
    case 'welcome':
      return <Welcome state={state} />;
    case 'king-open':
    case 'queen-open':
      return (
        <OpenList poll={poll(stage === 'king-open' ? 'king' : 'queen')} note="Voting starts soon" />
      );
    case 'king-voting':
    case 'queen-voting':
      return <VotingBoard poll={poll(stage === 'king-voting' ? 'king' : 'queen')} skew={skew} />;
    case 'king-result':
    case 'queen-result':
      return <Result poll={poll(stage === 'king-result' ? 'king' : 'queen')} />;
    case 'finale':
      return <Finale state={state} king={poll('king')} queen={poll('queen')} />;
  }
}

/* ---------------------------------------------------------- fullscreen */

type FullscreenDoc = Document & { webkitFullscreenElement?: Element | null };

/** For the big screen. Hidden where the browser can't do it (iPhone Safari). */
function FullscreenButton() {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    setSupported(!!document.fullscreenEnabled);
    const sync = () =>
      setOn(!!(document.fullscreenElement || (document as FullscreenDoc).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  if (!supported) return null;
  return (
    <button
      className="btn sm ghost"
      onClick={() =>
        on
          ? void document.exitFullscreen().catch(() => undefined)
          : void document.documentElement.requestFullscreen().catch(() => undefined)
      }
    >
      {on ? 'Exit full screen' : 'Full screen'}
    </button>
  );
}
