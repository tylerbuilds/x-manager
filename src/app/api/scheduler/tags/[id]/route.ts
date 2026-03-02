import { db } from '@/lib/db';
import { communityTags } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const tagId = parseInt(id, 10);
    await db.delete(communityTags).where(eq(communityTags.id, tagId));
    return NextResponse.json({ message: 'Tag deleted' });
  } catch (error) {
    console.error(`Error deleting tag ${id}:`, error);
    return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
  }
} 