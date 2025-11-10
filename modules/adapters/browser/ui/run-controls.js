import { ensureChild, setElementText, toggleHidden } from '../runtime/dom-utils.js';

const DEFAULT_MESSAGES = {
  analyzing: 'Generating failure report...',
  ready: 'Failure report available',
  idle: '',
  error: 'Failed to generate failure report'
};

export function renderRunControls({
  container,
  runId,
  state,
  onAnalyze,
  isTimelineOpen,
  timelineRenderer,
  stylesInjector
}) {
  if (!container) {
    return;
  }

  const { status, message } = state || {};
  const isLoading = status === 'loading';
  const isReady = status === 'ready';
  const isError = status === 'error';

  container.classList.add('dc-run-controls');
  container.dataset.runId = runId;

  if (typeof stylesInjector === 'function') {
    stylesInjector();
  }

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

  const timelineContainer = ensureChild(container, '.dc-timeline', () => {
    const el = document.createElement('div');
    el.className = 'dc-timeline';
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    container.appendChild(el);
    return el;
  });

  button.disabled = isLoading;
  button.classList.toggle('dc-action-button--loading', isLoading);
  button.classList.toggle('dc-action-button--ready', isReady);

  let buttonLabel = 'Analyze';
  if (isLoading) {
    buttonLabel = 'Analyzing...';
  } else if (isReady) {
    buttonLabel = isTimelineOpen ? 'Hide Details' : 'Details';
  }
  setElementText(button, buttonLabel);

  statusText.classList.remove('dc-status--error', 'dc-status--success');
  const effectiveMessage =
    message ||
    (isLoading
      ? DEFAULT_MESSAGES.analyzing
      : isReady
        ? DEFAULT_MESSAGES.ready
        : isError
          ? DEFAULT_MESSAGES.error
          : DEFAULT_MESSAGES.idle);
  setElementText(statusText, effectiveMessage);
  if (effectiveMessage) {
    if (isReady) {
      statusText.classList.add('dc-status--success');
    } else if (isError) {
      statusText.classList.add('dc-status--error');
    }
  }

  if (typeof onAnalyze === 'function') {
    button.onclick = () => onAnalyze({ runId, state });
  }

  if (isReady && timelineRenderer) {
    timelineRenderer({
      container: timelineContainer,
      isOpen: Boolean(isTimelineOpen)
    });
  } else {
    toggleHidden(timelineContainer, true);
  }

  return {
    container,
    button,
    statusText,
    timelineContainer
  };
}


