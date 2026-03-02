import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { ShortcutsProvider } from '@/components/ui/KeyboardShortcuts';

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
      <body className="antialiased">
          <ThemeProvider>
            <ToastProvider>
              <ShortcutsProvider>
                {children}
              </ShortcutsProvider>
            </ToastProvider>
          </ThemeProvider>
        </body>
    </html>
  );
}
