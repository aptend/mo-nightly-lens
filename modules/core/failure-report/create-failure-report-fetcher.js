import { generateFailureReport } from './index.js';
import { noopProgressReporter } from './progress.js';

function createDefaultTimeProvider() {
  const hasPerformance =
    typeof globalThis !== 'undefined' &&
    globalThis.performance &&
    typeof globalThis.performance.now === 'function';

  return {
    now: () => (hasPerformance ? globalThis.performance.now() : Date.now()),
    epochMs: () => Date.now()
  };
}

export function createFailureReportFetcher({
  defaultRepo,
  actionsClientFactory,
  stepLogLoaderFactory,
  namespaceResolverFactory,
  grafanaUrlBuilder,
  extractErrorContexts,
  enrichReportWithAiSummaries,
  timeProviderFactory
}) {
  if (typeof actionsClientFactory !== 'function') {
    throw new Error('createFailureReportFetcher requires an actionsClientFactory function.');
  }
  if (typeof stepLogLoaderFactory !== 'function') {
    throw new Error('createFailureReportFetcher requires a stepLogLoaderFactory function.');
  }
  if (typeof extractErrorContexts !== 'function') {
    throw new Error('createFailureReportFetcher requires an extractErrorContexts function.');
  }

  return async function fetchFailureReport({
    repo = defaultRepo,
    runId,
    token,
    includeLogs = false,
    includeTimings = false,
    logOutputDir,
    progressReporter
  } = {}) {
    if (!runId) {
      throw new Error('runId is required.');
    }

    const actionsClient = await actionsClientFactory({
      repo,
      token,
      includeLogs,
      includeTimings,
      logOutputDir,
      progressReporter
    });

    if (!actionsClient || typeof actionsClient !== 'object') {
      throw new Error('actionsClientFactory must return an actions client object.');
    }

    const getStepLog = await stepLogLoaderFactory({
      repo: actionsClient.repo || repo,
      owner: actionsClient.owner,
      runId,
      includeLogs,
      includeTimings,
      logOutputDir,
      progressReporter,
      actionsClient
    });

    if (typeof getStepLog !== 'function') {
      throw new Error('stepLogLoaderFactory must return a getStepLog function.');
    }

    const namespaceResolver =
      typeof namespaceResolverFactory === 'function'
        ? await namespaceResolverFactory({
            repo: actionsClient.repo || repo,
            runId,
            getStepLog,
            includeLogs,
            includeTimings,
            logOutputDir,
            progressReporter,
            actionsClient
          })
        : null;

    const dependencies = {
      actionsClient,
      getStepLog,
      namespaceResolver,
      grafanaUrlBuilder:
        typeof grafanaUrlBuilder === 'function'
          ? (namespace, options) => grafanaUrlBuilder(namespace, options)
          : undefined,
      extractErrorContexts: (log, options) => extractErrorContexts(log, options),
      enrichReportWithAiSummaries:
        typeof enrichReportWithAiSummaries === 'function'
          ? (value) => enrichReportWithAiSummaries(value)
          : undefined,
      progressReporter: progressReporter || noopProgressReporter,
      time:
        typeof timeProviderFactory === 'function' ? timeProviderFactory() : createDefaultTimeProvider()
    };

    return generateFailureReport({
      repo: actionsClient.repo || repo,
      runId,
      includeLogs,
      includeTimings,
      logOutputDir,
      dependencies
    });
  };
}


