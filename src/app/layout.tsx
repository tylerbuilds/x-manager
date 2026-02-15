import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'X Manager',
  description: 'Open source X posting, scheduling, and discovery manager',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
