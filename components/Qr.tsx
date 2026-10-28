'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** A QR code drawn in the browser — nothing is sent to a third-party service. */
export function Qr({ value, size = 280, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1f1a16', light: '#ffffff' },
    })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [value, size]);
  if (!src) return <div style={{ width: size, height: size }} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise
  return <img src={src} width={size} height={size} alt={label} />;
}
