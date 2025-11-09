const DEFAULT_RETRIES = 3;
const RETRYABLE_ERRORS = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED']);

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isRetryable(error) {
  if (!error) return false;

  const code = error.code || error.errno;
  if (code && RETRYABLE_ERRORS.has(code)) {
    return true;
  }

  if (typeof error.message === 'string') {
    const normalized = error.message.toLowerCase();
    return (
      normalized.includes('econnreset') ||
      normalized.includes('timeout') ||
      normalized.includes('network error')
    );
  }

  return false;
}

export async function withRetry(fn, { retries = DEFAULT_RETRIES, delayMs = 1000 } = {}) {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > retries || !isRetryable(error)) {
        throw error;
      }

      await delay(delayMs * attempt);
    }
  }
}


