import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { inboxTags } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET - list tags for an inbox item
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const inboxId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(inboxId) || inboxId <= 0) {
    return NextResponse.json({ error: 'Invalid inbox id.' }, { status: 400 });
  }

  const rows = await db.select().from(inboxTags).where(eq(inboxTags.inboxId, inboxId));
  return NextResponse.json({ tags: rows });
}

// POST - add a tag
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const inboxId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(inboxId) || inboxId <= 0) {
    return NextResponse.json({ error: 'Invalid inbox id.' }, { status: 400 });
  }

  const body = (await req.json()) as { tag?: unknown };
  const tag = typeof body.tag === 'string' ? body.tag.trim() : '';
  if (!tag) {
    return NextResponse.json({ error: 'tag is required.' }, { status: 400 });
  }

  const result = await db.insert(inboxTags).values({ inboxId, tag }).returning();
  return NextResponse.json({ ok: true, tag: result[0] }, { status: 201 });
}

// DELETE - remove a tag by tag text (all matching)
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const inboxId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(inboxId) || inboxId <= 0) {
    return NextResponse.json({ error: 'Invalid inbox id.' }, { status: 400 });
  }

  const url = new URL(req.url);
  const tag = url.searchParams.get('tag');
  if (!tag) {
    return NextResponse.json({ error: 'tag query param is required.' }, { status: 400 });
  }

  const { and } = await import('drizzle-orm');
  await db.delete(inboxTags).where(and(eq(inboxTags.inboxId, inboxId), eq(inboxTags.tag, tag)));
  return NextResponse.json({ ok: true });
}
