'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Calendar,
  CornerDownLeft,
  FileText,
  Layout,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Target,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  entityType: string;
  entityId: number;
  excerpt: string;
  matchField: string;
}

interface SearchResponse {
  query: string;
  total: number;
  results: SearchResult[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Navigate to a named view (dashboard, calendar, etc.) */
  onNavigate: (view: string) => void;
  /** Called when user selects a search result */
  onSelectResult?: (result: { entityType: string; entityId: number }) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTITY_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  post: {
    label: 'Post',
    icon: <Calendar size={14} />,
    color: 'text-blue-500 dark:text-blue-400',
  },
  draft: {
    label: 'Draft',
    icon: <FileText size={14} />,
    color: 'text-amber-500 dark:text-amber-400',
  },
  inbox: {
    label: 'Inbox',
    icon: <MessageSquare size={14} />,
    color: 'text-violet-500 dark:text-violet-400',
  },
  campaign: {
    label: 'Campaign',
    icon: <Target size={14} />,
    color: 'text-rose-500 dark:text-rose-400',
  },
  template: {
    label: 'Template',
    icon: <Layout size={14} />,
    color: 'text-emerald-500 dark:text-emerald-400',
  },
};

// Entity type display order for grouped results
const ENTITY_ORDER = ['post', 'draft', 'inbox', 'campaign', 'template'];

interface QuickAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  view?: string;
  action?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByEntityType(
  results: SearchResult[],
): Array<{ type: string; items: SearchResult[] }> {
  const map = new Map<string, SearchResult[]>();

  for (const result of results) {
    const list = map.get(result.entityType) ?? [];
    list.push(result);
    map.set(result.entityType, list);
  }

  // Return in canonical order, then any unknown types appended at the end
  const ordered: Array<{ type: string; items: SearchResult[] }> = [];
  for (const type of ENTITY_ORDER) {
    if (map.has(type)) {
      ordered.push({ type, items: map.get(type)! });
      map.delete(type);
    }
  }
  for (const [type, items] of map.entries()) {
    ordered.push({ type, items });
  }
  return ordered;
}

function truncateExcerpt(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '…';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-xs font-mono text-slate-600 dark:text-slate-300">
      {children}
    </span>
  );
}

