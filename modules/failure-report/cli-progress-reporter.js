import { createProgressReporter } from './progress.js';

function formatDuration(durationMs) {
  if (durationMs == null) {
    return '';
  }
  return ` ${durationMs < 1000 ? `${durationMs.toFixed(0)}ms` : `${(durationMs / 1000).toFixed(2)}s`}`;
}

function withPrefix(prefix, text) {
  return `${prefix}${text}`;
}

export function createCliProgressReporter({ stream = process.stdout } = {}) {
  const write = (line = '') => {
    stream.write(`${line}\n`);
  };

  const makeLabel = ({ label, name }) => label || name || '';

  return createProgressReporter({
    phaseStart: (payload = {}) => {
      const label = makeLabel(payload);
      if (label) {
        write(withPrefix('→ ', `${label}...`));
      }
    },
    phaseComplete: (payload = {}) => {
      const label = makeLabel(payload);
      if (label) {
        const duration = formatDuration(payload.durationMs);
        const metaSummary = payload.meta?.summary ? ` ${payload.meta.summary}` : '';
        write(withPrefix('✓ ', `${label}${duration}${metaSummary}`));
      }
    },
    phaseError: (payload = {}) => {
      const label = makeLabel(payload);
      const errorMessage = payload.error ? ` (${payload.error})` : '';
      write(withPrefix('✖ ', `${label}${errorMessage}`));
    },
    jobStart: ({ jobId, jobName, failingStepCount }) => {
      const label = jobName || `job ${jobId}`;
      write(withPrefix('• ', `Processing job "${label}" (${failingStepCount} failing steps)`));
    },
    jobComplete: ({ jobId, jobName, durationMs, stepCount }) => {
      const label = jobName || `job ${jobId}`;
      write(
        withPrefix(
          '✓ ',
          `Job "${label}" done${formatDuration(durationMs)}${
            stepCount != null ? `, processed ${stepCount} steps` : ''
          }`
        )
      );
    },
    stepStart: ({ jobId, jobName, stepNumber, stepName }) => {
      const jobLabel = jobName || `job ${jobId}`;
      write(withPrefix('  → ', `[${jobLabel}] Step ${stepNumber}: ${stepName}`));
    },
    stepComplete: ({ jobId, jobName, stepNumber, durationMs, contextCount }) => {
      const jobLabel = jobName || `job ${jobId}`;
      const contextsInfo =
        contextCount != null ? `, contexts: ${contextCount}` : '';
      write(
        withPrefix(
          '  ✓ ',
          `[${jobLabel}] Step ${stepNumber} complete${formatDuration(durationMs)}${contextsInfo}`
        )
      );
    },
    stepLogFetchStart: ({ jobId, jobName, stepNumber, stepName }) => {
      const jobLabel = jobName || `job ${jobId}`;
      write(
        withPrefix(
          '    ⇢ ',
          `[${jobLabel}] Fetching log for step ${stepNumber}${
            stepName ? ` (${stepName})` : ''
          }`
        )
      );
    },
    stepLogFetchComplete: ({ jobId, jobName, stepNumber, durationMs, fromCache, error }) => {
      const jobLabel = jobName || `job ${jobId}`;
      const base = `[${jobLabel}] Step ${stepNumber} log`;
      if (error) {
        write(withPrefix('    ✖ ', `${base} failed: ${error}`));
        return;
      }
      const source = fromCache ? 'cache' : 'download';
      write(withPrefix('    ↳ ', `${base} (${source})${formatDuration(durationMs)}`));
    }
  });
}


