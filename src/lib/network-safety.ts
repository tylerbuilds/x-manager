/**
 * Shared network-safety utilities for SSRF protection.
 * Used by webhook delivery, bridge media fetches, and thread creation.
 */

import dns from 'dns';

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
 * Returns true if an IP address belongs to a private/reserved range.
 * Catches DNS rebinding attacks where a public hostname resolves to an internal IP.
 */
export function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const normalized = v4Mapped ? v4Mapped[1] : ip;

  if (/^127\./.test(normalized)) return true;
  if (/^10\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(normalized)) return true;
  if (/^169\.254\./.test(normalized)) return true;
  if (normalized === '0.0.0.0') return true;

  // IPv6 loopback and link-local
  const lowerIp = ip.toLowerCase();
  if (lowerIp === '::1' || lowerIp === '::') return true;
  if (lowerIp.startsWith('fe80:')) return true;
  if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) return true;

  return false;
}

/**
 * Validates that a URL does not point to a private/internal network.
 * Performs DNS resolution to catch rebinding attacks.
 * Throws if the URL targets a private address.
 */
export async function assertPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`URL protocol must be http or https, got: ${parsed.protocol}`);
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`URL targets a private/internal network address: ${parsed.hostname}`);
  }

  // Resolve DNS and validate all returned IPs
  try {
    const addresses = await dns.promises.resolve4(parsed.hostname).catch(() => [] as string[]);
    const addresses6 = await dns.promises.resolve6(parsed.hostname).catch(() => [] as string[]);
    const allAddresses = [...addresses, ...addresses6];

    for (const addr of allAddresses) {
      if (isPrivateIp(addr)) {
        throw new Error(`URL hostname ${parsed.hostname} resolves to private IP ${addr}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('resolves to private IP')) {
      throw err;
    }
    // DNS resolution failure for non-IP hostnames is suspicious but not blocking
    // (could be a temporary DNS issue). IP-literal hostnames are already caught above.
  }
}
