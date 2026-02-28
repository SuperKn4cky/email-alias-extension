import { buildAliasEmail, extractSiteHost, generateAliasLocalPart, hostToSiteSlug } from '../lib/alias';
import {
  CloudflareApiError,
  cloudflareErrorMessage,
  createOrEnsureAliasRouting,
  mapCloudflareErrorCode,
  testCloudflareAccess
} from '../lib/cloudflare';
import type { RuntimeRequest, RuntimeResponse } from '../lib/messages';
import { addHistoryRecord, clearHistory, getHistory, getSettings } from '../lib/storage';
import type { ExtensionSettings } from '../lib/types';
import { isValidDomain, sanitizeSettings, validateSettings } from '../lib/validation';

function invalidSettingsResponse(settings: ExtensionSettings): RuntimeResponse {
  const errors = validateSettings(settings);
  if (errors.length === 0) {
    return {
      ok: true,
      data: null
    };
  }

  return {
    ok: false,
    error: errors[0],
    code: 'INVALID_CONFIG'
  };
}

async function handleGenerateAlias(tabUrl?: string): Promise<RuntimeResponse> {
  const settings = sanitizeSettings(await getSettings());
  if (!isValidDomain(settings.domain)) {
    return {
      ok: false,
      error: 'Domain in options is missing or invalid.',
      code: 'INVALID_CONFIG'
    };
  }

  const siteHost = extractSiteHost(tabUrl);
  const siteSlug = hostToSiteSlug(siteHost);
  const localPart = generateAliasLocalPart(siteSlug);
  const alias = buildAliasEmail(localPart, settings.domain);

  return {
    ok: true,
    data: {
      alias,
      siteHost,
      siteSlug
    }
  };
}

async function handleCreateCloudflareAlias(alias: string): Promise<RuntimeResponse> {
  const settings = sanitizeSettings(await getSettings());
  const settingsValidation = invalidSettingsResponse(settings);
  if (!settingsValidation.ok) {
    return settingsValidation;
  }

  try {
    const status = await createOrEnsureAliasRouting(settings, alias);
    return {
      ok: true,
      data: {
        status
      }
    };
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      return {
        ok: false,
        error: error.message,
        code: error.code
      };
    }

    return {
      ok: false,
      error: cloudflareErrorMessage('API_ERROR'),
      code: 'API_ERROR'
    };
  }
}

async function handleTestCloudflare(): Promise<RuntimeResponse> {
  const settings = sanitizeSettings(await getSettings());
  const settingsValidation = invalidSettingsResponse(settings);
  if (!settingsValidation.ok) {
    return settingsValidation;
  }

  try {
    await testCloudflareAccess(settings);
    return {
      ok: true,
      data: {
        ok: true
      }
    };
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      return {
        ok: false,
        error: error.message,
        code: error.code
      };
    }

    return {
      ok: false,
      error: cloudflareErrorMessage(mapCloudflareErrorCode()),
      code: 'API_ERROR'
    };
  }
}

async function handleRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  switch (request.type) {
    case 'GENERATE_ALIAS':
      return handleGenerateAlias(request.tabUrl);
    case 'CREATE_CLOUDFLARE_ALIAS':
      return handleCreateCloudflareAlias(request.alias);
    case 'SAVE_ALIAS_RECORD':
      await addHistoryRecord(request.record);
      return {
        ok: true,
        data: {
          saved: true
        }
      };
    case 'GET_HISTORY': {
      const items = await getHistory();
      return {
        ok: true,
        data: {
          items
        }
      };
    }
    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return {
        ok: true,
        data: {
          settings
        }
      };
    }
    case 'TEST_CLOUDFLARE':
      return handleTestCloudflare();
    case 'CLEAR_HISTORY':
      await clearHistory();
      return {
        ok: true,
        data: {
          cleared: true
        }
      };
    default:
      return {
        ok: false,
        error: 'Unknown message type.',
        code: 'UNKNOWN'
      };
  }
}

chrome.runtime.onMessage.addListener((request: RuntimeRequest, _sender, sendResponse) => {
  void handleRequest(request)
    .then((response) => sendResponse(response))
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      sendResponse({
        ok: false,
        error: message,
        code: 'UNEXPECTED'
      });
    });

  return true;
});
