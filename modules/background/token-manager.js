/**
 * Token 管理器
 * 负责 GitHub Token 和 AI Summary Token 的存储和读取
 */
export class TokenManager {
  constructor() {
    this.githubToken = null;
    this.aiSummaryToken = null;
  }

  async init() {
    const result = await chrome.storage.local.get(['githubToken', 'aiSummaryApiKey']);
    this.githubToken = result.githubToken || null;
    this.aiSummaryToken = result.aiSummaryApiKey || null;
  }

  getGitHubToken() {
    return this.githubToken;
  }

  getAiSummaryToken() {
    return this.aiSummaryToken;
  }

  async setGitHubToken(token) {
    const value = typeof token === 'string' ? token.trim() : '';
    if (!value) {
      throw new Error('GitHub token is required.');
    }
    this.githubToken = value;
    await chrome.storage.local.set({ githubToken: value });
  }

  async setAiSummaryToken(token) {
    const value = typeof token === 'string' ? token.trim() : '';
    if (!value) {
      throw new Error('AI summary token is required.');
    }
    this.aiSummaryToken = value;
    await chrome.storage.local.set({ aiSummaryApiKey: value });
  }

  buildApiHeaders(extra = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra
    };
    if (this.githubToken) {
      headers.Authorization = `token ${this.githubToken}`;
    }
    return headers;
  }
}

