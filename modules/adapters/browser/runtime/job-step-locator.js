import { delay, ensureDetailsExpanded, findElementByText, waitForCondition, clickIfPresent } from './dom-utils.js';

const JOB_SELECTORS = [
  '[data-testid="workflow-job"]',
  '[data-testid="workflow-job-name"]',
  '.workflow-job',
  '.workflow-job summary',
  '.TimelineItem',
  '.TimelineItem summary',
  'details[data-testid="workflow-job"]',
  'details.workflow-job'
];

const STEP_SELECTORS = [
  '[data-testid="workflow-step"]',
  '[data-testid="workflow-step-name"]',
  '.workflow-step',
  '.workflow-step summary',
  '.TimelineItem-body',
  'details[data-testid="workflow-step"]'
];

const JOB_PATTERNS = [/setup\s+mo\s+test\s+env/i, /branch\s+nightly/i];
const STEP_PATTERNS = [/clean\s+tke\s+env/i, /clean\s+tke/i];

function matches(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function getJobContainer(element) {
  return (
    element.closest('[data-testid="workflow-job"]') ||
    element.closest('.TimelineItem') ||
    element.closest('details') ||
    element
  );
}

function getStepContainer(element) {
  return (
    element.closest('[data-testid="workflow-step"]') ||
    element.closest('.workflow-step') ||
    element.closest('details') ||
    element
  );
}

export function findTargetJob(root = document) {
  return findElementByText(JOB_SELECTORS, (text) => matches(JOB_PATTERNS, text), {
    root,
    mapToContainer: getJobContainer
  });
}

export function findTargetStep(jobElement) {
  if (!jobElement) {
    return null;
  }
  return findElementByText(STEP_SELECTORS, (text) => matches(STEP_PATTERNS, text), {
    root: jobElement,
    mapToContainer: getStepContainer
  });
}

export async function waitForTargetJob({ timeout } = {}) {
  return waitForCondition(() => findTargetJob(), { timeout });
}

export async function waitForTargetStep(jobElement, { timeout } = {}) {
  return waitForCondition(() => findTargetStep(jobElement), { timeout });
}

export async function expandJob(jobElement) {
  if (!jobElement) {
    return false;
  }
  const expandedViaDetails = await ensureDetailsExpanded(jobElement);
  if (expandedViaDetails) {
    return true;
  }
  const expandedViaButton = await clickIfPresent(jobElement, 'button[aria-expanded="false"], summary');
  if (!expandedViaButton) {
    return false;
  }
  await delay(240);
  return true;
}

export async function expandStep(stepElement) {
  if (!stepElement) {
    return false;
  }
  const expandedViaDetails = await ensureDetailsExpanded(stepElement);
  if (expandedViaDetails) {
    return true;
  }
  const expandedViaButton = await clickIfPresent(stepElement, 'button[aria-expanded="false"], summary');
  if (!expandedViaButton) {
    return false;
  }
  await delay(240);
  return true;
}
