const SUPPORTED_PROVIDERS = new Set(['dashscope']);

function collectContexts(report) {
  const contexts = [];

  if (!report?.jobs || !Array.isArray(report.jobs)) {
    return contexts;
  }

  for (const job of report.jobs) {
    if (!job || !Array.isArray(job.steps)) continue;
    for (const step of job.steps) {
      if (!step || !Array.isArray(step.errorContexts) || step.errorContexts.length === 0)
        continue;
      for (let idx = 0; idx < step.errorContexts.length; idx += 1) {
        const context = step.errorContexts[idx];
        if (!context || typeof context !== 'object') continue;

        const contextId = `job-${job.id}-step-${step.number}-context-${idx}`;
        contexts.push({
          contextId,
          job,
          step,
          context,
          index: idx
        });
      }
    }
  }

  return contexts;
}

function buildPromptInput(report, contexts) {
  return {
    run: {
      id: report?.run?.id ?? null,
      name: report?.run?.name ?? null,
      conclusion: report?.run?.conclusion ?? null,
      createdAt: report?.run?.createdAt ?? null,
      updatedAt: report?.run?.updatedAt ?? null
    },
    summary: report?.summary ?? null,
    contexts: contexts.map(({ contextId, job, step, context }) => ({
      contextId,
      job: {
        id: job?.id ?? null,
        name: job?.name ?? null,
        conclusion: job?.conclusion ?? null
      },
      step: {
        number: step?.number ?? null,
        name: step?.name ?? null,
        conclusion: step?.conclusion ?? null
      },
      snippet: context?.snippet ?? '',
      grafanaUrl: context?.grafanaUrl ?? null
    }))
  };
}

function applyContextSummaries(contexts, summaryMap, { model, generatedAt }) {
  for (const item of contexts) {
    const entry = summaryMap.get(item.contextId);
    if (!entry) continue;

    const { contextId } = item;

    if (!item.context.aiSummary) {
      item.context.aiSummary = {};
    }

    item.context.aiSummary.summary = entry.summary;
    if (entry.details) {
      item.context.aiSummary.details = entry.details;
    } else {
      delete item.context.aiSummary.details;
    }
    item.context.aiSummary.model = model;
    item.context.aiSummary.generatedAt = generatedAt;
    item.context.aiSummary.contextId = contextId;
  }
}

function parseDashscopeContent(response) {
  const choices = response?.output?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const primaryChoice = choices[0];
  const content = primaryChoice?.message?.content;
  if (!content) {
    return null;
  }

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textPart = content.find(
      (part) => part && typeof part.text === 'string' && part.text.trim().length > 0
    );
    if (textPart) {
      return textPart.text;
    }
  }

  return null;
}

function normalizeJsonContent(text) {
  if (typeof text !== 'string') {
    return '';
  }
  let normalized = text.trim();
  if (normalized.startsWith('```')) {
    normalized = normalized.replace(/^```(?:json)?\s*/i, '');
    normalized = normalized.replace(/```[\s]*$/i, '');
  }
  return normalized.trim();
}

function buildSummaryMap(responsePayload) {
  if (!responsePayload) {
    return { summaries: new Map(), titles: new Map(), overall: null, extra: null };
  }

  const data = Array.isArray(responsePayload.contexts) ? responsePayload.contexts : [];
  const map = new Map();
  const titles = new Map();

  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const { contextId, summary, details, shortIssueTitle } = entry;
    if (!contextId || typeof summary !== 'string') continue;
    map.set(contextId, { summary: summary.trim(), details: details ?? null });
    if (typeof shortIssueTitle === 'string' && shortIssueTitle.trim().length > 0) {
      titles.set(contextId, shortIssueTitle.trim());
    }
  }

  return {
    summaries: map,
    titles,
    overall:
      typeof responsePayload.overallSummary === 'string'
        ? responsePayload.overallSummary.trim()
        : null,
    extra:
      typeof responsePayload.additionalNotes === 'string'
        ? responsePayload.additionalNotes.trim()
        : null
  };
}

async function maybeAsync(value) {
  return typeof value === 'function' ? value() : value;
}

async function resolveSettings(factory, overrides) {
  if (!factory) {
    return null;
  }
  const result = await factory(overrides);
  if (!result || typeof result !== 'object') {
    return null;
  }
  return result;
}

function normalizeLogger(logger) {
  return logger && typeof logger === 'object' ? logger : console;
}

