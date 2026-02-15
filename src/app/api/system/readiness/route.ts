import { NextResponse } from 'next/server';
import { asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { xAccounts } from '@/lib/db/schema';
import { getResolvedXConfig } from '@/lib/x-config';
import { ACCOUNT_SLOTS } from '@/lib/account-slots';
import { canEncryptSecrets } from '@/lib/crypto-store';
import { getAdminToken, isAuthRequired } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await getResolvedXConfig();
    const envChecks = {
      xApiKey: Boolean(config.xApiKey),
      xApiSecret: Boolean(config.xApiSecret),
      xBearerToken: Boolean(config.xBearerToken),
      appUrl: Boolean(config.appBaseUrl),
    };

    const accountRows = await db.select().from(xAccounts).orderBy(asc(xAccounts.slot));
    const bySlot = new Map(accountRows.map((account) => [account.slot, account]));
    const slotStatus = ACCOUNT_SLOTS.map((slot) => {
      const account = bySlot.get(slot);
      const connected = Boolean(account?.twitterAccessToken && account?.twitterAccessTokenSecret);
      return {
        slot,
        connected,
        username: account?.twitterUsername || null,
      };
    });
    const connectedSlots = slotStatus.filter((slot) => slot.connected).map((slot) => slot.slot);
    const requiredConnectedSlots = Math.max(
      1,
      Math.min(ACCOUNT_SLOTS.length, Number(process.env.REQUIRED_X_CONNECTED_SLOTS || 1)),
    );
    const connectedEnough = connectedSlots.length >= requiredConnectedSlots;
    const authChecks = {
      connected: connectedSlots.length > 0,
      allConnected: connectedSlots.length === ACCOUNT_SLOTS.length,
      requiredConnectedSlots,
      connectedEnough,
      connectedSlots,
      slotStatus,
    };

    const schedulerChecks = {
      inAppEnabled: process.env.DISABLE_IN_APP_SCHEDULER !== 'true',
      intervalSeconds: Math.max(10, Number(process.env.SCHEDULER_INTERVAL_SECONDS || 60)),
    };

    const securityChecks = {
      authRequired: isAuthRequired(),
      hasAdminToken: Boolean(getAdminToken()),
      hasEncryptionKey: canEncryptSecrets(),
    };

    const runtimeChecks = {
      nodeVersion: process.versions.node,
      strictBoot: process.env.X_MANAGER_STRICT_BOOT === 'true',
    };

    const securityReady = securityChecks.authRequired ? securityChecks.hasAdminToken : true;

    const ready =
      envChecks.xApiKey &&
      envChecks.xApiSecret &&
      envChecks.xBearerToken &&
      authChecks.connectedEnough &&
      schedulerChecks.inAppEnabled &&
      securityReady &&
      securityChecks.hasEncryptionKey;

    return NextResponse.json({
      ready,
      checkedAt: new Date().toISOString(),
      env: envChecks,
      auth: authChecks,
      scheduler: schedulerChecks,
      security: securityChecks,
      runtime: runtimeChecks,
    });
  } catch (error) {
    console.error('Error checking readiness:', error);
    return NextResponse.json(
      { ready: false, error: 'Failed to evaluate system readiness.' },
      { status: 500 },
    );
  }
}
