import type { AliasRecord, CloudflareStatus, ExtensionSettings } from '../lib/types';
import { sendRuntimeMessage } from '../lib/messages';
import { initializeThemeToggle } from '../lib/theme';
import { isValidDomain, normalizeDomain, sanitizeSettings } from '../lib/validation';

const siteHint = document.querySelector<HTMLParagraphElement>('#siteHint');
const statusNode = document.querySelector<HTMLParagraphElement>('#status');
const aliasValueNode = document.querySelector<HTMLElement>('#aliasValue');
const generateButton = document.querySelector<HTMLButtonElement>('#generateBtn');
const fillButton = document.querySelector<HTMLButtonElement>('#fillBtn');
const customAliasInput = document.querySelector<HTMLInputElement>('#customAliasInput');
const createCustomAliasButton = document.querySelector<HTMLButtonElement>('#createCustomAliasBtn');
const historyList = document.querySelector<HTMLUListElement>('#historyList');
const refreshHistoryButton = document.querySelector<HTMLButtonElement>('#refreshHistoryBtn');
const themeToggleButton = document.querySelector<HTMLButtonElement>('#themeToggle');

let latestAlias = '';
let latestSiteHost = 'manual';
let latestSiteSlug = 'manual';
let configuredDomain = '';

const CUSTOM_LOCAL_PART_REGEX = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/i;
type AliasSource = 'generated' | 'custom';

function setStatus(message: string): void {
  if (statusNode) {
    statusNode.textContent = message;
  }
}

function setAliasValue(alias: string): void {
  latestAlias = alias;
  if (aliasValueNode) {
    aliasValueNode.textContent = alias || '-';
  }

  if (fillButton) {
    fillButton.disabled = !alias;
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function getActiveTabUrl(): Promise<string | undefined> {
  const tab = await getActiveTab();
  return tab?.url;
}

function renderHistory(items: AliasRecord[]): void {
  if (!historyList) {
    return;
  }

  historyList.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No aliases yet.';
    historyList.appendChild(empty);
    return;
  }

  for (const item of items.slice(0, 12)) {
    const line = document.createElement('li');

    const alias = document.createElement('code');
    alias.textContent = item.alias;

    const details = document.createElement('span');
    const date = new Date(item.createdAt).toLocaleString();
    details.textContent = `${item.siteSlug} • ${item.cloudflareStatus} • ${date}`;

    line.appendChild(alias);
    line.appendChild(details);
    historyList.appendChild(line);
  }
}

async function loadHistory(): Promise<void> {
  const response = await sendRuntimeMessage({ type: 'GET_HISTORY' });
  if (!response.ok) {
    setStatus(response.error);
    return;
  }

  renderHistory(response.data.items);
}

async function copyAlias(alias: string): Promise<void> {
  await navigator.clipboard.writeText(alias);
}

function findEmailInputAndFill(alias: string): boolean {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email" i]'
    )
  );

  const target = candidates.find((input) => {
    if (input.disabled || input.readOnly) {
      return false;
    }

    const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  if (!target) {
    return false;
  }

  target.focus();
  target.value = alias;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

async function fillEmailField(alias: string): Promise<boolean> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return false;
  }

  let result: chrome.scripting.InjectionResult<unknown>[];
  try {
    result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: findEmailInputAndFill,
      args: [alias]
    });
  } catch {
    return false;
  }

  return Boolean(result[0]?.result);
}

async function getSettings(): Promise<ExtensionSettings | null> {
  const response = await sendRuntimeMessage({ type: 'GET_SETTINGS' });
  if (!response.ok) {
    setStatus(response.error);
    return null;
  }

  return sanitizeSettings(response.data.settings);
}

function createHistoryRecord(status: CloudflareStatus, errorCode?: string): AliasRecord {
  return {
    id: crypto.randomUUID(),
    alias: latestAlias,
    siteHost: latestSiteHost,
    siteSlug: latestSiteSlug,
    createdAt: new Date().toISOString(),
    cloudflareStatus: status,
    errorCode
  };
}

function setActionsEnabled(enabled: boolean): void {
  if (generateButton) {
    generateButton.disabled = !enabled;
  }
  if (createCustomAliasButton) {
    createCustomAliasButton.disabled = !enabled;
  }
}

type CustomAliasResolution =
  | {
      ok: true;
      alias: string;
    }
  | {
      ok: false;
      error: string;
    };

function resolveCustomAlias(inputValue: string, domain: string): CustomAliasResolution {
  const normalizedDomain = normalizeDomain(domain);
  const value = inputValue.trim().toLowerCase();

  if (!value) {
    return {
      ok: false,
      error: 'Enter an alias to recreate.'
    };
  }

  if (value.includes('@')) {
    const [localPart = '', domainPart = '', ...rest] = value.split('@');
    if (!localPart || !domainPart || rest.length > 0) {
      return {
        ok: false,
        error: 'Alias format is invalid.'
      };
    }

    const normalizedInputDomain = normalizeDomain(domainPart);
    if (normalizedInputDomain !== normalizedDomain) {
      return {
        ok: false,
        error: `Alias domain must be ${normalizedDomain}.`
      };
    }

    if (!CUSTOM_LOCAL_PART_REGEX.test(localPart)) {
      return {
        ok: false,
        error: 'Alias name can only use letters, numbers, ".", "_", "+", "-".'
      };
    }

    return {
      ok: true,
      alias: `${localPart}@${normalizedDomain}`
    };
  }

  if (!CUSTOM_LOCAL_PART_REGEX.test(value)) {
    return {
      ok: false,
      error: 'Alias name can only use letters, numbers, ".", "_", "+", "-".'
    };
  }

  return {
    ok: true,
    alias: `${value}@${normalizedDomain}`
  };
}

