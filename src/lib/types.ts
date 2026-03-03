export type CloudflareStatus = 'created' | 'exists' | 'failed';

export interface AliasRecord {
  id: string;
  alias: string;
  destinationEmail?: string;
  siteHost: string;
  siteSlug: string;
  createdAt: string;
  cloudflareStatus: CloudflareStatus;
  errorCode?: string;
}

export interface ExtensionSettings {
  domain: string;
  destinationEmail: string;
  accountId: string;
  zoneId: string;
  apiToken: string;
}

export interface AliasGenerationResult {
  alias: string;
  siteHost: string;
  siteSlug: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  domain: '',
  destinationEmail: '',
  accountId: '',
  zoneId: '',
  apiToken: ''
};

export const HISTORY_LIMIT = 500;
