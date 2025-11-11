import { unzipToTextMap } from '../utils/zip.js';

/**
 * 日志获取器
 * 负责下载和缓存 job logs 和 step logs
 */
export class LogFetcher {
  constructor(tokenManager, webBase, apiBase, owner, repoName) {
    this.tokenManager = tokenManager;
    this.webBase = webBase;
    this.apiBase = apiBase;
    this.owner = owner;
    this.repoName = repoName;
    this.jobStepCache = new Map();
    this.jobLogArchiveCache = new Map();
  }

  buildPageHeaders(extra = {}) {
    return {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ...extra
    };
  }

  async loadJobStepMetadata(runId, jobId) {
    const cacheKey = `${runId}:${jobId}`;
    if (this.jobStepCache.has(cacheKey)) {
      return this.jobStepCache.get(cacheKey);
    }

    console.log('[GitHub Actions Extension] loadJobStepMetadata:start', { runId, jobId });
    const url = `${this.webBase}/actions/runs/${runId}/job/${jobId}?check_suite_focus=true`;
    const response = await fetch(url, {
      headers: this.buildPageHeaders(),
      credentials: 'include'
    });
    if (!response.ok) {
      throw new Error(`Failed to load job page (${response.status})`);
    }
    const html = await response.text();

    const metadata = new Map();
    const stepRegex = /<check-step\b[^>]*>/gi;
    let match;
    while ((match = stepRegex.exec(html)) !== null) {
      const tag = match[0];
      const getAttr = (name) => {
        const attrRegex = new RegExp(`${name}="([^"]*)"`, 'i');
        const attrMatch = attrRegex.exec(tag);
        return attrMatch ? attrMatch[1] : null;
      };

      const numberValue = Number(getAttr('data-number'));
      if (Number.isNaN(numberValue)) {
        continue;
      }

      const rawLogUrl = getAttr('data-log-url');
      let logUrl = null;
      if (rawLogUrl) {
        try {
          logUrl = new URL(rawLogUrl, this.webBase).toString();
        } catch (error) {
          console.warn(
            '[GitHub Actions Extension] Unable to resolve step log URL',
            rawLogUrl,
            error
          );
        }
      }

      metadata.set(numberValue, {
        logUrl,
        name: getAttr('data-name'),
        conclusion: getAttr('data-conclusion')
      });
    }

    this.jobStepCache.set(cacheKey, metadata);
    console.log('[GitHub Actions Extension] loadJobStepMetadata:complete', {
      runId,
      jobId,
      stepCount: metadata.size
    });
    return metadata;
  }

