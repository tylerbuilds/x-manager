import { twitterOAuth } from '@/lib/twitter-oauth';
import { getResolvedXConfig } from '@/lib/x-config';
import { ACCOUNT_SLOTS, isAccountSlot, normalizeAccountSlot, type AccountSlot } from '@/lib/account-slots';
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
    // Ignore malformed cookie and fall back to other recovery paths.
  }
  return null;
}

function parseSlotParam(value: string | null): AccountSlot | null {
  if (!value) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && isAccountSlot(parsed)) {
    return parsed;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const config = await getResolvedXConfig();
  const appBaseUrl = config.appBaseUrl;
  const searchParams = req.nextUrl.searchParams;
  const slotFromQuery = parseSlotParam(searchParams.get('slot'));
  const oauthToken = searchParams.get('oauth_token');
  const oauthVerifier = searchParams.get('oauth_verifier');

  if (!oauthToken || !oauthVerifier) {
    const slotForRedirect = slotFromQuery ?? 1;
    return NextResponse.redirect(`${appBaseUrl}/?error=twitter_auth_failed&reason=missing_params&slot=${slotForRedirect}`);
  }

  // Recover slot + secret from our pending cookie. This is required for slot=2 flows
  // when the OAuth provider doesn't preserve our callback query params.
  let slot: AccountSlot = slotFromQuery ?? 1;
  let oauthTokenSecret: string | null = null;

  const cookieStore = cookies();

  const tryPendingCookie = (candidateSlot: AccountSlot): PendingOauthPayload | null => {
    const raw = cookieStore.get(`twitter_oauth_pending_slot_${candidateSlot}`)?.value;
    if (!raw) return null;
    const payload = decodePendingCookie(raw);
    if (!payload) return null;
    if (payload.oauthToken !== oauthToken) return null;
    return payload;
  };

  let pending: PendingOauthPayload | null = null;

  if (slotFromQuery) {
    pending = tryPendingCookie(slotFromQuery);
  }

  if (!pending) {
    for (const candidateSlot of ACCOUNT_SLOTS) {
      pending = tryPendingCookie(candidateSlot);
      if (pending) {
        slot = candidateSlot;
        break;
      }
    }
  }

  if (pending) {
    slot = normalizeAccountSlot(slot, 1);
    oauthTokenSecret = pending.oauthTokenSecret;
  } else if (slotFromQuery) {
    // Backward compatible path: older flow stored secret per-slot.
    oauthTokenSecret = cookieStore.get(`twitter_oauth_secret_slot_${slotFromQuery}`)?.value ?? null;
    slot = slotFromQuery;
  }

  if (!oauthTokenSecret) {
    return NextResponse.redirect(`${appBaseUrl}/?error=twitter_auth_failed&reason=missing_params&slot=${slot}`);
  }

  try {
    const { oauth_token, oauth_token_secret, user_id, screen_name } = await twitterOAuth.getAccessToken(
      oauthToken,
      oauthTokenSecret,
      oauthVerifier
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
      console.warn('Warning: failed to fetch user profile in callback; continuing with screen_name fallback.', profileError);
    }

    const encryptedTokens = encryptAccountTokens({
      twitterAccessToken: oauth_token,
      twitterAccessTokenSecret: oauth_token_secret,
    });

    await db.insert(xAccounts).values({
      slot,
      twitterUserId: user_id,
      twitterUsername: screen_name,
      twitterDisplayName,
      twitterAccessToken: encryptedTokens.twitterAccessToken,
      twitterAccessTokenSecret: encryptedTokens.twitterAccessTokenSecret,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: xAccounts.slot,
      set: {
        twitterUserId: user_id,
        twitterUsername: screen_name,
        twitterDisplayName,
        twitterAccessToken: encryptedTokens.twitterAccessToken,
        twitterAccessTokenSecret: encryptedTokens.twitterAccessTokenSecret,
        updatedAt: new Date(),
      }
    });

    cookieStore.delete(`twitter_oauth_pending_slot_${slot}`);
    cookieStore.delete(`twitter_oauth_secret_slot_${slot}`);

    return NextResponse.redirect(`${appBaseUrl}/?twitter_connected=true&slot=${slot}`);

  } catch (error) {
    console.error('Error in twitter auth callback:', error);
    cookieStore.delete(`twitter_oauth_pending_slot_${slot}`);
    cookieStore.delete(`twitter_oauth_secret_slot_${slot}`);
    return NextResponse.redirect(`${appBaseUrl}/?error=twitter_auth_failed&reason=server_error&slot=${slot}`);
  }
} 
