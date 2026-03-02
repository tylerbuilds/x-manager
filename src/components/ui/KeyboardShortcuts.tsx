'use client';

import React, {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { X, Command } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShortcutConfig {
  key: string;
  /** Requires Meta (macOS ⌘) or Ctrl (Windows/Linux) */
  meta?: boolean;
  shift?: boolean;
  handler: () => void;
  description: string;
  /** Optional grouping label (defaults to 'General') */
  category?: string;
}

// ---------------------------------------------------------------------------
// Context — shared registry so multiple hook calls cooperate
// ---------------------------------------------------------------------------

interface RegistryEntry extends ShortcutConfig {
  id: string;
}

interface RegistryContextValue {
  register: (entry: RegistryEntry) => void;
  unregister: (id: string) => void;
  shortcuts: RegistryEntry[];
}

const RegistryContext = createContext<RegistryContextValue | null>(null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _idCounter = 0;
function nextId() {
  return `ks-${++_idCounter}`;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = (el as HTMLElement).tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function matchesShortcut(e: KeyboardEvent, cfg: ShortcutConfig): boolean {
  const keyMatch = e.key.toLowerCase() === cfg.key.toLowerCase();
  const metaMatch = cfg.meta
    ? e.metaKey || e.ctrlKey
    : !e.metaKey && !e.ctrlKey;
  const shiftMatch = cfg.shift ? e.shiftKey : !e.shiftKey;
  return keyMatch && metaMatch && shiftMatch;
}

// ---------------------------------------------------------------------------
// ShortcutsProvider — must wrap the app (or the subtree) once
// ---------------------------------------------------------------------------

export function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [shortcuts, setShortcuts] = useState<RegistryEntry[]>([]);
  const shortcutsRef = useRef<RegistryEntry[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);

  const register = useCallback((entry: RegistryEntry) => {
    shortcutsRef.current = [...shortcutsRef.current, entry];
    setShortcuts([...shortcutsRef.current]);
  }, []);

  const unregister = useCallback((id: string) => {
    shortcutsRef.current = shortcutsRef.current.filter((e) => e.id !== id);
    setShortcuts([...shortcutsRef.current]);
  }, []);

  // Global keydown listener — lives here so it runs even if hook components unmount
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Escape closes help first; other Escape handlers can still run
      if (e.key === 'Escape') {
        if (helpOpen) {
          setHelpOpen(false);
          e.preventDefault();
          return;
        }
      }

      // Skip all other shortcuts when user is typing in an input/textarea
      if (isInputFocused()) return;

      // '?' opens help (shift+/) — only when NOT focused on an input
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        setHelpOpen((v) => !v);
        e.preventDefault();
        return;
      }

      for (const entry of shortcutsRef.current) {
        if (matchesShortcut(e, entry)) {
          e.preventDefault();
          entry.handler();
          return;
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen]);

  return (
    <RegistryContext.Provider value={{ register, unregister, shortcuts }}>
      {children}
      {helpOpen && (
        <ShortcutHelpModal
          shortcuts={shortcuts}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </RegistryContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// useKeyboardShortcuts — call from any client component
// ---------------------------------------------------------------------------

export function useKeyboardShortcuts(configs: ShortcutConfig[]): void {
  const ctx = useContext(RegistryContext);
  if (!ctx) {
    throw new Error(
      'useKeyboardShortcuts must be used inside <ShortcutsProvider>',
    );
  }

  const { register, unregister } = ctx;

  // Stable ref so effect deps don't thrash on every render
  const configsRef = useRef(configs);
  configsRef.current = configs;

  useEffect(() => {
    const entries: RegistryEntry[] = configsRef.current.map((cfg) => ({
      ...cfg,
      id: nextId(),
    }));
    entries.forEach(register);
    return () => entries.forEach((e) => unregister(e.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, unregister]);
}

// ---------------------------------------------------------------------------
// Default app-level shortcuts definition (wired but handlers are no-ops by
// default — callers can override by registering their own handlers for the
// same keys, or this list exists purely for the help modal display)
// ---------------------------------------------------------------------------

export const DEFAULT_SHORTCUTS: Omit<ShortcutConfig, 'handler'>[] = [
  { key: 'n',      category: 'Content',    description: 'New post' },
  { key: 'e',      category: 'Content',    description: 'Edit selected' },
  { key: 'd',      category: 'Content',    description: 'Delete selected' },
  { key: 'k', meta: true, category: 'Navigation', description: 'Open command palette' },
  { key: '?',      category: 'Help',       description: 'Show keyboard shortcuts' },
  { key: 'Escape', category: 'Navigation', description: 'Close modal / overlay' },
];

// ---------------------------------------------------------------------------
// Key badge renderer
// ---------------------------------------------------------------------------

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="
      inline-flex items-center gap-1 rounded border
      border-slate-300 dark:border-slate-600
      bg-slate-100 dark:bg-slate-700
      px-1.5 py-0.5 text-xs font-mono
      text-slate-700 dark:text-slate-300
    ">
      {children}
    </span>
  );
}

function ShortcutKeys({ cfg }: { cfg: Pick<ShortcutConfig, 'key' | 'meta' | 'shift'> }) {
  const parts: React.ReactNode[] = [];

  if (cfg.meta) {
    parts.push(
      <KeyBadge key="meta">
        <Command size={10} strokeWidth={2} />
      </KeyBadge>,
    );
  }
  if (cfg.shift) {
    parts.push(<KeyBadge key="shift">⇧</KeyBadge>);
  }

  const displayKey =
    cfg.key === 'Escape' ? 'Esc'
    : cfg.key === '?'    ? '?'
    : cfg.key.toUpperCase();

  parts.push(<KeyBadge key="main">{displayKey}</KeyBadge>);

  return <span className="inline-flex items-center gap-1">{parts}</span>;
}

// ---------------------------------------------------------------------------
// ShortcutHelpModal
// ---------------------------------------------------------------------------

interface ShortcutHelpModalProps {
  shortcuts: RegistryEntry[];
  onClose: () => void;
}

function ShortcutHelpModal({ shortcuts, onClose }: ShortcutHelpModalProps) {
  // Group by category
  const grouped = new Map<string, RegistryEntry[]>();

  for (const s of shortcuts) {
    const cat = s.category ?? 'General';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(s);
  }

  // Deduplicate by key+meta+shift within each group (multiple registrations
  // of the same logical shortcut can happen during hot-reload or re-mounts)
  const dedupedGroups: Array<{ category: string; items: RegistryEntry[] }> = [];
  grouped.forEach((items, category) => {
    const seen = new Set<string>();
    const unique = items.filter((item) => {
      const sig = `${item.meta ? 'meta+' : ''}${item.shift ? 'shift+' : ''}${item.key.toLowerCase()}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    dedupedGroups.push({ category, items: unique });
  });

  // Also include DEFAULT_SHORTCUTS that are not currently registered
  // (e.g., ? and Escape are handled at provider level, not via hook)
  const registeredSigs = new Set(
    shortcuts.map(
      (s) =>
        `${s.meta ? 'meta+' : ''}${s.shift ? 'shift+' : ''}${s.key.toLowerCase()}`,
    ),
  );

  for (const def of DEFAULT_SHORTCUTS) {
    const sig = `${def.meta ? 'meta+' : ''}${def.shift ? 'shift+' : ''}${def.key.toLowerCase()}`;
    if (!registeredSigs.has(sig)) {
      const cat = def.category ?? 'General';
      const existing = dedupedGroups.find((g) => g.category === cat);
      const entry: RegistryEntry = { ...def, handler: () => {}, id: '' };
      if (existing) {
        existing.items.push(entry);
      } else {
        dedupedGroups.push({ category: cat, items: [entry] });
      }
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="
        w-full max-w-lg rounded-xl shadow-2xl border
        bg-white dark:bg-slate-800
        border-slate-200 dark:border-slate-700
        text-slate-900 dark:text-slate-100
        overflow-hidden
      ">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts help"
            className="
              w-7 h-7 flex items-center justify-center rounded-md
              text-slate-400 hover:text-slate-600 hover:bg-slate-100
              dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-700
              transition-colors
            "
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-[60vh] overflow-y-auto">
          {dedupedGroups.map(({ category, items }) => (
            <div key={category} className="px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                {category}
              </p>
              <table className="w-full text-sm">
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx} className="group">
                      <td className="py-1 pr-4 text-slate-600 dark:text-slate-300 w-full">
                        {item.description}
                      </td>
                      <td className="py-1 text-right whitespace-nowrap">
                        <ShortcutKeys cfg={item} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {dedupedGroups.length === 0 && (
            <p className="px-5 py-6 text-sm text-slate-400 dark:text-slate-500 text-center">
              No shortcuts registered.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 text-xs text-slate-400 dark:text-slate-500">
          Press <KeyBadge>?</KeyBadge> to toggle this panel ·{' '}
          <KeyBadge>Esc</KeyBadge> to close
        </div>
      </div>
    </div>
  );
}
