/**
 * Pre-post URL liveness validation.
 *
 * Extracts URLs from tweet text, checks if any belong to configured
 * "must-validate" domains, and HEAD-requests them to confirm they resolve.
 * Prevents posting tweets with dead links (e.g. fabricated Ghost slugs).
 *
 * Configuration:
 *   TWEET_URL_VALIDATE_DOMAINS=swarmsignal.net,example.com
 *
 * If the env var is empty or unset, validation is skipped entirely.
 */

const URL_RE = /https?:\/\/[^\s)\]]+/g;
const VALIDATE_TIMEOUT_MS = 5_000;

function getValidateDomains(): Set<string> {
  const raw = (process.env.TWEET_URL_VALIDATE_DOMAINS || '').trim();
  if (!raw) return new Set();
  const result = new Set<string>();
  for (const d of raw.split(',')) {
    const normalized = d.trim().toLowerCase();
    if (normalized) result.add(normalized);
  }
  return result;
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

/**
 * Validate that URLs in tweet text pointing to configured domains
 * actually resolve (return HTTP 2xx/3xx after following redirects).
 *
 * Throws an error listing any broken URLs found.
 * Does nothing if TWEET_URL_VALIDATE_DOMAINS is not configured.
 */
export async function validateTweetUrls(text: string): Promise<void> {
  const domains = getValidateDomains();
  if (domains.size === 0) return;

  const allUrls = text.match(URL_RE) || [];
  const urlsToCheck: string[] = [];

  for (const raw of allUrls) {
    try {
      const parsed = new URL(raw);
      const matches = [...domains].some((d) => hostnameMatchesDomain(parsed.hostname, d));
      if (matches) urlsToCheck.push(raw);
    } catch {
      // Malformed URL in tweet text — not our concern here.
    }
  }

  if (urlsToCheck.length === 0) return;

  const broken: { url: string; status: number | string }[] = [];

  for (const url of urlsToCheck) {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
        headers: { 'User-Agent': 'x-manager/0.1 (+url-validator)' },
      });
      if (res.status >= 400) {
        broken.push({ url, status: res.status });
      }
    } catch (err) {
      // HEAD might not be supported; fall back to GET.
      try {
        const res = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
          headers: { 'User-Agent': 'x-manager/0.1 (+url-validator)' },
        });
        if (res.status >= 400) {
          broken.push({ url, status: res.status });
        }
      } catch (getErr) {
        broken.push({ url, status: getErr instanceof Error ? getErr.message : 'unreachable' });
      }
    }
  }

  if (broken.length > 0) {
    const details = broken.map((b) => `${b.url} (${b.status})`).join(', ');
    throw new Error(`Tweet contains broken URLs: ${details}`);
  }
}
