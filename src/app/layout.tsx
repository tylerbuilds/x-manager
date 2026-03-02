import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { ShortcutsProvider } from '@/components/ui/KeyboardShortcuts';

export const metadata: Metadata = {
  title: 'X Manager',
  description: 'Open source X posting, scheduling, and discovery manager',
};

// Inline script to apply dark mode class before React hydrates, preventing FOUC.
// Must match the storage key and logic in ThemeProvider.tsx.
const themeInitScript = `(function(){try{var t=localStorage.getItem('x-manager-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
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
