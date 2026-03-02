'use client';

import React from 'react';

// ---------------------------------------------------------------------------
// Base Skeleton
// ---------------------------------------------------------------------------

interface SkeletonProps {
  className?: string;
}

/**
 * Base animated pulse rectangle. Pass `className` to control size and shape.
 */
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={[
        'animate-pulse rounded-md bg-slate-200 dark:bg-slate-700',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  );
}

// ---------------------------------------------------------------------------
// SkeletonText
// ---------------------------------------------------------------------------

interface SkeletonTextProps {
  lines?: number;
}

/**
 * Multiple text-line skeletons with staggered widths to mimic real paragraph
 * text. `lines` defaults to 3.
 */
export function SkeletonText({ lines = 3 }: SkeletonTextProps) {
  // Cycle through widths so lines look organic
  const widths = ['w-full', 'w-5/6', 'w-4/6', 'w-3/4', 'w-full', 'w-2/3'];

  return (
    <div className="space-y-2">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={['h-3', widths[i % widths.length]].join(' ')}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonCard
// ---------------------------------------------------------------------------

/**
 * Card-shaped skeleton that mirrors the `.dashboard-card` pattern used
 * throughout the app (rounded-xl, border, p-4).
 */
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
      {/* Header row: avatar + title */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>

      {/* Body text */}
      <SkeletonText lines={3} />

      {/* Footer row: two small chips */}
      <div className="flex items-center gap-2 pt-1">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonPostList
// ---------------------------------------------------------------------------

interface SkeletonPostListProps {
  count?: number;
}

/**
 * A list of post-shaped skeletons, e.g. for tweet / scheduled-post lists.
 * `count` defaults to 5.
 */
export function SkeletonPostList({ count = 5 }: SkeletonPostListProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3"
        >
          {/* Avatar */}
          <Skeleton className="h-9 w-9 rounded-full shrink-0 mt-0.5" />

          <div className="flex-1 min-w-0 space-y-2">
            {/* Name + handle row */}
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>

            {/* Tweet body — vary line count slightly */}
            <SkeletonText lines={i % 3 === 2 ? 3 : 2} />

            {/* Meta row: timestamp + action icons */}
            <div className="flex items-center gap-3 pt-0.5">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-8" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonMetricCards
// ---------------------------------------------------------------------------

interface SkeletonMetricCardsProps {
  count?: number;
}

/**
 * A responsive grid of metric-card skeletons, e.g. for the analytics header
 * row. `count` defaults to 4.
 */
export function SkeletonMetricCards({ count = 4 }: SkeletonMetricCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3"
        >
          {/* Icon + label row */}
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-7 w-7 rounded-lg" />
          </div>

          {/* Big number */}
          <Skeleton className="h-7 w-16" />

          {/* Trend badge */}
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}
