import { describe, expect, it } from 'vitest';
import { cloudflareErrorMessage, mapCloudflareErrorCode } from './cloudflare';

describe('mapCloudflareErrorCode', () => {
  it('maps authentication statuses', () => {
    expect(mapCloudflareErrorCode(401)).toBe('AUTH_ERROR');
    expect(mapCloudflareErrorCode(403)).toBe('AUTH_ERROR');
  });

  it('maps 404 as not found', () => {
    expect(mapCloudflareErrorCode(404)).toBe('NOT_FOUND');
  });

  it('maps verification messages', () => {
    expect(mapCloudflareErrorCode(400, ['Please verify destination email'])).toBe('DESTINATION_UNVERIFIED');
  });

  it('maps undefined status as network error', () => {
    expect(mapCloudflareErrorCode()).toBe('NETWORK_ERROR');
  });
});

describe('cloudflareErrorMessage', () => {
  it('returns user readable messages', () => {
    expect(cloudflareErrorMessage('AUTH_ERROR')).toMatch(/authentication/i);
    expect(cloudflareErrorMessage('DESTINATION_UNVERIFIED')).toMatch(/verified/i);
  });
});
