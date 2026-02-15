import { eq, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { inboxNotes } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET - list notes for an inbox item
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const inboxId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(inboxId) || inboxId <= 0) {
    return NextResponse.json({ error: 'Invalid inbox id.' }, { status: 400 });
  }

  const rows = await db.select().from(inboxNotes).where(eq(inboxNotes.inboxId, inboxId)).orderBy(desc(inboxNotes.createdAt));
  return NextResponse.json({ notes: rows });
}

// POST - add a note
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const inboxId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(inboxId) || inboxId <= 0) {
    return NextResponse.json({ error: 'Invalid inbox id.' }, { status: 400 });
  }

  const body = (await req.json()) as { note?: unknown; author?: unknown };
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note) {
    return NextResponse.json({ error: 'note is required.' }, { status: 400 });
  }

  const author = typeof body.author === 'string' ? body.author.trim() : 'operator';
  const result = await db.insert(inboxNotes).values({ inboxId, author, note }).returning();
  return NextResponse.json({ ok: true, note: result[0] }, { status: 201 });
}
