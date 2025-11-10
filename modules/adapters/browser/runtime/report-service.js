export function requestFailureReport(runId) {
  if (!runId || !chrome?.runtime?.sendMessage) {
    return Promise.reject(new Error('Extension messaging unavailable'));
  }
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'generateFailureReport', runId }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message || 'Extension messaging failed'));
        return;
      }
      if (!response) {
        reject(new Error('Empty response from background'));
        return;
      }
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response.report);
    });
  });
}

export function fetchStepLog({ runId, jobName, stepName }) {
  if (!runId || !chrome?.runtime?.sendMessage) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action: 'fetchStepLogs',
        runId,
        jobName,
        stepName
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          resolve('');
          return;
        }
        resolve(response?.logText || '');
      }
    );
  });
}
