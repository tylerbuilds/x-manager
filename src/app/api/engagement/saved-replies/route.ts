import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { savedReplies } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const replies = await db
      .select()
      .from(savedReplies)
      .orderBy(desc(savedReplies.useCount));
    return NextResponse.json({ items: replies });
  } catch (error) {
    console.error('Failed to list saved replies:', error);
    return NextResponse.json({ error: 'Failed to list saved replies.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, category, text, shortcut } = body;

    if (!name?.trim() || !text?.trim()) {
      return NextResponse.json({ error: 'Name and text are required.' }, { status: 400 });
    }

    const inserted = await db.insert(savedReplies).values({
      name: name.trim(),
      category: category?.trim() || null,
      text: text.trim(),
      shortcut: shortcut?.trim() || null,
    }).returning();

    return NextResponse.json({ reply: inserted[0] });
  } catch (error) {
    console.error('Failed to create saved reply:', error);
    return NextResponse.json({ error: 'Failed to create saved reply.' }, { status: 500 });
  }
}
