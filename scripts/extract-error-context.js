#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  extractErrorContexts
} = await import(path.join(__dirname, '..', 'modules', 'core', 'logs', 'context-extractor.js'));

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = value;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const filePath = args.file || args.path || args.f || args.p;
  const stepName = args['step-name'] || args.step || args.name;

  if (!filePath) {
    console.error('❌ Please provide log file path via --file <path>');
    process.exit(1);
  }

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const logText = fs.readFileSync(resolvedPath, 'utf8');
  const contexts = extractErrorContexts(logText, {
    stepName,
    enableFinalErrorFallback: true
  });

  console.log(`🔍 File: ${resolvedPath}`);
  console.log(`🔍 Matches found: ${contexts.length}`);
  console.log('');

  contexts.forEach((ctx, index) => {
    console.log(`--- Context #${index + 1} (lines ${ctx.startLine}-${ctx.endLine}) ---`);
    console.log(ctx.snippet);
    console.log('');
  });
}

main().catch((error) => {
  console.error('❌ Extraction failed');
  console.error(error);
  process.exit(1);
});

