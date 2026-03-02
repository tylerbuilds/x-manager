import { and, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { feedEntries, feeds } from './db/schema';
import { emitEvent } from './events';
import { assertPublicUrl } from './network-safety';
import { createScheduledPost } from './post-scheduler';
import { renderTemplate } from './template-utils';

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type ParsedFeedEntry = {
  id: string;
  url: string;
  title: string;
  summary: string;
  publishedAt: Date | null;
};

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return decodeXml(match?.[1]?.trim() ?? '');
}

function extractAtomLink(block: string): string {
  const attrMatch = block.match(/<link[^>]*href=['"]([^'"]+)['"][^>]*\/?>/i);
  return decodeXml(attrMatch?.[1]?.trim() ?? '');
}

function parsePublishedAt(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseFeed(xml: string): ParsedFeedEntry[] {
  const rssBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const atomBlocks = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  const blocks = rssBlocks.length > 0 ? rssBlocks : atomBlocks;

  return blocks
    .map((block) => ({
      id: extractTag(block, 'guid') || extractTag(block, 'id') || extractTag(block, 'link') || extractAtomLink(block),
      url: extractTag(block, 'link') || extractAtomLink(block),
      title: extractTag(block, 'title') || extractTag(block, 'link') || extractAtomLink(block),
      summary: extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content'),
      publishedAt: parsePublishedAt(extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated')),
    }))
    .filter((entry) => entry.url && entry.title);
}

function shouldCheckFeed(lastCheckedAt: Date | null, intervalMinutes: number): boolean {
  if (!lastCheckedAt) return true;
  return lastCheckedAt.getTime() + intervalMinutes * 60_000 <= Date.now();
}

function defaultFeedTemplate(): string {
  return '{title} {url}';
}

export async function runFeedProcessor(logger: Logger): Promise<void> {
  const activeFeeds = await db
    .select()
    .from(feeds)
    .where(and(eq(feeds.status, 'active')))
    .orderBy(asc(feeds.id));

  for (const feed of activeFeeds) {
    if (!shouldCheckFeed(feed.lastCheckedAt, feed.checkIntervalMinutes)) {
      continue;
    }

    try {
      assertPublicUrl(feed.url);
      const response = await fetch(feed.url, {
        cache: 'no-store',
        headers: { 'User-Agent': 'x-manager/0.1 feed-processor' },
      });

      if (!response.ok) {
        throw new Error(`Feed fetch failed with status ${response.status}.`);
      }

      const xml = await response.text();
      const entries = parseFeed(xml);
      let newestEntryId = feed.lastEntryId;

      for (const entry of entries) {
        const inserted = await db.insert(feedEntries).values({
          feedId: feed.id,
          entryUrl: entry.url,
          entryTitle: entry.title,
          entrySummary: entry.summary || null,
          publishedAt: entry.publishedAt,
          processedAt: new Date(),
        }).onConflictDoNothing().returning();

        if (!inserted[0]) {
          continue;
        }

        newestEntryId = entry.id || newestEntryId;

        emitEvent({
          eventType: 'feed.new_entry',
          entityType: 'feed',
          entityId: feed.id,
          accountSlot: feed.accountSlot,
          payload: {
            feedId: feed.id,
            title: entry.title,
            url: entry.url,
            summary: entry.summary,
          },
        });

        if (feed.autoSchedule) {
          const text = renderTemplate(feed.template || defaultFeedTemplate(), {
            title: entry.title,
            url: entry.url,
            summary: entry.summary,
          }).trim();

          if (text) {
            const scheduled = await createScheduledPost({
              accountSlot: feed.accountSlot as 1 | 2,
              text,
              scheduledTime: new Date(Date.now() + 5 * 60_000),
              sourceUrl: entry.url,
            });

            await db
              .update(feedEntries)
              .set({
                scheduledPostId: scheduled.post.id,
                processedAt: new Date(),
              })
              .where(eq(feedEntries.id, inserted[0].id));
          }
        }
      }

      await db
        .update(feeds)
        .set({
          title: feed.title || extractTag(xml, 'title') || feed.title,
          lastCheckedAt: new Date(),
          lastEntryId: newestEntryId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(feeds.id, feed.id));
    } catch (error) {
      logger.error(`Feed processor failed for feed ${feed.id}:`, error);
      await db.update(feeds).set({ lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(feeds.id, feed.id));
    }
  }
}
