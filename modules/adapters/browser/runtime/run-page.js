import { waitForCondition } from './dom-utils.js';
import {
  waitForTargetJob,
  expandJob,
  waitForTargetStep
} from './job-step-locator.js';
import { extractLogsFromDom } from './log-extractor.js';
import { fetchStepLog } from './report-service.js';
import { saveNamespace } from './storage.js';

const JOB_NAME = 'SETUP MO TEST ENV';
const STEP_NAME = 'Clean TKE ENV';

function extractNamespaceFromText(text) {
  if (!text) {
    return null;
  }
  const match = text.match(/No\s+resources\s+found\s+in\s+([a-z0-9-]+)\s+namespace/i);
  return match ? match[1] : null;
}

function getRunIdFromUrl(url = window.location.href) {
  const match = url.match(/\/actions\/runs\/(\d+)/);
  return match ? match[1] : null;
}

export function createRunPageController({ namespaceExtractor }) {
  async function extractNamespace(stepElement, runId) {
    const domLogs = await extractLogsFromDom(stepElement, { timeout: 5000 });
    const apiLogs = domLogs || (await fetchStepLog({ runId, jobName: JOB_NAME, stepName: STEP_NAME }));
    if (!apiLogs) {
      return null;
    }
    if (namespaceExtractor?.extract) {
      return namespaceExtractor.extract(apiLogs);
    }
    return extractNamespaceFromText(apiLogs);
  }

  async function handleRunPage() {
    const runId = getRunIdFromUrl();
    if (!runId) {
      return;
    }

    await waitForCondition(() => document.readyState === 'complete' || document.readyState === 'interactive', {
      timeout: 8000,
      interval: 150
    });

    const jobElement = await waitForTargetJob({ timeout: 8000 });
    if (!jobElement) {
      return;
    }
    await expandJob(jobElement);

    const stepElement = await waitForTargetStep(jobElement, { timeout: 5000 });
    if (!stepElement) {
      return;
    }

    const namespace = await extractNamespace(stepElement, runId);
    if (!namespace) {
      return;
    }

    await saveNamespace(runId, namespace);
  }

  return {
    init: handleRunPage
  };
}
