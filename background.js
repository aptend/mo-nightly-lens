import { TokenManager } from './modules/background/token-manager.js';
import { GitHubApiClient } from './modules/background/github-api-client.js';
import { LogFetcher } from './modules/background/log-fetcher.js';
import { ProgressEmitter } from './modules/background/progress-emitter.js';
import { MessageHandler } from './modules/background/message-handler.js';
import { ReportGenerator } from './modules/background/report-generator.js';

const DEFAULT_REPO = 'matrixorigin/mo-nightly-regression';
const OWNER = 'matrixorigin';
const REPO_NAME = DEFAULT_REPO.split('/')[1];
const API_BASE = `https://api.github.com/repos/${DEFAULT_REPO}`;
const WEB_BASE = `https://github.com/${DEFAULT_REPO}`;

/**
 * Background Service Worker
 * 组合所有模块，提供统一的服务接口
 */
class BackgroundService {
  constructor() {
    // 初始化各个模块
    this.tokenManager = new TokenManager();
    this.apiClient = new GitHubApiClient(this.tokenManager, API_BASE);
    this.logFetcher = new LogFetcher(this.tokenManager, WEB_BASE, API_BASE, OWNER, REPO_NAME);
    this.progressEmitter = new ProgressEmitter();
    this.reportGenerator = new ReportGenerator(
      this.tokenManager,
      this.apiClient,
      this.logFetcher,
      this.progressEmitter,
      DEFAULT_REPO,
      OWNER,
      REPO_NAME
    );
    this.messageHandler = new MessageHandler({
      tokenManager: this.tokenManager,
      apiClient: this.apiClient,
      logFetcher: this.logFetcher,
      progressEmitter: this.progressEmitter,
      reportGenerator: this.reportGenerator
    });
  }

  async init() {
    // 初始化 token manager
    await this.tokenManager.init();

    // 初始化进度发送器的连接监听
    this.progressEmitter.initConnectionListener();

    // 启动消息队列处理
    this.progressEmitter.startQueueProcessor();

    // 注册消息监听器
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.messageHandler.handleMessage(request, sender, sendResponse);
      return true;
    });
  }
}

// Initialize background service
const backgroundService = new BackgroundService();
backgroundService.init();
