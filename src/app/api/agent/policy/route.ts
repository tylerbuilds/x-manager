import { NextResponse } from 'next/server';
import { getSlotPolicy, saveSlotPolicy, checkPolicy } from '@/lib/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slot = Number(url.searchParams.get('slot') || 1);
    if (slot !== 1 && slot !== 2) {
      return NextResponse.json({ error: 'slot must be 1 or 2.' }, { status: 400 });
    }

    const policy = await getSlotPolicy(slot as 1 | 2);
    return NextResponse.json({ policy, slot });
  } catch (error) {
    console.error('Failed to get policy:', error);
    return NextResponse.json({ error: 'Failed to get policy.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { slot?: unknown; [key: string]: unknown };
    const slot = Number(body.slot || 1);
    if (slot !== 1 && slot !== 2) {
      return NextResponse.json({ error: 'slot must be 1 or 2.' }, { status: 400 });
    }

    const { slot: _slot, ...policyUpdates } = body;
    await saveSlotPolicy(slot as 1 | 2, policyUpdates as Record<string, unknown>);

    const updated = await getSlotPolicy(slot as 1 | 2);
    return NextResponse.json({ ok: true, policy: updated, slot });
  } catch (error) {
    console.error('Failed to update policy:', error);
    return NextResponse.json({ error: 'Failed to update policy.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      slot?: unknown;
      action_type?: unknown;
      scheduled_time?: unknown;
    };

    const slot = Number(body.slot || 1);
    if (slot !== 1 && slot !== 2) {
      return NextResponse.json({ error: 'slot must be 1 or 2.' }, { status: 400 });
    }

    const actionType = String(body.action_type || '');
    if (!['post', 'reply', 'dm', 'like', 'repost'].includes(actionType)) {
      return NextResponse.json({ error: 'action_type must be post, reply, dm, like, or repost.' }, { status: 400 });
    }

    const scheduledTime = typeof body.scheduled_time === 'string' ? new Date(body.scheduled_time) : undefined;

    const result = await checkPolicy({
      slot: slot as 1 | 2,
      actionType: actionType as 'post' | 'reply' | 'dm' | 'like' | 'repost',
      scheduledTime,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to check policy:', error);
    return NextResponse.json({ error: 'Failed to check policy.' }, { status: 500 });
  }
}
