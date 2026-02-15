import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { postTemplates } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const templateId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return NextResponse.json({ error: 'Invalid template id.' }, { status: 400 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.name === 'string') updates.name = body.name.trim();
    if (typeof body.template === 'string') updates.template = body.template.trim();
    if (body.category !== undefined) updates.category = typeof body.category === 'string' ? body.category.trim() : null;

    const updated = await db.update(postTemplates).set(updates).where(eq(postTemplates.id, templateId)).returning();
    if (updated.length === 0) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, template: updated[0] });
  } catch (error) {
    console.error('Failed to update template:', error);
    return NextResponse.json({ error: 'Failed to update template.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const templateId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return NextResponse.json({ error: 'Invalid template id.' }, { status: 400 });
  }

  const deleted = await db.delete(postTemplates).where(eq(postTemplates.id, templateId)).returning();
  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
