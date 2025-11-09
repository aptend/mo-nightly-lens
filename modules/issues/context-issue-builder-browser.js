const DEFAULT_LABELS = ['kind/bug', 'needs-triage'];
const DEFAULT_ASSIGNEES = ['matrix-meow'];
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

function sanitizeSnippet(snippet) {
  if (!snippet || typeof snippet !== 'string') {
    return '';
  }
  return snippet.trim().slice(0, 4000);
}

function enumerateErrorContexts(report) {
  const entries = [];
  if (!Array.isArray(report?.jobs)) {
    return entries;
  }

  for (const job of report.jobs) {
    if (!job || !Array.isArray(job.steps)) continue;
    for (const step of job.steps) {
      if (!step || !Array.isArray(step.errorContexts)) continue;

      step.errorContexts.forEach((context, index) => {
        const contextId =
          context?.aiSummary?.contextId ||
          context?.cursorSummary?.contextId ||
          context?.contextId ||
          `job-${job?.id ?? 'unknown'}-step-${step?.number ?? index}-context-${index}`;

        entries.push({
          job,
          step,
          context,
          contextId
        });
      });
    }
  }

  return entries;
}

function pickContext(report, contextId) {
  const entries = enumerateErrorContexts(report);
  if (contextId) {
    const found = entries.find((entry) => entry.contextId === contextId);
    if (!found) {
      throw new Error(`Could not find errorContext with id "${contextId}".`);
    }
    return found;
  }

  if (entries.length === 0) {
    throw new Error('No errorContext entries found in report.');
  }
  if (entries.length > 1) {
    throw new Error('Multiple error contexts found; please specify contextId.');
  }
  return entries[0];
}

function extractCommitId(report) {
  const namespace = report?.namespace;
  if (typeof namespace === 'string') {
    const match = namespace.match(/commit-([0-9a-fA-F]+)/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return report?.run?.headSha || '';
}

function resolveStepUrl({ job, step }) {
  const jobUrl = job?.htmlUrl || job?.html_url || null;
  if (!jobUrl) return null;
  const hasQuery = jobUrl.includes('?');
  const focusParam = /[?&]check_suite_focus=true\b/.test(jobUrl);
  let base = jobUrl;
  if (!focusParam) {
    base = `${jobUrl}${hasQuery ? '&' : '?'}check_suite_focus=true`;
  }
  return `${base}#step:${step?.number ?? 0}:1`;
}

function buildIssueTitle({ step, context }) {
  const shortTitle =
    context?.aiSummary?.shortIssueTitle ||
    context?.cursorSummary?.shortIssueTitle;
  if (typeof shortTitle === 'string' && shortTitle.trim().length > 0) {
    return `[Bug]: ${shortTitle.trim()}`;
  }
  const stepName = step?.name || 'Unknown Step';
  return `[Bug]: [Nightly Regression] ${stepName} failure`;
}

async function buildIssueBody({ report, job, step, context, templatePath }) {
  const template = await loadTemplate(templatePath);
  const stepUrl =
    step?.stepUrl ||
    resolveStepUrl({ job, step }) ||
    'N/A';
  const logUrl = step?.logUrl || context?.logUrl || '';
  const grafanaUrl = context?.grafanaUrl || report?.grafanaUrl || '';
  const commitId = extractCommitId(report) || '<commit-id>';
  const aiSummary = context?.aiSummary?.summary || context?.cursorSummary?.summary || '';

  const replacements = {
    '<commit-id>': commitId,
    '<error-context-snippet>': `\`\`\`text\n${sanitizeSnippet(context?.snippet) || '（上下文为空）'}\n\`\`\``,
    '<step-url>': stepUrl,
    '<additional-information>': [
      `Namespace: ${report?.namespace || 'unknown'}`,
      aiSummary ? `AI Summary: ${aiSummary}` : null,
      grafanaUrl ? `Grafana: ${grafanaUrl}` : null,
      logUrl ? `Log: ${logUrl}` : null,
    ]
      .filter(Boolean)
      .join('\n\n') || 'N/A'
  };

  let body = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    body = body.replace(placeholder, value);
  }
  body = body.replace('<Workflow Run>', report?.run?.htmlUrl || report?.run?.html_url || 'N/A');
  body = body.replace('<Job URL>', job?.htmlUrl || job?.html_url || 'N/A');

  return body;
}

export function listContextOptions(report) {
  return enumerateErrorContexts(report).map(({ job, step, context, contextId }) => ({
    contextId,
    jobId: job?.id ?? null,
    jobName: job?.name ?? null,
    stepNumber: step?.number ?? null,
    stepName: step?.name ?? null,
    summary:
      context?.aiSummary?.summary ||
      context?.cursorSummary?.summary ||
      context?.snippet?.split('\n')[0] ||
      ''
  }));
}

export async function buildIssuePayload({
  report,
  contextId,
  labels = DEFAULT_LABELS,
  assignees = DEFAULT_ASSIGNEES,
  templatePath
}) {
  if (!report) {
    throw new Error('Report object is required.');
  }

  const { job, step, context, contextId: resolvedContextId } = pickContext(report, contextId);

  const title = buildIssueTitle({ report, job, step, context });
  const body = await buildIssueBody({
    report,
    job,
    step: {
      ...step,
      stepUrl: resolveStepUrl({ job, step })
    },
    context,
    templatePath
  });

  const params = new URLSearchParams();
  params.set('title', title);
  params.set('body', body);
  if (labels && labels.length > 0) {
    params.set('labels', labels.join(','));
  }
  if (assignees && assignees.length > 0) {
    params.set('assignees', assignees.join(','));
  }

  const issueUrl = `https://github.com/matrixorigin/matrixone/issues/new?${params.toString()}`;

  return {
    title,
    body,
    labels,
    assignees,
    issueUrl,
    contextId: resolvedContextId
  };
}


