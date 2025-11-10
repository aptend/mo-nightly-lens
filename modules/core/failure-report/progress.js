const METHOD_NAMES = [
  'phaseStart',
  'phaseComplete',
  'phaseError',
  'jobStart',
  'jobComplete',
  'stepStart',
  'stepComplete',
  'stepLogFetchStart',
  'stepLogFetchComplete'
];

function safeInvoke(handler, payload) {
  if (typeof handler !== 'function') {
    return;
  }
  try {
    handler(payload);
  } catch {
    // Swallow handler errors to avoid breaking main flow.
  }
}

export function createProgressReporter(handlers = {}) {
  const reporter = {};

  for (const methodName of METHOD_NAMES) {
    reporter[methodName] = (payload) => safeInvoke(handlers[methodName], payload);
  }

  return reporter;
}

export const noopProgressReporter = createProgressReporter();


