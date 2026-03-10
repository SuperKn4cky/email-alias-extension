import type { AliasRecord, ExtensionSettings } from './types';

export type CloudflareEnsureStatus = 'created' | 'exists';
export type CloudflareDeleteStatus = 'deleted' | 'not_found';

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
  result_info?: {
    count?: number;
    page?: number;
    per_page?: number;
    total_count?: number;
    total_pages?: number;
  };
}

interface DestinationAddress {
  id?: string;
  email?: string;
  verified?: boolean;
}

interface EmailRoutingRuleMatcher {
  field?: string;
  type?: string;
  value?: string;
}

interface EmailRoutingRuleAction {
  type?: string;
  value?: string[];
}

interface EmailRoutingRule {
  id?: string;
  enabled?: boolean;
  matchers?: EmailRoutingRuleMatcher[];
  actions?: EmailRoutingRuleAction[];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLOUDFLARE_PAGE_SIZE = 100;

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

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(normalizeEmail(value));
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

function extractRuleList(result: unknown): EmailRoutingRule[] {
  if (Array.isArray(result)) {
    return result as EmailRoutingRule[];
  }

  if (typeof result === 'object' && result !== null) {
    const objectResult = result as { items?: unknown; rules?: unknown };
    if (Array.isArray(objectResult.items)) {
      return objectResult.items as EmailRoutingRule[];
    }
    if (Array.isArray(objectResult.rules)) {
      return objectResult.rules as EmailRoutingRule[];
    }
  }

  return [];
}

function hasAliasMatcher(rule: EmailRoutingRule, alias: string): boolean {
  const target = alias.toLowerCase();
  if (!Array.isArray(rule.matchers)) {
    return false;
  }

  return rule.matchers.some((matcher) => {
    if (!matcher || matcher.field !== 'to' || typeof matcher.value !== 'string') {
      return false;
    }
    return matcher.value.toLowerCase() === target;
  });
}

function forwardsToDestination(rule: EmailRoutingRule, destinationEmail: string): boolean {
  if (!Array.isArray(rule.actions)) {
    return false;
  }

  const normalizedDestination = normalizeEmail(destinationEmail);
  return rule.actions.some((action) => {
    if (action.type !== 'forward' || !Array.isArray(action.value)) {
      return false;
    }

    return action.value.some((email) => normalizeEmail(email) === normalizedDestination);
  });
}

function findAliasRule(
  rules: EmailRoutingRule[],
  alias: string,
  destinationEmail?: string
): EmailRoutingRule | null {
  const aliasRules = rules.filter((rule) => hasAliasMatcher(rule, alias));
  if (aliasRules.length === 0) {
    return null;
  }

  if (destinationEmail) {
    const exact = aliasRules.find((rule) => forwardsToDestination(rule, destinationEmail));
    if (exact) {
      return exact;
    }
  }

  return aliasRules[0] ?? null;
}

function extractAliasFromRule(rule: EmailRoutingRule): string | null {
  if (!Array.isArray(rule.matchers)) {
    return null;
  }

  const matcher = rule.matchers.find((item) => item?.field === 'to' && typeof item.value === 'string');
  if (!matcher?.value || !matcher.value.includes('@')) {
    return null;
  }

  return normalizeEmail(matcher.value);
}

function inferSyncedAliasMetadata(alias: string): Pick<AliasRecord, 'siteHost' | 'siteSlug'> {
  const [localPart = ''] = alias.split('@');
  const generatedAliasMatch = localPart.match(/^(.*)-[a-z0-9]{6}$/i);

  if (generatedAliasMatch?.[1]) {
    return {
      siteHost: 'cloudflare',
      siteSlug: generatedAliasMatch[1].toLowerCase()
    };
  }

  return {
    siteHost: 'manual',
    siteSlug: 'custom'
  };
}

function getDestinationForCreate(settings: ExtensionSettings, destinationEmailOverride?: string): string {
  const candidate = normalizeEmail(destinationEmailOverride || settings.destinationEmail);
  if (!candidate || !isValidEmail(candidate)) {
    throw new CloudflareApiError('INVALID_CONFIG', 'A valid destination email is required.');
  }
  return candidate;
}

function getDestinationForDelete(settings: ExtensionSettings, destinationEmailOverride?: string): string | undefined {
  const override = normalizeEmail(destinationEmailOverride ?? '');
  if (override) {
    return isValidEmail(override) ? override : undefined;
  }

  const fallback = normalizeEmail(settings.destinationEmail);
  return fallback && isValidEmail(fallback) ? fallback : undefined;
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

async function cloudflareRequest<T>(
  path: string,
  apiToken: string,
  init: RequestInit = {}
): Promise<{ result: T; status: number; resultInfo?: CloudflareEnvelope<T>['result_info'] }> {
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
    status: response.status,
    resultInfo: payload.result_info
  };
}

async function listCloudflarePages<T>(
  path: string,
  apiToken: string,
  extractItems: (result: unknown) => T[]
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;

  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await cloudflareRequest<unknown>(
      `${path}${separator}page=${page}&per_page=${CLOUDFLARE_PAGE_SIZE}`,
      apiToken,
      { method: 'GET' }
    );
    const pageItems = extractItems(response.result);
    items.push(...pageItems);

    const totalPages = response.resultInfo?.total_pages;
    if (typeof totalPages === 'number') {
      if (page >= totalPages) {
        break;
      }
    } else if (pageItems.length < CLOUDFLARE_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return items;
}

async function listAliasRules(settings: ExtensionSettings): Promise<EmailRoutingRule[]> {
  return listCloudflarePages<EmailRoutingRule>(
    `/zones/${settings.zoneId}/email/routing/rules`,
    settings.apiToken,
    extractRuleList
  );
}

async function listDestinationAddresses(settings: ExtensionSettings): Promise<DestinationAddress[]> {
  return listCloudflarePages<DestinationAddress>(
    `/accounts/${settings.accountId}/email/routing/addresses`,
    settings.apiToken,
    extractAddressList
  );
}

async function ensureDestinationAddress(
  settings: ExtensionSettings,
  destinationEmail: string
): Promise<CloudflareEnsureStatus> {
  const addresses = await listDestinationAddresses(settings);
  const existing = addresses.find((item) => normalizeEmail(item.email ?? '') === destinationEmail);

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
        email: destinationEmail
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

async function ensureAliasRule(
  settings: ExtensionSettings,
  alias: string,
  destinationEmail: string
): Promise<CloudflareEnsureStatus> {
  const rules = await listAliasRules(settings);
  const existing = findAliasRule(rules, alias, destinationEmail);

  if (existing?.enabled && forwardsToDestination(existing, destinationEmail)) {
    return 'exists';
  }

  const payload = {
    name: `Alias ${alias}`,
    enabled: true,
    matchers: [
      {
        type: 'literal',
        field: 'to',
        value: alias
      }
    ],
    actions: [
      {
        type: 'forward',
        value: [destinationEmail]
      }
    ]
  };

  if (existing?.id) {
    await cloudflareRequest<EmailRoutingRule>(
      `/zones/${settings.zoneId}/email/routing/rules/${existing.id}`,
      settings.apiToken,
      {
        method: 'PUT',
        body: JSON.stringify(payload)
      }
    );
    return 'created';
  }

  await cloudflareRequest<EmailRoutingRule>(
    `/zones/${settings.zoneId}/email/routing/rules`,
    settings.apiToken,
    {
      method: 'POST',
      body: JSON.stringify(payload)
    }
  );

  return 'created';
}

export async function createOrEnsureAliasRouting(
  settings: ExtensionSettings,
  alias: string,
  destinationEmailOverride?: string
): Promise<CloudflareEnsureStatus> {
  if (!alias.includes('@')) {
    throw new CloudflareApiError('API_ERROR', 'Generated alias format is invalid.');
  }

  const destinationEmail = getDestinationForCreate(settings, destinationEmailOverride);
  const addressStatus = await ensureDestinationAddress(settings, destinationEmail);
  const ruleStatus = await ensureAliasRule(settings, alias.toLowerCase(), destinationEmail);

  return addressStatus === 'created' || ruleStatus === 'created' ? 'created' : 'exists';
}

export async function deleteAliasRouting(
  settings: ExtensionSettings,
  alias: string,
  destinationEmailOverride?: string
): Promise<CloudflareDeleteStatus> {
  const destinationEmail = getDestinationForDelete(settings, destinationEmailOverride);
  const rules = await listAliasRules(settings);
  const target = findAliasRule(rules, alias.toLowerCase(), destinationEmail);

  if (!target?.id) {
    return 'not_found';
  }

  await cloudflareRequest<unknown>(`/zones/${settings.zoneId}/email/routing/rules/${target.id}`, settings.apiToken, {
    method: 'DELETE'
  });

  return 'deleted';
}

export async function listAliasRecordsForDestination(
  settings: ExtensionSettings,
  destinationEmailOverride?: string
): Promise<AliasRecord[]> {
  const destinationEmail = getDestinationForCreate(settings, destinationEmailOverride);
  const syncedAt = new Date().toISOString();
  const seenAliases = new Set<string>();
  const rules = await listAliasRules(settings);

  return rules
    .filter((rule) => rule.enabled !== false && forwardsToDestination(rule, destinationEmail))
    .map((rule) => extractAliasFromRule(rule))
    .filter((alias): alias is string => Boolean(alias))
    .filter((alias) => {
      if (seenAliases.has(alias)) {
        return false;
      }

      seenAliases.add(alias);
      return true;
    })
    .map((alias) => ({
      id: crypto.randomUUID(),
      alias,
      destinationEmail,
      ...inferSyncedAliasMetadata(alias),
      createdAt: syncedAt,
      cloudflareStatus: 'exists'
    }));
}

export async function testCloudflareAccess(settings: ExtensionSettings): Promise<void> {
  await listDestinationAddresses(settings);

  await listAliasRules(settings);
}
