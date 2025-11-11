/**
 * GitHub API 客户端
 * 负责所有 GitHub API 请求
 */
export class GitHubApiClient {
  constructor(tokenManager, apiBase) {
    this.tokenManager = tokenManager;
    this.apiBase = apiBase;
  }

  async apiRequest(pathOrUrl, { method = 'GET', headers = {}, body } = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.apiBase}${pathOrUrl}`;
    const requestInit = {
      method,
      headers: this.tokenManager.buildApiHeaders(headers)
    };
    if (body != null) {
      requestInit.body = typeof body === 'string' ? body : JSON.stringify(body);
      if (!requestInit.headers['Content-Type']) {
        requestInit.headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, requestInit);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API request failed (${response.status}): ${text || response.statusText}`);
    }
    if (response.status === 204) {
      return null;
    }
    return await response.json();
  }

  async fetchRun(runId) {
    if (!runId) {
      throw new Error('runId is required');
    }
    return await this.apiRequest(`/actions/runs/${runId}`);
  }

  async fetchAllJobs(runId) {
    if (!runId) {
      throw new Error('runId is required');
    }
    const jobs = [];
    let page = 1;
    while (true) {
      const data = await this.apiRequest(
        `/actions/runs/${runId}/jobs?per_page=100&page=${page}`
      );
      const batch = Array.isArray(data?.jobs) ? data.jobs : [];
      jobs.push(...batch);
      if (batch.length < 100) {
        break;
      }
      page += 1;
    }
    return jobs;
  }

  async fetchJobDetails(jobId) {
    if (!jobId) {
      throw new Error('jobId is required');
    }
    return await this.apiRequest(`/actions/jobs/${jobId}`);
  }

  async ensureJobWithSteps(job) {
    if (job?.steps && Array.isArray(job.steps) && job.steps.length > 0) {
      return job;
    }
    const details = await this.fetchJobDetails(job.id);
    return {
      ...job,
      ...details,
      steps: Array.isArray(details?.steps) ? details.steps : []
    };
  }
}

