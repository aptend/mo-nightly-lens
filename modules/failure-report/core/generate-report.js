import { filterFailingJobs, filterFailingSteps } from '../job-utils.js';
import { noopProgressReporter } from '../progress.js';

function debugLog(...args) {
  if (typeof console !== 'undefined' && console.log) {
    console.log('[FailureReportCore]', ...args);
  }
}

function resolveTimeProvider(time) {
  if (time && typeof time.now === 'function' && typeof time.epochMs === 'function') {
    return time;
  }

  const hasPerformance = typeof globalThis !== 'undefined' && globalThis.performance;
  return {
    now: () => (hasPerformance ? globalThis.performance.now() : Date.now()),
    epochMs: () => Date.now()
  };
}

function toNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

function safeProgress(reporter, method, payload) {
  const handler = reporter && typeof reporter[method] === 'function' ? reporter[method] : null;
  if (!handler) {
    return;
  }
  try {
    handler(payload);
  } catch {
    // Swallow handler errors to avoid breaking main flow.
  }
}

function applyGrafanaContext(contexts, namespace, grafanaUrlBuilder) {
  const buildGrafanaUrl =
    typeof grafanaUrlBuilder === 'function'
      ? grafanaUrlBuilder
      : () => null;

  const defaultUrl = namespace ? buildGrafanaUrl(namespace) : null;

  return (contexts || []).map((ctx) => {
    if (!namespace) {
      return {
        ...ctx,
        grafanaUrl: defaultUrl
      };
    }

    const start = toNumber(ctx.startTimestamp);
    const end = toNumber(ctx.endTimestamp);
    if (start == null || end == null) {
      return {
        ...ctx,
        grafanaUrl: defaultUrl
      };
    }

    const range = {
      from: Math.min(start, end),
      to: Math.max(start, end)
    };

    return {
      ...ctx,
      grafanaUrl: buildGrafanaUrl(namespace, { range }) || defaultUrl
    };
  });
}

function formatStep({
  job,
  jobHtmlUrl,
  step,
  stepResult,
  contexts,
  includeLogs,
  runId,
  logOutputDir,
  actionsClient
}) {
  const ensureStepUrl = () => {
    if (!jobHtmlUrl) {
      const owner = actionsClient?.owner;
      const repoName = actionsClient?.repoName;
      if (owner && repoName) {
        const base = `https://github.com/${owner}/${repoName}/actions/runs/${runId}/job/${job.id}`;
        return `${base}?check_suite_focus=true#step:${step.number}:1`;
      }
      return null;
    }
    const hasQuery = jobHtmlUrl.includes('?');
    const hasFocusParam = /[?&]check_suite_focus=true\b/.test(jobHtmlUrl);
    let base = jobHtmlUrl;
    if (!hasFocusParam) {
      base = `${jobHtmlUrl}${hasQuery ? '&' : '?'}check_suite_focus=true`;
    }
    return `${base}#step:${step.number}:1`;
  };

  const stepInfo = {
    number: step.number,
    name: step.name,
    status: step.status,
    conclusion: step.conclusion,
    startedAt: step.started_at || null,
    completedAt: step.completed_at || null,
    logUrl: stepResult.logUrl || null,
    errorContexts: contexts
  };

  if (Array.isArray(contexts) && contexts.length > 0) {
    const stepUrl = ensureStepUrl();
    if (stepUrl) {
      stepInfo.stepUrl = stepUrl;
    }
  }

  if (includeLogs && logOutputDir) {
    stepInfo.rawLog = stepResult.log;
    stepInfo.logFile = `run-${runId}/job-${job.id}/step-${step.number}.log`;
  }

  return stepInfo;
}

function formatJobDetails({ job, details, steps, jobHtmlUrl, actionsClient, runId }) {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: details.started_at || job.started_at || null,
    completedAt: details.completed_at || job.completed_at || null,
    htmlUrl:
      jobHtmlUrl ||
      job.html_url ||
      details.html_url ||
      (actionsClient?.owner && actionsClient?.repoName
        ? `https://github.com/${actionsClient.owner}/${actionsClient.repoName}/actions/runs/${runId}/job/${job.id}`
        : null),
    steps
  };
}

