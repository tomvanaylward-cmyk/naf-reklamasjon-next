// app/layout.tsx
import type { Metadata } from 'next';
import { Sora } from 'next/font/google';
import './globals.css';

const sora = Sora({ subsets: ['latin'], weight: ['300','400','500','600','700'] });

export const metadata: Metadata = {
  title: 'NAF Reklamasjonssystem',
  description: 'Saksbehandlingsverktøy for NAF reklamasjoner',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no">
      <body className={sora.className}>{children}</body>
    </html>
  );
}
