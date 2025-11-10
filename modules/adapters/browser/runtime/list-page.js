import { waitForCondition, observeMutations } from './dom-utils.js';

const WORKFLOW_ITEM_SELECTOR = '[data-testid="workflow-run-row"], .Box-row, .workflow-run-item';
const WORKFLOW_LIST_SELECTOR = '.workflow-list, [data-testid="workflow-runs"]';

function getRunIdFromLink(link) {
  const href = link?.getAttribute('href') || link?.href;
  const match = href && href.match(/\/actions\/runs\/(\d+)/);
  return match ? match[1] : null;
}

function getOrCreateControlsContainer(item, runId) {
  const host = item.matches('a') && item.parentElement ? item.parentElement : item;
  const existing = host.querySelector(`.dc-run-controls[data-run-id="${runId}"]`);
  if (existing) {
    return existing;
  }
  const container = document.createElement('div');
  container.className = 'dc-run-controls';
  container.dataset.runId = runId;
  host.appendChild(container);
  return container;
}

export function createListPageController({
  stateStore,
  loadStoredState,
  uiRenderer,
  renderRunControls,
  renderTimeline,
  ensureStyles,
  buildIssueUrl,
  onAnalyze
}) {
  const runItems = new Map();
  let disposeProgress = null;
  let namespaceCache = {};
  let observerCleanup = null;

  function renderTimelineInto(container, report, isOpen) {
    if (!container) {
      return;
    }
    if (report && renderTimeline) {
      renderTimeline({
        container,
        report,
        buildIssueUrl: buildIssueUrl ? (contextId) => buildIssueUrl(report, contextId) : undefined
      });
      container.hidden = !isOpen;
      container.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    } else {
      container.hidden = true;
      container.setAttribute('aria-hidden', 'true');
    }
  }

  function renderRunItem(item, runId, namespaceInfo) {
    if (!item || !runId) {
      return;
    }
    runItems.set(runId, item);
    if (namespaceInfo) {
      if (uiRenderer?.renderNamespace) {
        uiRenderer.renderNamespace(item, namespaceInfo.namespace);
      } else {
        const badge = document.createElement('span');
        badge.textContent = `Namespace: ${namespaceInfo.namespace}`;
        badge.className = 'dc-namespace-badge';
        item.appendChild(badge);
      }
    }

    const container = getOrCreateControlsContainer(item, runId);
    const state = stateStore.getRunState(runId);
    const report = stateStore.getFailureReport(runId);

    renderRunControls({
      container,
      runId,
      state,
      stylesInjector: ensureStyles,
      onAnalyze: () => onAnalyze(runId, item),
      isTimelineOpen: stateStore.isTimelineOpen(runId),
      timelineRenderer: ({ container: timelineContainer, isOpen }) =>
        renderTimelineInto(timelineContainer, report, isOpen)
    });
  }

  function renderAllItems(namespaces, reports) {
    const items = document.querySelectorAll(WORKFLOW_ITEM_SELECTOR);
    items.forEach((item) => {
      const runLink = item.querySelector('a[href*="/actions/runs/"]');
      const runId = getRunIdFromLink(runLink);
      if (!runId) {
        return;
      }
      const namespaceInfo = (namespaceCache && namespaceCache[runId]) || namespaces?.[runId] || null;
      const report = reports?.[runId] || null;
      if (report) {
        stateStore.setFailureReport(runId, report);
      }
      renderRunItem(item, runId, namespaceInfo);
    });
  }

  function subscribeToStateChanges() {
    return stateStore.subscribe((runId) => {
      const item = runItems.get(runId);
      if (item) {
        renderRunItem(item, runId, namespaceCache?.[runId] || null);
      }
    });
  }

  function observeWorkflowList() {
    const host = document.querySelector(WORKFLOW_LIST_SELECTOR);
    if (!host) {
      return;
    }
    observerCleanup = observeMutations(
      host,
      async () => {
        const { namespaces: latestNamespaces, reports: latestReports } = await loadStoredState();
        namespaceCache = latestNamespaces || {};
        stateStore.syncFailureReports(latestReports);
        renderAllItems(namespaceCache, latestReports);
      },
      { childList: true, subtree: true }
    );
  }

  async function init() {
    await waitForCondition(() => document.querySelector(WORKFLOW_LIST_SELECTOR));
    const { namespaces, reports } = await loadStoredState();
    namespaceCache = namespaces || {};
    stateStore.syncFailureReports(reports);
    renderAllItems(namespaceCache, reports);
    observeWorkflowList();
    const unsubscribe = subscribeToStateChanges();
    disposeProgress = stateStore.registerProgressChannel();
    return () => {
      unsubscribe();
      if (observerCleanup) {
        observerCleanup();
        observerCleanup = null;
      }
      if (typeof disposeProgress === 'function') {
        disposeProgress();
      }
    };
  }

  return { init };
}