async function finalizeAliasFlow(alias: string, siteHost: string, siteSlug: string, source: AliasSource): Promise<void> {
  latestSiteHost = siteHost;
  latestSiteSlug = siteSlug;
  setAliasValue(alias);

  let cloudflareStatus: CloudflareStatus = 'exists';
  let cloudflareError = '';
  let cloudflareErrorCode = '';
  let copyOk = true;

  const cloudflareResponse = await sendRuntimeMessage({
    type: 'CREATE_CLOUDFLARE_ALIAS',
    alias
  });

  if (cloudflareResponse.ok) {
    cloudflareStatus = cloudflareResponse.data.status;
  } else {
    cloudflareStatus = 'failed';
    cloudflareError = cloudflareResponse.error;
    cloudflareErrorCode = cloudflareResponse.code ?? 'API_ERROR';
  }

  try {
    await copyAlias(alias);
  } catch {
    copyOk = false;
  }

  await sendRuntimeMessage({
    type: 'SAVE_ALIAS_RECORD',
    record: createHistoryRecord(cloudflareStatus, cloudflareErrorCode || undefined)
  });

  const aliasLabel = source === 'custom' ? 'Custom alias' : 'Alias';

  if (!copyOk && cloudflareStatus === 'failed') {
    setStatus(`${aliasLabel} ready but copy failed. Cloudflare: ${cloudflareError || 'error'}`);
  } else if (!copyOk) {
    setStatus(`${aliasLabel} ready but copy failed. Copy manually.`);
  } else if (cloudflareStatus === 'failed') {
    setStatus(`${aliasLabel} copied. Cloudflare: ${cloudflareError || 'error'}`);
  } else if (cloudflareStatus === 'created') {
    setStatus(`${aliasLabel} copied. Cloudflare routing updated.`);
  } else {
    setStatus(`${aliasLabel} copied. Cloudflare already configured.`);
  }

  await loadHistory();
}

async function handleGenerateFlow(): Promise<void> {
  if (!generateButton) {
    return;
  }

  setActionsEnabled(false);
  if (fillButton) {
    fillButton.disabled = true;
  }

  try {
    const tabUrl = await getActiveTabUrl();

    const aliasResponse = await sendRuntimeMessage({
      type: 'GENERATE_ALIAS',
      tabUrl
    });

    if (!aliasResponse.ok) {
      setStatus(aliasResponse.error);
      return;
    }

    await finalizeAliasFlow(
      aliasResponse.data.alias,
      aliasResponse.data.siteHost,
      aliasResponse.data.siteSlug,
      'generated'
    );
  } finally {
    setActionsEnabled(Boolean(configuredDomain));
    if (fillButton) {
      fillButton.disabled = !latestAlias;
    }
  }
}

async function handleCustomAliasFlow(): Promise<void> {
  if (!createCustomAliasButton || !customAliasInput) {
    return;
  }

  setActionsEnabled(false);
  if (fillButton) {
    fillButton.disabled = true;
  }

  try {
    if (!configuredDomain || !isValidDomain(configuredDomain)) {
      setStatus('Set a valid domain in options before creating a custom alias.');
      return;
    }

    const resolved = resolveCustomAlias(customAliasInput.value, configuredDomain);
    if (!resolved.ok) {
      setStatus(resolved.error);
      return;
    }

    await finalizeAliasFlow(resolved.alias, 'manual', 'custom', 'custom');
  } finally {
    setActionsEnabled(Boolean(configuredDomain));
    if (fillButton) {
      fillButton.disabled = !latestAlias;
    }
  }
}

async function bootstrap(): Promise<void> {
  const settings = await getSettings();
  if (!settings) {
    return;
  }

  const normalizedDomain = normalizeDomain(settings.domain);
  const hasValidDomain = isValidDomain(normalizedDomain);
  configuredDomain = normalizedDomain;

  if (!hasValidDomain) {
    setActionsEnabled(false);
    setStatus('Set a valid domain in options before generating aliases.');
  } else {
    setActionsEnabled(true);
    setStatus('Ready.');
  }

  const tab = await getActiveTab();
  let host = '-';
  if (tab?.url) {
    try {
      host = new URL(tab.url).hostname;
    } catch {
      host = '-';
    }
  }
  if (siteHint) {
    siteHint.textContent = `Current site: ${host}`;
  }

  await loadHistory();
}

generateButton?.addEventListener('click', () => {
  void handleGenerateFlow();
});

createCustomAliasButton?.addEventListener('click', () => {
  void handleCustomAliasFlow();
});

customAliasInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void handleCustomAliasFlow();
  }
});

fillButton?.addEventListener('click', () => {
  if (!latestAlias) {
    setStatus('Generate an alias first.');
    return;
  }

  void fillEmailField(latestAlias).then((ok) => {
    if (ok) {
      setStatus('Email field filled.');
    } else {
      setStatus('No visible email field found on this page.');
    }
  });
});

refreshHistoryButton?.addEventListener('click', () => {
  void loadHistory();
});

initializeThemeToggle(themeToggleButton);

void bootstrap();
