import { extractErrorContexts } from './modules/core/logs/context-extractor.js';
import { createFailureReportFetcher } from './modules/core/failure-report/create-failure-report-fetcher.js';
import { resolveNamespace } from './modules/core/failure-report/namespace-resolver.js';
import { enrichReportWithAiSummaries } from './modules/adapters/browser/failure-report/ai-summarizer.js';
import { buildGrafanaUrl } from './modules/namespace/index.js';
import { unzipToTextMap } from './modules/utils/zip.js';
import {
  FAILURE_REPORT_PROGRESS_CHANNEL,
  buildProgressMessage,
  createProgressEventBridge
} from './modules/core/runtime/progress-channel.js';
import { createActionsClient as createBrowserActionsClient } from './modules/adapters/browser/github/actions-client.js';

const DEFAULT_REPO = 'matrixorigin/mo-nightly-regression';
const OWNER = 'matrixorigin';
const REPO_NAME = DEFAULT_REPO.split('/')[1];
const API_ROOT = 'https://api.github.com';
const WEB_BASE = `https://github.com/${DEFAULT_REPO}`;

function normalize(value) {
  return (value || '').trim().toLowerCase();
}

const RAW_JOB_LOG_ENTRY = '__raw_job_log__.txt';

function decodeUtf8(uint8) {
  if (!uint8) {
    return '';
  }
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(uint8);
  } catch (error) {
    console.warn('[GitHub Actions Extension] Failed to decode job log response as UTF-8', error);
    return '';
  }
}

