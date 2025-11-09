import { createActionsClient } from '../github/actions-client.js';
import { createStepLogLoader } from '../failure-report/step-log-loader.js';
import { NamespaceExtractor, buildGrafanaUrl } from './index.js';

const DEFAULT_REPO = 'matrixorigin/mo-nightly-regression';
const DEFAULT_WORKFLOW = 'branch-nightly-regression-tke-new.yaml';
const DEFAULT_JOB_NAME = 'Branch Nightly Regression Test / SETUP MO TEST ENV';
const DEFAULT_STEP_NAME = 'Clean TKE Env';

const WORKFLOW_DEFAULTS = {
  [DEFAULT_WORKFLOW]: {
    jobName: DEFAULT_JOB_NAME,
    stepName: DEFAULT_STEP_NAME
  }
};

function normalize(text) {
  return (text || '').trim().toLowerCase();
}

function selectJob(jobs, targetName) {
  const normalizedTarget = normalize(targetName);
  return (
    jobs.find((job) => normalize(job.name) === normalizedTarget) ||
    jobs.find((job) => normalize(job.name).includes(normalizedTarget)) ||
    null
  );
}

function selectStep(steps, targetName) {
  const normalizedTarget = normalize(targetName);
  return (
    steps.find((step) => normalize(step.name) === normalizedTarget) ||
    steps.find((step) => normalize(step.name).includes(normalizedTarget)) ||
    null
  );
}

function resolveWorkflowDefaults(workflow, overrides = {}) {
  const defaults =
    WORKFLOW_DEFAULTS[workflow] || WORKFLOW_DEFAULTS[DEFAULT_WORKFLOW] || {
      jobName: DEFAULT_JOB_NAME,
      stepName: DEFAULT_STEP_NAME
    };

  return {
    jobName: overrides.jobName || defaults.jobName,
    stepName: overrides.stepName || defaults.stepName
  };
}

export async function fetchNamespaceForLatestRun({
  repo = DEFAULT_REPO,
  workflow = DEFAULT_WORKFLOW,
  token,
  ...overrides
} = {}) {
  const client = createActionsClient({ repo, token });
  const { jobName, stepName } = resolveWorkflowDefaults(workflow, overrides);

  const runsResponse = await client.listWorkflowRuns(workflow, { perPage: 1 });
  const runs = runsResponse.workflow_runs || [];

  if (runs.length === 0) {
    throw new Error(`No workflow runs found for workflow "${workflow}".`);
  }

  const latestRun = runs[0];

  const jobs = await client.listJobs(latestRun.id);

  if (jobs.length === 0) {
    throw new Error(`Run ${latestRun.id} has no jobs.`);
  }

  const job = selectJob(jobs, jobName);
  if (!job) {
    const available = jobs.map((j) => j.name).join(', ');
    throw new Error(`Job "${jobName}" not found. Available jobs: ${available}`);
  }

  const jobDetails = await client.getJob(job.id);

  const steps = jobDetails.steps || [];
  const step = selectStep(steps, stepName);
  if (!step) {
    const availableSteps = steps.map((s) => s.name).join(', ');
    throw new Error(`Step "${stepName}" not found. Available steps: ${availableSteps}`);
  }

  const getStepLog = createStepLogLoader({
    owner: client.owner,
    repo: client.repoName,
    runId: latestRun.id
  });

  const { log } = await getStepLog(job.id, step.number);

  const namespaceExtractor = new NamespaceExtractor();
  const namespace = namespaceExtractor.extract(log);

  return {
    run: {
      id: latestRun.id,
      name: latestRun.name,
      status: latestRun.status,
      conclusion: latestRun.conclusion,
      htmlUrl: latestRun.html_url
    },
    job: {
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion
    },
    step: {
      number: step.number,
      name: step.name,
      status: step.status,
      conclusion: step.conclusion
    },
    namespace,
    grafanaUrl: buildGrafanaUrl(namespace)
  };
}

