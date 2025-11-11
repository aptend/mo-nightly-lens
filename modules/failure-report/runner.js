import fs from 'fs';
import path from 'path';

import { fetchFailureReport } from './service.js';
import { createCliProgressReporter } from './cli-progress-reporter.js';

function normalizeArgValue(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;

  return value;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    let key = token.slice(2);
    if (!key) continue;

    let value;
    let consumedNext = false;

    const eqIndex = key.indexOf('=');
    if (eqIndex !== -1) {
      value = key.slice(eqIndex + 1);
      key = key.slice(0, eqIndex);
      if (value === '') {
        value = true;
      }
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        value = next;
        consumedNext = true;
      } else {
        value = true;
      }
    }

    args[key] = normalizeArgValue(value);
    if (consumedNext) {
      i += 1;
    }
  }
  return args;
}

function ensureDirectory(dirPath) {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeReportFile(report, filePath) {
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
}

function printReportSummary(report) {
  console.log('✅ Failure report generated');
  console.log(`Run: ${report.run.id} (${report.run.name || 'N/A'})`);
  console.log(`Total jobs: ${report.summary.totalJobs}`);
  console.log(`Failing jobs: ${report.summary.failingJobs}`);

  if (report.jobs.length === 0) {
    console.log('\nNo failing jobs with failing steps were found.');
    return;
  }

  console.log('\nFailing jobs:');
  for (const job of report.jobs) {
    console.log(`- ${job.name} (ID: ${job.id})`);
    for (const step of job.steps) {
      console.log(`    • Step ${step.number}: ${step.name}`);
    }
  }
}

function writeLogs({ report, logsDir }) {
  if (!logsDir || report.jobs.length === 0) {
    return [];
  }

  const writtenLogs = [];
  for (const job of report.jobs) {
    const jobDir = path.join(logsDir, `job-${job.id}`);
    ensureDirectory(jobDir);

    for (const step of job.steps) {
      if (!step.rawLog) continue;
      const logPath = path.join(jobDir, `step-${step.number}.log`);
      fs.writeFileSync(
        logPath,
        `Log URL: ${step.logUrl || 'N/A'}\n\n${step.rawLog}`,
        'utf8'
      );
      writtenLogs.push({
        jobName: job.name,
        stepNumber: step.number,
        path: logPath
      });
      delete step.rawLog;
    }
  }

  return writtenLogs;
}

export async function runFetchFailureReport({
  argv,
  reportsRoot,
  fetchFn = fetchFailureReport
}) {
  const args = parseArgs(argv);
  const repo = args.repo;
  const runId = args.run || args.runId || args['run-id'];
  const downloadLogs = Boolean(args['with-logs'] || args['download-logs']);

  if (!runId) {
    throw new Error('Please specify run ID via --run <id>');
  }

  const logsDir = downloadLogs ? path.join(reportsRoot, `run-${runId}`) : null;
  ensureDirectory(reportsRoot);
  ensureDirectory(logsDir);

  const progressReporter = createCliProgressReporter({
    stream: process.stdout
  });

  const report = await fetchFn({
    repo,
    runId,
    includeLogs: downloadLogs,
    logOutputDir: logsDir,
    progress: progressReporter
  });

  printReportSummary(report);

  let writtenLogs = [];
  if (downloadLogs) {
    writtenLogs = writeLogs({ report, logsDir });
    if (writtenLogs.length > 0) {
      console.log('\nSaving logs:');
      for (const item of writtenLogs) {
        console.log(`- ${item.jobName} / Step ${item.stepNumber} → ${item.path}`);
      }
    }
  }

  const outputFile = path.join(reportsRoot, `failure-report-${report.run.id}.json`);
  writeReportFile(report, outputFile);

  console.log(`\nReport saved to ${outputFile}`);

  return {
    report,
    outputFile,
    logs: writtenLogs
  };
}

export { parseArgs };

