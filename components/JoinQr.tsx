'use client';

import { useEffect, useState } from 'react';
import { joinLink } from '@/lib/client';
import { Qr } from './Qr';

/**
 * "Scan to join": the open session's QR code, for the Live screen and the
 * holding page. `corner` is the small card that sits on the Live screen while
 * the show runs, so late arrivals can still get in.
 */
export function JoinQr({
  joinId,
  size = 220,
  corner = false,
}: {
  joinId: string;
  size?: number;
  corner?: boolean;
}) {
  const [link, setLink] = useState('');
  useEffect(() => setLink(joinLink(joinId)), [joinId]);
  if (!link) return null;
  return (
    <figure className={`join-qr${corner ? ' corner' : ''}`}>
      <Qr value={link} size={size} label="QR code to join the vote" />
      <figcaption>Scan to join</figcaption>
    </figure>
  );
}
