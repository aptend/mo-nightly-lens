import { createContextIssueBuilder } from '../../../core/issues/context-issue-builder.js';

const DEFAULT_TEMPLATE_PATH = 'config/bug-report.md';

let templateCache = null;
let templatePromise = null;

const FALLBACK_TEMPLATE = `
### Is there an existing issue for the same bug?

- [x] I have checked the existing issues.

### Branch Name

main

### Commit ID

<commit-id>

### Other Environment Information

TKE Daily

### Actual Behavior

<error-context-snippet>

### Expected Behavior

No Error

### Steps to Reproduce

<step-url>

### Additional information

<additional-information>
`.trim();

function resolveExtensionUrl(pathname) {
  if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
    return chrome.runtime.getURL(pathname.replace(/^\/+/, ''));
  }
  return pathname;
}

async function loadTemplate(templatePath) {
  if (templateCache) {
    return templateCache;
  }
  if (!templatePromise) {
    const url = resolveExtensionUrl(templatePath || DEFAULT_TEMPLATE_PATH);
    templatePromise = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load template (${response.status} ${response.statusText})`);
        }
        return response.text();
      })
      .catch((error) => {
        console.warn('[context-issue-builder] Falling back to default template:', error);
        return FALLBACK_TEMPLATE;
      });
  }
  templateCache = await templatePromise;
  return templateCache;
}

const builder = createContextIssueBuilder({
  loadTemplate,
  resolveTemplatePath: (templatePath) => templatePath || DEFAULT_TEMPLATE_PATH,
  logger: console
});

export const { listContextOptions, buildIssuePayload } = builder;


