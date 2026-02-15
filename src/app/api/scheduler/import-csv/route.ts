import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { parseCsvImportFlags, prepareCsvImport } from '@/lib/csv-import';
import { and, eq, inArray } from 'drizzle-orm';
import { canonicalizeUrl, computeDedupeKey, extractFirstUrl, normalizeCopy } from '@/lib/scheduler-dedupe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Missing file. Upload a CSV file.' }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: 'Only .csv files are supported.' }, { status: 400 });
    }

    const csvText = await file.text();
    const flags = parseCsvImportFlags({
      dryRun: formData.get('dry_run') as string | null,
      intervalMinutes: formData.get('interval_minutes') as string | null,
      startTime: formData.get('start_time') as string | null,
      reschedulePast: formData.get('reschedule_past') as string | null,
      accountSlot: formData.get('account_slot') as string | null,
    });

    const result = prepareCsvImport(csvText, {
      intervalMinutes: flags.intervalMinutes,
      startTime: flags.startTime,
      reschedulePast: flags.reschedulePast,
      accountSlot: flags.accountSlot,
    });

    if (result.errors.length > 0) {
      return NextResponse.json(
        {
          error: 'CSV validation failed.',
          totalRows: result.totalRows,
          validRows: result.posts.length,
          errors: result.errors,
          warnings: result.warnings,
          preview: result.posts.slice(0, 25).map((post) => ({
            lineNumber: post.lineNumber,
            accountSlot: post.accountSlot,
            text: post.text,
            scheduledTime: post.scheduledTime.toISOString(),
            communityId: post.communityId,
            replyToTweetId: post.replyToTweetId,
          })),
        },
        { status: 400 },
      );
    }

    if (flags.dryRun) {
      return NextResponse.json({
        dryRun: true,
        totalRows: result.totalRows,
        validRows: result.posts.length,
        errors: result.errors,
        warnings: result.warnings,
        preview: result.posts.slice(0, 100).map((post) => ({
          lineNumber: post.lineNumber,
          accountSlot: post.accountSlot,
          text: post.text,
          scheduledTime: post.scheduledTime.toISOString(),
          communityId: post.communityId,
          replyToTweetId: post.replyToTweetId,
        })),
      });
    }

    if (result.posts.length === 0) {
      return NextResponse.json({ error: 'No valid rows to import.' }, { status: 400 });
    }

    const values = result.posts.map((post) => ({
      accountSlot: post.accountSlot,
      text: post.text,
      sourceUrl: (() => {
        const extracted = extractFirstUrl(post.text);
        return extracted ? canonicalizeUrl(extracted) : null;
      })(),
      dedupeKey: (() => {
        const extracted = extractFirstUrl(post.text);
        if (!extracted) return null;
        const canonicalUrl = canonicalizeUrl(extracted);
        return computeDedupeKey({
          accountSlot: post.accountSlot,
          canonicalUrl,
          normalizedCopy: normalizeCopy(post.text),
        });
      })(),
      scheduledTime: post.scheduledTime,
      communityId: post.communityId,
      replyToTweetId: post.replyToTweetId,
      status: 'scheduled' as const,
    }));

    // Dedupe (URL+copy) against existing scheduled posts, per slot.
    const existingKeysBySlot = new Map<number, Set<string>>();
    const keysBySlot = new Map<number, string[]>();

    for (const value of values) {
      if (!value.dedupeKey) continue;
      const slot = value.accountSlot;
      const list = keysBySlot.get(slot) || [];
      list.push(value.dedupeKey);
      keysBySlot.set(slot, list);
    }

    for (const [slot, keys] of keysBySlot.entries()) {
      if (keys.length === 0) continue;
      const existing = await db
        .select({ dedupeKey: scheduledPosts.dedupeKey })
        .from(scheduledPosts)
        .where(and(eq(scheduledPosts.accountSlot, slot), eq(scheduledPosts.status, 'scheduled'), inArray(scheduledPosts.dedupeKey, keys)));
      existingKeysBySlot.set(
        slot,
        new Set(existing.map((row) => row.dedupeKey).filter((key): key is string => Boolean(key))),
      );
    }

    const seenBySlot = new Map<number, Set<string>>();
    const filtered = values.filter((value) => {
      if (!value.dedupeKey) return true;
      const slot = value.accountSlot;
      const existingKeys = existingKeysBySlot.get(slot);
      if (existingKeys?.has(value.dedupeKey)) return false;
      const seen = seenBySlot.get(slot) || new Set<string>();
      if (seen.has(value.dedupeKey)) return false;
      seen.add(value.dedupeKey);
      seenBySlot.set(slot, seen);
      return true;
    });

    const skipped = values.length - filtered.length;

    const inserted = filtered.length > 0
      ? await db.insert(scheduledPosts).values(filtered).returning()
      : [];

    return NextResponse.json({
      imported: inserted.length,
      totalRows: result.totalRows,
      warnings: result.warnings,
      skipped,
      insertedPreview: inserted.slice(0, 20),
    });
  } catch (error) {
    console.error('Error importing CSV posts:', error);
    return NextResponse.json({ error: 'Failed to import CSV posts.' }, { status: 500 });
  }
}
