import type { Metadata, Viewport } from 'next';
import './globals.css';
import DemoBadge from '@/components/DemoBadge';

export const metadata: Metadata = {
  title: 'Charade Party',
  description:
    'Multiplayer charades in the browser: build your own question bank, split into teams, race the clock.',
};

export const viewport: Viewport = {
  themeColor: '#e0dace',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <DemoBadge />
      </body>
    </html>
  );
}
