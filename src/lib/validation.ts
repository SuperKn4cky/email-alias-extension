import type { ExtensionSettings } from './types';

const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, '');
}

export function isValidDomain(value: string): boolean {
  const normalized = normalizeDomain(value);
  return DOMAIN_REGEX.test(normalized);
}

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim());
}

export function sanitizeSettings(settings: ExtensionSettings): ExtensionSettings {
  return {
    domain: normalizeDomain(settings.domain),
    destinationEmail: settings.destinationEmail.trim().toLowerCase(),
    accountId: settings.accountId.trim(),
    zoneId: settings.zoneId.trim(),
    apiToken: settings.apiToken.trim()
  };
}

export function validateSettings(settings: ExtensionSettings): string[] {
  const sanitized = sanitizeSettings(settings);
  const errors: string[] = [];

  if (!isValidDomain(sanitized.domain)) {
    errors.push('Domain must be a valid hostname like example.com.');
  }

  if (!isValidEmail(sanitized.destinationEmail)) {
    errors.push('Forward destination email is invalid.');
  }

  if (!sanitized.accountId) {
    errors.push('Cloudflare account ID is required.');
  }

  if (!sanitized.zoneId) {
    errors.push('Cloudflare zone ID is required.');
  }

  if (!sanitized.apiToken) {
    errors.push('Cloudflare API token is required.');
  }

  return errors;
}

export function hasRequiredSettings(settings: ExtensionSettings): boolean {
  return validateSettings(settings).length === 0;
}
