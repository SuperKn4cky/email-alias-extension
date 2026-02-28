import { normalizeDomain } from './validation';

const COMMON_SUBDOMAINS = new Set(['www', 'm', 'mobile', 'app']);

export function extractSiteHost(tabUrl?: string): string {
  if (!tabUrl) {
    return 'manual';
  }

  try {
    const parsed = new URL(tabUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'manual';
    }

    return parsed.hostname.toLowerCase();
  } catch {
    return 'manual';
  }
}

export function hostToSiteSlug(hostname: string): string {
  if (hostname === 'manual') {
    return 'manual';
  }

  const pieces = hostname.toLowerCase().split('.').filter(Boolean);
  if (pieces.length === 0) {
    return 'manual';
  }

  const filtered = pieces.filter((part, index) => {
    if (index === pieces.length - 1 || index === pieces.length - 2) {
      return true;
    }

    return !COMMON_SUBDOMAINS.has(part);
  });

  const base = filtered.length >= 2 ? filtered[filtered.length - 2] : filtered[0];
  const slug = base.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return slug || 'manual';
}

function secureRandomInt(maxExclusive: number): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % maxExclusive;
}

export function generateRandomSuffix(
  length = 6,
  randomInt: (maxExclusive: number) => number = secureRandomInt
): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';

  for (let index = 0; index < length; index += 1) {
    value += alphabet[randomInt(alphabet.length)];
  }

  return value;
}

export function generateAliasLocalPart(siteSlug: string, randomInt?: (maxExclusive: number) => number): string {
  const normalizedSlug = siteSlug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'manual';
  return `${normalizedSlug}-${generateRandomSuffix(6, randomInt)}`;
}

export function buildAliasEmail(localPart: string, domain: string): string {
  const normalizedDomain = normalizeDomain(domain);
  return `${localPart}@${normalizedDomain}`;
}
