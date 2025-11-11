/**
 * 进度消息发送器
 * 负责发送进度消息，包括消息队列和重试机制
 */
const connectionRegistry = new Map(); // tabId -> port

export class ProgressEmitter {
  constructor() {
    this.messageQueue = new Map(); // runId -> Array<{timestamp, message, retries}>
    this.queueProcessingInterval = null;
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1秒
    this.runTabMap = new Map(); // runId -> tabId
  }

  /**
   * 初始化连接监听
   */
  initConnectionListener() {
    chrome.runtime.onConnect.addListener((port) => {
      if (!port || port.name !== 'failureReportProgress') {
        return;
      }
      const tabId = port.sender?.tab?.id ?? null;
      const context = tabId != null ? 'tab' : 'extension';
      console.debug('[GitHub Actions Extension] Port connected', { tabId, context });

      if (tabId != null) {
        connectionRegistry.set(tabId, port);
        // Port 连接时，尝试发送队列中的消息
        this.flushQueueForTab(tabId);
      }
      
      // 监听 port 错误
      port.onDisconnect.addListener(() => {
        if (tabId != null) {
          connectionRegistry.delete(tabId);
        }
        console.debug('[GitHub Actions Extension] Port disconnected', { tabId, context });
      });
    });
  }

  /**
   * 发送进度消息
   */
  emitProgress(tabId, runId, payload) {
    const message = {
      action: 'failureReportProgress',
      runId,
      payload,
      timestamp: Date.now()
    };

    if (tabId != null) {
      console.debug('[GitHub Actions Extension] Emitting progress (tab)', tabId, runId, payload);
    } else {
      console.debug('[GitHub Actions Extension] Emitting progress (broadcast)', runId, payload);
    }

    // 尝试立即发送
    const sent = this.trySendMessage(tabId, message);
    
    // 如果发送失败，加入队列
    if (!sent) {
      this.enqueueMessage(runId, tabId, message);
    }

    // 同时写入 chrome.storage 作为备份（用于 content script 轮询）
    this.saveProgressToStorage(runId, message).catch(err => {
      console.warn('[GitHub Actions Extension] Failed to save progress to storage:', err);
    });
  }

