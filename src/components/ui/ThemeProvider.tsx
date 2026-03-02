'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'x-manager-theme';
const CYCLE_ORDER: Theme[] = ['light', 'dark', 'system'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveEffectiveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyThemeToDom(theme: Theme): void {
  const effective = resolveEffectiveTheme(theme);
  const root = document.documentElement;
  if (effective === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable in some environments
  }
  return 'system';
}

function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start with 'system' on the server so the initial render matches SSR.
  // The real preference is applied client-side in the first useEffect.
  const [theme, setThemeState] = useState<Theme>('system');

  const applyAndStore = useCallback((next: Theme) => {
    setThemeState(next);
    writeStoredTheme(next);
    applyThemeToDom(next);
  }, []);

  // Read stored preference once on mount
  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    applyThemeToDom(stored);
  }, []);

  // Track system preference changes when theme === 'system'
  useEffect(() => {
    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyThemeToDom('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => applyAndStore(next),
    [applyAndStore],
  );

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const idx = CYCLE_ORDER.indexOf(prev);
      const next = CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
      writeStoredTheme(next);
      applyThemeToDom(next);
      return next;
    });
  }, []);

  const value: ThemeContextValue = { theme, setTheme, toggleTheme };

  // Render children immediately to avoid hydration mismatch.
  // Theme class is applied to <html> via useEffect above.
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// ThemeToggle
// ---------------------------------------------------------------------------

const THEME_META: Record<Theme, { label: string; Icon: React.ElementType }> = {
  light: { label: 'Light mode', Icon: Sun },
  dark:  { label: 'Dark mode',  Icon: Moon },
  system: { label: 'System mode', Icon: Monitor },
};

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { label, Icon } = THEME_META[theme];

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={`Current theme: ${label}. Click to cycle theme.`}
      className="
        w-8 h-8 rounded-lg flex items-center justify-center
        text-slate-400 hover:text-slate-600 hover:bg-slate-100
        dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-800
        transition-colors
      "
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}
