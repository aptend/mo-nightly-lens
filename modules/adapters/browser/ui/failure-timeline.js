function safeFormatDate(value) {
  if (!value) {
    return null;
  }
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleString();
  } catch {
    return null;
  }
}

function formatTimestamp(timestamp, fallbackLabel) {
  if (timestamp == null) {
    return fallbackLabel || 'Timestamp unavailable';
  }
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return fallbackLabel || 'Timestamp unavailable';
    }
    return date.toLocaleString();
  } catch {
    return fallbackLabel || 'Timestamp unavailable';
  }
}

function buildFallbackTimestampLabel(context, step) {
  if (context.startTimestamp != null || context.endTimestamp != null) {
    return null;
  }
  if (step.startedAt) {
    return `Step started at ${step.startedAt}`;
  }
  if (step.completedAt) {
    return `Step completed at ${step.completedAt}`;
  }
  return 'Timestamp unavailable';
}

function resolveContextTimestamp(context, step, job) {
  if (context.startTimestamp != null) {
    return context.startTimestamp;
  }
  if (context.endTimestamp != null) {
    return context.endTimestamp;
  }
  const stepStart = step.startedAt ? Date.parse(step.startedAt) : NaN;
  if (!Number.isNaN(stepStart)) {
    return stepStart;
  }
  const jobStart = job.startedAt ? Date.parse(job.startedAt) : NaN;
  if (!Number.isNaN(jobStart)) {
    return jobStart;
  }
  return null;
}

function buildTimelineEntries(report) {
  if (!report || !Array.isArray(report.jobs)) {
    return [];
  }

  const entries = [];
  report.jobs.forEach((job) => {
    const steps = Array.isArray(job.steps) ? job.steps : [];
    steps.forEach((step) => {
      const contexts = Array.isArray(step.errorContexts) ? step.errorContexts : [];
      contexts.forEach((context, index) => {
        const timestamp = resolveContextTimestamp(context, step, job);
        const fullSnippet = context?.snippet || '';
        const contextId =
          context?.aiSummary?.contextId ||
          context?.cursorSummary?.contextId ||
          context?.contextId ||
          `job-${job?.id ?? 'unknown'}-step-${step?.number ?? index}-context-${index}`;
        entries.push({
          id: contextId,
          contextId,
          jobName: job.name || 'Unknown job',
          stepName: step.name || `Step ${step.number || '?'}`,
          fullSnippet,
          timestamp,
          fallbackLabel: buildFallbackTimestampLabel(context, step),
          stepUrl: step.stepUrl || null,
          logUrl: step.logUrl || null,
          grafanaUrl: context.grafanaUrl || step.grafanaUrl || null,
          aiSummary: context.aiSummary || null,
          startLine: context.startLine ?? null,
          endLine: context.endLine ?? null
        });
      });
    });
  });

  entries.sort((a, b) => {
    if (a.timestamp == null && b.timestamp == null) {
      return 0;
    }
    if (a.timestamp == null) {
      return 1;
    }
    if (b.timestamp == null) {
      return -1;
    }
    return a.timestamp - b.timestamp;
  });

  return entries;
}

function buildOverallSummaryCard(aiSummary) {
  const card = document.createElement('div');
  card.className = 'dc-overall-summary';

  const header = document.createElement('div');
  header.className = 'dc-summary-header';
  header.textContent = 'AI Summary';

  if (aiSummary?.model) {
    const modelEl = document.createElement('span');
    modelEl.className = 'dc-summary-model';
    const generatedAt = safeFormatDate(aiSummary.generatedAt);
    modelEl.textContent = generatedAt
      ? `${aiSummary.model} • ${generatedAt}`
      : aiSummary.model;
    header.appendChild(modelEl);
  }

  card.appendChild(header);

  if (aiSummary.status === 'ok') {
    if (aiSummary.overallSummary) {
      const body = document.createElement('div');
      body.className = 'dc-summary-body';
      body.textContent = aiSummary.overallSummary;
      card.appendChild(body);
    }
    if (aiSummary.additionalNotes) {
      const notes = document.createElement('div');
      notes.className = 'dc-summary-notes';
      notes.textContent = aiSummary.additionalNotes;
      card.appendChild(notes);
    }
  } else if (aiSummary?.error) {
    const errorEl = document.createElement('div');
    errorEl.className = 'dc-summary-error';
    errorEl.textContent = aiSummary.error;
    card.appendChild(errorEl);
  } else {
    const unavailable = document.createElement('div');
    unavailable.className = 'dc-summary-error';
    unavailable.textContent = 'AI summary is unavailable for this run.';
    card.appendChild(unavailable);
  }

  return card;
}

