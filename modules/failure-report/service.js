import { performance } from 'node:perf_hooks';

import { buildGrafanaUrl } from '../namespace/index.js';
import { extractErrorContexts } from '../logs/context-extractor.js';
import { createActionsClient } from '../github/actions-client.js';
import { createStepLogLoader } from './step-log-loader.js';
import { resolveNamespace } from './namespace-resolver.js';
import { noopProgressReporter } from './progress.js';
import { enrichReportWithAiSummaries } from './ai-summarizer.js';
import { generateFailureReport } from './core/index.js';

const DEFAULT_REPO = 'matrixorigin/mo-nightly-regression';

function wrapNamespaceResolver(baseResolver, getStepLog) {
  if (typeof baseResolver !== 'function') {
    return null;
  }

  return async (context) =>
    baseResolver({
      ...context,
      getStepLog
    });
}

export async function fetchFailureReport({
  repo = DEFAULT_REPO,
  runId,
  token,
  includeLogs = false,
  logOutputDir,
  progress
} = {}) {
  if (!runId) {
    throw new Error('runId is required.');
  }

  const client = createActionsClient({ repo, token });
  const getStepLog = createStepLogLoader({
    owner: client.owner,
    repo: client.repoName,
    runId
  });

  const timeProvider = {
    now: () => performance.now(),
    epochMs: () => Date.now()
  };

  const dependencies = {
    actionsClient: client,
    getStepLog: (jobId, stepNumber) => getStepLog(jobId, stepNumber),
    namespaceResolver: wrapNamespaceResolver(resolveNamespace, (jobId, stepNumber) =>
      getStepLog(jobId, stepNumber)
    ),
    grafanaUrlBuilder: (namespace, options) => buildGrafanaUrl(namespace, options),
    extractErrorContexts: (log, options) => extractErrorContexts(log, options),
    enrichReportWithAiSummaries: (report) => enrichReportWithAiSummaries(report),
    progressReporter: progress || noopProgressReporter,
    time: timeProvider
  };

  return generateFailureReport({
    repo: client.repo,
    runId,
    includeLogs,
    logOutputDir,
    dependencies
  });
}

