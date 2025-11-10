import { withRetry } from '../../utils/retry.js';

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

export function createActionsClient({ repo, request }) {
  if (!repo) {
    throw new Error('Repository slug is required when creating an actions client.');
  }
  if (typeof request !== 'function') {
    throw new Error('createActionsClient requires a request function.');
  }

  const { owner, name } = parseRepoSlug(repo);
  const baseRepoPath = `/repos/${owner}/${name}`;

  const send = (path, options) => {
    const url = path.startsWith('http') ? path : `${baseRepoPath}${path}`;
    return withRetry(() => request(url, options));
  };

  const getRun = (runId) => {
    if (!runId) throw new Error('runId is required.');
    return send(`/actions/runs/${runId}`);
  };

  const listJobs = async (runId) => {
    if (!runId) throw new Error('runId is required.');

    const jobs = [];
    let page = 1;

    while (true) {
      const url = `/actions/runs/${runId}/jobs?per_page=100&page=${page}`;
      const response = await send(url);
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
    return send(`/actions/jobs/${jobId}`);
  };

  const listWorkflowRuns = (workflow, { perPage = 1 } = {}) => {
    if (!workflow) throw new Error('workflow file name is required.');
    return send(`/actions/workflows/${workflow}/runs?per_page=${perPage}`);
  };

  return {
    repo,
    owner,
    repoName: name,
    request: send,
    getRun,
    listJobs,
    getJob,
    listWorkflowRuns
  };
}


