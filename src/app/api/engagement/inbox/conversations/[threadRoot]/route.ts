import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { threadRoot: string } },
) {
  try {
    const { threadRoot } = params;

    if (!threadRoot) {
      return NextResponse.json({ error: 'Thread root ID required.' }, { status: 400 });
    }

    // Find all messages in this thread: the root message and any that reply to it
    // Also include any messages that share the same conversation_id
    const messages = sqlite.prepare(`
      SELECT * FROM engagement_inbox
      WHERE source_id = ?
         OR in_reply_to_tweet_id = ?
         OR (conversation_id IS NOT NULL AND conversation_id = ?)
      ORDER BY received_at ASC
    `).all(threadRoot, threadRoot, threadRoot) as Array<{
      id: number;
      account_slot: number;
      source_type: string;
      source_id: string;
      conversation_id: string | null;
      author_user_id: string | null;
      author_username: string | null;
      text: string;
      raw_payload: string;
      in_reply_to_tweet_id: string | null;
      received_at: number;
      status: string;
    }>;

    return NextResponse.json({
      threadRoot,
      messages: messages.map((msg) => ({
        ...msg,
        rawPayload: (() => {
          try { return JSON.parse(msg.raw_payload); } catch { return msg.raw_payload; }
        })(),
      })),
    });
  } catch (error) {
    console.error('Conversation fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch conversation.' }, { status: 500 });
  }
}
