import type { AliasGenerationResult, AliasRecord, ExtensionSettings } from './types';
import type { CloudflareEnsureStatus } from './cloudflare';

export type RuntimeRequest =
  | { type: 'GENERATE_ALIAS'; tabUrl?: string }
  | { type: 'CREATE_CLOUDFLARE_ALIAS'; alias: string }
  | { type: 'SAVE_ALIAS_RECORD'; record: AliasRecord }
  | { type: 'GET_HISTORY' }
  | { type: 'GET_SETTINGS' }
  | { type: 'TEST_CLOUDFLARE' }
  | { type: 'CLEAR_HISTORY' };

export interface RuntimeResponseMap {
  GENERATE_ALIAS: AliasGenerationResult;
  CREATE_CLOUDFLARE_ALIAS: { status: CloudflareEnsureStatus };
  SAVE_ALIAS_RECORD: { saved: true };
  GET_HISTORY: { items: AliasRecord[] };
  GET_SETTINGS: { settings: ExtensionSettings };
  TEST_CLOUDFLARE: { ok: true };
  CLEAR_HISTORY: { cleared: true };
}

export type RuntimeResponse<T = unknown> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
      code?: string;
    };

export async function sendRuntimeMessage<K extends keyof RuntimeResponseMap>(
  request: Extract<RuntimeRequest, { type: K }>
): Promise<RuntimeResponse<RuntimeResponseMap[K]>> {
  const response = (await chrome.runtime.sendMessage(request)) as RuntimeResponse<RuntimeResponseMap[K]>;
  return response;
}
