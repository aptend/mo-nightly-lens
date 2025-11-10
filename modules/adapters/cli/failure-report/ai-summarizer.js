import { createAiSummarizer } from '../../../core/failure-report/ai-summarizer.js';
import { createDashscopeChatCompletion } from '../ai/dashscope-client.js';
import {
  getSummaryProvider,
  getSummaryApiKey,
  getSummaryApiBase,
  getSummaryModel,
  isSummariesEnabled,
  loadSummaryPromptConfig
} from '../../../config/index.js';

function resolveSettings(overrides = {}) {
  const enabledOverride =
    typeof overrides.enabled === 'boolean' ? overrides.enabled : undefined;

  return {
    enabled: enabledOverride ?? isSummariesEnabled(),
    provider: overrides.provider || getSummaryProvider(),
    apiKey: overrides.apiKey || getSummaryApiKey(),
    apiBase: overrides.apiBase || getSummaryApiBase(),
    model: overrides.model || getSummaryModel()
  };
}

export const enrichReportWithAiSummaries = createAiSummarizer({
  getSettings: (overrides) => resolveSettings(overrides || {}),
  loadPromptConfig: () => loadSummaryPromptConfig(),
  createChatCompletion: (payload) => createDashscopeChatCompletion(payload),
  logger: console
});


