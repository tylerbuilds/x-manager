'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle, Info, X, XCircle, type LucideIcon } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastVariant = 'default' | 'success' | 'error' | 'warning';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
  /** true while the exit animation is running */
  exiting: boolean;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Variant configuration
// ---------------------------------------------------------------------------

const variantConfig: Record<
  ToastVariant,
  {
    containerClass: string;
    iconClass: string;
    Icon: LucideIcon;
  }
> = {
  default: {
    containerClass:
      'bg-white border-slate-200 text-slate-900 ' +
      'dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100',
    iconClass: 'text-slate-500 dark:text-slate-400',
    Icon: Info,
  },
  success: {
    containerClass:
      'bg-emerald-50 border-emerald-200 text-emerald-800 ' +
      'dark:bg-emerald-900/50 dark:border-emerald-800 dark:text-emerald-200',
    iconClass: 'text-emerald-500 dark:text-emerald-400',
    Icon: CheckCircle,
  },
  error: {
    containerClass:
      'bg-red-50 border-red-200 text-red-700 ' +
      'dark:bg-red-900/50 dark:border-red-800 dark:text-red-200',
    iconClass: 'text-red-500 dark:text-red-400',
    Icon: XCircle,
  },
  warning: {
    containerClass:
      'bg-amber-50 border-amber-200 text-amber-900 ' +
      'dark:bg-amber-900/50 dark:border-amber-800 dark:text-amber-200',
    iconClass: 'text-amber-500 dark:text-amber-400',
    Icon: AlertTriangle,
  },
};

// ---------------------------------------------------------------------------
// Animation styles injected once into <head>
// ---------------------------------------------------------------------------

const STYLE_ID = 'x-manager-toast-styles';

function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes toast-slide-in {
      from {
        opacity: 0;
        transform: translateX(110%);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @keyframes toast-fade-out {
      from {
        opacity: 1;
        transform: translateX(0);
        max-height: 200px;
        margin-bottom: 0.5rem;
      }
      to {
        opacity: 0;
        transform: translateX(110%);
        max-height: 0;
        margin-bottom: 0;
      }
    }

    .toast-enter {
      animation: toast-slide-in 280ms cubic-bezier(0.21, 1.02, 0.73, 1) both;
    }

    .toast-exit {
      animation: toast-fade-out 220ms ease-in both;
      pointer-events: none;
      overflow: hidden;
    }

    @media (prefers-reduced-motion: reduce) {
      .toast-enter,
      .toast-exit {
        animation: none;
      }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Individual toast component
// ---------------------------------------------------------------------------

const MAX_TOASTS = 5;
const EXIT_ANIMATION_MS = 220;

interface ToastItemProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
}

function ToastItemComponent({ item, onDismiss }: ToastItemProps) {
  const { containerClass, iconClass, Icon } = variantConfig[item.variant ?? 'default'];

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={[
        'relative flex items-start gap-3 w-full max-w-sm',
        'rounded-xl border shadow-lg px-4 py-3',
        'mb-2',
        containerClass,
        item.exiting ? 'toast-exit' : 'toast-enter',
      ].join(' ')}
    >
      {/* Icon */}
      <span className={['mt-0.5 shrink-0', iconClass].join(' ')}>
        <Icon size={18} />
      </span>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-snug">{item.title}</p>
        {item.description && (
          <p className="text-sm opacity-80 mt-0.5 leading-snug">{item.description}</p>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
        className="shrink-0 mt-0.5 rounded p-0.5 opacity-60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current transition-opacity"
      >
        <X size={15} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast container rendered via portal
// ---------------------------------------------------------------------------

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    ensureStyles();
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse items-end pointer-events-none"
      style={{ maxWidth: '24rem' }}
    >
      {toasts.map((item) => (
        <div key={item.id} className="pointer-events-auto w-full">
          <ToastItemComponent item={item} onDismiss={onDismiss} />
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Map of id -> timeout handle for auto-dismiss
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    // Start exit animation
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    );

    // Remove from state after animation completes
    const removeTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_ANIMATION_MS);

    // Clean up the auto-dismiss timer if it's still pending
    const existing = timersRef.current.get(id);
    if (existing) {
      clearTimeout(existing);
      timersRef.current.delete(id);
    }

    // Store the remove timer so we can clean it up if needed
    timersRef.current.set(`__remove_${id}`, removeTimer);
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const duration = options.duration ?? 4000;

      setToasts((prev) => {
        // Enforce max visible toasts: drop the oldest non-exiting ones if over limit
        const active = prev.filter((t) => !t.exiting);
        let next = [...prev];
        if (active.length >= MAX_TOASTS) {
          // Remove the oldest active toast immediately (no animation to keep it fast)
          const oldest = active[0];
          const existingTimer = timersRef.current.get(oldest.id);
          if (existingTimer) {
            clearTimeout(existingTimer);
            timersRef.current.delete(oldest.id);
          }
          next = next.filter((t) => t.id !== oldest.id);
        }
        return [...next, { ...options, id, exiting: false }];
      });

      // Schedule auto-dismiss
      const timer = setTimeout(() => {
        dismiss(id);
      }, duration);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
