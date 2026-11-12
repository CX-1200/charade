import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ConfirmProvider } from '@/components/ConfirmDialog';

export const metadata: Metadata = {
  title: 'Best Dress Vote',
  description: 'Scan, vote once, and watch the Best Dress King and Queen results live.',
};

export const viewport: Viewport = {
  themeColor: '#2d1947',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConfirmProvider>{children}</ConfirmProvider>
      </body>
    </html>
  );
}
