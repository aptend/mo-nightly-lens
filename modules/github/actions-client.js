import { withRetry } from '../utils/retry.js';
import {
  githubApiRequest,
  resolveGitHubToken
} from './http-client.js';

function parseRepoSlug(repo) {
  if (!repo || typeof repo !== 'string') {
    throw new Error('Repository slug is required in the form "owner/repo".');
  }

  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo slug "${repo}". Expected "owner/repo".`);
  }

  return {
    owner: parts[0],
    name: parts[1]
  };
}

export function createActionsClient({ repo, token } = {}) {
  if (!repo) {
    throw new Error('Repository slug is required when creating an actions client.');
  }

  const authToken = resolveGitHubToken(token);

  const { owner, name } = parseRepoSlug(repo);
  const baseRepoPath = `/repos/${owner}/${name}`;

  const request = (path) => {
    const url = path.startsWith('http') ? path : `${baseRepoPath}${path}`;
    return withRetry(() => githubApiRequest(url, authToken));
  };

  const getRun = (runId) => {
    if (!runId) throw new Error('runId is required.');
    return request(`/actions/runs/${runId}`);
  };

  const listJobs = async (runId) => {
    if (!runId) throw new Error('runId is required.');

    const jobs = [];
    let page = 1;

    while (true) {
      const url = `/actions/runs/${runId}/jobs?per_page=100&page=${page}`;
      const response = await request(url);
      const batch = response.jobs || [];
      jobs.push(...batch);

      if (batch.length < 100) {
        break;
      }

      page += 1;
    }

    return jobs;
  };

  const getJob = (jobId) => {
    if (!jobId) throw new Error('jobId is required.');
    return request(`/actions/jobs/${jobId}`);
  };

  const listWorkflowRuns = (workflow, { perPage = 1 } = {}) => {
    if (!workflow) throw new Error('workflow file name is required.');
    return request(`/actions/workflows/${workflow}/runs?per_page=${perPage}`);
  };

  return {
    repo,
    owner,
    repoName: name,
    token: authToken,
    request,
    getRun,
    listJobs,
    getJob,
    listWorkflowRuns
  };
}


