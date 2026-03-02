'use client';

import { useMemo } from 'react';

// X wraps all URLs to t.co links, which are always 23 characters.
const TCO_LENGTH = 23;
const MAX_CHARS = 280;
const WARN_THRESHOLD = 260;

const URL_REGEX = /https?:\/\/[^\s]+/g;

interface TweetPreviewProps {
  text: string;
  className?: string;
}

interface Segment {
  type: 'text' | 'url' | 'mention' | 'hashtag';
  value: string;
}

/**
 * Splits raw tweet text into typed segments for syntax highlighting.
 * Segments are: plain text, URLs, @mentions, #hashtags.
 */
function parseSegments(text: string): Segment[] {
  // We tokenize by splitting on whitespace boundaries while keeping delimiters,
  // then classify each token.
  const tokens = text.split(/(\s+)/);
  const segments: Segment[] = [];

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      segments.push({ type: 'text', value: token });
    } else if (/^https?:\/\//i.test(token)) {
      segments.push({ type: 'url', value: token });
    } else if (/^@\w+/.test(token)) {
      // Handle trailing punctuation — keep it as plain text
      const match = token.match(/^(@\w+)(.*)/s);
      if (match) {
        segments.push({ type: 'mention', value: match[1] });
        if (match[2]) segments.push({ type: 'text', value: match[2] });
      } else {
        segments.push({ type: 'text', value: token });
      }
    } else if (/^#\w+/.test(token)) {
      const match = token.match(/^(#\w+)(.*)/s);
      if (match) {
        segments.push({ type: 'hashtag', value: match[1] });
        if (match[2]) segments.push({ type: 'text', value: match[2] });
      } else {
        segments.push({ type: 'text', value: token });
      }
    } else {
      segments.push({ type: 'text', value: token });
    }
  }

  return segments;
}

/**
 * Computes the weighted character count, substituting each URL with TCO_LENGTH.
 */
function weightedLength(text: string): number {
  let count = 0;
  let lastIndex = 0;

  const urlMatches = Array.from(text.matchAll(URL_REGEX));

  for (const match of urlMatches) {
    const start = match.index ?? 0;
    // Count characters between the last match end and this URL start
    count += start - lastIndex;
    // URLs count as TCO_LENGTH regardless of actual length
    count += TCO_LENGTH;
    lastIndex = start + match[0].length;
  }

  // Remaining text after last URL
  count += text.length - lastIndex;

  return count;
}

export default function TweetPreview({ text, className = '' }: TweetPreviewProps) {
  const segments = useMemo(() => parseSegments(text), [text]);
  const charCount = useMemo(() => weightedLength(text), [text]);

  const countColor =
    charCount > MAX_CHARS
      ? 'text-red-500 font-semibold'
      : charCount >= WARN_THRESHOLD
      ? 'text-yellow-500 font-medium'
      : 'text-slate-400 dark:text-slate-500';

  return (
    <div className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 ${className}`}>
      {/* Tweet text body */}
      <p className="font-sans text-[15px] leading-snug text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words min-h-[3rem]">
        {text.length === 0 ? (
          <span className="text-slate-300 dark:text-slate-600 italic">Tweet preview will appear here...</span>
        ) : (
          segments.map((seg, i) => {
            if (seg.type === 'url') {
              return (
                <span
                  key={i}
                  className="text-blue-500 hover:underline cursor-pointer"
                  title={seg.value}
                >
                  {seg.value}
                </span>
              );
            }
            if (seg.type === 'mention') {
              return (
                <span key={i} className="text-blue-500 font-medium">
                  {seg.value}
                </span>
              );
            }
            if (seg.type === 'hashtag') {
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

      {/* Character count */}
      <div className="mt-3 flex items-center justify-end border-t border-slate-100 dark:border-slate-700 pt-2">
        <span className={`text-xs tabular-nums ${countColor}`}>
          {charCount} / {MAX_CHARS}
        </span>
      </div>
    </div>
  );
}
