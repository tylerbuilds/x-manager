'use client';

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type DragEvent,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  GripVertical,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Scissors,
  Send,
  Smile,
  ImageIcon,
  Loader2,
  Clock,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHARS = 280;
const WARN_THRESHOLD = 250;
const TCO_LENGTH = 23;
const URL_REGEX = /https?:\/\/[^\s]+/g;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Twitter-weighted character count (URLs count as 23 chars). */
function weightedLength(text: string): number {
  let count = 0;
  let lastIndex = 0;
  const matches = Array.from(text.matchAll(URL_REGEX));

  for (const match of matches) {
    const start = match.index ?? 0;
    count += start - lastIndex;
    count += TCO_LENGTH;
    lastIndex = start + match[0].length;
  }

  count += text.length - lastIndex;
  return count;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Split long text into tweet-sized chunks at sentence boundaries. */
function autoSplitText(text: string): string[] {
  if (weightedLength(text) <= MAX_CHARS) return [text];

  const sentenceBreaks = /(?<=[.!?])\s+/g;
  const sentences: string[] = [];
  let lastIdx = 0;

  for (const match of text.matchAll(sentenceBreaks)) {
    const idx = (match.index ?? 0) + match[0].length;
    sentences.push(text.slice(lastIdx, idx).trim());
    lastIdx = idx;
  }
  // Remainder (or if no sentence breaks found)
  const remainder = text.slice(lastIdx).trim();
  if (remainder) sentences.push(remainder);

  // If there were no sentence breaks, fall back to word-boundary splitting
  if (sentences.length <= 1) {
    return splitByWords(text);
  }

  // Greedily pack sentences into tweets
  const tweets: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (weightedLength(candidate) <= MAX_CHARS) {
      current = candidate;
    } else {
      if (current) tweets.push(current.trim());
      // If a single sentence is over the limit, split it by words
      if (weightedLength(sentence) > MAX_CHARS) {
        const wordChunks = splitByWords(sentence);
        tweets.push(...wordChunks.slice(0, -1));
        current = wordChunks[wordChunks.length - 1] || '';
      } else {
        current = sentence;
      }
    }
  }
  if (current.trim()) tweets.push(current.trim());

  return tweets.length > 0 ? tweets : [text];
}

/** Fallback: split at word boundaries when no sentence breaks available. */
function splitByWords(text: string): string[] {
  const words = text.split(/\s+/);
  const tweets: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (weightedLength(candidate) <= MAX_CHARS) {
      current = candidate;
    } else {
      if (current) tweets.push(current);
      current = word;
    }
  }
  if (current) tweets.push(current);

  return tweets;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TweetItem {
  id: string;
  text: string;
}

