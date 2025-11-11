import { extractErrorContexts } from '../logs/context-extractor.js';
import { generateFailureReport as generateFailureReportCore } from '../failure-report/core/index.js';
import { resolveNamespace } from '../failure-report/namespace-resolver.js';
import { enrichReportWithAiSummaries } from '../failure-report/ai-summarizer-browser.js';
import { buildGrafanaUrl } from '../namespace/index.js';

function normalize(value) {
  return (value || '').trim().toLowerCase();
}

/**
 * 报告生成器
 * 负责生成失败报告
 */
export class ReportGenerator {
  constructor(tokenManager, apiClient, logFetcher, progressEmitter, defaultRepo, owner, repoName) {
    this.tokenManager = tokenManager;
    this.apiClient = apiClient;
    this.logFetcher = logFetcher;
    this.progressEmitter = progressEmitter;
    this.defaultRepo = defaultRepo;
    this.owner = owner;
    this.repoName = repoName;
  }

  async getStoredFailureReport(runId) {
    if (!runId) {
      throw new Error('runId is required');
    }
    const key = `failureReport_${runId}`;
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
  }

  async generateFailureReport(runId, { tabId } = {}) {
    if (!runId) {
      throw new Error('runId is required.');
    }
    if (!this.tokenManager.getGitHubToken()) {
      throw new Error('GitHub token is not configured. Please save a token in the popup.');
    }

    this.logFetcher.clearCache();
    console.log(
      '[GitHub Actions Extension] Generating failure report',
      runId,
      tabId != null ? `(tab ${tabId})` : ''
    );

    const actionsClient = {
      repo: this.defaultRepo,
      owner: this.owner,
      repoName: this.repoName,
      getRun: (id) => this.apiClient.fetchRun(id),
      listJobs: (id) => this.apiClient.fetchAllJobs(id),
      getJob: (id) => this.apiClient.fetchJobDetails(id)
    };

    const getStepLog = async (jobId, stepNumber) => {
      const result = await this.logFetcher.fetchStepLog({
        runId,
        jobId,
        stepNumber
      }, (payload) => {
        this.progressEmitter.emitRunProgress(runId, payload);
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

    const progressReporter = this.progressEmitter.createProgressReporter(runId, tabId);

    this.progressEmitter.emitProgress(tabId, runId, {
      type: 'status',
      label: 'Starting analysis...'
    });

    let report;
    try {
      report = await generateFailureReportCore({
        repo: this.defaultRepo,
        runId,
        includeLogs: false,
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
                apiKey: this.tokenManager.getAiSummaryToken() ?? undefined,
                enabled: this.tokenManager.getAiSummaryToken() ? true : undefined
              }
            }),
          time: timeProvider,
          progressReporter
        }
      });
    } catch (error) {
      console.error('[GitHub Actions Extension] Failure report generation failed:', error);
      this.progressEmitter.emitProgress(tabId, runId, {
        type: 'error',
        error: error?.message || String(error)
      });
      this.progressEmitter.clearRunMapping(runId);
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

    this.progressEmitter.emitProgress(tabId, runId, {
      type: 'complete',
      label: 'Failure report generated',
      reportSummary: {
        failingJobs: report.summary?.failingJobs ?? 0,
        errorContextCount: report.summary?.errorContextCount ?? 0
      }
    });

    this.progressEmitter.clearRunMapping(runId);

    return report;
  }

  async fetchStepLogs(runId, jobName, stepName) {
    try {
      const jobs = await this.apiClient.fetchAllJobs(runId);

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

      const jobWithSteps = await this.apiClient.ensureJobWithSteps(targetJob);
      const steps = Array.isArray(jobWithSteps.steps) ? jobWithSteps.steps : [];

      let targetStep =
        steps.find((step) => step.name === stepName) ||
        steps.find((step) => normalize(step.name).includes(normalize(stepName))) ||
        null;

      if (!targetStep) {
        throw new Error(`Step "${stepName}" not found in job "${jobWithSteps.name}".`);
      }

      const { log } = await this.logFetcher.fetchStepLog({
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
}