function slugifyForFilename(value, fallback) {
  const normalized = normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function buildStepFilename(index, name) {
  const slug = slugifyForFilename(name, `step-${index}`);
  return `${index}_${slug}.txt`;
}

function parsePlaintextJobLog(uint8) {
  const text = decodeUtf8(uint8);
  if (!text) {
    return { entries: [], rawText: '' };
  }

  const lines = text.split(/\r?\n/);
  const entries = [];

  let current = null;
  let stepIndex = 0;

  const matchStart = (line) => {
    const startPatterns = [
      /##\[(?:group|section)\]\s*(?:Starting:\s*)?Run\s+(.+)/i,
      /^::group::\s*(?:Run\s+)?(.+)/i
    ];
    for (const pattern of startPatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return null;
  };

  const isEnd = (line) => {
    return (
      /##\[(?:endgroup)\]/i.test(line) ||
      /##\[(?:section)\]\s*Finishing:/i.test(line) ||
      /^::endgroup::/i.test(line)
    );
  };

  const flush = () => {
    if (!current) {
      return;
    }
    const content = current.lines.join('\n').trim();
    if (content) {
      stepIndex += 1;
      const filename = buildStepFilename(stepIndex, current.name);
      entries.push({ name: filename, content });
    }
    current = null;
  };

  for (const line of lines) {
    const startName = matchStart(line);
    if (startName) {
      flush();
      current = { name: startName, lines: [] };
      continue;
    }
    if (current) {
      current.lines.push(line);
      if (isEnd(line)) {
        flush();
      }
    }
  }

  flush();

  return { entries, rawText: text };
}

function findStepContentInRawLog(rawText, { stepNumber, stepName }) {
  if (!rawText) {
    return null;
  }
  const { entries } = parsePlaintextJobLog(new TextEncoder().encode(rawText));
  if (!entries.length) {
    return null;
  }

  const normalizedTargetName = normalize(stepName).replace(/[^a-z0-9]+/g, '');
  const normalizedTargetIndex = Number.isFinite(stepNumber) ? stepNumber : null;

  const scored = entries.map((entry, index) => {
    const normalizedName = entry.name.toLowerCase();
    const sanitized = normalizedName.replace(/[^a-z0-9]+/g, '');
    let score = 0;
    const entryIndex = index + 1;
    if (normalizedTargetIndex === entryIndex) {
      score += 4;
    }
    if (normalizedTargetIndex != null && sanitized.includes(`step${normalizedTargetIndex}`)) {
      score += 2;
    }
    if (normalizedTargetName && sanitized.includes(normalizedTargetName)) {
      score += 3;
    }
    return { entry, score, entryIndex };
  });

  scored.sort((a, b) => b.score - a.score || a.entryIndex - b.entryIndex);

  if (scored[0] && scored[0].score > 0) {
    return scored[0].entry.content;
  }

  return null;
}

const connectionRegistry = new Map(); // tabId -> port

// Background service worker for GitHub Actions Extension
// Handles API requests and data processing

class BackgroundService {
  constructor() {
    this.githubToken = null;
    this.aiSummaryToken = null;
    this.jobCache = new Map();
    this.jobLogArchiveCache = new Map();
    this.runTabMap = new Map();
    this.actionsClient = null;
  }

  async init() {
    const result = await chrome.storage.local.get(['githubToken', 'aiSummaryApiKey']);
    this.githubToken = result.githubToken || null;
    this.aiSummaryToken = result.aiSummaryApiKey || null;
    this.refreshActionsClient();

    chrome.runtime.onConnect.addListener((port) => {
      if (!port || port.name !== FAILURE_REPORT_PROGRESS_CHANNEL) {
        return;
      }
      const tabId = port.sender?.tab?.id ?? null;
      const context = tabId != null ? 'tab' : 'extension';
      console.debug('[GitHub Actions Extension] Port connected', { tabId, context });

      if (tabId != null) {
        connectionRegistry.set(tabId, port);
      }
      port.onDisconnect.addListener(() => {
        if (tabId != null) {
          connectionRegistry.delete(tabId);
        }
        console.debug('[GitHub Actions Extension] Port disconnected', { tabId, context });
      });
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'fetchStepLogs': {
          const logText = await this.fetchStepLogs(
            request.runId,
            request.jobName,
            request.stepName
          );
          sendResponse({ logText });
          break;
        }

        case 'setGitHubToken': {
          await this.setGitHubToken(request.token);
          sendResponse({ success: true });
          break;
        }

        case 'setAiSummaryToken': {
          await this.setAiSummaryToken(request.token);
          sendResponse({ success: true });
          break;
        }

        case 'generateFailureReport': {
          const tabId = sender?.tab?.id ?? null;
          const report = await this.generateFailureReport(request.runId, { tabId });
          sendResponse({ success: true, report });
          break;
        }

        case 'getFailureReport': {
          const report = await this.getStoredFailureReport(request.runId);
          sendResponse({ success: true, report });
          break;
        }

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Background service error:', error);
      sendResponse({ error: error.message });
    }
  }

  refreshActionsClient() {
    this.actionsClient = createBrowserActionsClient({
      repo: DEFAULT_REPO,
      token: this.githubToken || undefined,
      apiBase: API_ROOT
    });
  }

  getActionsClient() {
    if (!this.actionsClient) {
      this.refreshActionsClient();
    }
    return this.actionsClient;
  }

  async fetchRun(runId) {
    if (!runId) {
      throw new Error('runId is required');
    }
    const client = this.getActionsClient();
    return await client.getRun(runId);
  }

  async fetchAllJobs(runId) {
    if (!runId) {
      throw new Error('runId is required');
    }
    const client = this.getActionsClient();
    return await client.listJobs(runId);
  }

  async fetchJobDetails(jobId) {
    if (!jobId) {
      throw new Error('jobId is required');
    }
    const client = this.getActionsClient();
    return await client.getJob(jobId);
  }

  async ensureJobWithSteps(jobOrId) {
    const jobId = typeof jobOrId === 'object' ? jobOrId?.id : jobOrId;
    if (!jobId) {
      throw new Error('jobId is required.');
    }
    const cached = this.jobCache.get(jobId);
    if (cached?.steps?.length) {
      return cached;
    }
    const baseJob = typeof jobOrId === 'object' && jobOrId ? jobOrId : null;
    const details = baseJob?.steps?.length ? baseJob : await this.fetchJobDetails(jobId);
    const withSteps = {
      ...(baseJob || {}),
      ...(details || {}),
      id: jobId,
      steps: Array.isArray(details?.steps) ? details.steps : []
    };
    this.jobCache.set(jobId, withSteps);
    return withSteps;
  }

  async fetchJobLogArchive(runId, jobId) {
    if (this.jobLogArchiveCache.has(jobId)) {
      return this.jobLogArchiveCache.get(jobId);
    }

    console.log('[GitHub Actions Extension] fetchJobLogArchive:start', { jobId });
    this.emitRunProgress(runId, {
      type: 'status',
      label: `Downloading job logs for job ${jobId}...`
    });

    if (!this.githubToken) {
      throw new Error('GitHub token is required to download job logs.');
    }

    const url = `https://api.github.com/repos/${OWNER}/${REPO_NAME}/actions/jobs/${jobId}/logs`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.githubToken}`,
        'User-Agent': 'daily-check-extension'
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to download job log archive (${response.status} ${response.statusText}): ${body || 'no response body'}`
      );
    }

    const buffer = await response.arrayBuffer();
    const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const isZip = uint8.length >= 2 && uint8[0] === 0x50 && uint8[1] === 0x4b;
    if (!isZip) {
      console.warn(
        '[GitHub Actions Extension] Job log archive returned as plaintext, applying fallback parser',
        { jobId }
      );
      const { entries, rawText } = parsePlaintextJobLog(uint8);
      const archive = new Map();
      if (rawText) {
        archive.set(RAW_JOB_LOG_ENTRY, rawText);
      }
      for (const entry of entries) {
        archive.set(entry.name, entry.content);
      }
      if (archive.size === 0) {
        let preview = '';
        try {
          preview = decodeUtf8(uint8.slice(0, 512));
        } catch (error) {
          preview = '[binary data]';
        }
        throw new Error(
          `GitHub returned a non-zip response when downloading job logs: ${preview || 'no preview available'}`
        );
      }
      this.jobLogArchiveCache.set(jobId, archive);
      console.log('[GitHub Actions Extension] fetchJobLogArchive:complete (plaintext)', {
        jobId,
        entryCount: archive.size
      });
      this.emitRunProgress(runId, {
        type: 'status',
        label: `Job logs downloaded (plaintext fallback, ${archive.size} sections)`
      });
      return archive;
    }
    const archive = unzipToTextMap(uint8);
    this.jobLogArchiveCache.set(jobId, archive);
    console.log('[GitHub Actions Extension] fetchJobLogArchive:complete', {
      jobId,
      entryCount: archive.size
    });
    this.emitRunProgress(runId, {
      type: 'status',
      label: `Job logs downloaded (${archive.size} files)`
    });
    return archive;
  }

  async getStepLogFromArchive({ runId, jobId, stepNumber, stepName }) {
    console.log('[GitHub Actions Extension] getStepLogFromArchive:start', {
      jobId,
      stepNumber,
      stepName
    });
    this.emitRunProgress(runId, {
      type: 'status',
      label: `Searching archive for step ${stepNumber}...`
    });
    const archive = await this.fetchJobLogArchive(runId, jobId);
    if (!archive || archive.size === 0) {
      throw new Error('Job log archive is empty.');
    }

    const normalizedStepName = (stepName || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

    const candidates = [];

    const matches = (entryName) => {
      const lowerName = entryName.toLowerCase();
      if (!lowerName.endsWith('.txt')) {
        return false;
      }

      const sanitized = lowerName.replace(/[^a-z0-9]+/g, '');
      if (sanitized.includes(`step${stepNumber}`)) {
        return true;
      }

      if (
        lowerName.startsWith(`${stepNumber}_`) ||
        lowerName.startsWith(`${stepNumber}-`) ||
        lowerName.startsWith(`${String(stepNumber).padStart(2, '0')}_`) ||
        lowerName.startsWith(`${String(stepNumber).padStart(2, '0')}-`)
      ) {
        return true;
      }

      if (normalizedStepName && sanitized.includes(normalizedStepName)) {
        return true;
      }

      return false;
    };

    for (const [name, content] of archive.entries()) {
      if (matches(name)) {
        candidates.push({ name, content });
      }
    }

    if (candidates.length === 0) {
      // As a fallback try any file containing the step number
      const numberToken = `_${stepNumber}_`;
      for (const [name, content] of archive.entries()) {
        const lower = name.toLowerCase();
        if (!lower.endsWith('.txt')) {
          continue;
        }
        if (lower.includes(numberToken)) {
          candidates.push({ name, content });
        }
      }
    }

    if (candidates.length === 0) {
      const rawText = archive.get(RAW_JOB_LOG_ENTRY) || null;
      if (typeof rawText === 'string' && rawText.length > 0) {
        const fallbackContent = findStepContentInRawLog(rawText, { stepNumber, stepName });
        if (fallbackContent) {
          console.warn(
            '[GitHub Actions Extension] Step log resolved via plaintext fallback parser',
            {
              jobId,
              stepNumber,
              stepName
            }
          );
          this.emitRunProgress(runId, {
            type: 'status',
            label: `Archive matched via plaintext fallback for step ${stepNumber}`
          });
          return fallbackContent;
        }
      }

      const available = Array.from(archive.keys());
      console.warn('[GitHub Actions Extension] Step log not found in archive', {
        jobId,
        stepNumber,
        stepName,
        availableFiles: available
      });
      this.emitRunProgress(runId, {
        type: 'phaseError',
        error: `Step ${stepNumber} log not found in archive`,
        meta: { availableFiles: available }
      });
      return null;
    }

    candidates.sort((a, b) => a.name.length - b.name.length);
    console.log('[GitHub Actions Extension] getStepLogFromArchive:match', {
      jobId,
      stepNumber,
      stepName,
      chosen: candidates[0].name
    });
    this.emitRunProgress(runId, {
      type: 'status',
      label: `Archive matched: ${candidates[0].name}`
    });
    return candidates[0].content;
  }

  async fetchStepLog({ runId, jobId, stepNumber }) {
    if (!runId || !jobId || typeof stepNumber !== 'number') {
      throw new Error('runId, jobId, and stepNumber are required to fetch step logs.');
    }

    const job = await this.ensureJobWithSteps(jobId);
    const step = job.steps?.find((candidate) => candidate.number === stepNumber) || null;
    const stepName = step?.name || null;

    this.emitRunProgress(runId, {
      type: 'status',
      label: `Preparing logs for step ${stepNumber}${stepName ? ` (${stepName})` : ''}...`
    });

    const archiveLog = await this.getStepLogFromArchive({
      runId,
      jobId,
      stepNumber,
      stepName
    });
    if (!archiveLog) {
      throw new Error('Step log not found in job log archive.');
    }
    this.emitRunProgress(runId, {
      type: 'status',
      label: `Archive log ready for step ${stepNumber}`
    });
    return {
      log: archiveLog,
      logUrl: null
    };
  }

  async getStoredFailureReport(runId) {
    if (!runId) {
      throw new Error('runId is required');
    }
    const key = `failureReport_${runId}`;
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
  }

  emitProgress(tabId, runId, payload) {
    const message = buildProgressMessage(runId, payload);

    if (tabId != null) {
      console.debug('[GitHub Actions Extension] Emitting progress (tab)', tabId, runId, payload);
    } else {
      console.debug('[GitHub Actions Extension] Emitting progress (broadcast)', runId, payload);
    }

    const send = () => {
      if (tabId != null) {
        const port = connectionRegistry.get(tabId);
        if (port) {
          try {
            port.postMessage(message);
          } catch (error) {
            console.warn('[GitHub Actions Extension] Failed to post progress message via port:', error);
          }
        }
      }

      chrome.runtime.sendMessage(message, () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.debug(
            '[GitHub Actions Extension] Broadcast progress error:',
            lastError.message
          );
        }
      });
    };

    console.debug('[GitHub Actions Extension] emitProgress dispatching', {
      runId,
      tabId,
      payload
    });
    send();
  }

  createProgressReporter(runId, tabId) {
    if (tabId != null) {
      this.runTabMap.set(runId, tabId);
    }
    const emit = (progressPayload) => {
      this.emitProgress(tabId, runId, progressPayload);
    };

    return createProgressEventBridge({
      emit
    });
  }

  emitRunProgress(runId, payload = {}) {
    if (!runId) {
      return;
    }
    const tabId = this.runTabMap.get(runId) ?? null;
    this.emitProgress(tabId, runId, payload);
  }

  async generateFailureReport(runId, { tabId } = {}) {
    if (!runId) {
      throw new Error('runId is required.');
    }
    if (!this.githubToken) {
      throw new Error('GitHub token is not configured. Please save a token in the popup.');
    }

    this.jobCache.clear();
    this.jobLogArchiveCache.clear();
    console.log(
      '[GitHub Actions Extension] Generating failure report',
      runId,
      tabId != null ? `(tab ${tabId})` : ''
    );

    const fetchFailureReport = createFailureReportFetcher({
      defaultRepo: DEFAULT_REPO,
      actionsClientFactory: () => this.getActionsClient(),
      stepLogLoaderFactory: ({ runId: currentRunId }) => async (jobId, stepNumber) =>
        this.fetchStepLog({
          runId: currentRunId,
          jobId,
          stepNumber
        }),
      namespaceResolverFactory: ({ getStepLog }) =>
        typeof resolveNamespace === 'function'
          ? (resolverContext) =>
              resolveNamespace({
                ...resolverContext,
                getStepLog
              })
          : null,
      grafanaUrlBuilder: (namespace, options) => buildGrafanaUrl(namespace, options),
      extractErrorContexts: (log, options) => extractErrorContexts(log, options),
      enrichReportWithAiSummaries: (value) =>
        enrichReportWithAiSummaries(value, {
          logger: console,
          overrides: {
            apiKey: this.aiSummaryToken ?? undefined,
            enabled: this.aiSummaryToken ? true : undefined
          }
        }),
      timeProviderFactory: () => ({
        now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
        epochMs: () => Date.now()
      })
    });

    const progressReporter = this.createProgressReporter(runId, tabId);

    this.emitProgress(tabId, runId, {
      type: 'status',
      label: 'Starting analysis...'
    });

    let report;
    try {
      report = await fetchFailureReport({
        repo: DEFAULT_REPO,
        runId,
        includeLogs: false,
        includeTimings: false,
        progressReporter
      });
    } catch (error) {
      console.error('[GitHub Actions Extension] Failure report generation failed:', error);
      this.emitProgress(tabId, runId, {
        type: 'error',
        error: error?.message || String(error)
      });
      this.runTabMap.delete(runId);
      throw error;
    }
    console.log('[GitHub Actions Extension] Generating failure report complete', {
      runId,
      failingJobs: report?.summary?.failingJobs,
      errorContexts: report?.summary?.errorContextCount
    });

    report.generatedAt = new Date().toISOString();

    await chrome.storage.local.set({
      [`failureReport_${runId}`]: report
    });

    this.emitProgress(tabId, runId, {
      type: 'complete',
      label: 'Failure report generated',
      reportSummary: {
        failingJobs: report.summary?.failingJobs ?? 0,
        errorContextCount: report.summary?.errorContextCount ?? 0
      }
    });

    this.runTabMap.delete(runId);

    return report;
  }

  async fetchStepLogs(runId, jobName, stepName) {
    try {
      const jobs = await this.fetchAllJobs(runId);

      if (!jobs || jobs.length === 0) {
        throw new Error('No jobs found for this workflow run');
      }

      let targetJob =
        jobs.find((job) => job.name?.includes('SETUP MO TEST ENV')) || null;

      if (!targetJob && jobName) {
        const normalizedName = normalize(jobName);
        targetJob =
          jobs.find(
            (job) =>
              normalize(job.name) === normalizedName ||
              normalize(job.name).includes(normalizedName)
          ) || null;
      }

      if (!targetJob) {
        console.log('Available jobs:', jobs.map((j) => j.name));
        throw new Error(`Target job "${jobName}" not found`);
      }

      const jobWithSteps = await this.ensureJobWithSteps(targetJob);
      const steps = Array.isArray(jobWithSteps.steps) ? jobWithSteps.steps : [];

      let targetStep =
        steps.find((step) => step.name === stepName) ||
        steps.find((step) => normalize(step.name).includes(normalize(stepName))) ||
        null;

      if (!targetStep) {
        throw new Error(`Step "${stepName}" not found in job "${jobWithSteps.name}".`);
      }

      const { log } = await this.fetchStepLog({
        runId,
        jobId: jobWithSteps.id,
        stepNumber: targetStep.number
      });

      return log;
    } catch (error) {
      console.error('Error fetching step logs:', error);
      throw error;
    }
  }

  async setGitHubToken(token) {
    const value = typeof token === 'string' ? token.trim() : '';
    if (!value) {
      throw new Error('GitHub token is required.');
    }
    this.githubToken = value;
    this.refreshActionsClient();
    await chrome.storage.local.set({ githubToken: value });
  }

  async setAiSummaryToken(token) {
    const value = typeof token === 'string' ? token.trim() : '';
    if (!value) {
      throw new Error('AI summary token is required.');
    }
    this.aiSummaryToken = value;
    await chrome.storage.local.set({ aiSummaryApiKey: value });
  }
}

// Initialize background service
const backgroundService = new BackgroundService();
backgroundService.init();

