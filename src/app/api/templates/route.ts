import { desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { postTemplates } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.select().from(postTemplates).orderBy(desc(postTemplates.createdAt));
    return NextResponse.json({ templates: rows });
  } catch (error) {
    console.error('Failed to list templates:', error);
    return NextResponse.json({ error: 'Failed to list templates.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name?: unknown;
      category?: unknown;
      template?: unknown;
    };

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const template = typeof body.template === 'string' ? body.template.trim() : '';

    if (!name || !template) {
      return NextResponse.json({ error: 'name and template are required.' }, { status: 400 });
    }

    const result = await db.insert(postTemplates).values({
      name,
      category: typeof body.category === 'string' ? body.category.trim() : null,
      template,
    }).returning();

    return NextResponse.json({ ok: true, template: result[0] }, { status: 201 });
  } catch (error) {
    console.error('Failed to create template:', error);
    return NextResponse.json({ error: 'Failed to create template.' }, { status: 500 });
  }
}
