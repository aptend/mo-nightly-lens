import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config', 'app-config.json');
const DEFAULT_SUMMARY_PROMPT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'config',
  'ai-summary-prompt.json'
);
const CONFIG_ENV_KEY = 'DAILYCHECK_CONFIG_PATH';
const SUMMARY_PROMPT_ENV_KEY = 'DAILYCHECK_SUMMARY_PROMPT_PATH';

let cachedConfig = null;
let cachedPath = null;
let cachedSummaryPrompt = null;
let cachedSummaryPromptPath = null;

function resolveConfigPath() {
  if (cachedPath) {
    return cachedPath;
  }

  const overridePath = process.env[CONFIG_ENV_KEY];
  if (overridePath) {
    cachedPath = path.isAbsolute(overridePath)
      ? overridePath
      : path.resolve(process.cwd(), overridePath);
    return cachedPath;
  }

  cachedPath = DEFAULT_CONFIG_PATH;
  return cachedPath;
}

function readConfigFile(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Configuration file not found at ${configPath}. ` +
        'Please create the file or set DAILY_CHECK_CONFIG_PATH to point to your config JSON.'
    );
  }

  const content = fs.readFileSync(configPath, 'utf8');

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse config JSON at ${configPath}: ${error.message}`);
  }
}

export function loadConfig() {
  if (!cachedConfig) {
    const configPath = resolveConfigPath();
    cachedConfig = readConfigFile(configPath);
  }

  return cachedConfig;
}

export function getGitHubConfig() {
  const config = loadConfig();
  return config?.github || {};
}

export function getGitHubToken() {
  const { token } = getGitHubConfig();
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    throw new Error(
      'GitHub token is missing in config. ' +
        'Please set github.token in config/app-config.json or override using DAILY_CHECK_CONFIG_PATH.'
    );
  }
  return token.trim();
}

export function getGitHubApiBase() {
  const { apiBase } = getGitHubConfig();
  return (apiBase && typeof apiBase === 'string' && apiBase.trim().length > 0
    ? apiBase
    : 'https://api.github.com'
  ).replace(/\/+$/, '');
}

export function getGitHubSessionConfig() {
  const githubConfig = getGitHubConfig();
  return githubConfig?.session || {};
}

export function getGitHubCookies() {
  const sessionConfig = getGitHubSessionConfig();
  const cookies = sessionConfig?.cookies || {};
  const normalizedEntries = Object.entries(cookies)
    .filter(([key, value]) => Boolean(key) && typeof value === 'string' && value.trim().length > 0)
    .map(([key, value]) => [key.trim(), value.trim()]);

  return Object.fromEntries(normalizedEntries);
}

export function getProxyUrl() {
  const sessionConfig = getGitHubSessionConfig();
  if (sessionConfig?.proxyUrl && typeof sessionConfig.proxyUrl === 'string') {
    const value = sessionConfig.proxyUrl.trim();
    if (value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function getCursorConfig() {
  return getSummaryConfig();
}

export function getSummaryConfig() {
  const config = loadConfig();
  return config?.aiSummaries || config?.cursor || {};
}

export function getSummaryProvider() {
  const summaryConfig = getSummaryConfig();
  const provider = summaryConfig?.provider;
  if (typeof provider === 'string' && provider.trim().length > 0) {
    return provider.trim();
  }
  if (summaryConfig?.apiBase?.includes('dashscope')) {
    return 'dashscope';
  }
  return 'dashscope';
}

export function getSummaryApiKey() {
  const summaryConfig = getSummaryConfig();
  const apiKey = summaryConfig?.apiKey;
  if (typeof apiKey !== 'string') {
    return null;
  }
  const trimmed = apiKey.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getSummaryApiBase() {
  const summaryConfig = getSummaryConfig();
  const base =
    typeof summaryConfig?.apiBase === 'string' && summaryConfig.apiBase.trim().length > 0
      ? summaryConfig.apiBase.trim()
      : 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation';
  return base.replace(/\/+$/, '');
}

export function getSummaryModel() {
  const summaryConfig = getSummaryConfig();
  if (typeof summaryConfig?.model === 'string' && summaryConfig.model.trim().length > 0) {
    return summaryConfig.model.trim();
  }

  const summariesConfig = summaryConfig?.summaries || {};
  if (typeof summariesConfig.model === 'string' && summariesConfig.model.trim().length > 0) {
    return summariesConfig.model.trim();
  }

  return 'qwen-max';
}

export function isSummariesEnabled() {
  const summaryConfig = getSummaryConfig();
  if (typeof summaryConfig.enabled === 'boolean') {
    return summaryConfig.enabled;
  }
  const summariesConfig = summaryConfig?.summaries || {};
  return Boolean(summariesConfig.enabled);
}

function resolveSummaryPromptPath() {
  if (cachedSummaryPromptPath) {
    return cachedSummaryPromptPath;
  }

  const overridePath = process.env[SUMMARY_PROMPT_ENV_KEY];
  if (overridePath) {
    cachedSummaryPromptPath = path.isAbsolute(overridePath)
      ? overridePath
      : path.resolve(process.cwd(), overridePath);
    return cachedSummaryPromptPath;
  }

  cachedSummaryPromptPath = DEFAULT_SUMMARY_PROMPT_PATH;
  return cachedSummaryPromptPath;
}

function readSummaryPromptFile(promptPath) {
  if (!fs.existsSync(promptPath)) {
    throw new Error(
      `Summary prompt file not found at ${promptPath}. ` +
        'Please create the file or set DAILYCHECK_SUMMARY_PROMPT_PATH to override.'
    );
  }

  const content = fs.readFileSync(promptPath, 'utf8');

  try {
    const data = JSON.parse(content);
    if (typeof data !== 'object' || data === null) {
      throw new Error('Prompt file must contain a JSON object');
    }
    return data;
  } catch (error) {
    throw new Error(`Failed to parse summary prompt JSON at ${promptPath}: ${error.message}`);
  }
}

export function loadSummaryPromptConfig() {
  if (!cachedSummaryPrompt) {
    const promptPath = resolveSummaryPromptPath();
    cachedSummaryPrompt = readSummaryPromptFile(promptPath);
  }

  return cachedSummaryPrompt;
}


