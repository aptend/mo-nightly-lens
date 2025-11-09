import fs from 'fs';
import path from 'path';

const DEFAULT_LABELS = ['kind/bug', 'needs-triage'];
const DEFAULT_ASSIGNEES = ['matrix-meow'];

function sanitizeSnippet(snippet) {
  if (!snippet || typeof snippet !== 'string') {
    return '';
  }
  return snippet.trim().slice(0, 4000);
}

function loadTemplate(templatePath = path.resolve('config', 'bug-report.md')) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found at ${templatePath}`);
  }
  return fs.readFileSync(templatePath, 'utf8');
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
          context.aiSummary?.contextId ||
          context.cursorSummary?.contextId ||
          context.contextId ||
          `job-${job.id}-step-${step.number}-context-${index}`;

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

export function listContextOptions(report) {
  return enumerateErrorContexts(report).map(({ job, step, context, contextId }) => ({
    contextId,
    jobId: job?.id ?? null,
    jobName: job?.name ?? null,
    stepNumber: step?.number ?? null,
    stepName: step?.name ?? null,
    summary:
      context.aiSummary?.summary ||
      context.cursorSummary?.summary ||
      context.snippet?.split('\n')[0] ||
      ''
  }));
}

export function pickContext(report, contextId) {
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
    context.aiSummary?.shortIssueTitle ||
    context.cursorSummary?.shortIssueTitle;
  if (typeof shortTitle === 'string' && shortTitle.trim().length > 0) {
    return `[Bug]: ${shortTitle.trim()}`;
  }
  const stepName = step?.name || 'Unknown Step';
  return `[Bug]: [Nightly Regression] ${stepName} failure`;
}

function buildIssueBody({ report, job, step, context, contextId, templatePath }) {
  const template = loadTemplate(templatePath);
  const stepUrl = resolveStepUrl({ job, step }) || 'N/A';
  const logUrl = step?.logUrl || null;
  const grafanaUrl = context?.grafanaUrl || report?.grafanaUrl || null;
  const commitId = extractCommitId(report) || '<commit-id>';
  const aiSummary = context.aiSummary?.summary || context.cursorSummary?.summary || '';

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
      .join('\n\n')
  };

  let body = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    body = body.replace(placeholder, value);
  }
  body = body.replace('<Workflow Run>', report?.run?.htmlUrl || 'N/A');
  body = body.replace('<Job URL>', job?.htmlUrl || job?.html_url || 'N/A');

  return body;
}

export function buildIssuePayload({
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
  const body = buildIssueBody({
    report,
    job,
    step: {
      ...step,
      stepUrl: resolveStepUrl({ job, step })
    },
    context,
    contextId: resolvedContextId,
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

