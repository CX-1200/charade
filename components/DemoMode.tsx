'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { DEMO_EVENT, isDemoMode, setDemoMode } from '@/lib/demo';

const RELOAD_GUARD = 'charade:demoSynced';

/**
 * Keeps demo mode in step with the server on every page.
 *
 * Demo mode exists only because a deployment has no shared store, so the flag
 * must follow that fact in both directions: switch on when there is no store
 * (otherwise nothing works at all), and — the part that matters after you
 * configure Redis — switch back off, or the browser would keep playing against
 * its own localStorage and the new database would look like it did nothing.
 */
export default function DemoMode() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(isDemoMode());
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener(DEMO_EVENT, sync);

    api<{ durable: boolean }>('/api/health')
      .then(({ durable }) => {
        const shouldBeOn = !durable;
        if (shouldBeOn === isDemoMode()) {
          sessionStorage.removeItem(RELOAD_GUARD);
          return;
        }
        setDemoMode(shouldBeOn);
        // Data already on screen came from the wrong source; reload once to
        // re-fetch it. The guard makes a loop impossible.
        if (!sessionStorage.getItem(RELOAD_GUARD)) {
          sessionStorage.setItem(RELOAD_GUARD, '1');
          window.location.reload();
        }
      })
      .catch(() => undefined);

    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(DEMO_EVENT, sync);
    };
  }, []);

  if (!on) return null;

  return (
    <button
      className="demo-badge"
      title="Demo mode: the game runs in this browser only. Click to turn it off."
      onClick={() => {
        if (confirm('Turn off demo mode? The demo room and its scores stay saved in this browser.')) {
          setDemoMode(false);
          window.location.href = '/';
        }
      }}
    >
      🎬 DEMO MODE
    </button>
  );
}