export interface ThreadComposerProps {
  initialTweets?: string[];
  accountSlot?: number;
  onSubmit: (tweets: string[], scheduledTime: string | null) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
  scheduledTime?: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Connecting line between tweet cards. */
function ConnectingLine({
  showAddButton,
  onAdd,
}: {
  showAddButton: boolean;
  onAdd: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative flex flex-col items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="w-0.5 h-6 bg-slate-300 dark:bg-slate-600" />
      {showAddButton && (
        <button
          type="button"
          onClick={onAdd}
          className={`
            absolute top-1/2 -translate-y-1/2
            w-6 h-6 rounded-full border-2 border-dashed
            flex items-center justify-center
            transition-all duration-150
            ${
              hovered
                ? 'border-teal-500 dark:border-teal-400 text-teal-500 dark:text-teal-400 scale-110'
                : 'border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500'
            }
            bg-white dark:bg-slate-800
            hover:border-teal-500 dark:hover:border-teal-400
            hover:text-teal-500 dark:hover:text-teal-400
          `}
          aria-label="Insert tweet here"
        >
          <Plus className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/** Character count bar & label. */
function CharacterCount({ text }: { text: string }) {
  const count = useMemo(() => weightedLength(text), [text]);
  const pct = Math.min((count / MAX_CHARS) * 100, 100);

  const barColor =
    count > MAX_CHARS
      ? 'bg-red-500'
      : count >= WARN_THRESHOLD
      ? 'bg-yellow-500'
      : 'bg-teal-500';

  const textColor =
    count > MAX_CHARS
      ? 'text-red-500 font-semibold'
      : count >= WARN_THRESHOLD
      ? 'text-yellow-500 font-medium'
      : 'text-slate-400 dark:text-slate-500';

  return (
    <div className="flex items-center gap-3">
      {/* Bar */}
      <div className="flex-1 h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div
          className={`h-1 rounded-full transition-all duration-200 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Count label */}
      <span className={`text-xs tabular-nums whitespace-nowrap ${textColor}`}>
        {count} / {MAX_CHARS}
      </span>
    </div>
  );
}

/** Single tweet card in compose mode. */
function TweetCard({
  tweet,
  index,
  total,
  onChange,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragTarget,
}: {
  tweet: TweetItem;
  index: number;
  total: number;
  onChange: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragEnd: () => void;
  isDragTarget: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 80)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [tweet.text, adjustHeight]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(tweet.id, e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Allow tab to move focus naturally
    if (e.key === 'Tab') return;
  };

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, tweet.id)}
      onDragOver={(e) => onDragOver(e, tweet.id)}
      onDrop={(e) => onDrop(e, tweet.id)}
      onDragEnd={onDragEnd}
      className={`
        bg-white dark:bg-slate-800
        border rounded-xl shadow-sm
        transition-all duration-150
        ${
          isDragTarget
            ? 'border-teal-500 dark:border-teal-400 shadow-md ring-2 ring-teal-500/20'
            : 'border-slate-200 dark:border-slate-700'
        }
      `}
    >
      {/* Card header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        {/* Drag handle */}
        <div
          className="cursor-grab active:cursor-grabbing text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors"
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Tweet number */}
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 select-none">
          Tweet {index + 1}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Delete button */}
        {total > 1 && (
          <button
            type="button"
            onClick={() => onDelete(tweet.id)}
            className="p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            aria-label={`Delete tweet ${index + 1}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Textarea */}
      <div className="px-4">
        <textarea
          ref={textareaRef}
          value={tweet.text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={index === 0 ? 'Start your thread...' : 'Continue the thread...'}
          className="
            w-full resize-none border-0 bg-transparent
            focus:ring-0 focus:outline-none
            text-slate-900 dark:text-slate-100
            placeholder-slate-400 dark:placeholder-slate-500
            text-[15px] leading-relaxed
            min-h-[80px]
          "
          rows={3}
        />
      </div>

      {/* Character count */}
      <div className="px-4 pb-2">
        <CharacterCount text={tweet.text} />
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-1 px-3 pb-3 border-t border-slate-100 dark:border-slate-700/50 pt-2 mx-1">
        <button
          type="button"
          className="p-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
          aria-label="Add emoji"
          title="Emoji"
        >
          <Smile className="w-4 h-4" />
        </button>
        <button
          type="button"
          className="p-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
          aria-label="Add media"
          title="Media"
        >
          <ImageIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** Single tweet card in preview mode (X-like appearance). */
function PreviewCard({ text, index }: { text: string; index: number }) {
  // Parse segments for syntax highlighting (mirrors TweetPreview logic)
  const segments = useMemo(() => {
    const tokens = text.split(/(\s+)/);
    const result: { type: 'text' | 'url' | 'mention' | 'hashtag'; value: string }[] = [];

    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        result.push({ type: 'text', value: token });
      } else if (/^https?:\/\//i.test(token)) {
        result.push({ type: 'url', value: token });
      } else if (/^@\w+/.test(token)) {
        const match = token.match(/^(@\w+)(.*)/s);
        if (match) {
          result.push({ type: 'mention', value: match[1] });
          if (match[2]) result.push({ type: 'text', value: match[2] });
        } else {
          result.push({ type: 'text', value: token });
        }
      } else if (/^#\w+/.test(token)) {
        const match = token.match(/^(#\w+)(.*)/s);
        if (match) {
          result.push({ type: 'hashtag', value: match[1] });
          if (match[2]) result.push({ type: 'text', value: match[2] });
        } else {
          result.push({ type: 'text', value: token });
        }
      } else {
        result.push({ type: 'text', value: token });
      }
    }
    return result;
  }, [text]);

  return (
    <div className="flex gap-3">
      {/* Left: avatar + thread line */}
      <div className="flex flex-col items-center">
        {/* Avatar placeholder */}
        <div className="w-10 h-10 rounded-full bg-slate-300 dark:bg-slate-600 flex-shrink-0" />
        {/* Thread connector line */}
        <div className="w-0.5 flex-1 bg-slate-300 dark:bg-slate-600 mt-1" />
      </div>

      {/* Right: content */}
      <div className="flex-1 pb-4 border-l-2 border-teal-500/40 dark:border-teal-400/40 pl-3 -ml-px">
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
            Your Name
          </span>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            @handle
          </span>
          <span className="text-slate-400 dark:text-slate-500 text-xs">
            &middot; {index === 0 ? 'now' : `${index}m`}
          </span>
        </div>

        {/* Tweet body */}
        <p className="text-[15px] leading-snug text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">
          {text.length === 0 ? (
            <span className="text-slate-400 dark:text-slate-500 italic">
              Empty tweet
            </span>
          ) : (
            segments.map((seg, i) => {
              if (seg.type === 'url') {
                return (
                  <span key={i} className="text-blue-500 hover:underline cursor-pointer">
                    {seg.value}
                  </span>
                );
              }
              if (seg.type === 'mention' || seg.type === 'hashtag') {
                return (
                  <span key={i} className="text-blue-500 font-medium">
                    {seg.value}
                  </span>
                );
              }
              return <span key={i}>{seg.value}</span>;
            })
          )}
        </p>

        {/* Thread link */}
        <p className="mt-2 text-sm text-blue-500 dark:text-blue-400 cursor-pointer hover:underline">
          Show this thread
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ThreadComposer({
  initialTweets,
  onSubmit,
  onCancel,
  isSubmitting = false,
  scheduledTime: initialScheduledTime,
}: ThreadComposerProps) {
  // --- State ---
  const [tweets, setTweets] = useState<TweetItem[]>(() => {
    const initial = initialTweets && initialTweets.length > 0 ? initialTweets : [''];
    return initial.map((text) => ({ id: generateId(), text }));
  });

  const [previewMode, setPreviewMode] = useState(false);
  const [scheduledTime, setScheduledTime] = useState(initialScheduledTime ?? '');
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // --- Helpers ---

  const updateTweet = useCallback((id: string, text: string) => {
    setTweets((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)));
  }, []);

  const deleteTweet = useCallback((id: string) => {
    setTweets((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const addTweetAt = useCallback((index: number) => {
    setTweets((prev) => {
      const next = [...prev];
      next.splice(index, 0, { id: generateId(), text: '' });
      return next;
    });
  }, []);

  const addTweetAtEnd = useCallback(() => {
    setTweets((prev) => [...prev, { id: generateId(), text: '' }]);
  }, []);

  // --- Auto-split ---

  const handleAutoSplit = useCallback(() => {
    setTweets((prev) => {
      if (prev.length === 0) return prev;
      const first = prev[0];
      if (weightedLength(first.text) <= MAX_CHARS) return prev;

      const chunks = autoSplitText(first.text);
      const newTweets: TweetItem[] = chunks.map((text, i) =>
        i === 0 ? { ...first, text } : { id: generateId(), text }
      );

      // Keep remaining tweets after the first
      return [...newTweets, ...prev.slice(1)];
    });
  }, []);

  // --- Drag & Drop ---

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>, id: string) => {
      setDragSourceId(id);
      e.dataTransfer.effectAllowed = 'move';
      // Required for Firefox
      e.dataTransfer.setData('text/plain', id);
    },
    []
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>, id: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragTargetId(id);
    },
    []
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, targetId: string) => {
      e.preventDefault();
      if (!dragSourceId || dragSourceId === targetId) {
        setDragSourceId(null);
        setDragTargetId(null);
        return;
      }

      setTweets((prev) => {
        const sourceIdx = prev.findIndex((t) => t.id === dragSourceId);
        const targetIdx = prev.findIndex((t) => t.id === targetId);
        if (sourceIdx === -1 || targetIdx === -1) return prev;

        const next = [...prev];
        const [moved] = next.splice(sourceIdx, 1);
        next.splice(targetIdx, 0, moved);
        return next;
      });

      setDragSourceId(null);
      setDragTargetId(null);
    },
    [dragSourceId]
  );

  const handleDragEnd = useCallback(() => {
    setDragSourceId(null);
    setDragTargetId(null);
  }, []);

  // --- Submit ---

  const handleSubmit = useCallback(async () => {
    const nonEmpty = tweets.filter((t) => t.text.trim().length > 0);
    if (nonEmpty.length === 0) return;

    const tweetTexts = nonEmpty.map((t) => t.text);
    const time = scheduledTime || null;
    await onSubmit(tweetTexts, time);
  }, [tweets, scheduledTime, onSubmit]);

  // --- Computed ---

  const hasOverLimit = useMemo(
    () => tweets.some((t) => weightedLength(t.text) > MAX_CHARS),
    [tweets]
  );

  const hasContent = useMemo(
    () => tweets.some((t) => t.text.trim().length > 0),
    [tweets]
  );

  const canAutoSplit = useMemo(
    () => tweets.length > 0 && weightedLength(tweets[0]?.text ?? '') > MAX_CHARS,
    [tweets]
  );

  // Format scheduled time for the input
  const scheduledTimeInputValue = useMemo(() => {
    if (!scheduledTime) return '';
    try {
      const d = new Date(scheduledTime);
      // Format to local datetime-local input value
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return scheduledTime;
    }
  }, [scheduledTime]);

  const handleTimeChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) {
      setScheduledTime('');
      return;
    }
    // Convert datetime-local to ISO string
    setScheduledTime(new Date(val).toISOString());
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div ref={containerRef} className="w-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Preview toggle */}
        <button
          type="button"
          onClick={() => setPreviewMode(!previewMode)}
          className={`
            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
            transition-colors duration-150
            ${
              previewMode
                ? 'bg-teal-500 text-white hover:bg-teal-600'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }
          `}
        >
          {previewMode ? (
            <>
              <EyeOff className="w-4 h-4" />
              Edit
            </>
          ) : (
            <>
              <Eye className="w-4 h-4" />
              Preview
            </>
          )}
        </button>

        {/* Auto-split */}
        {!previewMode && (
          <button
            type="button"
            onClick={handleAutoSplit}
            disabled={!canAutoSplit}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
              transition-colors duration-150
              ${
                canAutoSplit
                  ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600 cursor-not-allowed'
              }
            `}
            title={canAutoSplit ? 'Split first tweet into multiple tweets at sentence boundaries' : 'First tweet must exceed 280 characters to auto-split'}
          >
            <Scissors className="w-4 h-4" />
            Auto-split
          </button>
        )}

        {/* Tweet count */}
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
          {tweets.length} tweet{tweets.length !== 1 ? 's' : ''} in thread
        </span>
      </div>

      {/* --- Preview mode --- */}
      {previewMode ? (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4">
          {tweets.filter((t) => t.text.trim()).length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">
              Nothing to preview. Add some content to your tweets.
            </p>
          ) : (
            <div className="space-y-0">
              {tweets
                .filter((t) => t.text.trim())
                .map((tweet, i) => (
                  <PreviewCard key={tweet.id} text={tweet.text} index={i} />
                ))}
            </div>
          )}
        </div>
      ) : (
        /* --- Compose mode --- */
        <div>
          {tweets.map((tweet, index) => (
            <div key={tweet.id}>
              {/* Connecting line + add button between cards */}
              {index > 0 && (
                <ConnectingLine
                  showAddButton
                  onAdd={() => addTweetAt(index)}
                />
              )}

              <TweetCard
                tweet={tweet}
                index={index}
                total={tweets.length}
                onChange={updateTweet}
                onDelete={deleteTweet}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                isDragTarget={dragTargetId === tweet.id && dragSourceId !== tweet.id}
              />
            </div>
          ))}

          {/* Add tweet at end */}
          <div className="flex flex-col items-center mt-1">
            <div className="w-0.5 h-4 bg-slate-300 dark:bg-slate-600" />
            <button
              type="button"
              onClick={addTweetAtEnd}
              className="
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                text-teal-600 dark:text-teal-400
                bg-teal-50 dark:bg-teal-500/10
                hover:bg-teal-100 dark:hover:bg-teal-500/20
                border border-teal-200 dark:border-teal-500/30
                transition-colors duration-150
              "
            >
              <Plus className="w-4 h-4" />
              Add Tweet
            </button>
          </div>
        </div>
      )}

      {/* --- Bottom bar: schedule + actions --- */}
      <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-3">
          {/* Schedule time */}
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400 dark:text-slate-500" />
            <input
              type="datetime-local"
              value={scheduledTimeInputValue}
              onChange={handleTimeChange}
              className="
                text-sm rounded-lg px-3 py-1.5
                bg-white dark:bg-slate-800
                border border-slate-200 dark:border-slate-700
                text-slate-700 dark:text-slate-300
                focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500
                dark:focus:ring-teal-400/40 dark:focus:border-teal-400
                transition-colors
              "
            />
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Cancel */}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="
                px-4 py-2 rounded-lg text-sm font-medium
                text-slate-600 dark:text-slate-300
                bg-slate-100 dark:bg-slate-700
                hover:bg-slate-200 dark:hover:bg-slate-600
                disabled:opacity-50
                transition-colors duration-150
              "
            >
              Cancel
            </button>
          )}

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !hasContent || hasOverLimit}
            className="
              inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold
              bg-teal-500 text-white
              hover:bg-teal-600
              disabled:bg-teal-500/50 disabled:cursor-not-allowed
              transition-colors duration-150
            "
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Scheduling...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {scheduledTime ? 'Schedule Thread' : 'Post Thread'}
              </>
            )}
          </button>
        </div>

        {/* Validation warning */}
        {hasOverLimit && (
          <p className="mt-2 text-xs text-red-500 font-medium">
            One or more tweets exceed the 280-character limit. Please shorten them or use Auto-split.
          </p>
        )}
      </div>
    </div>
  );
}
