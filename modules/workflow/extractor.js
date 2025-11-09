export class WorkflowExtractor {
  extractRunId(url = window.location.href) {
    const match = url.match(/\/actions\/runs\/(\d+)/);
    return match ? match[1] : null;
  }

  extractWorkflowId(url = window.location.href) {
    const match = url.match(/\/workflows\/([^/]+)/);
    return match ? match[1] : null;
  }

  findJob(jobName) {
    const jobElements = document.querySelectorAll(
      '[data-testid="workflow-job"], .TimelineItem-body h3, .workflow-job, [data-job-name]'
    );

    for (const job of jobElements) {
      const jobTitle = job.textContent || '';
      const jobNameAttr = job.getAttribute('data-job-name') || '';

      if (jobTitle.includes(jobName) || jobNameAttr.includes(jobName)) {
        return (
          job.closest('.TimelineItem') ||
          job.closest('.workflow-job-container') ||
          job.closest('[data-testid="workflow-job"]') ||
          job
        );
      }
    }

    return null;
  }

  findStep(jobElement, stepName) {
    if (!jobElement) {
      return null;
    }

    const stepElements = jobElement.querySelectorAll(
      '.TimelineItem-body, .workflow-step, [data-step-name], .details-summary'
    );

    for (const step of stepElements) {
      const stepTitle = step.textContent || '';
      const stepNameAttr = step.getAttribute('data-step-name') || '';

      if (stepTitle.includes(stepName) || stepNameAttr.includes(stepName)) {
        return step;
      }
    }

    return null;
  }

  extractWorkflowRuns() {
    const runs = [];
    const runElements = document.querySelectorAll(
      '[data-testid="workflow-run-row"], .Box-row a[href*="/actions/runs/"], .workflow-run-item'
    );

    runElements.forEach((element) => {
      const link = element.querySelector('a[href*="/actions/runs/"]') || element;
      const href = link.href || link.getAttribute('href');
      const runIdMatch = href.match(/\/actions\/runs\/(\d+)/);

      if (runIdMatch) {
        runs.push({
          runId: runIdMatch[1],
          element,
          url: href,
          status: this.extractStatus(element),
          createdAt: this.extractCreatedAt(element)
        });
      }
    });

    return runs;
  }

  extractStatus(element) {
    const statusElements = element.querySelectorAll('[aria-label*="Status"], .status-badge, [data-status]');
    for (const statusEl of statusElements) {
      const status =
        statusEl.getAttribute('aria-label') ||
        statusEl.textContent ||
        statusEl.getAttribute('data-status');
      if (status) {
        return status.toLowerCase();
      }
    }
    return 'unknown';
  }

  extractCreatedAt(element) {
    const timeElements = element.querySelectorAll('time, [datetime]');
    for (const timeEl of timeElements) {
      const datetime = timeEl.getAttribute('datetime');
      if (datetime) {
        return datetime;
      }
    }
    return null;
  }
}