function SkeletonLine({ width }: { width: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-slate-200 dark:bg-slate-700 h-4 ${width}`}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div className="px-4 py-3 space-y-3" aria-label="Loading results">
      {[
        { label: 'w-3/4', meta: 'w-1/4' },
        { label: 'w-2/3', meta: 'w-1/5' },
        { label: 'w-4/5', meta: 'w-1/4' },
      ].map((row, i) => (
        <div key={i} className="flex items-center gap-3">
          <SkeletonLine width="w-5" />
          <div className="flex-1 space-y-1.5">
            <SkeletonLine width={row.label} />
            <SkeletonLine width={row.meta} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onSelectResult,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track last query that was actually fetched to avoid stale results
  const lastQueryRef = useRef('');

  // ------------------------------------------------------------------
  // Quick actions (shown when query is empty)
  // ------------------------------------------------------------------

  const quickActions: QuickAction[] = [
    {
      id: 'new-post',
      label: 'New Post',
      icon: <Plus size={16} />,
      view: 'calendar',
    },
    {
      id: 'view-calendar',
      label: 'View Calendar',
      icon: <Calendar size={16} />,
      view: 'calendar',
    },
    {
      id: 'view-analytics',
      label: 'View Analytics',
      icon: <BarChart3 size={16} />,
      view: 'analytics',
    },
    {
      id: 'view-drafts',
      label: 'View Drafts',
      icon: <FileText size={16} />,
      view: 'drafts',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings size={16} />,
      view: 'settings',
    },
  ];

  // ------------------------------------------------------------------
  // Keyboard shortcut registration: Cmd+K / Ctrl+K
  // ------------------------------------------------------------------

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Open via Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
        return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  // ------------------------------------------------------------------
  // Reset state when palette opens/closes
  // ------------------------------------------------------------------

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setError(null);
      setHighlightedIndex(-1);
      lastQueryRef.current = '';
      // Auto-focus input on next tick (after animation starts)
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // ------------------------------------------------------------------
  // Debounced search
  // ------------------------------------------------------------------

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    lastQueryRef.current = q;

    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}&limit=10`,
      );
      if (!res.ok) {
        throw new Error(`Search failed: ${res.status}`);
      }
      const data: SearchResponse = await res.json();
      // Only apply if this is still the latest query
      if (lastQueryRef.current === q) {
        setResults(data.results);
        setHighlightedIndex(data.results.length > 0 ? 0 : -1);
      }
    } catch (err) {
      if (lastQueryRef.current === q) {
        setError('Search failed. Please try again.');
        setResults([]);
      }
    } finally {
      if (lastQueryRef.current === q) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query) {
      setResults([]);
      setLoading(false);
      setError(null);
      setHighlightedIndex(-1);
      return;
    }

    debounceRef.current = setTimeout(() => {
      doSearch(query);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  // ------------------------------------------------------------------
  // Build flat list of selectable items for keyboard navigation
  // ------------------------------------------------------------------

  // This flat list drives index-based highlighting
  const flatItems: Array<
    | { kind: 'result'; result: SearchResult }
    | { kind: 'action'; action: QuickAction }
  > = query
    ? results.map((r) => ({ kind: 'result' as const, result: r }))
    : quickActions.map((a) => ({ kind: 'action' as const, action: a }));

  // ------------------------------------------------------------------
  // Keyboard navigation inside the palette
  // ------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
        return;
      }

      if (e.key === 'Tab') {
        // Trap focus — do nothing (don't let Tab escape the palette)
        e.preventDefault();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const next = prev < flatItems.length - 1 ? prev + 1 : 0;
          scrollItemIntoView(next);
          return next;
        });
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : flatItems.length - 1;
          scrollItemIntoView(next);
          return next;
        });
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < flatItems.length) {
          selectItem(highlightedIndex);
        }
        return;
      }
    },
    [flatItems, highlightedIndex, onOpenChange],
  );

  function scrollItemIntoView(index: number) {
    if (!resultsRef.current) return;
    const el = resultsRef.current.querySelector<HTMLElement>(
      `[data-index="${index}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }

  function selectItem(index: number) {
    const item = flatItems[index];
    if (!item) return;

    if (item.kind === 'action') {
      if (item.action.view) {
        onNavigate(item.action.view);
      } else {
        item.action.action?.();
      }
      onOpenChange(false);
    } else {
      onSelectResult?.({
        entityType: item.result.entityType,
        entityId: item.result.entityId,
      });
      onOpenChange(false);
    }
  }

  // ------------------------------------------------------------------
  // Backdrop click closes palette
  // ------------------------------------------------------------------

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) {
      onOpenChange(false);
    }
  }

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  function renderQuickActions() {
    return (
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-4 py-2">
          Quick Actions
        </div>
        {quickActions.map((action, idx) => {
          const isHighlighted = highlightedIndex === idx;
          return (
            <button
              key={action.id}
              data-index={idx}
              type="button"
              onMouseEnter={() => setHighlightedIndex(idx)}
              onClick={() => selectItem(idx)}
              className={[
                'w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors text-left',
                isHighlighted
                  ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-900 dark:text-teal-100'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700',
              ].join(' ')}
            >
              <span
                className={
                  isHighlighted
                    ? 'text-teal-600 dark:text-teal-400'
                    : 'text-slate-400 dark:text-slate-500'
                }
              >
                {action.icon}
              </span>
              <span className="text-sm font-medium">{action.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  function renderSearchResults() {
    if (loading) {
      return <LoadingSkeleton />;
    }

    if (error) {
      return (
        <div className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">
          {error}
        </div>
      );
    }

    if (query.length < 2) {
      return (
        <div className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">
          Type at least 2 characters to search
        </div>
      );
    }

    if (results.length === 0) {
      return (
        <div className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">
          No results for &ldquo;{query}&rdquo;
        </div>
      );
    }

    const groups = groupByEntityType(results);

    // Compute per-group index offsets for correct flat-list highlighting
    let runningIndex = 0;
    return groups.map(({ type, items }) => {
      const config = ENTITY_CONFIG[type] ?? {
        label: type.charAt(0).toUpperCase() + type.slice(1),
        icon: <FileText size={14} />,
        color: 'text-slate-400 dark:text-slate-500',
      };

      const groupStart = runningIndex;
      runningIndex += items.length;

      return (
        <div key={type}>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-4 py-2">
            {config.label}s
          </div>
          {items.map((result, i) => {
            const flatIdx = groupStart + i;
            const isHighlighted = highlightedIndex === flatIdx;

            return (
              <button
                key={`${result.entityType}-${result.entityId}-${i}`}
                data-index={flatIdx}
                type="button"
                onMouseEnter={() => setHighlightedIndex(flatIdx)}
                onClick={() => selectItem(flatIdx)}
                className={[
                  'w-full flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors text-left',
                  isHighlighted
                    ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-900 dark:text-teal-100'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700',
                ].join(' ')}
              >
                {/* Entity type icon */}
                <span
                  className={`mt-0.5 shrink-0 ${isHighlighted ? 'text-teal-600 dark:text-teal-400' : config.color}`}
                >
                  {config.icon}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={[
                        'text-xs px-1.5 py-0.5 rounded shrink-0',
                        isHighlighted
                          ? 'bg-teal-100 dark:bg-teal-800/50 text-teal-700 dark:text-teal-300'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
                      ].join(' ')}
                    >
                      {config.label} #{result.entityId}
                    </span>
                  </div>
                  <p
                    className={[
                      'text-sm mt-0.5 truncate',
                      isHighlighted
                        ? 'text-teal-800 dark:text-teal-200'
                        : 'text-slate-600 dark:text-slate-300',
                    ].join(' ')}
                  >
                    {truncateExcerpt(result.excerpt)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      );
    });
  }

  // ------------------------------------------------------------------
  // Guard: don't mount DOM when closed (keeps animation clean)
  // ------------------------------------------------------------------

  if (!open) return null;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div
      className="command-palette-backdrop fixed inset-0 bg-black/40 dark:bg-black/60 z-[60] flex justify-center"
      style={{ paddingTop: '20vh' }}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="command-palette-container bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden w-full max-w-xl mx-4 self-start"
        onKeyDown={handleKeyDown}
      >
        {/* ------------------------------------------------------------------ */}
        {/* Search input row                                                     */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex items-center border-b border-slate-200 dark:border-slate-700 px-4">
          <Search
            size={18}
            className="shrink-0 text-slate-400 dark:text-slate-500 mr-3"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search posts, drafts, inbox..."
            className="text-lg bg-transparent border-0 focus:ring-0 focus:outline-none w-full py-3 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500 ml-3 hidden sm:block">
            <KeyBadge>Esc</KeyBadge>
          </span>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Results / quick actions                                              */}
        {/* ------------------------------------------------------------------ */}
        <div
          ref={resultsRef}
          className="max-h-[50vh] overflow-y-auto overscroll-contain"
          role="listbox"
          aria-label={query ? 'Search results' : 'Quick actions'}
        >
          {query ? renderSearchResults() : renderQuickActions()}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Footer                                                              */}
        {/* ------------------------------------------------------------------ */}
        <div className="bg-slate-50 dark:bg-slate-900 px-4 py-2 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <span className="flex items-center gap-1">
            <KeyBadge>
              <ArrowUp size={10} />
            </KeyBadge>
            <KeyBadge>
              <ArrowDown size={10} />
            </KeyBadge>
            <span className="ml-0.5">navigate</span>
          </span>
          <span className="flex items-center gap-1">
            <KeyBadge>
              <CornerDownLeft size={10} />
            </KeyBadge>
            <span className="ml-0.5">select</span>
          </span>
          <span className="flex items-center gap-1">
            <KeyBadge>Esc</KeyBadge>
            <span className="ml-0.5">close</span>
          </span>
          {query && !loading && results.length > 0 && (
            <span className="ml-auto">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
