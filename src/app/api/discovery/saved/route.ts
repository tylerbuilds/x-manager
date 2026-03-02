import { desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { savedSearches } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeSearch(search: typeof savedSearches.$inferSelect) {
  return {
    ...search,
    keywords: JSON.parse(search.keywords),
  };
}

export async function GET() {
  try {
    const rows = await db.select().from(savedSearches).orderBy(desc(savedSearches.createdAt));
    return NextResponse.json({ searches: rows.map(serializeSearch) });
  } catch (error) {
    console.error('Failed to list saved searches:', error);
    return NextResponse.json({ error: 'Failed to list saved searches.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const keywords = Array.isArray(body.keywords) ? body.keywords.map((value) => String(value).trim()).filter(Boolean) : [];
    const accountSlot = Number(body.account_slot ?? 1);
    if (keywords.length === 0) {
      return NextResponse.json({ error: 'keywords array is required.' }, { status: 400 });
    }
    if (accountSlot !== 1 && accountSlot !== 2) {
      return NextResponse.json({ error: 'account_slot must be 1 or 2.' }, { status: 400 });
    }

    const inserted = await db.insert(savedSearches).values({
      keywords: JSON.stringify(keywords),
      accountSlot,
      checkIntervalMinutes: Math.max(5, Number(body.check_interval_minutes ?? 15)),
      autoAction: body.auto_action === 'like' || body.auto_action === 'reply' ? body.auto_action : null,
      replyTemplate: typeof body.reply_template === 'string' ? body.reply_template : null,
      notify: body.notify === false ? false : true,
      language: typeof body.language === 'string' ? body.language.trim() || 'en' : 'en',
      status: body.status === 'paused' ? 'paused' : 'active',
    }).returning();

    return NextResponse.json({ ok: true, search: serializeSearch(inserted[0]) }, { status: 201 });
  } catch (error) {
    console.error('Failed to create saved search:', error);
    return NextResponse.json({ error: 'Failed to create saved search.' }, { status: 500 });
  }
}
