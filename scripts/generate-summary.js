import fs from 'fs';
import path from 'path';

import { enrichReportWithAiSummaries } from '../modules/failure-report/ai-summarizer.js';

async function main() {
  const [, , inputPath] = process.argv;

  if (!inputPath) {
    console.error('Usage: node scripts/generate-summary.js <path-to-failure-report.json>');
    process.exitCode = 1;
    return;
  }

  const resolvedPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);

  let report;
  try {
    const content = fs.readFileSync(resolvedPath, 'utf8');
    report = JSON.parse(content);
  } catch (error) {
    console.error(`Failed to read or parse report JSON at ${resolvedPath}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    await enrichReportWithAiSummaries(report, { logger: console });
  } catch (error) {
    console.error(`Failed to generate AI summary: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (!report.aiSummary || report.aiSummary.status !== 'ok') {
    console.error(
      'AI summary was not generated. Check config/aiSummaries settings and provider credentials.'
    );
    process.exitCode = 1;
    return;
  }

  const contexts =
    report.jobs
      ?.flatMap((job) =>
        (job.steps || []).flatMap((step) =>
          (step.errorContexts || []).map((ctx) => ({
            contextId: ctx.aiSummary?.contextId ?? null,
            jobId: job.id,
            jobName: job.name,
            stepNumber: step.number,
            stepName: step.name,
            aiSummary: ctx.aiSummary ?? null,
            grafanaUrl: ctx.grafanaUrl ?? null,
            logUrl: step.logUrl ?? null
          }))
        )
      )
      ?.filter((entry) => entry.aiSummary != null) ?? [];

  const output = {
    aiSummary: report.aiSummary,
    contexts
  };

  console.log(JSON.stringify(output, null, 2));
}

main();

