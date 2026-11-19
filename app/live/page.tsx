'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdmin } from '@/components/AdminUnlock';
import {
  Backdrop,
  Finale,
  OpenMarquee,
  Result,
  useSceneTransition,
  VotingBoard,
  WATERMARK,
  Welcome,
  WideScreen,
} from '@/components/Show';
import { JoinQr } from '@/components/JoinQr';
import { TopBar } from '@/components/TopBar';
import { useLiveState, type ShowState } from '@/components/useLiveState';
import type { PollId, Stage } from '@/lib/types';

/**
 * The big screen, for the admin to put on the projector. It has no controls:
 * the admin runs the show from Manage and this follows, countdown included.
 * While the site is on it shows the join QR code — in the middle of the
 * welcome screen, then in a corner card, so late arrivals can still get in.
 *
 * Every scene is fitted to the window — scaled down if it would not fit — so
 * the projector never shows a scroll bar, whatever the screen size or the
 * number of nominees.
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
  const corner =
    !!show?.joinId &&
    !!shown &&
    shown !== 'welcome' &&
    shown !== 'finale' &&
    !shown.endsWith('-open');

  if (!admin) return <TopBar />;
  return (
    <>
      <TopBar actions={<FullscreenButton />} />
      <main className={`page wide live fit${corner ? ' has-corner' : ''}`}>
        {shown && <Backdrop word={WATERMARK[shown]} />}
        {!show || !shown ? (
          error ? (
            <div className="err">{error}</div>
          ) : (
            <p className="muted">Loading…</p>
          )
        ) : (
          <div className={`scene${leaving ? ' out' : ''}`} key={shown}>
            <FitToScreen>
              <WideScreen.Provider value>
                <Scene stage={shown} state={show} skew={skew} />
              </WideScreen.Provider>
            </FitToScreen>
          </div>
        )}
        {corner && show?.joinId && <JoinQr joinId={show.joinId} size={120} corner />}
      </main>
    </>
  );
}

function Scene({ stage, state, skew }: { stage: Stage; state: ShowState; skew: number }) {
  const poll = (id: PollId) => state.polls.find((p) => p.id === id)!;
  switch (stage) {
    case 'welcome':
      return (
        <Welcome
          state={state}
          join={state.joinId ? <JoinQr joinId={state.joinId} size={200} /> : null}
        />
      );
    case 'king-open':
    case 'queen-open':
      return (
        <OpenMarquee
          poll={poll(stage === 'king-open' ? 'king' : 'queen')}
          note="Voting starts soon"
          join={state.joinId ? <JoinQr joinId={state.joinId} size={130} /> : null}
        />
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

/* --------------------------------------------------------------- fit */

/**
 * Shrinks its content to fit the rest of the window (never enlarges it).
 * Layout size is measured, which a transform does not change, so scaling
 * never feeds back into the measurement.
 */
function FitToScreen({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const o = outer.current;
      const i = inner.current;
      if (!o || !i) return;
      const room = window.innerHeight - o.getBoundingClientRect().top - 24;
      const scale = Math.min(1, room / i.offsetHeight, o.clientWidth / i.scrollWidth);
      setFit({ scale: Math.max(0.3, scale), height: i.offsetHeight * Math.max(0.3, scale) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (inner.current) observer.observe(inner.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return (
    <div ref={outer} className="fit-box" style={{ height: fit.height || undefined }}>
      <div
        ref={inner}
        className="fit-inner"
        style={fit.scale < 1 ? { transform: `scale(${fit.scale})` } : undefined}
      >
        {children}
      </div>
    </div>
  );
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
