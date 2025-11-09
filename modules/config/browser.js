let configCache = null;
let configPromise = null;

let promptCache = null;
let promptPromise = null;

function resolveExtensionUrl(pathname) {
  if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
    return chrome.runtime.getURL(pathname.replace(/^\/+/, ''));
  }
  return pathname;
}

async function fetchJsonOnce(url) {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`Failed to load config resource (${response.status} ${response.statusText})`);
  }
  return await response.json();
}

export async function loadBrowserConfig() {
  if (configCache) {
    return configCache;
  }
  if (!configPromise) {
    const url = resolveExtensionUrl('config/app-config.json');
    configPromise = fetchJsonOnce(url).catch((error) => {
      configPromise = null;
      throw error;
    });
  }
  configCache = await configPromise;
  return configCache;
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return undefined;
}

function sanitizeString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function resolveSummaryConfig(rawConfig = {}) {
  if (rawConfig.aiSummaries && typeof rawConfig.aiSummaries === 'object') {
    return rawConfig.aiSummaries;
  }
  if (rawConfig.cursor && typeof rawConfig.cursor === 'object') {
    return rawConfig.cursor;
  }
  return {};
}

export async function getAiSummarySettings(overrides = {}) {
  let config = {};
  try {
    config = await loadBrowserConfig();
  } catch (error) {
    console.warn('[GitHub Actions Extension] Failed to load AI summary config:', error);
  }

  const summaryConfig = resolveSummaryConfig(config);
  const nestedSummaries =
    summaryConfig && typeof summaryConfig.summaries === 'object'
      ? summaryConfig.summaries
      : {};

  const enabledOverride = typeof overrides.enabled === 'boolean' ? overrides.enabled : undefined;
  const providerOverride = sanitizeString(overrides.provider);
  const apiKeyOverride = sanitizeString(overrides.apiKey);
  const apiBaseOverride = sanitizeString(overrides.apiBase);
  const modelOverride = sanitizeString(overrides.model);

  let enabled =
    enabledOverride ??
    coerceBoolean(summaryConfig.enabled) ??
    coerceBoolean(nestedSummaries.enabled);
  if (enabled === undefined && apiKeyOverride) {
    enabled = true;
  }
  if (enabled === undefined) {
    enabled = false;
  }

  let provider = providerOverride;
  if (!provider) {
    provider =
      sanitizeString(summaryConfig.provider) ||
      (sanitizeString(summaryConfig.apiBase)?.includes('dashscope') ? 'dashscope' : null) ||
      'dashscope';
  }

  let apiKey = apiKeyOverride;
  if (apiKey == null) {
    apiKey =
      sanitizeString(summaryConfig.apiKey) || sanitizeString(nestedSummaries.apiKey) || null;
  }

  let apiBase = apiBaseOverride;
  if (!apiBase) {
    apiBase =
      sanitizeString(summaryConfig.apiBase) ||
      sanitizeString(nestedSummaries.apiBase) ||
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation';
  }

  let model = modelOverride;
  if (!model) {
    model =
      sanitizeString(summaryConfig.model) ||
      sanitizeString(nestedSummaries.model) ||
      'qwen-max';
  }

  return {
    enabled,
    provider,
    apiKey,
    apiBase,
    model
  };
}

export async function loadSummaryPromptConfig() {
  if (promptCache) {
    return promptCache;
  }
  if (!promptPromise) {
    const url = resolveExtensionUrl('config/ai-summary-prompt.json');
    promptPromise = fetchJsonOnce(url).catch((error) => {
      promptPromise = null;
      throw error;
    });
  }
  promptCache = await promptPromise;
  return promptCache;
}


