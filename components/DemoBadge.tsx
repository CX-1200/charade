'use client';

import { useEffect, useState } from 'react';
import { DEMO_EVENT, isDemoMode, setDemoMode } from '@/lib/demo';

/** A standing reminder that this browser is not talking to the server. */
export default function DemoBadge() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(isDemoMode());
    // Keep the badge honest whether this tab or another one flips the flag.
    const sync = () => setOn(isDemoMode());
    window.addEventListener('storage', sync);
    window.addEventListener(DEMO_EVENT, sync);
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
