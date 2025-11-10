export const FAILURE_REPORT_PROGRESS_CHANNEL = 'failureReportProgress';

const DEFAULT_RUN_STATE = {
  status: 'idle',
  message: null,
  progress: undefined,
  error: undefined
};

export function buildProgressMessage(runId, payload) {
  return {
    action: FAILURE_REPORT_PROGRESS_CHANNEL,
    runId,
    payload
  };
}

export function isFailureReportProgressMessage(message) {
  return message?.action === FAILURE_REPORT_PROGRESS_CHANNEL;
}

export function getDefaultRunState() {
  return { ...DEFAULT_RUN_STATE };
}

export function mergeRunState(previous = DEFAULT_RUN_STATE, update = {}) {
  return {
    status: Object.prototype.hasOwnProperty.call(update, 'status')
      ? update.status
      : previous.status ?? DEFAULT_RUN_STATE.status,
    message: Object.prototype.hasOwnProperty.call(update, 'message')
      ? update.message
      : previous.message ?? DEFAULT_RUN_STATE.message,
    progress: Object.prototype.hasOwnProperty.call(update, 'progress')
      ? update.progress
      : previous.progress,
    error: Object.prototype.hasOwnProperty.call(update, 'error')
      ? update.error
      : previous.error
  };
}

function resolveLabel(payload) {
  return payload?.label || payload?.name || null;
}

export function deriveRunStateFromProgress(payload) {
  if (!payload) {
    return null;
  }

  const type = payload.type || 'status';
  const label =
    payload.label || payload.meta?.label || payload.meta?.name || resolveLabel(payload) || null;

  if (type === 'phaseError' || type === 'error') {
    const errorMessage = payload.error || label || 'Failed to generate failure report';
    return {
      status: 'error',
      message: errorMessage,
      error: errorMessage,
      progress: payload
    };
  }

  if (type === 'complete') {
    const summary = payload.reportSummary || {};
    const contextCount =
      typeof summary.errorContextCount === 'number' ? summary.errorContextCount : null;
    const summaryMessage =
      label ||
      (contextCount != null
        ? `Failure report ready (${contextCount} error contexts)`
        : 'Failure report available');
    return {
      status: 'ready',
      message: summaryMessage,
      progress: payload
    };
  }

  return {
    status: 'loading',
    message: label || 'Analyzing failure report...',
    progress: payload
  };
}

export function createProgressEventBridge({ emit }) {
  if (typeof emit !== 'function') {
    throw new Error('createProgressEventBridge requires an emit function.');
  }

  const send = (type, payload = {}) => {
    emit({
      type,
      ...payload
    });
  };

  return {
    phaseStart: (payload) => {
      send('phaseStart', {
        label: resolveLabel(payload) || 'Working...',
        meta: payload || null
      });
    },
    phaseComplete: (payload) => {
      send('phaseComplete', {
        label: resolveLabel(payload),
        meta: payload || null
      });
    },
    phaseError: (payload) => {
      send('phaseError', {
        error: payload?.error || 'Unknown error',
        label: resolveLabel(payload) || 'Phase failed',
        meta: payload || null
      });
    },
    jobStart: (payload) => {
      send('jobStart', {
        label: `Processing job: ${payload?.jobName || payload?.jobId || ''}`,
        meta: payload || null
      });
    },
    jobComplete: (payload) => {
      send('jobComplete', {
        label: `Completed job: ${payload?.jobName || payload?.jobId || ''}`,
        meta: payload || null
      });
    },
    stepStart: (payload) => {
      send('stepStart', {
        label: `Fetching step: ${payload?.stepName || `#${payload?.stepNumber ?? '?'}`}`,
        meta: payload || null
      });
    },
    stepComplete: (payload) => {
      send('stepComplete', {
        label: `Analyzed step: ${payload?.stepName || `#${payload?.stepNumber ?? '?'}`}`,
        meta: payload || null
      });
    },
    stepLogFetchStart: (payload) => {
      send('stepLogFetchStart', {
        label: `Downloading logs for ${
          payload?.stepName || `step ${payload?.stepNumber ?? '?'}`
        }`,
        meta: payload || null
      });
    },
    stepLogFetchComplete: (payload) => {
      send('stepLogFetchComplete', {
        label: `Downloaded logs for ${
          payload?.stepName || `step ${payload?.stepNumber ?? '?'}`
        }`,
        meta: payload || null
      });
    },
    status: (payload) => {
      send('status', payload || {});
    }
  };
}


