import { db } from '@/lib/db';
import { systemPrompts } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { name, prompt, isDefault = false } = body;
    const id = parseInt(params.id);

    if (!name || !prompt) {
      return NextResponse.json({ error: 'Name and prompt are required' }, { status: 400 });
    }

    // If this is being set as default, remove default from others
    if (isDefault) {
      await db.update(systemPrompts).set({ isDefault: false });
    }

    const updatedPrompt = await db.update(systemPrompts)
      .set({ 
        name, 
        prompt, 
        isDefault,
        updatedAt: new Date()
      })
      .where(eq(systemPrompts.id, id))
      .returning();

    if (updatedPrompt.length === 0) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    return NextResponse.json(updatedPrompt[0]);
  } catch (error) {
    console.error('Error updating system prompt:', error);
    return NextResponse.json({ error: 'Failed to update system prompt' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id);

    const deletedPrompt = await db.delete(systemPrompts)
      .where(eq(systemPrompts.id, id))
      .returning();

    if (deletedPrompt.length === 0) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting system prompt:', error);
    return NextResponse.json({ error: 'Failed to delete system prompt' }, { status: 500 });
  }
} 