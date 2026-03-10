import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cloudflareErrorMessage,
  createOrEnsureAliasRouting,
  listAliasRecordsForDestination,
  mapCloudflareErrorCode
} from './cloudflare';

const settings = {
  domain: 'singesupreme.fr',
  destinationEmail: 'warmax7794@gmail.com',
  accountId: 'account-123',
  zoneId: 'zone-123',
  apiToken: 'token-123'
};

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('listAliasRecordsForDestination', () => {
  it('imports aliases for the selected destination across paginated Cloudflare rules', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/email/routing/rules?page=1&per_page=100')) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [
              {
                enabled: true,
                matchers: [{ field: 'to', type: 'literal', value: 'president-des@singesupreme.fr' }],
                actions: [{ type: 'forward', value: ['warmax7794@gmail.com'] }]
              },
              {
                enabled: true,
                matchers: [{ field: 'to', type: 'literal', value: 'ignored@singesupreme.fr' }],
                actions: [{ type: 'forward', value: ['someone-else@gmail.com'] }]
              }
            ],
            result_info: {
              page: 1,
              per_page: 100,
              total_pages: 2
            }
          }),
          { status: 200 }
        );
      }

      if (url.includes('/email/routing/rules?page=2&per_page=100')) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [
              {
                enabled: true,
                matchers: [{ field: 'to', type: 'literal', value: 'github-ab12cd@singesupreme.fr' }],
                actions: [{ type: 'forward', value: ['warmax7794@gmail.com'] }]
              },
              {
                enabled: false,
                matchers: [{ field: 'to', type: 'literal', value: 'disabled@singesupreme.fr' }],
                actions: [{ type: 'forward', value: ['warmax7794@gmail.com'] }]
              }
            ],
            result_info: {
              page: 2,
              per_page: 100,
              total_pages: 2
            }
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const records = await listAliasRecordsForDestination(settings, 'warmax7794@gmail.com');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(records.map((item) => item.alias)).toEqual([
      'president-des@singesupreme.fr',
      'github-ab12cd@singesupreme.fr'
    ]);
    expect(records[0]).toMatchObject({
      destinationEmail: 'warmax7794@gmail.com',
      siteHost: 'manual',
      siteSlug: 'custom',
      cloudflareStatus: 'exists'
    });
    expect(records[1]).toMatchObject({
      destinationEmail: 'warmax7794@gmail.com',
      siteHost: 'cloudflare',
      siteSlug: 'github',
      cloudflareStatus: 'exists'
    });
  });
});

describe('createOrEnsureAliasRouting', () => {
  it('reuses a destination address found on a later pagination page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.includes('/email/routing/addresses?page=1&per_page=100')) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ email: 'other@gmail.com', verified: true }],
            result_info: {
              page: 1,
              per_page: 100,
              total_pages: 2
            }
          }),
          { status: 200 }
        );
      }

      if (method === 'GET' && url.includes('/email/routing/addresses?page=2&per_page=100')) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ email: 'warmax7794@gmail.com', verified: true }],
            result_info: {
              page: 2,
              per_page: 100,
              total_pages: 2
            }
          }),
          { status: 200 }
        );
      }

      if (method === 'GET' && url.includes('/email/routing/rules?page=1&per_page=100')) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [
              {
                id: 'rule-123',
                enabled: true,
                matchers: [{ field: 'to', type: 'literal', value: 'president-des@singesupreme.fr' }],
                actions: [{ type: 'forward', value: ['warmax7794@gmail.com'] }]
              }
            ],
            result_info: {
              page: 1,
              per_page: 100,
              total_pages: 1
            }
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const status = await createOrEnsureAliasRouting(
      settings,
      'president-des@singesupreme.fr',
      'warmax7794@gmail.com'
    );

    expect(status).toBe('exists');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.some(([url, init]) => String(url).includes('/email/routing/addresses') && init?.method === 'POST')
    ).toBe(false);
  });
});
