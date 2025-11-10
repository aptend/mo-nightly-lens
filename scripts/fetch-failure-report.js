#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const reportsRoot = path.join(__dirname, '..', 'reports');

async function main() {
  const { runFetchFailureReport } = await import('../modules/adapters/cli/failure-report/runner.js');

  try {
    await runFetchFailureReport({
      argv: process.argv,
      reportsRoot
    });
  } catch (error) {
    console.error('❌ Failed to generate failure report');
    console.error(error.message);
    process.exitCode = 1;
  }
}

main();
