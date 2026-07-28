import type { ReactNode } from 'react';

export const metadata = { title: 'Liknende saker — NAF reklamasjon' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nb">
      <body style={{ margin: 0, background: '#fafafa' }}>{children}</body>
    </html>
  );
}
