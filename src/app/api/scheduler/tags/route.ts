import { db } from '@/lib/db';
import { communityTags } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const tags = await db.select().from(communityTags).orderBy(desc(communityTags.createdAt));
    return NextResponse.json(tags);
  } catch (error) {
    console.error('Error fetching community tags:', error);
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tag_name, community_id, community_name } = body;

    if (!tag_name || !community_id) {
      return NextResponse.json({ error: 'Tag name and community ID are required' }, { status: 400 });
    }

    const newTag = {
      tagName: tag_name,
      communityId: community_id,
      communityName: community_name,
    };

    const inserted = await db.insert(communityTags).values(newTag).returning();

    return NextResponse.json(inserted[0]);
  } catch (error) {
    console.error('Error creating community tag:', error);
    return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
  }
} 