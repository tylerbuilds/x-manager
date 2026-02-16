/**
 * Shared network-safety utilities for SSRF protection.
 * Used by webhook delivery, bridge media fetches, and thread creation.
 */

/**
 * Returns true if the hostname resolves to a private/internal network address.
 * Blocks requests to localhost, link-local, and RFC 1918 ranges.
 */
export function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '::1' || lower.endsWith('.local')) return true;
  if (/^127\./.test(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower)) return true;
  if (/^169\.254\./.test(lower)) return true;
  if (lower === '0.0.0.0' || lower === '[::]') return true;
  return false;
}

/**
 * Validates that a URL does not point to a private/internal network.
 * Throws if the URL targets a private hostname.
 */
export function assertPublicUrl(url: string): void {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`URL protocol must be http or https, got: ${parsed.protocol}`);
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`URL targets a private/internal network address: ${parsed.hostname}`);
  }
}
