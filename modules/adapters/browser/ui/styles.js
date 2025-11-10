const STYLE_ELEMENT_ID = 'daily-check-content-styles';
const FALLBACK_CSS = `
  .dc-run-controls { margin-top: 8px; font-size: 12px; }
  .dc-action-button { padding: 4px 10px; }
`;

let cssLoadPromise = null;

function loadFailureReportCss() {
  if (cssLoadPromise) {
    return cssLoadPromise;
  }

  if (typeof chrome?.runtime?.getURL !== 'function') {
    cssLoadPromise = Promise.resolve(null);
    return cssLoadPromise;
  }

  const cssUrl = chrome.runtime.getURL('styles/failure-report.css');
  cssLoadPromise = fetch(cssUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load CSS from ${cssUrl}`);
      }
      return response.text();
    })
    .catch((error) => {
      console.warn('[GitHub Actions Extension] Failed to fetch failure report CSS', error);
      return null;
    });

  return cssLoadPromise;
}

export function ensureFailureReportStyles() {
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }

  const styleEl = document.createElement('style');
  styleEl.id = STYLE_ELEMENT_ID;
  styleEl.textContent = FALLBACK_CSS;
  document.head.appendChild(styleEl);

  loadFailureReportCss().then((cssText) => {
    if (!cssText) {
      return;
    }
    const target = document.getElementById(STYLE_ELEMENT_ID);
    if (target) {
      target.textContent = cssText;
    }
  });
}