  /**
   * 尝试发送消息，返回是否成功
   */
  trySendMessage(tabId, message) {
    let portSent = false;
    let broadcastSent = false;

    // 方法1: 通过 port 发送（如果 tabId 存在）
    if (tabId != null) {
      const port = connectionRegistry.get(tabId);
      if (port) {
        try {
          // 检查 port 是否仍然连接
          if (port.sender) {
            port.postMessage(message);
            portSent = true;
            console.debug('[GitHub Actions Extension] Message sent via port', { tabId, runId: message.runId });
          }
        } catch (error) {
          console.warn('[GitHub Actions Extension] Failed to post progress message via port:', error);
          // Port 可能已断开，从注册表中移除
          connectionRegistry.delete(tabId);
        }
      }
    }

    // 方法2: 通过 sendMessage 广播（作为 fallback）
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          // 如果没有监听器，这是正常的，不算错误
          if (!lastError.message.includes('Could not establish connection')) {
            console.debug(
              '[GitHub Actions Extension] Broadcast progress error:',
              lastError.message
            );
          }
        } else {
          broadcastSent = true;
        }
      });
    } catch (error) {
      console.warn('[GitHub Actions Extension] Failed to send broadcast message:', error);
    }

    // 只要有一种方式成功就算成功
    return portSent || broadcastSent;
  }

  /**
   * 将消息加入队列
   */
  enqueueMessage(runId, tabId, message) {
    if (!this.messageQueue.has(runId)) {
      this.messageQueue.set(runId, []);
    }
    
    const queue = this.messageQueue.get(runId);
    queue.push({
      timestamp: Date.now(),
      tabId,
      message,
      retries: 0
    });

    // 限制队列大小，避免内存泄漏
    if (queue.length > 100) {
      queue.shift(); // 移除最旧的消息
    }

    console.debug('[GitHub Actions Extension] Message enqueued', {
      runId,
      tabId,
      queueSize: queue.length
    });
  }

  /**
   * 处理队列中的消息
   */
  async processQueue() {
    if (this.messageQueue.size === 0) {
      return;
    }

    const now = Date.now();

    for (const [runId, queue] of this.messageQueue.entries()) {
      const remaining = [];
      
      for (const item of queue) {
        // 如果重试次数过多，跳过
        if (item.retries >= this.maxRetries) {
          console.warn('[GitHub Actions Extension] Message max retries reached, dropping', {
            runId,
            tabId: item.tabId,
            retries: item.retries
          });
          continue;
        }

        // 如果距离上次尝试时间太短，等待
        const timeSinceLastAttempt = now - (item.lastAttempt || item.timestamp);
        if (timeSinceLastAttempt < this.retryDelay) {
          remaining.push(item);
          continue;
        }

        // 尝试发送
        item.lastAttempt = now;
        const sent = this.trySendMessage(item.tabId, item.message);
        
        if (!sent) {
          item.retries++;
          remaining.push(item);
        }
      }

      if (remaining.length === 0) {
        this.messageQueue.delete(runId);
      } else {
        this.messageQueue.set(runId, remaining);
      }
    }
  }

  /**
   * 启动队列处理器
   */
  startQueueProcessor() {
    if (this.queueProcessingInterval) {
      return;
    }

    // 每 2 秒处理一次队列
    this.queueProcessingInterval = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('[GitHub Actions Extension] Queue processing error:', err);
      });
    }, 2000);

    // 立即处理一次
    this.processQueue().catch(err => {
      console.error('[GitHub Actions Extension] Initial queue processing error:', err);
    });
  }

  /**
   * 停止队列处理器
   */
  stopQueueProcessor() {
    if (this.queueProcessingInterval) {
      clearInterval(this.queueProcessingInterval);
      this.queueProcessingInterval = null;
    }
  }

  /**
   * 为特定 tab 刷新队列
   */
  flushQueueForTab(tabId) {
    if (!tabId) {
      return;
    }

    for (const [runId, queue] of this.messageQueue.entries()) {
      const tabMessages = queue.filter(item => item.tabId === tabId);
      if (tabMessages.length === 0) {
        continue;
      }

      const remaining = queue.filter(item => item.tabId !== tabId);
      
      for (const item of tabMessages) {
        const sent = this.trySendMessage(tabId, item.message);
        if (!sent) {
          remaining.push(item);
        }
      }

      if (remaining.length === 0) {
        this.messageQueue.delete(runId);
      } else {
        this.messageQueue.set(runId, remaining);
      }
    }
  }

  /**
   * 将进度消息保存到 chrome.storage（作为备份）
   */
  async saveProgressToStorage(runId, message) {
    if (!runId) {
      return;
    }

    const key = `progress_${runId}`;
    const existing = await chrome.storage.local.get(key);
    const progressList = existing[key] || [];
    
    // 添加新消息
    progressList.push({
      timestamp: message.timestamp || Date.now(),
      payload: message.payload
    });

    // 只保留最近 50 条消息
    if (progressList.length > 50) {
      progressList.shift();
    }

    await chrome.storage.local.set({ [key]: progressList });
  }

  /**
   * 创建进度报告器
   */
  createProgressReporter(runId, tabId) {
    if (tabId != null) {
      this.runTabMap.set(runId, tabId);
    }
    const emit = (type, payload = {}) => {
      this.emitProgress(tabId, runId, {
        type,
        ...payload
      });
    };

    return {
      phaseStart: (payload) => {
        emit('phaseStart', {
          label: payload?.label || payload?.name || 'Working...',
          meta: payload || null
        });
      },
      phaseComplete: (payload) => {
        emit('phaseComplete', {
          label: payload?.label || payload?.name || null,
          meta: payload || null
        });
      },
      phaseError: (payload) => {
        emit('phaseError', {
          error: payload?.error || 'Unknown error',
          label: payload?.label || payload?.name || 'Phase failed',
          meta: payload || null
        });
      },
      jobStart: (payload) => {
        emit('jobStart', {
          label: `Processing job: ${payload?.jobName || payload?.jobId || ''}`,
          meta: payload || null
        });
      },
      jobComplete: (payload) => {
        emit('jobComplete', {
          label: `Completed job: ${payload?.jobName || payload?.jobId || ''}`,
          meta: payload || null
        });
      },
      stepStart: (payload) => {
        emit('stepStart', {
          label: `Fetching step: ${payload?.stepName || `#${payload?.stepNumber ?? '?'}`}`,
          meta: payload || null
        });
      },
      stepComplete: (payload) => {
        emit('stepComplete', {
          label: `Analyzed step: ${payload?.stepName || `#${payload?.stepNumber ?? '?'}`}`,
          meta: payload || null
        });
      },
      stepLogFetchStart: (payload) => {
        emit('stepLogFetchStart', {
          label: `Downloading logs for ${payload?.stepName || `step ${payload?.stepNumber ?? '?'}`}`,
          meta: payload || null
        });
      },
      stepLogFetchComplete: (payload) => {
        emit('stepLogFetchComplete', {
          label: `Downloaded logs for ${payload?.stepName || `step ${payload?.stepNumber ?? '?'}`}`,
          meta: payload || null
        });
      },
      status: (payload) => {
        emit('status', payload || {});
      }
    };
  }

  /**
   * 发送运行进度（通过 runId 查找 tabId）
   */
  emitRunProgress(runId, payload = {}) {
    if (!runId) {
      return;
    }
    const tabId = this.runTabMap.get(runId) ?? null;
    this.emitProgress(tabId, runId, payload);
  }

  /**
   * 清理 runId 的映射
   */
  clearRunMapping(runId) {
    this.runTabMap.delete(runId);
  }
}

