import { waitForCondition } from './dom-utils.js';
import { expandStep } from './job-step-locator.js';

const LOG_NODE_SELECTORS = [
  '.log-line',
  '.ansi',
  'pre code',
  'code[data-testid="log-line"]',
  '[data-testid="log-line"]',
  '.blob-code-inner',
  '.blob-code'
];

function collectLogText(root) {
  if (!root) {
    return '';
  }
  const fragments = [];
  LOG_NODE_SELECTORS.forEach((selector) => {
    root.querySelectorAll(selector).forEach((node) => {
      const text = node.textContent || '';
      if (text.trim()) {
        fragments.push(text.trim());
      }
    });
  });
  return fragments.join('\n');
}

export async function extractLogsFromDom(stepElement, { timeout = 4000 } = {}) {
  if (!stepElement) {
    return '';
  }

  let text = collectLogText(stepElement);
  if (text) {
    return text;
  }

  await expandStep(stepElement);

  text = await waitForCondition(() => {
    const value = collectLogText(stepElement);
    return value || null;
  }, { timeout });

  return text || '';
}
