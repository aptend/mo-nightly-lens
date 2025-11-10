import { load as loadHtml } from 'cheerio';
import { fetchWithSession } from '../github/session-client.js';

function ensureStepIdentifier(stepNumber, stepName) {
  if (stepNumber !== undefined && stepNumber !== null) {
    return { stepNumber: Number(stepNumber) };
  }

  if (stepName) {
    return { stepName };
  }

  throw new Error('Please provide either stepNumber or stepName.');
}

function findStepElement($, { stepNumber, stepName }) {
  if (typeof stepNumber === 'number' && !Number.isNaN(stepNumber)) {
    const byNumber = $(`check-step[data-number="${stepNumber}"]`).first();
    if (byNumber.length > 0) {
      return byNumber;
    }
  }

  if (stepName) {
    const normalized = stepName.trim().toLowerCase();
    const byName = $('check-step').filter((_, el) => {
      const name = $(el).attr('data-name') || '';
      return name.toLowerCase().includes(normalized);
    });
    if (byName.length > 0) {
      return byName.first();
    }
  }

  return null;
}

export async function fetchStepLog({
  owner,
  repo,
  runId,
  jobId,
  stepNumber,
  stepName
}) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required.');
  }
  if (!runId || !jobId) {
    throw new Error('runId and jobId are required.');
  }

  const stepIdentifier = ensureStepIdentifier(stepNumber, stepName);
  const baseUrl = `https://github.com/${owner}/${repo}`;
  const jobPageUrl = `${baseUrl}/actions/runs/${runId}/job/${jobId}`;

  const jobResponse = await fetchWithSession(jobPageUrl);
  if (jobResponse.status !== 200) {
    throw new Error(
      `Failed to load job page. HTTP ${jobResponse.status} (${jobResponse.url})`
    );
  }

  const $ = loadHtml(jobResponse.body.toString('utf8'));
  const stepElement = findStepElement($, stepIdentifier);

  if (!stepElement || stepElement.length === 0) {
    throw new Error(
      `Could not locate step ${stepIdentifier.stepNumber ?? stepIdentifier.stepName} on the job page.`
    );
  }

  const logPath = stepElement.attr('data-log-url');
  if (!logPath) {
    throw new Error('Step does not expose a log URL (missing data-log-url attribute).');
  }

  const resolvedLogUrl = new URL(logPath, baseUrl).toString();
  const logResponse = await fetchWithSession(resolvedLogUrl);

  if (logResponse.status !== 200) {
    throw new Error(
      `Failed to download step log. HTTP ${logResponse.status} (${logResponse.url})`
    );
  }

  const stepInfo = {
    number: Number(stepElement.attr('data-number')),
    name: stepElement.attr('data-name') || null,
    conclusion: stepElement.attr('data-conclusion') || null,
    externalId: stepElement.attr('data-external-id') || null
  };

  return {
    step: stepInfo,
    log: logResponse.body.toString('utf8'),
    logUrl: resolvedLogUrl
  };
}


