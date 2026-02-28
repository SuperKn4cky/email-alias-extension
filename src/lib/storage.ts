import type { AliasRecord, ExtensionSettings } from './types';
import { DEFAULT_SETTINGS, HISTORY_LIMIT } from './types';
import { sanitizeSettings } from './validation';

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'aliasHistory';

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  const raw = result[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;

  return {
    ...DEFAULT_SETTINGS,
    ...raw
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.sync.set({
    [SETTINGS_KEY]: sanitizeSettings(settings)
  });
}

export async function getHistory(): Promise<AliasRecord[]> {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  const raw = result[HISTORY_KEY] as AliasRecord[] | undefined;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw;
}

export async function addHistoryRecord(record: AliasRecord): Promise<void> {
  const current = await getHistory();
  const deduped = current.filter((item) => item.alias !== record.alias);
  const next = [record, ...deduped].slice(0, HISTORY_LIMIT);
  await chrome.storage.local.set({
    [HISTORY_KEY]: next
  });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({
    [HISTORY_KEY]: []
  });
}
