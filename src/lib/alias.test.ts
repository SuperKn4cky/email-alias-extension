import { describe, expect, it } from 'vitest';
import { buildAliasEmail, extractSiteHost, generateAliasLocalPart, generateRandomSuffix, hostToSiteSlug } from './alias';

describe('extractSiteHost', () => {
  it('returns hostname for valid URLs', () => {
    expect(extractSiteHost('https://www.amazon.com/account')).toBe('www.amazon.com');
  });

  it('returns manual for invalid or non-http URLs', () => {
    expect(extractSiteHost('chrome://extensions')).toBe('manual');
    expect(extractSiteHost('not-a-url')).toBe('manual');
  });
});

describe('hostToSiteSlug', () => {
  it('extracts site slug from standard hostnames', () => {
    expect(hostToSiteSlug('www.amazon.com')).toBe('amazon');
    expect(hostToSiteSlug('m.github.com')).toBe('github');
  });

  it('returns manual on edge cases', () => {
    expect(hostToSiteSlug('manual')).toBe('manual');
    expect(hostToSiteSlug('')).toBe('manual');
  });
});

describe('alias generation', () => {
  it('generates deterministic local part with custom RNG', () => {
    let idx = 0;
    const values = [0, 1, 2, 3, 4, 5];
    const local = generateAliasLocalPart('amazon', () => values[idx++] ?? 0);
    expect(local).toBe('amazon-abcdef');
  });

  it('generates random suffix with expected length', () => {
    const suffix = generateRandomSuffix(8, () => 0);
    expect(suffix).toBe('aaaaaaaa');
  });

  it('builds full alias email', () => {
    expect(buildAliasEmail('amazon-abc123', 'Example.COM')).toBe('amazon-abc123@example.com');
  });
});