export function createAiSummarizer({
  getSettings,
  loadPromptConfig,
  createChatCompletion,
  logger: providedLogger
}) {
  if (typeof getSettings !== 'function') {
    throw new Error('createAiSummarizer requires a getSettings(factory) function.');
  }
  if (typeof loadPromptConfig !== 'function') {
    throw new Error('createAiSummarizer requires a loadPromptConfig() function.');
  }
  if (typeof createChatCompletion !== 'function') {
    throw new Error('createAiSummarizer requires a createChatCompletion() function.');
  }

  const logger = normalizeLogger(providedLogger);

  return async function enrichReportWithAiSummaries(report, options = {}) {
    const { overrides, logger: overrideLogger } = options;
    const activeLogger = normalizeLogger(overrideLogger) || logger;

    const settings = await resolveSettings(getSettings, overrides);
    if (!settings) {
      return report;
    }

    if (!settings.enabled) {
      return report;
    }

    const provider = settings.provider || 'dashscope';
    if (!SUPPORTED_PROVIDERS.has(provider)) {
      const error = `Unsupported AI summaries provider "${provider}".`;
      activeLogger?.error?.(`[ai] ${error}`);
      report.aiSummary = {
        status: 'error',
        error
      };
      return report;
    }

    if (!settings.apiKey) {
      activeLogger?.warn?.(
        `[ai] Summaries enabled but apiKey is not configured for provider "${provider}".`
      );
      return report;
    }

    const contexts = collectContexts(report);
    if (contexts.length === 0) {
      activeLogger?.info?.('[ai] No error contexts found; skipping summarization.');
      return report;
    }

    let promptConfig;
    try {
      promptConfig = await maybeAsync(() => loadPromptConfig());
    } catch (error) {
      const message = error?.message || String(error);
      activeLogger?.error?.(`[ai] Failed to load summary prompt: ${message}`);
      report.aiSummary = {
        status: 'error',
        error: message
      };
      return report;
    }

    const systemPrompt = promptConfig?.systemPrompt;
    const template = promptConfig?.userPromptTemplate;
    const responseFormat = promptConfig?.responseFormat ?? null;
    const temperature =
      typeof promptConfig?.temperature === 'number' ? promptConfig.temperature : undefined;

    if (typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0) {
      const error = 'Summary prompt config is missing systemPrompt.';
      activeLogger?.error?.(`[ai] ${error}`);
      report.aiSummary = {
        status: 'error',
        error
      };
      return report;
    }
    if (typeof template !== 'string' || template.trim().length === 0) {
      const error = 'Summary prompt config is missing userPromptTemplate.';
      activeLogger?.error?.(`[ai] ${error}`);
      report.aiSummary = {
        status: 'error',
        error
      };
      return report;
    }

    const promptInput = buildPromptInput(report, contexts);
    const userPrompt = template.replace(
      '{{summary_input}}',
      JSON.stringify(promptInput, null, 2)
    );

    const model = settings.model || 'qwen-max';
    const requestPayload = {
      model,
      temperature,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      responseFormat,
      apiKey: settings.apiKey,
      apiBase: settings.apiBase
    };

    let apiResponse;
    try {
      if (provider === 'dashscope') {
        apiResponse = await createChatCompletion(requestPayload);
      } else {
        throw new Error(`Provider "${provider}" has no implemented client.`);
      }
    } catch (error) {
      const message = error?.message || String(error);
      activeLogger?.error?.(`[ai] Failed to fetch summaries: ${message}`);
      report.aiSummary = {
        status: 'error',
        error: message
      };
      return report;
    }

    const assistantContent = parseDashscopeContent(apiResponse);
    if (!assistantContent) {
      activeLogger?.error?.('[ai] AI provider did not return text content for summaries.');
      report.aiSummary = {
        status: 'error',
        error: 'AI provider did not return text content'
      };
      return report;
    }

    let parsedContent;
    try {
      parsedContent = JSON.parse(normalizeJsonContent(assistantContent));
    } catch (error) {
      const message = error?.message || String(error);
      activeLogger?.error?.(`[ai] Failed to parse provider response as JSON: ${message}`);
      report.aiSummary = {
        status: 'error',
        error: `Failed to parse provider response as JSON: ${message}`
      };
      return report;
    }

    const { summaries, titles, overall, extra } = buildSummaryMap(parsedContent);
    const generatedAt = new Date().toISOString();

    applyContextSummaries(contexts, summaries, { model, generatedAt });

    for (const item of contexts) {
      const title = titles.get(item.contextId);
      if (title) {
        if (!item.context.aiSummary) {
          item.context.aiSummary = {};
        }
        item.context.aiSummary.shortIssueTitle = title;
      }
    }

    report.aiSummary = {
      status: 'ok',
      provider,
      model,
      generatedAt,
      overallSummary: overall,
      additionalNotes: extra || undefined
    };

    return report;
  };
}


