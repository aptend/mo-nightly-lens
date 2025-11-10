import { performance } from 'node:perf_hooks';

import { createFailureReportFetcher } from '../../../core/failure-report/create-failure-report-fetcher.js';
import { createActionsClient } from '../github/actions-client.js';
import { createStepLogLoader } from '../../../core/failure-report/step-log-loader.js';
import { resolveNamespace } from '../../../core/failure-report/namespace-resolver.js';
import { buildGrafanaUrl } from '../../../namespace/index.js';
import { extractErrorContexts } from '../../../core/logs/context-extractor.js';
import { enrichReportWithAiSummaries } from './ai-summarizer.js';

const DEFAULT_REPO = 'matrixorigin/mo-nightly-regression';

function wrapNamespaceResolver(baseResolver, getStepLog) {
  if (typeof baseResolver !== 'function') {
    return null;
  }

  return (context) =>
    baseResolver({
      ...context,
      getStepLog
    });
}

export const fetchFailureReport = createFailureReportFetcher({
  defaultRepo: DEFAULT_REPO,
  actionsClientFactory: ({ repo, token }) => createActionsClient({ repo, token }),
  stepLogLoaderFactory: ({ actionsClient, runId }) =>
    createStepLogLoader({
      owner: actionsClient.owner,
      repo: actionsClient.repoName,
      runId
    }),
  namespaceResolverFactory: ({ getStepLog }) => wrapNamespaceResolver(resolveNamespace, getStepLog),
  grafanaUrlBuilder: (namespace, options) => buildGrafanaUrl(namespace, options),
  extractErrorContexts: (log, options) => extractErrorContexts(log, options),
  enrichReportWithAiSummaries: (report) => enrichReportWithAiSummaries(report),
  timeProviderFactory: () => ({
    now: () => performance.now(),
    epochMs: () => Date.now()
  })
});

export { DEFAULT_REPO };


