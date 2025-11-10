const DEFAULT_TIMEOUT = 8000;
const DEFAULT_INTERVAL = 120;

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForCondition(check, { timeout = DEFAULT_TIMEOUT, interval = DEFAULT_INTERVAL } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await Promise.resolve().then(check);
    if (result) {
      return result;
    }
    if (Date.now() - start > timeout) {
      return null;
    }
    await delay(interval);
  }
}

export function findElementByText(selectors, predicate, { root = document, mapToContainer } = {}) {
  for (const selector of selectors) {
    const candidates = root.querySelectorAll(selector);
    for (const element of candidates) {
      const text = element.textContent?.trim();
      if (!text) {
        continue;
      }
      if (predicate(text, element)) {
        if (typeof mapToContainer === 'function') {
          const container = mapToContainer(element);
          if (container) {
            return container;
          }
        }
        return element;
      }
    }
  }
  return null;
}

export async function ensureDetailsExpanded(element) {
  if (!element) {
    return false;
  }

  const detailsEl = element.matches('details') ? element : element.closest('details');
  if (!detailsEl) {
    return false;
  }

  if (!detailsEl.open) {
    detailsEl.open = true;
    const summary = detailsEl.querySelector(':scope > summary');
    if (summary) {
      summary.setAttribute('aria-expanded', 'true');
    }
    await delay(160);
    return true;
  }
  return false;
}

export async function clickIfPresent(element, selector) {
  if (!element) {
    return false;
  }
  const target = element.matches(selector) ? element : element.querySelector(selector);
  if (target) {
    target.click();
    await delay(160);
    return true;
  }
  return false;
}

export function ensureChild(parent, selector, factory) {
  if (!parent) {
    return null;
  }
  const existing = parent.querySelector(selector);
  if (existing) {
    return existing;
  }
  if (typeof factory === 'function') {
    return factory(parent) || null;
  }
  return null;
}

export function setElementText(element, text = '') {
  if (element) {
    // eslint-disable-next-line no-param-reassign
    element.textContent = text;
  }
}

export function toggleHidden(element, hidden) {
  if (!element) {
    return;
  }
  const isHidden = Boolean(hidden);
  element.hidden = isHidden;
  element.setAttribute('aria-hidden', isHidden ? 'true' : 'false');
}

export function observeMutations(target, callback, options) {
  if (!target || typeof callback !== 'function') {
    return () => {};
  }
  const observer = new MutationObserver(callback);
  observer.observe(target, options);
  return () => observer.disconnect();
}
