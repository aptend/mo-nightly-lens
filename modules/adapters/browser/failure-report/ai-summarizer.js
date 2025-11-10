import { createAiSummarizer } from '../../../core/failure-report/ai-summarizer.js';
import { createDashscopeChatCompletion } from '../ai/dashscope-client.js';
import { getAiSummarySettings, loadSummaryPromptConfig } from '../../../config/browser.js';

export const enrichReportWithAiSummaries = createAiSummarizer({
  getSettings: (overrides) => getAiSummarySettings(overrides || {}),
  loadPromptConfig: () => loadSummaryPromptConfig(),
  createChatCompletion: (payload) => createDashscopeChatCompletion(payload),
  logger: console
});


