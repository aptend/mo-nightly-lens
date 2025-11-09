import { extractErrorContexts } from './modules/logs/context-extractor.js';
import { generateFailureReport as generateFailureReportCore } from './modules/failure-report/core/index.js';
import { resolveNamespace } from './modules/failure-report/namespace-resolver.js';
import { enrichReportWithAiSummaries } from './modules/failure-report/ai-summarizer-browser.js';
import { buildGrafanaUrl } from './modules/namespace/index.js';
import { unzipToTextMap } from './modules/utils/zip.js';

const DEFAULT_REPO = 'matrixorigin/mo-nightly-regression';
const OWNER = 'matrixorigin';
const REPO_NAME = DEFAULT_REPO.split('/')[1];
const API_BASE = `https://api.github.com/repos/${DEFAULT_REPO}`;
const WEB_BASE = `https://github.com/${DEFAULT_REPO}`;

function normalize(value) {
  return (value || '').trim().toLowerCase();
}

const connectionRegistry = new Map(); // tabId -> port

// Background service worker for GitHub Actions Extension
// Handles API requests and data processing

class BackgroundService {
  constructor() {
    this.githubToken = null;
    this.aiSummaryToken = null;
    this.jobStepCache = new Map();
    this.jobLogArchiveCache = new Map();
    this.runTabMap = new Map();
  }

