import type { Metadata, Viewport } from 'next';
import './globals.css';
import DemoMode from '@/components/DemoMode';

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
        <DemoMode />
      </body>
    </html>
  );
}