  async fetchJobLogArchive(runId, jobId, onProgress) {
    if (this.jobLogArchiveCache.has(jobId)) {
      return this.jobLogArchiveCache.get(jobId);
    }

    console.log('[GitHub Actions Extension] fetchJobLogArchive:start', { jobId });
    if (onProgress) {
      onProgress({
        type: 'status',
        label: `Downloading job logs for job ${jobId}...`
      });
    }

    if (!this.tokenManager.getGitHubToken()) {
      throw new Error('GitHub token is required to download job logs.');
    }

    const url = `https://api.github.com/repos/${this.owner}/${this.repoName}/actions/jobs/${jobId}/logs`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.tokenManager.getGitHubToken()}`,
        'User-Agent': 'daily-check-extension'
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to download job log archive (${response.status} ${response.statusText}): ${body || 'no response body'}`
      );
    }

    const buffer = await response.arrayBuffer();
    const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const isZip = uint8.length >= 2 && uint8[0] === 0x50 && uint8[1] === 0x4b;
    if (!isZip) {
      let preview = '';
      try {
        preview = new TextDecoder('utf-8', { fatal: false }).decode(uint8.slice(0, 512));
      } catch (error) {
        preview = '[binary data]';
      }
      throw new Error(
        `GitHub returned a non-zip response when downloading job logs: ${preview || 'no preview available'}`
      );
    }
    const archive = unzipToTextMap(uint8);
    this.jobLogArchiveCache.set(jobId, archive);
    console.log('[GitHub Actions Extension] fetchJobLogArchive:complete', {
      jobId,
      entryCount: archive.size
    });
    if (onProgress) {
      onProgress({
        type: 'status',
        label: `Job logs downloaded (${archive.size} files)`
      });
    }
    return archive;
  }

  async getStepLogFromArchive({ runId, jobId, stepNumber, stepName }, onProgress) {
    console.log('[GitHub Actions Extension] getStepLogFromArchive:start', {
      jobId,
      stepNumber,
      stepName
    });
    if (onProgress) {
      onProgress({
        type: 'status',
        label: `Searching archive for step ${stepNumber}...`
      });
    }
    const archive = await this.fetchJobLogArchive(runId, jobId, onProgress);
    if (!archive || archive.size === 0) {
      throw new Error('Job log archive is empty.');
    }

    const normalizedStepName = (stepName || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

    const candidates = [];

    const matches = (entryName) => {
      const lowerName = entryName.toLowerCase();
      if (!lowerName.endsWith('.txt')) {
        return false;
      }

      const sanitized = lowerName.replace(/[^a-z0-9]+/g, '');
      if (sanitized.includes(`step${stepNumber}`)) {
        return true;
      }

      if (
        lowerName.startsWith(`${stepNumber}_`) ||
        lowerName.startsWith(`${stepNumber}-`) ||
        lowerName.startsWith(`${String(stepNumber).padStart(2, '0')}_`) ||
        lowerName.startsWith(`${String(stepNumber).padStart(2, '0')}-`)
      ) {
        return true;
      }

      if (normalizedStepName && sanitized.includes(normalizedStepName)) {
        return true;
      }

      return false;
    };

    for (const [name, content] of archive.entries()) {
      if (matches(name)) {
        candidates.push({ name, content });
      }
    }

    if (candidates.length === 0) {
      // As a fallback try any file containing the step number
      const numberToken = `_${stepNumber}_`;
      for (const [name, content] of archive.entries()) {
        const lower = name.toLowerCase();
        if (!lower.endsWith('.txt')) {
          continue;
        }
        if (lower.includes(numberToken)) {
          candidates.push({ name, content });
        }
      }
    }

    if (candidates.length === 0) {
      const available = Array.from(archive.keys());
      console.warn(
        '[GitHub Actions Extension] Step log not found in archive',
        {
          jobId,
          stepNumber,
          stepName,
          availableFiles: available
        }
      );
      if (onProgress) {
        onProgress({
          type: 'phaseError',
          error: `Step ${stepNumber} log not found in archive`,
          meta: { availableFiles: available }
        });
      }
      return null;
    }

    candidates.sort((a, b) => a.name.length - b.name.length);
    console.log('[GitHub Actions Extension] getStepLogFromArchive:match', {
      jobId,
      stepNumber,
      stepName,
      chosen: candidates[0].name
    });
    if (onProgress) {
      onProgress({
        type: 'status',
        label: `Archive matched: ${candidates[0].name}`
      });
    }
    return candidates[0].content;
  }

  async fetchStepLog({ runId, jobId, stepNumber }, onProgress) {
    if (!runId || !jobId || typeof stepNumber !== 'number') {
      throw new Error('runId, jobId, and stepNumber are required to fetch step logs.');
    }

    console.log('[GitHub Actions Extension] fetchStepLog:start', {
      runId,
      jobId,
      stepNumber
    });
    if (onProgress) {
      onProgress({
        type: 'status',
        label: `Preparing logs for step ${stepNumber}...`
      });
    }
    const metadata = await this.loadJobStepMetadata(runId, jobId);
    const stepMeta = metadata.get(stepNumber);

    const attemptArchiveFallback = async () => {
      console.log('[GitHub Actions Extension] fetchStepLog:archiveFallback', {
        runId,
        jobId,
        stepNumber,
        stepName: stepMeta?.name || null
      });
      if (onProgress) {
        onProgress({
          type: 'status',
          label: `Using archive logs for step ${stepNumber}...`
        });
      }
      const archiveLog = await this.getStepLogFromArchive({
        runId,
        jobId,
        stepNumber,
        stepName: stepMeta?.name || null
      }, onProgress);
      if (!archiveLog) {
        throw new Error('Step log not found in job log archive.');
      }
      if (onProgress) {
        onProgress({
          type: 'status',
          label: `Archive log ready for step ${stepNumber}`
        });
      }
      return {
        log: archiveLog,
        logUrl: stepMeta?.logUrl || null
      };
    };

    if (!stepMeta?.logUrl) {
      return attemptArchiveFallback();
    }

    console.log('[GitHub Actions Extension] fetchStepLog:httpAttempt', {
      runId,
      jobId,
      stepNumber,
      url: stepMeta.logUrl
    });
    try {
      const response = await fetch(stepMeta.logUrl, {
        headers: {
          Accept: 'text/plain, text/*;q=0.9, */*;q=0.8',
          ...(this.tokenManager.getGitHubToken() ? { Authorization: `token ${this.tokenManager.getGitHubToken()}` } : {})
        },
        credentials: 'same-origin',
        mode: 'cors'
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Failed to download step log (${response.status} ${response.statusText}): ${body || 'no response body'}`
        );
      }

      const log = await response.text();
      console.log('[GitHub Actions Extension] fetchStepLog:httpSuccess', {
        runId,
        jobId,
        stepNumber,
        url: stepMeta.logUrl,
        size: log.length
      });
      return {
        log,
        logUrl: stepMeta.logUrl
      };
    } catch (error) {
      console.warn(
        '[GitHub Actions Extension] Direct step log fetch failed, using archive fallback',
        {
          jobId,
          stepNumber,
          stepName: stepMeta?.name || null,
          error: error?.message || String(error)
        }
      );
      if (onProgress) {
        onProgress({
          type: 'status',
          label: `Direct fetch failed for step ${stepNumber}. Trying archive...`,
          meta: { error: error?.message || String(error) }
        });
      }
      return attemptArchiveFallback();
    }
  }

  clearCache() {
    this.jobStepCache.clear();
    this.jobLogArchiveCache.clear();
  }
}

