/**
 * 状态管理器
 * 负责管理运行状态和失败报告缓存
 */
export class StateManager {
  constructor() {
    this.runStates = new Map();
    this.failureReports = new Map();
    this.timelineOpen = new Set();
  }

  getRunState(runId) {
    if (this.runStates.has(runId)) {
      return this.runStates.get(runId);
    }

    if (this.failureReports.has(runId)) {
      const readyState = { status: 'ready', message: 'Failure report available' };
      this.runStates.set(runId, readyState);
      return readyState;
    }

    const defaultState = { status: 'idle', message: null };
    this.runStates.set(runId, defaultState);
    return defaultState;
  }

  setRunState(runId, state) {
    const previous = this.runStates.get(runId) || { status: 'idle', message: null };
    const next = {
      status: Object.prototype.hasOwnProperty.call(state, 'status')
        ? state.status
        : previous.status,
      message: Object.prototype.hasOwnProperty.call(state, 'message')
        ? state.message
        : previous.message,
      progress: Object.prototype.hasOwnProperty.call(state, 'progress')
        ? state.progress
        : previous.progress,
      error: Object.prototype.hasOwnProperty.call(state, 'error')
        ? state.error
        : previous.error
    };
    console.debug('[GitHub Actions Extension] setRunState', runId, {
      previous,
      next
    });
    this.runStates.set(runId, next);
  }

  getFailureReport(runId) {
    return this.failureReports.get(runId) || null;
  }

  setFailureReport(runId, report) {
    if (report) {
      this.failureReports.set(runId, report);
      this.setRunState(runId, {
        status: 'ready',
        message: 'Failure report available'
      });
    } else {
      this.failureReports.delete(runId);
      this.setRunState(runId, {
        status: 'idle',
        message: null
      });
    }
  }

  updateFailureReportsCache(reportData = {}) {
    if (!reportData || typeof reportData !== 'object') {
      return;
    }

    Object.entries(reportData).forEach(([runId, report]) => {
      if (!runId) {
        return;
      }
      if (report) {
        this.failureReports.set(runId, report);
        this.setRunState(runId, {
          status: 'ready',
          message: 'Failure report available'
        });
      } else {
        this.failureReports.delete(runId);
        this.setRunState(runId, {
          status: 'idle',
          message: null
        });
      }
    });
  }

  isTimelineOpen(runId) {
    return this.timelineOpen.has(runId);
  }

  toggleTimeline(runId) {
    if (this.timelineOpen.has(runId)) {
      this.timelineOpen.delete(runId);
    } else {
      this.timelineOpen.add(runId);
    }
  }

  getAllRunIds() {
    return Array.from(this.runStates.keys());
  }
}

