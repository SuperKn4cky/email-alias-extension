import { describe, expect, it } from 'vitest';
import { hasRequiredSettings, isValidDomain, isValidEmail, normalizeDomain, sanitizeSettings, validateSettings } from './validation';

describe('normalizeDomain', () => {
  it('normalizes domain values', () => {
    expect(normalizeDomain('  @Example.COM. ')).toBe('example.com');
  });
});

describe('domain and email validation', () => {
  it('validates domain format', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain('nope')).toBe(false);
  });

  it('validates email format', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('user@@example')).toBe(false);
  });
});

describe('settings validation', () => {
  const validSettings = {
    domain: 'example.com',
    destinationEmail: 'user@example.net',
    accountId: 'acc123',
    zoneId: 'zone123',
    apiToken: 'token123'
  };

  it('sanitizes settings', () => {
    expect(
      sanitizeSettings({
        ...validSettings,
        domain: '  EXAMPLE.COM  ',
        destinationEmail: '  USER@EXAMPLE.NET '
      })
    ).toEqual(validSettings);
  });

  it('returns no errors when settings are valid', () => {
    expect(validateSettings(validSettings)).toHaveLength(0);
    expect(hasRequiredSettings(validSettings)).toBe(true);
  });

  it('returns errors when settings are incomplete', () => {
    expect(validateSettings({ ...validSettings, apiToken: '' }).length).toBeGreaterThan(0);
    expect(hasRequiredSettings({ ...validSettings, apiToken: '' })).toBe(false);
  });
});
