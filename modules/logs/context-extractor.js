const CONTEXT_BEFORE = 10;
const CONTEXT_AFTER = 10;
const MERGE_EXTENSION = 10;
const TIMESTAMP_PATTERN = /^\s*\d{4}-\d{2}-\d{2}[T\s]/;
const ISO_TIMESTAMP_REGEX = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/;
const BASIC_TIMESTAMP_REGEX = /\b\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\b/;

function normalize(text) {
  return (text || '').trim().toLowerCase();
}

function matchesAny(line, keywords) {
  const value = normalize(line);
  return keywords.some((keyword) => value.includes(keyword));
}

const SCENARIOS = {
  TPCC: 'tpcc',
  TPCH: 'tpch'
};

function detectScenario({ stepName, jobName }) {
  const source = `${stepName || ''} ${jobName || ''}`;
  if (matchesAny(source, ['tpcc'])) {
    return SCENARIOS.TPCC;
  }
  if (matchesAny(source, ['tpch'])) {
    return SCENARIOS.TPCH;
  }
  return null;
}

function isTpchSummaryLine(line) {
  const value = normalize(line);
  if (!value) return false;
  if (value.includes('##[error]process completed with exit code')) {
    return true;
  }
  if (value.includes('this test has been executed failed, more info, please see the log')) {
    return true;
  }
  return value.includes('process completed with exit code 1');
}

function isTpchSummarySnippet(snippet) {
  if (!snippet) return false;
  const lines = snippet
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return false;
  }

  return lines.every((line) => isTpchSummaryLine(line));
}

function hasMeaningfulTpchContent(snippet) {
  if (!snippet) return false;
  return snippet.split('\n').some((line) => {
    if (isTpchSummaryLine(line)) {
      return false;
    }
    const normalized = normalize(line);
    if (!normalized) {
      return false;
    }
    return (
      normalized.includes('error ') ||
      normalized.includes('error:') ||
      normalized.includes('fatal') ||
      normalized.includes('exception') ||
      normalized.includes('timeout') ||
      normalized.includes('fail ') ||
      normalized.endsWith(' fail') ||
      /\berror\b/.test(normalized)
    );
  });
}

function filterContextsByScenario(contexts, scenario, { lines }) {
  if (!scenario) {
    return contexts;
  }

  if (scenario === SCENARIOS.TPCC) {
    const summaryIndex = lines.findIndex((line) =>
      line.includes('There are some unexpected error in benchmarksql-error.log.')
    );
    return contexts.filter((ctx) => {
      const firstMatchIndex = ctx.firstMatchIndex ?? ctx.start ?? 0;
      if (summaryIndex !== -1 && firstMatchIndex >= summaryIndex) {
        return false;
      }
      return ctx.snippet.includes('FATAL jTPCCTerminal');
    });
  }

  if (scenario === SCENARIOS.TPCH) {
    return contexts.filter((ctx) => {
      if (isTpchSummarySnippet(ctx.snippet)) {
        return false;
      }
      return hasMeaningfulTpchContent(ctx.snippet);
    });
  }

  return contexts;
}

function extractTimestampMs(line) {
  if (typeof line !== 'string' || line.length === 0) {
    return null;
  }

  const isoMatch = line.match(ISO_TIMESTAMP_REGEX);
  if (isoMatch?.[0]) {
    const value = Date.parse(isoMatch[0]);
    return Number.isNaN(value) ? null : value;
  }

  const basicMatch = line.match(BASIC_TIMESTAMP_REGEX);
  if (basicMatch?.[0]) {
    const value = Date.parse(`${basicMatch[0]}Z`);
    return Number.isNaN(value) ? null : value;
  }

  return null;
}

export function extractErrorContexts(logText, {
  stepName,
  jobName,
  enableFinalErrorFallback = false
} = {}) {
  if (!logText || typeof logText !== 'string') {
    return [];
  }

  const lines = logText.split('\n');
  const ranges = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hasGithubError = line.trimStart().startsWith('##[error]');
    const hasTimestamp = TIMESTAMP_PATTERN.test(line);
    const hasError = /(?:^|\s)ERROR\b/.test(line);
    const hasKilled = /\bKilled\b/i.test(line) || /exit code/i.test(line);
    const hasSeverity = line.includes('FATAL') || hasError || hasKilled;
    if (!(hasGithubError || (hasTimestamp && hasSeverity))) {
      continue;
    }

    const start = Math.max(0, i - CONTEXT_BEFORE);
    const endExclusive = Math.min(lines.length, i + CONTEXT_AFTER + 1);

    if (ranges.length > 0) {
      const last = ranges[ranges.length - 1];
      if (start <= last.mergeUntil) {
        last.start = Math.min(last.start, start);
        last.endExclusive = Math.max(last.endExclusive, endExclusive);
        last.mergeUntil = Math.min(
          lines.length,
          Math.max(last.mergeUntil, endExclusive + MERGE_EXTENSION)
        );
        last.firstMatchIndex = Math.min(last.firstMatchIndex, i);
        continue;
      }
    }

    ranges.push({
      start,
      endExclusive,
      mergeUntil: Math.min(lines.length, endExclusive + MERGE_EXTENSION),
      firstMatchIndex: i
    });
  }

  let contexts = ranges.map(({ start, endExclusive, firstMatchIndex }) => ({
    start,
    endExclusive,
    firstMatchIndex,
    snippet: lines.slice(start, endExclusive).join('\n').trim()
  }));

  const scenario = detectScenario({ stepName, jobName });
  contexts = filterContextsByScenario(contexts, scenario, { lines });

  const seen = new Set();
  const result = [];
  for (let idx = 0; idx < contexts.length; idx += 1) {
    const ctx = contexts[idx];
    const firstMatchIndex = ctx.firstMatchIndex ?? ctx.start;
    const key = ctx.snippet;
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);

    let startTimestamp = null;
    let endTimestamp = null;
    for (let lineIndex = ctx.start; lineIndex < ctx.endExclusive; lineIndex += 1) {
      const timestampMs = extractTimestampMs(lines[lineIndex]);
      if (timestampMs == null) {
        continue;
      }

      if (startTimestamp == null || timestampMs < startTimestamp) {
        startTimestamp = timestampMs;
      }
      if (endTimestamp == null || timestampMs > endTimestamp) {
        endTimestamp = timestampMs;
      }
    }

    result.push({
      startLine: ctx.start + 1,
      endLine: ctx.endExclusive,
      snippet: ctx.snippet,
      startTimestamp,
      endTimestamp
    });
  }

  if (result.length === 0 && enableFinalErrorFallback) {
    const finalErrorIndex = lines
      .slice()
      .reverse()
      .findIndex((line) => line.trimStart().startsWith('##[error]'));

    if (finalErrorIndex !== -1) {
      const actualIndex = lines.length - 1 - finalErrorIndex;
      const start = Math.max(0, actualIndex - CONTEXT_BEFORE);
      const endExclusive = Math.min(lines.length, actualIndex + CONTEXT_AFTER + 1);
      const snippet = lines.slice(start, endExclusive).join('\n').trim();
      if (snippet.length > 0) {
        result.push({
          startLine: start + 1,
          endLine: endExclusive,
          snippet,
          startTimestamp: null,
          endTimestamp: null
        });
      }
    }
  }

  return result;
}

