import { db } from '@/lib/db';
import { systemPrompts } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const prompts = await db.select().from(systemPrompts).orderBy(desc(systemPrompts.createdAt));
    return NextResponse.json(prompts);
  } catch (error) {
    console.error('Error fetching system prompts:', error);
    return NextResponse.json({ error: 'Failed to fetch system prompts' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, prompt, isDefault = false } = body;

    if (!name || !prompt) {
      return NextResponse.json({ error: 'Name and prompt are required' }, { status: 400 });
    }

    // If this is being set as default, remove default from others
    if (isDefault) {
      await db.update(systemPrompts).set({ isDefault: false });
    }

    const newPrompt = {
      name,
      prompt,
      isDefault,
    };

    const inserted = await db.insert(systemPrompts).values(newPrompt).returning();
    return NextResponse.json(inserted[0]);
  } catch (error) {
    console.error('Error creating system prompt:', error);
    return NextResponse.json({ error: 'Failed to create system prompt' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, action } = body;

    if (action === 'set-default') {
      // First, remove default from all prompts
      await db.update(systemPrompts).set({ isDefault: false });
      
      // Then set the selected prompt as default
      await db.update(systemPrompts).set({ isDefault: true }).where(eq(systemPrompts.id, id));
      
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error updating system prompt:', error);
    return NextResponse.json({ error: 'Failed to update system prompt' }, { status: 500 });
  }
}