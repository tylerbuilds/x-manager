import crypto from 'crypto';

const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
  'igshid',
  'mc_cid',
  'mc_eid',
]);

function stripTrailingPunctuation(value: string): string {
  let out = value.trim();
  while (out.length > 0 && /[)\].,!?;:"'}]/.test(out[out.length - 1] || '')) {
    out = out.slice(0, -1);
  }
  return out;
}

export function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/\S+/i);
  if (!match) return null;
  const candidate = stripTrailingPunctuation(match[0]);
  return candidate.length > 0 ? candidate : null;
}

export function canonicalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';

    // Normalize host + protocol casing.
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    // Remove tracking params and sort remaining params.
    const kept = [...parsed.searchParams.entries()].filter(([key]) => !TRACKING_QUERY_PARAMS.has(key));
    kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    parsed.search = '';
    for (const [key, value] of kept) {
      parsed.searchParams.append(key, value);
    }

    // Trim trailing slash (except for root).
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function normalizeCopy(text: string): string {
  return (text || '')
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeDedupeKey(params: {
  accountSlot: number;
  canonicalUrl: string;
  normalizedCopy: string;
}): string {
  const payload = `v1|slot=${params.accountSlot}|url=${params.canonicalUrl}|copy=${params.normalizedCopy}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

