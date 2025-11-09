#!/usr/bin/env node

/**
 * Download a specific GitHub Actions step log using browser session cookies
 * and extract namespace information using shared modules.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createActionsClient } from '../modules/github/actions-client.js';
import { fetchStepLog } from '../modules/logs/step-log-client.js';
import { NamespaceExtractor } from '../modules/namespace/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_REPO = 'matrixorigin/mo-nightly-regression';
const DEFAULT_RUN = '19072270367';
const DEFAULT_JOB_KEYWORD = 'SETUP MO TEST ENV';
const DEFAULT_STEP_KEYWORD = 'Clean TKE Env';
const OUTPUT_DIR = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    const value = next && !next.startsWith('--') ? next : true;
    args[key] = value;
    if (value === next) {
      i += 1;
    }
  }
  return args;
}

function selectJob(jobs, jobId, jobKeyword) {
  if (jobId) {
    const numericId = Number(jobId);
    const match = jobs.find((job) => job.id === numericId);
    if (!match) {
      throw new Error(`Job with ID ${jobId} not found in workflow run.`);
    }
    return match;
  }

  const normalizedKeyword = (jobKeyword || '').trim().toLowerCase();
  const match =
    jobs.find((job) => job.name.trim().toLowerCase() === normalizedKeyword) ||
    jobs.find((job) => job.name.trim().toLowerCase().includes(normalizedKeyword));

  if (!match) {
    const available = jobs.map((job) => `"${job.name}"`).join(', ');
    throw new Error(`Job "${jobKeyword}" not found. Available jobs: ${available}`);
  }

  return match;
}

function ensureStepIdentifier({ stepNumber, stepName, defaultName }) {
  if (stepNumber !== undefined && stepNumber !== null) {
    const parsed = Number(stepNumber);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid step number: ${stepNumber}`);
    }
    return { stepNumber: parsed };
  }

  const resolvedName = stepName || defaultName;
  if (resolvedName) {
    return { stepName: resolvedName.toString() };
  }

  throw new Error('Please specify step number via --step or step name via --step-name.');
}

async function main() {
  const args = parseArgs(process.argv);

  const repoSlug = args.repo || DEFAULT_REPO;
  const runId = args.run || DEFAULT_RUN;
  const jobKeyword = args.job || DEFAULT_JOB_KEYWORD;
  const stepNameArg = args['step-name'];
  const stepNumberArg = args.step !== true ? args.step : undefined;
  const jobIdArg = args['job-id'];

  const client = createActionsClient({ repo: repoSlug });
  const jobs = await client.listJobs(runId);

  if (jobs.length === 0) {
    throw new Error(`No jobs found for run ${runId}.`);
  }

  const job = selectJob(jobs, jobIdArg, jobKeyword);

  console.log(`🔄 Fetching step log via browser session`);
  console.log(`   Repository: ${repoSlug}`);
  console.log(`   Run ID: ${runId}`);
  console.log(`   Job ID: ${job.id} (${job.name})`);

  const stepIdentifier = ensureStepIdentifier({
    stepNumber: stepNumberArg,
    stepName: stepNameArg,
    defaultName: DEFAULT_STEP_KEYWORD
  });

  if (stepIdentifier.stepNumber !== undefined) {
    console.log(`   Step number: ${stepIdentifier.stepNumber}`);
  } else if (stepIdentifier.stepName) {
    console.log(`   Step name filter: ${stepIdentifier.stepName}`);
  }
  console.log('');

  const [owner, repo] = repoSlug.split('/');
  const stepResult = await fetchStepLog({
    owner,
    repo,
    runId,
    jobId: job.id,
    ...stepIdentifier
  });

  const namespaceExtractor = new NamespaceExtractor();
  const namespace = namespaceExtractor.extract(stepResult.log);

  const stepLogPath = path.join(OUTPUT_DIR, 'step-log.txt');
  fs.writeFileSync(stepLogPath, stepResult.log, 'utf8');

  const summary = {
    repo: repoSlug,
    runId,
    job: {
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion
    },
    step: stepResult.step,
    logUrl: stepResult.logUrl,
    namespace: namespace || null
  };

  const summaryPath = path.join(OUTPUT_DIR, 'step-log-result.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  if (namespace) {
    console.log(`✅ Namespace: ${namespace}`);
  } else {
    console.log('⚠️  Namespace not found in the log snippet.');
  }

  console.log('');
  console.log(`📝 Step log saved to ${stepLogPath}`);
  console.log(`📝 Summary saved to ${summaryPath}`);
}

main().catch((error) => {
  console.error('❌ Step log download failed:', error.message);
  process.exit(1);
});

