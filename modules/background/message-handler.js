/**
 * 消息处理器
 * 负责处理来自 content script 和 popup 的消息
 */
export class MessageHandler {
  constructor(services) {
    this.services = services; // { tokenManager, apiClient, logFetcher, progressEmitter, reportGenerator }
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'fetchStepLogs': {
          const logText = await this.services.reportGenerator.fetchStepLogs(
            request.runId,
            request.jobName,
            request.stepName
          );
          sendResponse({ logText });
          break;
        }

        case 'setGitHubToken': {
          await this.services.tokenManager.setGitHubToken(request.token);
          sendResponse({ success: true });
          break;
        }

        case 'setAiSummaryToken': {
          await this.services.tokenManager.setAiSummaryToken(request.token);
          sendResponse({ success: true });
          break;
        }

        case 'generateFailureReport': {
          const tabId = sender?.tab?.id ?? null;
          const report = await this.services.reportGenerator.generateFailureReport(
            request.runId,
            { tabId }
          );
          sendResponse({ success: true, report });
          break;
        }

        case 'getFailureReport': {
          const report = await this.services.reportGenerator.getStoredFailureReport(request.runId);
          sendResponse({ success: true, report });
          break;
        }

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Background service error:', error);
      sendResponse({ error: error.message });
    }
  }
}