export async function generateFailureReport({
  repo,
  runId,
  includeLogs = false,
  includeTimings = false,
  logOutputDir,
  dependencies = {}
} = {}) {
  if (!runId) {
    throw new Error('runId is required.');
  }

  const {
    actionsClient,
    getStepLog,
    namespaceResolver,
    grafanaUrlBuilder,
    extractErrorContexts,
    enrichReportWithAiSummaries,
    progressReporter = noopProgressReporter,
    time
  } = dependencies;

  if (!actionsClient) {
    throw new Error('actionsClient dependency is required.');
  }
  if (typeof getStepLog !== 'function') {
    throw new Error('getStepLog dependency must be a function.');
  }
  if (typeof extractErrorContexts !== 'function') {
    throw new Error('extractErrorContexts dependency must be a function.');
  }

  debugLog('generate:start', { repo, runId, includeLogs, includeTimings });

  const timeProvider = resolveTimeProvider(time);
  const runStartedAt = timeProvider.now();

  const timings = includeTimings
    ? {
        startedAtEpochMs: timeProvider.epochMs(),
        phases: [],
        jobPhases: [],
        stepTimings: [],
        stepLogDownloads: [],
        contextExtraction: []
      }
    : null;

  const toRelativeMs = (timestamp) => {
    const value = toNumber(timestamp);
    if (value == null) {
      return null;
    }
    return Number((value - runStartedAt).toFixed(3));
  };

  const toDurationMs = (duration) => {
    const value = toNumber(duration);
    if (value == null) {
      return null;
    }
    return Number(value.toFixed(3));
  };

  const measure = async ({
    collectionName,
    name,
    fn,
    meta,
    progressEvent
  }) => {
    debugLog('measure:start', name, { runId, collectionName });
    const start = timeProvider.now();
    let result;
    let error;
    const progressPayload =
      progressEvent || (name ? { name, label: name } : null);

    if (progressPayload) {
      safeProgress(progressReporter, 'phaseStart', progressPayload);
    }

    try {
      result = await fn();
      debugLog('measure:success', name, { runId, collectionName });
      return result;
    } catch (err) {
      error = err;
      debugLog('measure:error', name, {
        runId,
        collectionName,
        error: err?.message || String(err)
      });
      throw err;
    } finally {
      const end = timeProvider.now();
      if (timings && collectionName && timings[collectionName]) {
        const metaValue = typeof meta === 'function' ? meta(result, error) : meta;
        timings[collectionName].push({
          name,
          startedAtMs: toRelativeMs(start),
          endedAtMs: toRelativeMs(end),
          durationMs: toDurationMs(end - start),
          ...(metaValue || {}),
          ...(error ? { error: error.message || String(error) } : {})
        });
      }

      if (progressPayload) {
        const metaValue = typeof meta === 'function' ? meta(result, error) : meta;
        const payload = {
          ...progressPayload,
          durationMs: toDurationMs(end - start),
          meta: metaValue || {}
        };
        if (error) {
          safeProgress(progressReporter, 'phaseError', {
            ...payload,
            error: error.message || String(error)
          });
        } else {
          safeProgress(progressReporter, 'phaseComplete', payload);
        }
      }
    }
  };

  const {
    getRun,
    listJobs,
    getJob,
    owner,
    repoName
  } = actionsClient;

  const resolvedRepo = actionsClient.repo || repo;

  const run = await measure({
    collectionName: 'phases',
    name: 'actions.getRun',
    fn: () => getRun(runId),
    meta: (result) => ({
      runId,
      conclusion: result?.conclusion || null,
      summary: `conclusion: ${result?.conclusion || 'unknown'}`
    }),
    progressEvent: {
      name: 'actions.getRun',
      label: 'Fetching workflow run'
    }
  });

  const jobs = await measure({
    collectionName: 'phases',
    name: 'actions.listJobs',
    fn: () => listJobs(runId),
    meta: (result) => ({
      runId,
      jobCount: Array.isArray(result) ? result.length : 0,
      summary: `${Array.isArray(result) ? result.length : 0} jobs`
    }),
    progressEvent: {
      name: 'actions.listJobs',
      label: 'Listing workflow jobs'
    }
  });

  const namespaceInfo =
    namespaceResolver
      ? await measure({
          collectionName: 'phases',
          name: 'resolveNamespace',
          fn: () =>
            namespaceResolver({
              jobs,
              fetchJobDetails: getJob,
              getStepLog,
              runId,
              repo: resolvedRepo
            }),
          meta: (result) => ({
            namespaceResolved: Boolean(result?.namespace),
            grafanaUrlResolved: Boolean(result?.grafanaUrl),
            summary: result?.namespace
              ? `namespace: ${result.namespace}`
              : 'namespace unavailable'
          }),
          progressEvent: {
            name: 'resolveNamespace',
            label: 'Resolving namespace'
          }
        })
      : null;

  const namespace = namespaceInfo?.namespace || null;
  const defaultGrafanaUrl =
    namespaceInfo?.grafanaUrl ||
    (namespace && typeof grafanaUrlBuilder === 'function'
      ? grafanaUrlBuilder(namespace)
      : null);

  const failingJobs = filterFailingJobs(jobs);
  const detailedJobs = [];
  debugLog('jobs:evaluated', {
    runId,
    jobCount: Array.isArray(jobs) ? jobs.length : null,
    failingJobs: failingJobs.length
  });

  for (const job of failingJobs) {
    debugLog('job:start', {
      runId,
      jobId: job.id,
      jobName: job.name
    });
    const details = await measure({
      collectionName: 'jobPhases',
      name: 'actions.getJob',
      fn: () => getJob(job.id),
      meta: () => ({
        jobId: job.id,
        jobName: job.name
      }),
      progressEvent: {
        name: `actions.getJob:${job.id}`,
        label: `Fetching job details for "${job.name}"`
      }
    });

    const failingSteps = filterFailingSteps(details.steps);
    if (failingSteps.length === 0) {
      continue;
    }

    const jobHtmlUrl =
      details.html_url ||
      job.html_url ||
      (owner && repoName
        ? `https://github.com/${owner}/${repoName}/actions/runs/${runId}/job/${job.id}`
        : null);

    safeProgress(progressReporter, 'jobStart', {
      jobId: job.id,
      jobName: job.name,
      failingStepCount: failingSteps.length
    });

    const jobProcessingStart = timeProvider.now();

    const steps = [];

    for (const step of failingSteps) {
      const stepProcessingStart = timeProvider.now();
      const stepMetadata = {
        jobId: job.id,
        jobName: job.name,
        stepNumber: step.number,
        stepName: step.name
      };

      debugLog('step:start', {
        runId,
        jobId: job.id,
        jobName: job.name,
        stepNumber: step.number,
        stepName: step.name
      });

      safeProgress(progressReporter, 'stepStart', stepMetadata);
      safeProgress(progressReporter, 'stepLogFetchStart', stepMetadata);

      const stepLogStart = timeProvider.now();
      let stepResult;
      let stepLogError;
      try {
        stepResult = await getStepLog(job.id, step.number);
      } catch (err) {
        stepLogError = err;
        throw err;
      } finally {
        const stepLogEnd = timeProvider.now();
        if (timings) {
          timings.stepLogDownloads.push({
            name: 'stepLog.fetch',
            jobId: job.id,
            jobName: job.name,
            stepNumber: step.number,
            stepName: step.name,
            fromCache: false,
            startedAtMs: toRelativeMs(stepLogStart),
            endedAtMs: toRelativeMs(stepLogEnd),
            durationMs: toDurationMs(stepLogEnd - stepLogStart),
            ...(stepLogError
              ? { error: stepLogError.message || String(stepLogError) }
              : {})
          });
        }

        safeProgress(progressReporter, 'stepLogFetchComplete', {
          ...stepMetadata,
          durationMs: toDurationMs(stepLogEnd - stepLogStart),
          error: stepLogError ? stepLogError.message || String(stepLogError) : undefined
        });
      }

      const extractedContexts = await measure({
        collectionName: 'contextExtraction',
        name: 'logs.extractErrorContexts',
        fn: async () =>
          extractErrorContexts(stepResult.log, {
            stepName: step.name,
            jobName: job.name,
            enableFinalErrorFallback: true
          }),
        meta: (result) => ({
          jobId: job.id,
          jobName: job.name,
          stepNumber: step.number,
          stepName: step.name,
          contextCount: Array.isArray(result) ? result.length : 0
        })
      });

      const contextsWithGrafana = applyGrafanaContext(
        extractedContexts,
        namespace,
        grafanaUrlBuilder
      );

      const stepProcessingEnd = timeProvider.now();
      if (timings) {
        timings.stepTimings.push({
          name: 'step.process',
          jobId: job.id,
          jobName: job.name,
          stepNumber: step.number,
          stepName: step.name,
          startedAtMs: toRelativeMs(stepProcessingStart),
          endedAtMs: toRelativeMs(stepProcessingEnd),
          durationMs: toDurationMs(stepProcessingEnd - stepProcessingStart)
        });
      }

          const stepInfo = formatStep({
            job,
            jobHtmlUrl,
            step,
            stepResult,
            contexts: contextsWithGrafana,
            includeLogs,
            runId,
            logOutputDir,
            actionsClient
          });

      safeProgress(progressReporter, 'stepComplete', {
        ...stepMetadata,
        durationMs: toDurationMs(stepProcessingEnd - stepProcessingStart),
        contextCount: extractedContexts?.length ?? 0
      });

      steps.push(stepInfo);

      debugLog('step:complete', {
        runId,
        jobId: job.id,
        jobName: job.name,
        stepNumber: step.number,
        stepName: step.name,
        contextCount: extractedContexts?.length ?? 0
      });
    }

    const jobProcessingEnd = timeProvider.now();
    if (timings) {
      timings.jobPhases.push({
        name: 'job.processFailingSteps',
        jobId: job.id,
        jobName: job.name,
        failingStepCount: failingSteps.length,
        startedAtMs: toRelativeMs(jobProcessingStart),
        endedAtMs: toRelativeMs(jobProcessingEnd),
        durationMs: toDurationMs(jobProcessingEnd - jobProcessingStart)
      });
    }

    safeProgress(progressReporter, 'jobComplete', {
      jobId: job.id,
      jobName: job.name,
      durationMs: toDurationMs(jobProcessingEnd - jobProcessingStart),
      stepCount: steps.length
    });

    debugLog('job:complete', {
      runId,
      jobId: job.id,
      jobName: job.name,
      processedSteps: steps.length
    });

    detailedJobs.push(
      formatJobDetails({
        job,
        details,
        steps,
        jobHtmlUrl,
        actionsClient,
        runId
      })
    );
  }

  const summary = {
    totalJobs: Array.isArray(jobs) ? jobs.length : 0,
    failingJobs: detailedJobs.length,
    errorContextCount: detailedJobs.reduce((count, jobDetails) => {
      const stepCount = jobDetails.steps.reduce(
        (stepAccum, stepDetails) =>
          stepAccum + (stepDetails.errorContexts?.length || 0),
        0
      );
      return count + stepCount;
    }, 0)
  };

  const result = {
    repo: resolvedRepo || repo,
    run: {
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      event: run.event,
      headBranch: run.head_branch,
      headSha: run.head_sha,
      actor: run.actor?.login || null,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      runAttempt: run.run_attempt || 1,
      htmlUrl: run.html_url
    },
    summary,
    namespace,
    grafanaUrl: defaultGrafanaUrl,
    jobs: detailedJobs
  };

  if (includeTimings && timings) {
    timings.totalDurationMs = toDurationMs(timeProvider.now() - runStartedAt);
    result.timings = timings;
  }

  debugLog('generate:resultReady', {
    runId,
    summary: result.summary
  });

  if (typeof enrichReportWithAiSummaries === 'function') {
    debugLog('ai:enrich:start', { runId });
    const enriched = await enrichReportWithAiSummaries(result);
    debugLog('ai:enrich:complete', {
      runId,
      status: enriched?.aiSummary?.status || enriched?.aiSummary?.status || 'unknown'
    });
    return enriched || result;
  }

  debugLog('generate:complete', {
    runId,
    failingJobs: result.summary?.failingJobs,
    errorContexts: result.summary?.errorContextCount
  });

  return result;
}