  async init() {
    const result = await chrome.storage.local.get(['githubToken', 'aiSummaryApiKey']);
    this.githubToken = result.githubToken || null;
    this.aiSummaryToken = result.aiSummaryApiKey || null;

    chrome.runtime.onConnect.addListener((port) => {
      if (!port || port.name !== 'failureReportProgress') {
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

  buildApiHeaders(extra = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra
    };
    if (this.githubToken) {
      headers.Authorization = `token ${this.githubToken}`;
    }
    return headers;
  }

  async apiRequest(pathOrUrl, { method = 'GET', headers = {}, body } = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
    const requestInit = {
      method,
      headers: this.buildApiHeaders(headers)
    };
    if (body != null) {
      requestInit.body = typeof body === 'string' ? body : JSON.stringify(body);
      if (!requestInit.headers['Content-Type']) {
        requestInit.headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, requestInit);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API request failed (${response.status}): ${text || response.statusText}`);
    }
    if (response.status === 204) {
      return null;
    }
    return await response.json();
  }

  async fetchRun(runId) {
    if (!runId) {
      throw new Error('runId is required');
    }
    return await this.apiRequest(`/actions/runs/${runId}`);
  }

  async fetchAllJobs(runId) {
    if (!runId) {
      throw new Error('runId is required');
    }
    const jobs = [];
    let page = 1;
    while (true) {
      const data = await this.apiRequest(
        `/actions/runs/${runId}/jobs?per_page=100&page=${page}`
      );
      const batch = Array.isArray(data?.jobs) ? data.jobs : [];
      jobs.push(...batch);
      if (batch.length < 100) {
        break;
      }
      page += 1;
    }
    return jobs;
  }

  async fetchJobDetails(jobId) {
    if (!jobId) {
      throw new Error('jobId is required');
    }
    return await this.apiRequest(`/actions/jobs/${jobId}`);
  }

  async ensureJobWithSteps(job) {
    if (job?.steps && Array.isArray(job.steps) && job.steps.length > 0) {
      return job;
    }
    const details = await this.fetchJobDetails(job.id);
    return {
      ...job,
      ...details,
      steps: Array.isArray(details?.steps) ? details.steps : []
    };
  }

  buildPageHeaders(extra = {}) {
    return {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ...extra
    };
  }

  async loadJobStepMetadata(runId, jobId) {
    const cacheKey = `${runId}:${jobId}`;
    if (this.jobStepCache.has(cacheKey)) {
      return this.jobStepCache.get(cacheKey);
    }

    console.log('[GitHub Actions Extension] loadJobStepMetadata:start', { runId, jobId });
    const url = `${WEB_BASE}/actions/runs/${runId}/job/${jobId}?check_suite_focus=true`;
    const response = await fetch(url, {
      headers: this.buildPageHeaders(),
      credentials: 'include'
    });
    if (!response.ok) {
      throw new Error(`Failed to load job page (${response.status})`);
    }
    const html = await response.text();

    const metadata = new Map();
    const stepRegex = /<check-step\b[^>]*>/gi;
    let match;
    while ((match = stepRegex.exec(html)) !== null) {
      const tag = match[0];
      const getAttr = (name) => {
        const attrRegex = new RegExp(`${name}="([^"]*)"`, 'i');
        const attrMatch = attrRegex.exec(tag);
        return attrMatch ? attrMatch[1] : null;
      };

      const numberValue = Number(getAttr('data-number'));
      if (Number.isNaN(numberValue)) {
        continue;
      }

      const rawLogUrl = getAttr('data-log-url');
      let logUrl = null;
      if (rawLogUrl) {
        try {
          logUrl = new URL(rawLogUrl, WEB_BASE).toString();
        } catch (error) {
          console.warn(
            '[GitHub Actions Extension] Unable to resolve step log URL',
            rawLogUrl,
            error
          );
        }
      }

      metadata.set(numberValue, {
        logUrl,
        name: getAttr('data-name'),
        conclusion: getAttr('data-conclusion')
      });
    }

    this.jobStepCache.set(cacheKey, metadata);
    console.log('[GitHub Actions Extension] loadJobStepMetadata:complete', {
      runId,
      jobId,
      stepCount: metadata.size
    });
    return metadata;
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
      let preview = '';
      try {
        preview = new TextDecoder('utf-8', { fatal: false }).decode(uint8.slice(0, 512));
      } catch (error) {
        preview = '[binary data]';
      }
      throw new Error(
        `GitHub returned a non-zip response when downloading job logs: ${preview || 'no preview available'}`
      );
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
      const available = Array.from(archive.keys());
      console.warn(
        '[GitHub Actions Extension] Step log not found in archive',
        {
          jobId,
          stepNumber,
          stepName,
          availableFiles: available
        }
      );
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

    console.log('[GitHub Actions Extension] fetchStepLog:start', {
      runId,
      jobId,
      stepNumber
    });
    this.emitRunProgress(runId, {
      type: 'status',
      label: `Preparing logs for step ${stepNumber}...`
    });
    const metadata = await this.loadJobStepMetadata(runId, jobId);
    const stepMeta = metadata.get(stepNumber);

    const attemptArchiveFallback = async () => {
      console.log('[GitHub Actions Extension] fetchStepLog:archiveFallback', {
        runId,
        jobId,
        stepNumber,
        stepName: stepMeta?.name || null
      });
      this.emitRunProgress(runId, {
        type: 'status',
        label: `Using archive logs for step ${stepNumber}...`
      });
      const archiveLog = await this.getStepLogFromArchive({
        runId,
        jobId,
        stepNumber,
        stepName: stepMeta?.name || null
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
        logUrl: stepMeta?.logUrl || null
      };
    };

    if (!stepMeta?.logUrl) {
      return attemptArchiveFallback();
    }

    console.log('[GitHub Actions Extension] fetchStepLog:httpAttempt', {
      runId,
      jobId,
      stepNumber,
      url: stepMeta.logUrl
    });
    try {
      const response = await fetch(stepMeta.logUrl, {
        headers: {
          Accept: 'text/plain, text/*;q=0.9, */*;q=0.8',
          ...(this.githubToken ? { Authorization: `token ${this.githubToken}` } : {})
        },
        credentials: 'same-origin',
        mode: 'cors'
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Failed to download step log (${response.status} ${response.statusText}): ${body || 'no response body'}`
        );
      }

      const log = await response.text();
      console.log('[GitHub Actions Extension] fetchStepLog:httpSuccess', {
        runId,
        jobId,
        stepNumber,
        url: stepMeta.logUrl,
        size: log.length
      });
      return {
        log,
        logUrl: stepMeta.logUrl
      };
    } catch (error) {
      console.warn(
        '[GitHub Actions Extension] Direct step log fetch failed, using archive fallback',
        {
          jobId,
          stepNumber,
          stepName: stepMeta?.name || null,
          error: error?.message || String(error)
        }
      );
      this.emitRunProgress(runId, {
        type: 'status',
        label: `Direct fetch failed for step ${stepNumber}. Trying archive...`,
        meta: { error: error?.message || String(error) }
      });
      return attemptArchiveFallback();
    }
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
    const message = {
      action: 'failureReportProgress',
      runId,
      payload
    };

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
    const emit = (type, payload = {}) => {
      this.emitProgress(tabId, runId, {
        type,
        ...payload
      });
    };

    return {
      phaseStart: (payload) => {
        emit('phaseStart', {
          label: payload?.label || payload?.name || 'Working...',
          meta: payload || null
        });
      },
      phaseComplete: (payload) => {
        emit('phaseComplete', {
          label: payload?.label || payload?.name || null,
          meta: payload || null
        });
      },
      phaseError: (payload) => {
        emit('phaseError', {
          error: payload?.error || 'Unknown error',
          label: payload?.label || payload?.name || 'Phase failed',
          meta: payload || null
        });
      },
      jobStart: (payload) => {
        emit('jobStart', {
          label: `Processing job: ${payload?.jobName || payload?.jobId || ''}`,
          meta: payload || null
        });
      },
      jobComplete: (payload) => {
        emit('jobComplete', {
          label: `Completed job: ${payload?.jobName || payload?.jobId || ''}`,
          meta: payload || null
        });
      },
      stepStart: (payload) => {
        emit('stepStart', {
          label: `Fetching step: ${payload?.stepName || `#${payload?.stepNumber ?? '?'}`}`,
          meta: payload || null
        });
      },
      stepComplete: (payload) => {
        emit('stepComplete', {
          label: `Analyzed step: ${payload?.stepName || `#${payload?.stepNumber ?? '?'}`}`,
          meta: payload || null
        });
      },
      stepLogFetchStart: (payload) => {
        emit('stepLogFetchStart', {
          label: `Downloading logs for ${payload?.stepName || `step ${payload?.stepNumber ?? '?'}`}`,
          meta: payload || null
        });
      },
      stepLogFetchComplete: (payload) => {
        emit('stepLogFetchComplete', {
          label: `Downloaded logs for ${payload?.stepName || `step ${payload?.stepNumber ?? '?'}`}`,
          meta: payload || null
        });
      },
      status: (payload) => {
        emit('status', payload || {});
      }
    };
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

    this.jobStepCache.clear();
    this.jobLogArchiveCache.clear();
    console.log(
      '[GitHub Actions Extension] Generating failure report',
      runId,
      tabId != null ? `(tab ${tabId})` : ''
    );

    const actionsClient = {
      repo: DEFAULT_REPO,
      owner: OWNER,
      repoName: REPO_NAME,
      getRun: (id) => this.fetchRun(id),
      listJobs: (id) => this.fetchAllJobs(id),
      getJob: (id) => this.fetchJobDetails(id)
    };

    const getStepLog = async (jobId, stepNumber) => {
      const result = await this.fetchStepLog({
        runId,
        jobId,
        stepNumber
      });
      return result;
    };

    const namespaceResolver =
      typeof resolveNamespace === 'function'
        ? (context) =>
            resolveNamespace({
              ...context,
              getStepLog
            })
        : null;

    const timeProvider = {
      now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      epochMs: () => Date.now()
    };

    const progressReporter = this.createProgressReporter(runId, tabId);

    this.emitProgress(tabId, runId, {
      type: 'status',
      label: 'Starting analysis...'
    });

    let report;
    try {
      report = await generateFailureReportCore({
        repo: DEFAULT_REPO,
        runId,
        includeLogs: false,
        includeTimings: false,
        dependencies: {
          actionsClient,
          getStepLog,
          namespaceResolver,
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
          time: timeProvider,
          progressReporter
        }
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

