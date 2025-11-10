const NAMESPACE_PREFIX = 'namespace_';
const REPORT_PREFIX = 'failureReport_';

export function saveNamespace(runId, namespace) {
  if (!runId || !namespace || !chrome?.storage?.local) {
    return Promise.resolve();
  }
  const payload = {
    [`${NAMESPACE_PREFIX}${runId}`]: {
      runId,
      namespace,
      timestamp: Date.now()
    }
  };
  return new Promise((resolve) => {
    chrome.storage.local.set(payload, () => resolve());
  });
}

export function loadStoredState() {
  if (!chrome?.storage?.local) {
    return Promise.resolve({ namespaces: {}, reports: {} });
  }
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items = {}) => {
      const namespaces = {};
      const reports = {};
      Object.entries(items).forEach(([key, value]) => {
        if (key.startsWith(NAMESPACE_PREFIX)) {
          namespaces[key.slice(NAMESPACE_PREFIX.length)] = value;
        } else if (key.startsWith(REPORT_PREFIX)) {
          reports[key.slice(REPORT_PREFIX.length)] = value;
        }
      });
      resolve({ namespaces, reports });
    });
  });
}
