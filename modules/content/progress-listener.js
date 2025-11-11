/**
 * 进度监听器
 * 负责监听和处理来自 background 的进度消息
 */
export class ProgressListener {
  constructor(stateManager, onProgressUpdate) {
    this.stateManager = stateManager;
    this.onProgressUpdate = onProgressUpdate; // 回调函数，用于更新 UI
    this.progressListenerRegistered = false;
    this.progressPollInterval = null;
    this.lastProgressTimestamp = new Map(); // runId -> timestamp
    this.progressPort = null;
  }

  register() {
    if (this.progressListenerRegistered || !chrome?.runtime?.onMessage) {
      return;
    }

    const ensurePort = () => {
      try {
        if (this.progressPort) {
          return;
        }
        const port = chrome.runtime.connect({ name: 'failureReportProgress' });
        this.progressPort = port;
        this.progressPort.onDisconnect.addListener(() => {
          this.progressPort = null;
          console.debug('[GitHub Actions Extension] Progress port disconnected');
        });
        this.progressPort.onMessage.addListener((message) => {
          if (!message || message.action !== 'failureReportProgress') {
            return;
          }
          console.debug('[GitHub Actions Extension] Progress event received via port', message);
          this.handleProgress(message);
        });
        console.debug('[GitHub Actions Extension] Progress port established');
      } catch (error) {
        console.warn('[GitHub Actions Extension] Failed to open progress port:', error);
      }
    };

    ensurePort();

    const handler = (message) => {
      if (!message || message.action !== 'failureReportProgress') {
        return;
      }
      console.debug('[GitHub Actions Extension] Progress event received', message);
      this.handleProgress(message);
    };

    chrome.runtime.onMessage.addListener(handler);

    this.progressListenerRegistered = true;
    this.startPolling();
  }

  handleProgress(message) {
    if (!message) {
      return;
    }

    const { runId, payload, timestamp } = message;
    if (!runId || !payload) {
      return;
    }

    // 更新最后接收时间戳
    if (timestamp) {
      this.lastProgressTimestamp.set(runId, timestamp);
    }

    const type = payload.type || 'status';
    const label = payload.label || payload.meta?.label || payload.meta?.name || null;
    let stateUpdate;

    if (type === 'phaseError' || type === 'error') {
      stateUpdate = {
        status: 'error',
        message: payload.error || label || 'Failed to generate failure report',
        error: payload.error || label || 'Unknown error',
        progress: payload
      };
    } else if (type === 'complete') {
      const summary = payload.reportSummary || {};
      const contextCount = typeof summary.errorContextCount === 'number' ? summary.errorContextCount : null;
      const summaryMessage =
        label ||
        (contextCount != null
          ? `Failure report ready (${contextCount} error contexts)`
          : 'Failure report available');
      stateUpdate = {
        status: 'ready',
        message: summaryMessage,
        progress: payload
      };
    } else {
      stateUpdate = {
        status: 'loading',
        message: label || 'Analyzing failure report...',
        progress: payload
      };
    }

    this.stateManager.setRunState(runId, stateUpdate);

    // 调用回调更新 UI
    if (this.onProgressUpdate) {
      this.onProgressUpdate(runId, stateUpdate);
    }
  }

  /**
   * 启动进度轮询（从 chrome.storage 读取备份消息）
   */
  startPolling() {
    if (this.progressPollInterval) {
      return;
    }

    // 每 3 秒轮询一次 storage 中的进度消息
    this.progressPollInterval = setInterval(() => {
      this.pollProgressFromStorage().catch(err => {
        console.warn('[GitHub Actions Extension] Progress polling error:', err);
      });
    }, 3000);

    // 立即轮询一次
    this.pollProgressFromStorage().catch(err => {
      console.warn('[GitHub Actions Extension] Initial progress polling error:', err);
    });
  }

  /**
   * 停止进度轮询
   */
  stopPolling() {
    if (this.progressPollInterval) {
      clearInterval(this.progressPollInterval);
      this.progressPollInterval = null;
    }
  }

  /**
   * 从 chrome.storage 轮询进度消息
   */
  async pollProgressFromStorage() {
    // 获取所有正在加载的 runId
    const activeRunIds = this.stateManager.getAllRunIds().filter(runId => {
      const state = this.stateManager.getRunState(runId);
      return state && state.status === 'loading';
    });

    if (activeRunIds.length === 0) {
      return;
    }

    // 检查每个 runId 的进度消息
    for (const runId of activeRunIds) {
      try {
        const key = `progress_${runId}`;
        const result = await chrome.storage.local.get(key);
        const progressList = result[key] || [];

        if (progressList.length === 0) {
          continue;
        }

        // 获取最后已知的时间戳
        const lastTimestamp = this.lastProgressTimestamp.get(runId) || 0;

        // 处理新的消息
        for (const item of progressList) {
          const itemTimestamp = item.timestamp || 0;
          if (itemTimestamp > lastTimestamp) {
            // 这是一个新消息，处理它
            this.handleProgress({
              action: 'failureReportProgress',
              runId,
              payload: item.payload,
              timestamp: itemTimestamp
            });
          }
        }

        // 更新最后时间戳
        if (progressList.length > 0) {
          const latest = progressList[progressList.length - 1];
          const latestTimestamp = latest.timestamp || 0;
          if (latestTimestamp > lastTimestamp) {
            this.lastProgressTimestamp.set(runId, latestTimestamp);
          }
        }
      } catch (error) {
        console.warn(`[GitHub Actions Extension] Failed to poll progress for runId ${runId}:`, error);
      }
    }
  }
}

