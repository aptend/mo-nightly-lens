import fs from 'fs';
import path from 'path';

import {
  listContextOptions,
  buildIssuePayload
} from '../modules/adapters/cli/issues/context-issue-builder.js';

function parseArgs(argv) {
  const args = {
    repo: 'matrixorigin/matrixone'
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;

    if (!token.startsWith('--')) {
      if (!args.reportPath) {
        args.reportPath = token;
      } else if (!args.contextId) {
        args.contextId = token;
      }
      continue;
    }

    const [flag, value] = token.split('=');
    if (flag === '--repo' && value) {
      args.repo = value;
    } else if (flag === '--context' && value) {
      args.contextId = value;
    } else if (flag === '--report' && value) {
      args.reportPath = value;
    }
  }

  return args;
}

function loadReport(reportPath) {
  if (!reportPath) {
    throw new Error('Please provide report path (argument or --report=<path>).');
  }

  const resolvedPath = path.isAbsolute(reportPath)
    ? reportPath
    : path.resolve(process.cwd(), reportPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Report file not found at ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf8');
  return JSON.parse(content);
}

function resolveContextId(report, explicitContextId) {
  if (explicitContextId) {
    return explicitContextId;
  }

  const options = listContextOptions(report);
  if (options.length === 0) {
    throw new Error('No error contexts found in report.');
  }
  if (options.length === 1) {
    return options[0].contextId;
  }

  console.log('可选的 errorContext：\n');
  options.forEach((option, idx) => {
    console.log(
      `${idx + 1}. [${option.contextId}] Job: ${option.jobName || 'Unknown'} / Step: #${
        option.stepNumber ?? '?'
      } ${option.stepName || 'Unknown'}\n   摘要: ${option.summary || '（无摘要）'}`
    );
  });

  const prompt = '请选择要提交的 errorContext (输入序号): ';
  fs.writeSync(1, `\n${prompt}`);

  const buffer = Buffer.alloc(1024);
  const bytesRead = fs.readSync(0, buffer, 0, 1024, null);
  const input = buffer.slice(0, bytesRead).toString('utf8').trim();

  const index = Number.parseInt(input, 10);
  if (Number.isNaN(index) || index < 1 || index > options.length) {
    throw new Error(`输入无效: ${input}`);
  }

  const selected = options[index - 1];
  return selected.contextId;
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const report = loadReport(args.reportPath);

    const contextId = resolveContextId(report, args.contextId);

    const payload = await buildIssuePayload({
      report,
      contextId
    });

    console.log('--- ISSUE PREVIEW ---');
    console.log(`Repo: ${args.repo}`);
    console.log(`Context ID: ${payload.contextId}`);
    console.log(`Title: ${payload.title}`);
    console.log('\nBody:\n');
    console.log(payload.body);
    console.log('\nPrefilled issue URL:\n');
    console.log(payload.issueUrl);
    console.log('\n请打开上述链接，在 GitHub 页面上确认或编辑内容后手动提交。');
    console.log('--- END ---');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

main();

