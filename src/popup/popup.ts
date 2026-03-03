import type { AliasRecord, CloudflareStatus, ExtensionSettings } from '../lib/types';
import { sendRuntimeMessage } from '../lib/messages';
import { initializeThemeToggle } from '../lib/theme';
import { isValidDomain, normalizeDomain, sanitizeSettings } from '../lib/validation';

const siteHint = document.querySelector<HTMLParagraphElement>('#siteHint');
const statusNode = document.querySelector<HTMLParagraphElement>('#status');
const aliasValueNode = document.querySelector<HTMLElement>('#aliasValue');
const generateButton = document.querySelector<HTMLButtonElement>('#generateBtn');
const fillButton = document.querySelector<HTMLButtonElement>('#fillBtn');
const historyList = document.querySelector<HTMLUListElement>('#historyList');
const refreshHistoryButton = document.querySelector<HTMLButtonElement>('#refreshHistoryBtn');
const themeToggleButton = document.querySelector<HTMLButtonElement>('#themeToggle');

let latestAlias = '';
let latestSiteHost = 'manual';
let latestSiteSlug = 'manual';

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

async function handleGenerateFlow(): Promise<void> {
  if (!generateButton) {
    return;
  }

  generateButton.disabled = true;
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

    latestAlias = aliasResponse.data.alias;
    latestSiteHost = aliasResponse.data.siteHost;
    latestSiteSlug = aliasResponse.data.siteSlug;
    setAliasValue(latestAlias);

    let cloudflareStatus: CloudflareStatus = 'exists';
    let cloudflareError = '';
    let cloudflareErrorCode = '';
    let copyOk = true;

    const cloudflareResponse = await sendRuntimeMessage({
      type: 'CREATE_CLOUDFLARE_ALIAS',
      alias: latestAlias
    });

    if (cloudflareResponse.ok) {
      cloudflareStatus = cloudflareResponse.data.status;
    } else {
      cloudflareStatus = 'failed';
      cloudflareError = cloudflareResponse.error;
      cloudflareErrorCode = cloudflareResponse.code ?? 'API_ERROR';
    }

    try {
      await copyAlias(latestAlias);
    } catch {
      copyOk = false;
    }

    await sendRuntimeMessage({
      type: 'SAVE_ALIAS_RECORD',
      record: createHistoryRecord(cloudflareStatus, cloudflareErrorCode || undefined)
    });

    if (!copyOk && cloudflareStatus === 'failed') {
      setStatus(`Alias generated but copy failed. Cloudflare: ${cloudflareError || 'error'}`);
    } else if (!copyOk) {
      setStatus('Alias generated but copy failed. Copy manually.');
    } else if (cloudflareStatus === 'failed') {
      setStatus(`Alias copied. Cloudflare: ${cloudflareError || 'error'}`);
    } else if (cloudflareStatus === 'created') {
      setStatus('Alias copied. Cloudflare routing updated.');
    } else {
      setStatus('Alias copied. Cloudflare already configured.');
    }

    await loadHistory();
  } finally {
    generateButton.disabled = false;
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

  if (!hasValidDomain && generateButton) {
    generateButton.disabled = true;
    setStatus('Set a valid domain in options before generating aliases.');
  } else if (generateButton) {
    generateButton.disabled = false;
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
