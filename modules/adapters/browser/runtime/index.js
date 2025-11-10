import { createRunStateStore } from './run-state-store.js';
import { createListPageController } from './list-page.js';
import { createRunPageController } from './run-page.js';
import { createIssueLinkBuilder } from './issue-link-builder.js';
import { loadStoredState } from './storage.js';
import { requestFailureReport } from './report-service.js';
import { ensureChild, setElementText, toggleHidden } from './dom-utils.js';

const ISSUE_MODULE_PATH = 'modules/adapters/browser/issues/context-issue-builder.js';
const FALLBACK_STATE = { status: 'idle', message: null, progress: undefined, error: undefined };

const fallbackMerge = (previous = FALLBACK_STATE, next = {}) => ({
  status: Object.prototype.hasOwnProperty.call(next, 'status')
    ? next.status
    : previous.status ?? FALLBACK_STATE.status,
  message: Object.prototype.hasOwnProperty.call(next, 'message')
    ? next.message
    : previous.message ?? FALLBACK_STATE.message,
  progress: Object.prototype.hasOwnProperty.call(next, 'progress')
    ? next.progress
    : previous.progress,
  error: Object.prototype.hasOwnProperty.call(next, 'error') ? next.error : previous.error
});

const fallbackDerive = (payload) => {
  if (!payload) {
    return null;
  }
  const type = payload.type || 'status';
  const label = payload.label || payload.meta?.label || payload.meta?.name || payload.name || null;

  if (type === 'phaseError' || type === 'error') {
    const message = payload.error || label || 'Failed to generate failure report';
    return { status: 'error', message, error: message, progress: payload };
  }

  if (type === 'complete') {
    const summary = payload.reportSummary || {};
    const contextCount = typeof summary.errorContextCount === 'number' ? summary.errorContextCount : null;
    return {
      status: 'ready',
      message: contextCount != null
        ? `Failure report ready (${contextCount} error contexts)`
        : label || 'Failure report available',
      progress: payload
    };
  }

  return {
    status: 'loading',
    message: label || 'Analyzing failure report...',
    progress: payload
  };
};

const fallbackDefaultState = () => ({ ...FALLBACK_STATE });

const ensureStylesFallback = () => {
  const existing = document.getElementById('daily-check-content-styles');
  if (existing) {
    return;
  }
  const href = chrome?.runtime?.getURL?.('styles/failure-report.css');
  if (href) {
    const link = document.createElement('link');
    link.id = 'daily-check-content-styles';
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    return;
  }
  const style = document.createElement('style');
  style.id = 'daily-check-content-styles';
  style.textContent = `
    .dc-run-controls { margin-top: 8px; font-size: 12px; }
    .dc-action-button { padding: 4px 10px; }
  `;
  document.head.appendChild(style);
};

const fallbackRunControls = ({
  container,
  runId,
  state,
  onAnalyze,
  isTimelineOpen
}) => {
  if (!container) {
    return;
  }
  container.classList.add('dc-run-controls');
  container.dataset.runId = runId;

  const actionBar = ensureChild(container, '.dc-action-bar', () => {
    const bar = document.createElement('div');
    bar.className = 'dc-action-bar';
    container.appendChild(bar);
    return bar;
  });

  const button = ensureChild(actionBar, '.dc-action-button', () => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'dc-action-button';
    actionBar.appendChild(el);
    return el;
  });

  const statusText = ensureChild(actionBar, '.dc-status-text', () => {
    const el = document.createElement('span');
    el.className = 'dc-status-text';
    actionBar.appendChild(el);
    return el;
  });

  const status = state?.status || 'idle';
  const isLoading = status === 'loading';
  const isReady = status === 'ready';
  const isError = status === 'error';

  button.disabled = isLoading;
  let label = 'Analyze';
  if (isLoading) {
    label = 'Analyzing...';
  } else if (isReady) {
    label = isTimelineOpen ? 'Hide Details' : 'Details';
  }
  setElementText(button, label);

  if (typeof onAnalyze === 'function') {
    button.onclick = () => onAnalyze({ runId, state });
  }

  const message = state?.message;
  const fallbackMessage = isLoading
    ? 'Generating failure report...'
    : isError
      ? 'Failed to generate report'
      : isReady
        ? 'Failure report available'
        : '';
  setElementText(statusText, message || fallbackMessage);
};

function isRunPage(url) {
  return url.includes('/actions/runs/');
}

function isListPage(url) {
  return url.includes('/actions/workflows/');
}

export function createBrowserRuntime({
  NamespaceExtractor,
  UIRenderer,
  progressModule,
  issueModule,
  timelineModule,
  stylesModule,
  controlsModule
}) {
  const namespaceExtractor = NamespaceExtractor ? new NamespaceExtractor() : null;
  const uiRenderer = UIRenderer ? new UIRenderer() : null;

  const ensureStyles = stylesModule?.ensureFailureReportStyles || ensureStylesFallback;
  const renderRunControls = controlsModule?.renderRunControls || fallbackRunControls;
  const renderTimeline = timelineModule?.renderFailureTimeline || null;

  const channelName = progressModule?.FAILURE_REPORT_PROGRESS_CHANNEL || 'failureReportProgress';
  const mergeRunState = progressModule?.mergeRunState || fallbackMerge;
  const getDefaultRunState = progressModule?.getDefaultRunState || fallbackDefaultState;
  const deriveRunStateFromProgress = progressModule?.deriveRunStateFromProgress || fallbackDerive;
  const isProgressMessage = typeof progressModule?.isFailureReportProgressMessage === 'function'
    ? (message) => progressModule.isFailureReportProgressMessage(message)
    : (message) => message?.action === channelName;

  const stateStore = createRunStateStore({
    mergeRunState,
    getDefaultRunState,
    deriveRunStateFromProgress,
    isProgressMessage,
    channelName
  });

  const buildIssueUrl = createIssueLinkBuilder({
    initialBuilder: issueModule?.buildIssuePayload,
    modulePath: ISSUE_MODULE_PATH
  });

  const runPage = createRunPageController({ namespaceExtractor });

  const listPage = createListPageController({
    stateStore,
    loadStoredState,
    uiRenderer,
    renderRunControls,
    renderTimeline,
    ensureStyles,
    buildIssueUrl,
    onAnalyze: async (runId) => {
      const currentState = stateStore.getRunState(runId);
      const existingReport = stateStore.getFailureReport(runId);
      if (existingReport && currentState.status === 'ready') {
        stateStore.toggleTimeline(runId);
        return;
      }
      stateStore.setRunState(runId, { status: 'loading', message: 'Starting analysis...' });
      try {
        ensureStyles();
        const report = await requestFailureReport(runId);
        if (!report) {
          throw new Error('Empty failure report received');
        }
        stateStore.setFailureReport(runId, report);
        stateStore.openTimeline(runId);
      } catch (error) {
        stateStore.setRunState(runId, {
          status: 'error',
          message: error?.message || 'Failed to generate report'
        });
      }
    }
  });

  let cleanup = null;

  async function init() {
    const url = window.location.href;
    if (isRunPage(url)) {
      await runPage.init();
    }
    if (isListPage(url)) {
      cleanup = await listPage.init();
    }
  }

  function destroy() {
    if (typeof cleanup === 'function') {
      cleanup();
      cleanup = null;
    }
  }

  return { init, destroy };
}
