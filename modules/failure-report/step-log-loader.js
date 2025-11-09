import { withRetry } from '../utils/retry.js';

let cachedFetcher = null;

async function loadFetcher() {
  if (!cachedFetcher) {
    const moduleUrl = new URL('../logs/step-log-client.js', import.meta.url);
    const module = await import(moduleUrl.href);
    cachedFetcher = module.fetchStepLog;
  }

  return cachedFetcher;
}

export function createStepLogLoader({
  owner,
  repo,
  runId,
  onFetchStart,
  onFetchComplete
}) {
  if (!owner || !repo || !runId) {
    throw new Error('owner, repo, and runId are required to create a step log loader.');
  }

  const cache = new Map();

  const hasPerformance =
    typeof globalThis !== 'undefined' && globalThis.performance && globalThis.performance.now;
  const now = () => (hasPerformance ? globalThis.performance.now() : Date.now());

  return async function getStepLog(jobId, stepNumber) {
    if (!jobId || typeof stepNumber !== 'number') {
      throw new Error('jobId and stepNumber are required to fetch step logs.');
    }

    const cacheKey = `${jobId}:${stepNumber}`;
    if (cache.has(cacheKey)) {
      const cachedResult = cache.get(cacheKey);
      if (onFetchComplete) {
        const timestamp = performance.now();
        onFetchComplete({
          jobId,
          stepNumber,
          startedAt: timestamp,
          endedAt: timestamp,
          durationMs: 0,
          fromCache: true
        });
      }
      return cachedResult;
    }

    const fetchStepLog = await loadFetcher();
    const startedAt = now();

    if (onFetchStart) {
      onFetchStart({
        jobId,
        stepNumber,
        startedAt
      });
    }

    let result;
    let error;
    try {
      result = await withRetry(
        () =>
          fetchStepLog({
            owner,
            repo,
            runId,
            jobId,
            stepNumber
          }),
        { delayMs: 1500 }
      );

      cache.set(cacheKey, result);
      return result;
    } catch (err) {
      error = err;
      throw err;
    } finally {
      const endedAt = now();

      if (onFetchComplete) {
        onFetchComplete({
          jobId,
          stepNumber,
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          fromCache: false,
          error: error ? error.message : undefined
        });
      }
    }
  };
}


