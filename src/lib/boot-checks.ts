import { canEncryptSecrets } from './crypto-store';
import { getAdminToken, isAuthRequired } from './api-auth';

type BootCheckResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
};

function parseNodeMajor(): number {
  const major = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
  return Number.isFinite(major) ? major : 0;
}

export function runBootChecks(): BootCheckResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const nodeMajor = parseNodeMajor();
  if (nodeMajor < 20 || nodeMajor > 25) {
    warnings.push(`Node ${process.versions.node} is outside the recommended range (20-25).`);
  }

  if (isAuthRequired() && !getAdminToken()) {
    errors.push('X_MANAGER_REQUIRE_AUTH is enabled but X_MANAGER_ADMIN_TOKEN is missing.');
  }

  if (!canEncryptSecrets()) {
    errors.push('Secret encryption is unavailable. Set X_MANAGER_ENCRYPTION_KEY (or X_MANAGER_ADMIN_TOKEN).');
  }

  const strictBoot = process.env.X_MANAGER_STRICT_BOOT === 'true';
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !isAuthRequired()) {
    warnings.push('Production mode is running with API auth disabled. Consider setting X_MANAGER_REQUIRE_AUTH=true.');
  }

  if ((strictBoot || isProduction) && errors.length > 0) {
    throw new Error(`Boot checks failed: ${errors.join(' ')}`);
  }

  for (const warning of warnings) {
    console.warn('[boot-check]', warning);
  }
  for (const error of errors) {
    console.error('[boot-check]', error);
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
  };
}
