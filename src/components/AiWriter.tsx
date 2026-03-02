'use client';

import { useState, useCallback } from 'react';
import {
  Sparkles,
  RefreshCw,
  Maximize2,
  Zap,
  Copy,
  Check,
  X,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = 'generate' | 'rewrite' | 'expand' | 'hook';
type Tone = 'professional' | 'casual' | 'provocative' | 'educational' | 'witty';

interface AiWriterProps {
  onInsert: (text: string) => void;
  existingText?: string;
  className?: string;
}

interface Suggestion {
  text: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TWEET_LENGTH = 280;

const TONES: { value: Tone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'provocative', label: 'Provocative' },
  { value: 'educational', label: 'Educational' },
  { value: 'witty', label: 'Witty' },
];

const MODES: { value: Mode; label: string; icon: React.ReactNode; tooltip: string }[] = [
  {
    value: 'generate',
    label: 'Generate',
    icon: <Sparkles className="w-3.5 h-3.5" />,
    tooltip: 'Create new tweets from your prompt',
  },
  {
    value: 'rewrite',
    label: 'Rewrite',
    icon: <RefreshCw className="w-3.5 h-3.5" />,
    tooltip: 'Rephrase your existing text',
  },
  {
    value: 'expand',
    label: 'Expand',
    icon: <Maximize2 className="w-3.5 h-3.5" />,
    tooltip: 'Turn a tweet into a thread outline',
  },
  {
    value: 'hook',
    label: 'Hook',
    icon: <Zap className="w-3.5 h-3.5" />,
    tooltip: 'Write attention-grabbing opening lines',
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CharCountBadge({ count }: { count: number }) {
  const isOver = count > MAX_TWEET_LENGTH;
  const isWarning = count > 260 && !isOver;

  return (
    <span
      className={[
        'text-xs font-mono px-1.5 py-0.5 rounded',
        isOver
          ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
          : isWarning
          ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
      ].join(' ')}
    >
      {count}/{MAX_TWEET_LENGTH}
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 animate-pulse">
      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-full mb-2" />
      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-4/5 mb-2" />
      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/5" />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available — silently fail.
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-teal-500" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

function SuggestionCard({
  suggestion,
  onInsert,
}: {
  suggestion: Suggestion;
  onInsert: (text: string) => void;
}) {
  const charCount = suggestion.text.length;
  const isOver = charCount > MAX_TWEET_LENGTH;

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-2">
      <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
        {suggestion.text}
      </p>
      <div className="flex items-center justify-between gap-2 pt-1">
        <CharCountBadge count={charCount} />
        <div className="flex items-center gap-1">
          <CopyButton text={suggestion.text} />
          <button
            onClick={() => onInsert(suggestion.text)}
            disabled={isOver}
            className={[
              'text-sm font-medium px-2 py-0.5 rounded transition-colors',
              isOver
                ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed'
                : 'text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-900/30',
            ].join(' ')}
          >
            Use this
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AiWriter({ onInsert, existingText, className = '' }: AiWriterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<Mode>('generate');
  const [tone, setTone] = useState<Tone>('professional');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiPowered, setAiPowered] = useState<boolean | null>(null);

  const handleGenerate = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError('Please enter a prompt describing what you want to tweet about.');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuggestions([]);
    setAiPowered(null);

    try {
      const body: Record<string, unknown> = {
        prompt: trimmedPrompt,
        mode,
        tone,
        count: 3,
      };

      if ((mode === 'rewrite' || mode === 'expand') && existingText?.trim()) {
        body.existingText = existingText.trim();
      }

      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json() as { suggestions?: string[]; aiPowered?: boolean; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `Request failed with status ${res.status}.`);
      }

      const rawSuggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      setSuggestions(rawSuggestions.map((text) => ({ text: String(text) })));
      setAiPowered(data.aiPowered ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate suggestions. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [prompt, mode, tone, existingText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate],
  );

  // Collapsed toggle button
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={[
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
          'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
          'border border-teal-200 dark:border-teal-800',
          'hover:bg-teal-100 dark:hover:bg-teal-900/50',
          className,
        ].join(' ')}
      >
        <Sparkles className="w-3.5 h-3.5" />
        AI Writer
      </button>
    );
  }

  return (
    <div
      className={[
        'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm',
        'flex flex-col gap-3 p-4',
        className,
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-teal-500" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">AI Writer</span>
          {aiPowered !== null && (
            <span
              className={[
                'text-xs px-1.5 py-0.5 rounded-full font-medium',
                aiPowered
                  ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
              ].join(' ')}
            >
              {aiPowered ? 'AI-assisted' : 'Template-based'}
            </span>
          )}
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded"
          aria-label="Close AI Writer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Prompt input */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          What do you want to tweet about?
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your topic, idea, or paste key talking points..."
          rows={3}
          className={[
            'w-full resize-none rounded-lg px-3 py-2 text-sm',
            'bg-slate-50 dark:bg-slate-900',
            'border border-slate-200 dark:border-slate-700',
            'text-slate-800 dark:text-slate-200',
            'placeholder-slate-400 dark:placeholder-slate-600',
            'focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-400 dark:focus:border-teal-600',
            'transition-colors',
          ].join(' ')}
        />
        <p className="text-xs text-slate-400 dark:text-slate-600 text-right">
          Cmd+Enter to generate
        </p>
      </div>

      {/* Tone selector */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Tone</span>
        <div className="flex flex-wrap gap-1.5">
          {TONES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTone(t.value)}
              className={[
                'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                tone === t.value
                  ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mode selector */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Mode</span>
        <div className="flex flex-wrap gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              title={m.tooltip}
              disabled={
                (m.value === 'rewrite' || m.value === 'expand') &&
                !existingText?.trim() &&
                !prompt.trim()
              }
              className={[
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                mode === m.value
                  ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500',
                ((m.value === 'rewrite' || m.value === 'expand') &&
                  !existingText?.trim() &&
                  !prompt.trim())
                  ? 'opacity-40 cursor-not-allowed'
                  : '',
              ].join(' ')}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={isLoading || !prompt.trim()}
        className={[
          'w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
          'bg-teal-600 hover:bg-teal-700 text-white',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'focus:outline-none focus:ring-2 focus:ring-teal-500/50',
        ].join(' ')}
      >
        {isLoading ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Generate
          </>
        )}
      </button>

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <X className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div className="flex flex-col gap-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Results */}
      {!isLoading && suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={handleGenerate}
              className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Regenerate
            </button>
          </div>
          {suggestions.map((s, idx) => (
            <SuggestionCard key={idx} suggestion={s} onInsert={onInsert} />
          ))}
        </div>
      )}
    </div>
  );
}
