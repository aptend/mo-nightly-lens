export function createRunStateStore({
  mergeRunState,
  getDefaultRunState,
  deriveRunStateFromProgress,
  isProgressMessage,
  channelName
}) {
  const runStates = new Map();
  const failureReports = new Map();
  const timelineOpen = new Set();
  const listeners = new Set();

  function ensureState(runId) {
    if (!runStates.has(runId)) {
      runStates.set(runId, getDefaultRunState());
    }
    return runStates.get(runId);
  }

  function setRunState(runId, partialState) {
    const previous = ensureState(runId);
    const next = mergeRunState(previous, partialState || {});
    runStates.set(runId, next);
    listeners.forEach((listener) => listener(runId, next));
    return next;
  }

  function getRunState(runId) {
    if (runStates.has(runId)) {
      return runStates.get(runId);
    }
    if (failureReports.has(runId)) {
      return setRunState(runId, { status: 'ready' });
    }
    return ensureState(runId);
  }

  function setFailureReport(runId, report) {
    if (!runId) {
      return;
    }
    if (report) {
      failureReports.set(runId, report);
      setRunState(runId, { status: 'ready' });
    } else {
      failureReports.delete(runId);
    }
  }

  function getFailureReport(runId) {
    return failureReports.get(runId) || null;
  }

  function syncFailureReports(reportMap = {}) {
    Object.entries(reportMap).forEach(([runId, report]) => {
      setFailureReport(runId, report);
    });
  }

  function isTimelineOpen(runId) {
    return timelineOpen.has(runId);
  }

  function toggleTimeline(runId) {
    if (timelineOpen.has(runId)) {
      timelineOpen.delete(runId);
    } else {
      timelineOpen.add(runId);
    }
    const state = ensureState(runId);
    listeners.forEach((listener) => listener(runId, state));
  }

  function openTimeline(runId) {
    timelineOpen.add(runId);
    const state = ensureState(runId);
    listeners.forEach((listener) => listener(runId, state));
  }

  function closeTimeline(runId) {
    timelineOpen.delete(runId);
    const state = ensureState(runId);
    listeners.forEach((listener) => listener(runId, state));
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function handleProgressMessage(message) {
    if (!message || (typeof isProgressMessage === 'function' && !isProgressMessage(message))) {
      return;
    }
    const { runId, payload } = message;
    if (!runId || !payload) {
      return;
    }
    const nextState = deriveRunStateFromProgress(payload);
    if (nextState) {
      setRunState(runId, nextState);
    }
  }

  function registerProgressChannel() {
    if (!chrome?.runtime) {
      return () => {};
    }

    let port = null;

    const onMessage = (message) => handleProgressMessage(message);

    const connectPort = () => {
      try {
        if (!chrome.runtime.connect) {
          return;
        }
        port = chrome.runtime.connect({ name: channelName });
        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(() => {
          port = null;
        });
      } catch (error) {
        console.warn('[BrowserRuntime] Failed to connect progress channel', error);
      }
    };

    connectPort();

    const messageListener = (message) => onMessage(message);
    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      if (port) {
        try {
          port.onMessage.removeListener(onMessage);
          port.disconnect();
        } catch (_) {
          // ignore
        }
      }
    };
  }

  return {
    getRunState,
    setRunState,
    setFailureReport,
    getFailureReport,
    syncFailureReports,
    isTimelineOpen,
    toggleTimeline,
    openTimeline,
    closeTimeline,
    subscribe,
    registerProgressChannel
  };
}
