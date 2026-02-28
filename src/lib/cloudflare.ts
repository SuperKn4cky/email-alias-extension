import type { ExtensionSettings } from './types';

export type CloudflareEnsureStatus = 'created' | 'exists';

export type CloudflareErrorCode =
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'DESTINATION_UNVERIFIED'
  | 'API_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_CONFIG';

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result: T;
}

interface DestinationAddress {
  id?: string;
  email?: string;
  verified?: boolean;
}

interface CatchAllRule {
  enabled?: boolean;
  actions?: Array<{ type?: string; value?: string[] }>;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!headers) {
    return normalized;
  }

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key] = value;
    });
    return normalized;
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      normalized[key] = value;
    }
    return normalized;
  }

  return { ...headers };
}

export class CloudflareApiError extends Error {
  readonly code: CloudflareErrorCode;
  readonly status?: number;

  constructor(code: CloudflareErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'CloudflareApiError';
    this.code = code;
    this.status = status;
  }
}

export function mapCloudflareErrorCode(status?: number, messages: string[] = []): CloudflareErrorCode {
  if (status === 401 || status === 403) {
    return 'AUTH_ERROR';
  }

  if (status === 404) {
    return 'NOT_FOUND';
  }

  const lowered = messages.join(' ').toLowerCase();
  if (lowered.includes('verify') || lowered.includes('verification')) {
    return 'DESTINATION_UNVERIFIED';
  }

  if (status === undefined) {
    return 'NETWORK_ERROR';
  }

  return 'API_ERROR';
}

export function cloudflareErrorMessage(code: CloudflareErrorCode): string {
  switch (code) {
    case 'AUTH_ERROR':
      return 'Cloudflare authentication failed. Check API token scopes.';
    case 'NOT_FOUND':
      return 'Cloudflare zone/account not found.';
    case 'DESTINATION_UNVERIFIED':
      return 'Destination email is not verified in Cloudflare Email Routing.';
    case 'NETWORK_ERROR':
      return 'Network error while calling Cloudflare API.';
    case 'INVALID_CONFIG':
      return 'Invalid settings. Open options and complete all fields.';
    default:
      return 'Cloudflare API error.';
  }
}

function extractAddressList(result: unknown): DestinationAddress[] {
  if (Array.isArray(result)) {
    return result as DestinationAddress[];
  }

  if (typeof result === 'object' && result !== null) {
    const objectResult = result as { items?: unknown; addresses?: unknown };
    if (Array.isArray(objectResult.items)) {
      return objectResult.items as DestinationAddress[];
    }
    if (Array.isArray(objectResult.addresses)) {
      return objectResult.addresses as DestinationAddress[];
    }
  }

  return [];
}

function hasForwardToDestination(rule: CatchAllRule | null, destinationEmail: string): boolean {
  if (!rule?.enabled || !Array.isArray(rule.actions)) {
    return false;
  }

  return rule.actions.some((action) => {
    if (action.type !== 'forward' || !Array.isArray(action.value)) {
      return false;
    }

    return action.value.some((email) => email.toLowerCase() === destinationEmail.toLowerCase());
  });
}

async function cloudflareRequest<T>(
  path: string,
  apiToken: string,
  init: RequestInit = {}
): Promise<{ result: T; status: number }> {
  let response: Response;

  try {
    response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        ...normalizeHeaders(init.headers)
      }
    });
  } catch {
    throw new CloudflareApiError('NETWORK_ERROR', cloudflareErrorMessage('NETWORK_ERROR'));
  }

  let payload: CloudflareEnvelope<T>;
  try {
    payload = (await response.json()) as CloudflareEnvelope<T>;
  } catch {
    const code = mapCloudflareErrorCode(response.status);
    throw new CloudflareApiError(code, cloudflareErrorMessage(code), response.status);
  }

  if (!response.ok || !payload.success) {
    const messages = payload.errors?.map((item) => item.message) ?? [];
    const code = mapCloudflareErrorCode(response.status, messages);
    const message = messages[0] ?? cloudflareErrorMessage(code);
    throw new CloudflareApiError(code, message, response.status);
  }

  return {
    result: payload.result,
    status: response.status
  };
}

async function ensureDestinationAddress(settings: ExtensionSettings): Promise<CloudflareEnsureStatus> {
  const listResponse = await cloudflareRequest<unknown>(
    `/accounts/${settings.accountId}/email/routing/addresses`,
    settings.apiToken,
    {
      method: 'GET'
    }
  );

  const addresses = extractAddressList(listResponse.result);
  const existing = addresses.find(
    (item) => item.email?.toLowerCase() === settings.destinationEmail.toLowerCase()
  );

  if (existing) {
    if (existing.verified === false) {
      throw new CloudflareApiError(
        'DESTINATION_UNVERIFIED',
        cloudflareErrorMessage('DESTINATION_UNVERIFIED')
      );
    }

    return 'exists';
  }

  const createResponse = await cloudflareRequest<DestinationAddress>(
    `/accounts/${settings.accountId}/email/routing/addresses`,
    settings.apiToken,
    {
      method: 'POST',
      body: JSON.stringify({
        email: settings.destinationEmail
      })
    }
  );

  if (createResponse.result.verified === false) {
    throw new CloudflareApiError(
      'DESTINATION_UNVERIFIED',
      cloudflareErrorMessage('DESTINATION_UNVERIFIED')
    );
  }

  return 'created';
}

async function getCatchAllRule(settings: ExtensionSettings): Promise<CatchAllRule | null> {
  try {
    const response = await cloudflareRequest<CatchAllRule>(
      `/zones/${settings.zoneId}/email/routing/rules/catch_all`,
      settings.apiToken,
      {
        method: 'GET'
      }
    );

    return response.result;
  } catch (error) {
    if (error instanceof CloudflareApiError && error.code === 'NOT_FOUND') {
      return null;
    }

    throw error;
  }
}

async function ensureCatchAllRule(settings: ExtensionSettings): Promise<CloudflareEnsureStatus> {
  const current = await getCatchAllRule(settings);

  if (hasForwardToDestination(current, settings.destinationEmail)) {
    return 'exists';
  }

  await cloudflareRequest<CatchAllRule>(
    `/zones/${settings.zoneId}/email/routing/rules/catch_all`,
    settings.apiToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Catch all',
        enabled: true,
        actions: [
          {
            type: 'forward',
            value: [settings.destinationEmail]
          }
        ]
      })
    }
  );

  return 'created';
}

export async function createOrEnsureAliasRouting(
  settings: ExtensionSettings,
  alias: string
): Promise<CloudflareEnsureStatus> {
  if (!alias.includes('@')) {
    throw new CloudflareApiError('API_ERROR', 'Generated alias format is invalid.');
  }

  const addressStatus = await ensureDestinationAddress(settings);
  const ruleStatus = await ensureCatchAllRule(settings);

  return addressStatus === 'created' || ruleStatus === 'created' ? 'created' : 'exists';
}

export async function testCloudflareAccess(settings: ExtensionSettings): Promise<void> {
  await cloudflareRequest<unknown>(`/accounts/${settings.accountId}/email/routing/addresses`, settings.apiToken, {
    method: 'GET'
  });

  await getCatchAllRule(settings);
}
