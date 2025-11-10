import fs from 'fs';
import path from 'path';

import { createContextIssueBuilder } from '../../../core/issues/context-issue-builder.js';

const DEFAULT_TEMPLATE_PATH = path.resolve('config', 'bug-report.md');

function resolveTemplatePath(templatePath) {
  if (!templatePath) {
    return DEFAULT_TEMPLATE_PATH;
  }
  if (path.isAbsolute(templatePath)) {
    return templatePath;
  }
  return path.resolve(process.cwd(), templatePath);
}

function loadTemplate(templatePath = DEFAULT_TEMPLATE_PATH) {
  const resolvedPath = resolveTemplatePath(templatePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Template file not found at ${resolvedPath}`);
  }
  return fs.readFileSync(resolvedPath, 'utf8');
}

const builder = createContextIssueBuilder({
  loadTemplate,
  resolveTemplatePath
});

export const { listContextOptions, buildIssuePayload } = builder;


