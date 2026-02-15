import { twitterOAuth } from '@/lib/twitter-oauth';
import { normalizeAccountSlot } from '@/lib/account-slots';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { xAccounts } from '@/lib/db/schema';
import { encryptAccountTokens } from '@/lib/x-account-crypto';

export const dynamic = 'force-dynamic';

type PendingOauthPayload = {
  oauthToken: string;
  oauthTokenSecret: string;
  createdAt?: number;
};

function decodePendingCookie(value: string): PendingOauthPayload | null {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as Partial<PendingOauthPayload>;
    if (typeof parsed.oauthToken === 'string' && typeof parsed.oauthTokenSecret === 'string') {
      return {
        oauthToken: parsed.oauthToken,
        oauthTokenSecret: parsed.oauthTokenSecret,
        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
      };
    }
  } catch {
    // Ignore malformed cookie.
  }
  return null;
}

export async function POST(req: NextRequest) {
  let slot = 1;
  let oauthVerifier = '';
  let oauthToken: string | null = null;

  try {
    const body = await req.json();
    slot = normalizeAccountSlot(body?.slot, 1);
    oauthVerifier = String(body?.oauthVerifier || body?.verifier || '').trim();
    oauthToken = body?.oauthToken ? String(body.oauthToken) : null;
  } catch {
    slot = 1;
  }

  if (!oauthVerifier) {
    return NextResponse.json({ error: 'Missing oauthVerifier.' }, { status: 400 });
  }

  const cookieStore = cookies();
  const pendingRaw = cookieStore.get(`twitter_oauth_pending_slot_${slot}`)?.value;
  const pending = pendingRaw ? decodePendingCookie(pendingRaw) : null;

  if (!pending) {
    return NextResponse.json(
      { error: 'Missing pending OAuth state for this slot. Start the connection flow again.' },
      { status: 400 },
    );
  }

  if (oauthToken && oauthToken !== pending.oauthToken) {
    return NextResponse.json(
      { error: 'OAuth token mismatch. Start the connection flow again.' },
      { status: 400 },
    );
  }

  try {
    const { oauth_token, oauth_token_secret, user_id, screen_name } = await twitterOAuth.getAccessToken(
      pending.oauthToken,
      pending.oauthTokenSecret,
      oauthVerifier,
    );

    let twitterDisplayName = screen_name;
    try {
      const twitterUser = await twitterOAuth.getUserProfile(oauth_token, oauth_token_secret);
      if (twitterUser?.name) {
        twitterDisplayName = twitterUser.name;
      }
    } catch (profileError) {
      // Some apps can exchange user tokens successfully but fail profile lookup due auth host quirks.
      // Persist the connection anyway so posting can proceed with the obtained OAuth1 user tokens.
      console.warn('Warning: failed to fetch user profile during auth completion; continuing with screen_name fallback.', profileError);
    }

    const encryptedTokens = encryptAccountTokens({
      twitterAccessToken: oauth_token,
      twitterAccessTokenSecret: oauth_token_secret,
    });

    await db
      .insert(xAccounts)
      .values({
        slot,
        twitterUserId: user_id,
        twitterUsername: screen_name,
        twitterDisplayName,
        twitterAccessToken: encryptedTokens.twitterAccessToken,
        twitterAccessTokenSecret: encryptedTokens.twitterAccessTokenSecret,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: xAccounts.slot,
        set: {
          twitterUserId: user_id,
          twitterUsername: screen_name,
          twitterDisplayName,
          twitterAccessToken: encryptedTokens.twitterAccessToken,
          twitterAccessTokenSecret: encryptedTokens.twitterAccessTokenSecret,
          updatedAt: new Date(),
        },
      });

    cookieStore.delete(`twitter_oauth_pending_slot_${slot}`);
    cookieStore.delete(`twitter_oauth_secret_slot_${slot}`);

    return NextResponse.json({
      ok: true,
      slot,
      username: screen_name,
    });
  } catch (error) {
    console.error('Error completing twitter auth:', error);
    const message = error instanceof Error ? error.message : 'Failed to complete Twitter authentication';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