export function renderFailureTimeline({ container, report, buildIssueUrl }) {
  if (!container) {
    return;
  }

  const entries = buildTimelineEntries(report);
  container.innerHTML = '';

  if (report?.aiSummary) {
    container.appendChild(buildOverallSummaryCard(report.aiSummary));
  }

  if (entries.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'dc-timeline-empty';
    emptyState.textContent = 'No error contexts were detected for this run.';
    container.appendChild(emptyState);
    return;
  }

  entries.forEach((entry) => {
    const entryEl = document.createElement('div');
    entryEl.className = 'dc-timeline-entry';

    const timeEl = document.createElement('div');
    timeEl.className = 'dc-timeline-time';
    timeEl.textContent = formatTimestamp(entry.timestamp, entry.fallbackLabel);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'dc-timeline-body';

    const headerEl = document.createElement('div');
    headerEl.className = 'dc-entry-header';
    headerEl.textContent = `${entry.jobName} • ${entry.stepName}`;

    const headerRow = document.createElement('div');
    headerRow.className = 'dc-entry-header-row';
    headerRow.appendChild(headerEl);

    if (entry.stepUrl) {
      const stepLink = document.createElement('a');
      stepLink.href = entry.stepUrl;
      stepLink.target = '_blank';
      stepLink.rel = 'noopener noreferrer';
      stepLink.textContent = 'View step';
      stepLink.className = 'dc-step-link';
      headerRow.appendChild(stepLink);
    }

    bodyEl.appendChild(headerRow);

    if (entry.aiSummary) {
      const inlineSummary = document.createElement('div');
      inlineSummary.className = 'dc-ai-summary-inline';

      if (entry.aiSummary.summary) {
        const inlineBody = document.createElement('div');
        inlineBody.className = 'dc-ai-summary-inline-body';
        inlineBody.textContent = entry.aiSummary.summary;
        inlineSummary.appendChild(inlineBody);
      } else {
        inlineSummary.classList.add('dc-ai-summary-inline--empty');
        inlineSummary.textContent = 'AI summary unavailable.';
      }

      bodyEl.appendChild(inlineSummary);
    }

    const detailsEl = document.createElement('div');
    detailsEl.className = 'dc-entry-details';
    detailsEl.hidden = true;

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'dc-entry-toggle';
    toggleButton.textContent = 'Show details';
    toggleButton.setAttribute('aria-expanded', 'false');

    const createIcon = (symbol) => {
      const span = document.createElement('span');
      span.className = 'dc-link-icon';
      span.textContent = symbol;
      return span;
    };

    const linkBar = document.createElement('div');
    linkBar.className = 'dc-entry-links dc-entry-links--detail';
    if (entry.logUrl) {
      const logLink = document.createElement('a');
      logLink.href = entry.logUrl;
      logLink.target = '_blank';
      logLink.rel = 'noopener noreferrer';
      logLink.appendChild(createIcon('⬇️'));
      logLink.appendChild(document.createTextNode('Download log'));
      linkBar.appendChild(logLink);
    }
    if (entry.grafanaUrl) {
      const grafanaLink = document.createElement('a');
      grafanaLink.href = entry.grafanaUrl;
      grafanaLink.target = '_blank';
      grafanaLink.rel = 'noopener noreferrer';
      grafanaLink.appendChild(createIcon('📊'));
      grafanaLink.appendChild(document.createTextNode('Open Grafana Explore'));
      linkBar.appendChild(grafanaLink);
    }
    if (entry.contextId && typeof buildIssueUrl === 'function') {
      const issueLink = document.createElement('a');
      issueLink.href = '#';
      issueLink.appendChild(createIcon('🐞'));
      issueLink.appendChild(document.createTextNode('Create issue'));
      issueLink.addEventListener('click', async (event) => {
        event.preventDefault();
        if (issueLink.dataset.loading === 'true') {
          return;
        }
        issueLink.dataset.loading = 'true';
        issueLink.classList.add('dc-link--loading');
        try {
          const issueUrl = await buildIssueUrl(entry.contextId);
          if (issueUrl) {
            window.open(issueUrl, '_blank', 'noopener,noreferrer');
          }
        } catch (error) {
          console.error('[GitHub Actions Extension] Failed to open issue link:', error);
        } finally {
          delete issueLink.dataset.loading;
          issueLink.classList.remove('dc-link--loading');
        }
      });
      linkBar.appendChild(issueLink);
    }
    if (linkBar.childNodes.length > 0) {
      detailsEl.appendChild(linkBar);
    }

    const snippetEl = document.createElement('pre');
    snippetEl.className = 'dc-entry-snippet';
    if (entry.fullSnippet) {
      snippetEl.textContent = entry.fullSnippet;
    } else {
      snippetEl.textContent = 'No log snippet captured for this context.';
      snippetEl.classList.add('dc-entry-snippet--empty');
    }
    detailsEl.appendChild(snippetEl);

    const metadataParts = [];
    if (entry.startLine != null) {
      metadataParts.push(`Start line ${entry.startLine}`);
    }
    if (entry.endLine != null) {
      metadataParts.push(`End line ${entry.endLine}`);
    }
    if (entry.contextId) {
      metadataParts.push(`ID: ${entry.contextId}`);
    }
    if (entry.aiSummary?.model) {
      metadataParts.push(`Model: ${entry.aiSummary.model}`);
    }
    if (entry.aiSummary?.generatedAt) {
      const generated = safeFormatDate(entry.aiSummary.generatedAt);
      if (generated) {
        metadataParts.push(`Generated: ${generated}`);
      }
    }
    if (metadataParts.length > 0) {
      const metadataEl = document.createElement('div');
      metadataEl.className = 'dc-entry-metadata';
      metadataEl.textContent = metadataParts.join(' • ');
      detailsEl.appendChild(metadataEl);
    }

    toggleButton.addEventListener('click', () => {
      const shouldShow = detailsEl.hidden;
      detailsEl.hidden = !shouldShow;
      toggleButton.textContent = shouldShow ? 'Hide details' : 'Show details';
      toggleButton.setAttribute('aria-expanded', shouldShow ? 'true' : 'false');
      entryEl.classList.toggle('dc-timeline-entry--expanded', shouldShow);
    });

    const actionsEl = document.createElement('div');
    actionsEl.className = 'dc-entry-actions';
    actionsEl.appendChild(toggleButton);

    bodyEl.appendChild(actionsEl);
    bodyEl.appendChild(detailsEl);

    entryEl.appendChild(timeEl);
    entryEl.appendChild(bodyEl);

    container.appendChild(entryEl);
  });
}


