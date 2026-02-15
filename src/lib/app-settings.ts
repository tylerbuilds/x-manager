import { asc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { appSettings } from './db/schema';
import { decryptValue, encryptValue, isEncryptedValue } from './crypto-store';

export const APP_SETTING_KEYS = [
  'x_api_key',
  'x_api_secret',
  'x_bearer_token',
  'x_api_base_url',
  'x_upload_api_base_url',
  'app_base_url',
] as const;

export type AppSettingKey = (typeof APP_SETTING_KEYS)[number];

export type AppSettingsMap = Partial<Record<AppSettingKey, string>>;

export const SECRET_SETTING_KEYS = new Set<AppSettingKey>([
  'x_api_key',
  'x_api_secret',
  'x_bearer_token',
]);

function normalizeValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isAppSettingKey(value: string): value is AppSettingKey {
  return (APP_SETTING_KEYS as readonly string[]).includes(value);
}

export async function getAppSettings(keys?: AppSettingKey[]): Promise<AppSettingsMap> {
  const rows = keys && keys.length > 0
    ? await db
        .select()
        .from(appSettings)
        .where(inArray(appSettings.settingKey, keys))
    : await db.select().from(appSettings).orderBy(asc(appSettings.settingKey));

  const result: AppSettingsMap = {};
  for (const row of rows) {
    if (isAppSettingKey(row.settingKey)) {
      let resolvedValue = row.settingValue;
      if (SECRET_SETTING_KEYS.has(row.settingKey)) {
        resolvedValue = decryptValue(row.settingValue);

        // Opportunistically migrate legacy plaintext values to encrypted storage.
        if (!isEncryptedValue(row.settingValue)) {
          const encrypted = encryptValue(row.settingValue);
          if (encrypted !== row.settingValue) {
            await db
              .update(appSettings)
              .set({
                settingValue: encrypted,
                updatedAt: new Date(),
              })
              .where(eq(appSettings.settingKey, row.settingKey));
          }
        }
      }
      result[row.settingKey] = resolvedValue;
    }
  }

  return result;
}

export async function upsertAppSettings(values: Partial<Record<AppSettingKey, string | null | undefined>>): Promise<void> {
  const entries = Object.entries(values) as Array<[AppSettingKey, string | null | undefined]>;

  for (const [key, rawValue] of entries) {
    const value = normalizeValue(rawValue);
    if (value === null) {
      await db.delete(appSettings).where(eq(appSettings.settingKey, key));
      continue;
    }

    const valueForStorage = SECRET_SETTING_KEYS.has(key) ? encryptValue(value) : value;

    await db
      .insert(appSettings)
      .values({
        settingKey: key,
        settingValue: valueForStorage,
      })
      .onConflictDoUpdate({
        target: appSettings.settingKey,
        set: {
          settingValue: valueForStorage,
          updatedAt: new Date(),
        },
      });
  }
}

export function summarizeSettingsForClient(settings: AppSettingsMap): {
  hasXApiKey: boolean;
  hasXApiSecret: boolean;
  hasXBearerToken: boolean;
  appBaseUrl: string;
  xApiBaseUrl: string;
  xUploadApiBaseUrl: string;
} {
  return {
    hasXApiKey: Boolean(settings.x_api_key),
    hasXApiSecret: Boolean(settings.x_api_secret),
    hasXBearerToken: Boolean(settings.x_bearer_token),
    appBaseUrl: settings.app_base_url || '',
    xApiBaseUrl: settings.x_api_base_url || '',
    xUploadApiBaseUrl: settings.x_upload_api_base_url || '',
  };
}
