import { githubApiRequest, resolveGitHubToken } from './http-client.js';

export async function createIssue({
  repo,
  title,
  body,
  labels,
  assignees,
  token
}) {
  if (!repo) {
    throw new Error('Target repo is required when creating an issue.');
  }
  if (!title || typeof title !== 'string') {
    throw new Error('Issue title is required.');
  }

  const payload = {
    title,
    body,
    labels,
    assignees
  };

  return githubApiRequest(`/repos/${repo}/issues`, resolveGitHubToken(token), {
    method: 'POST',
    body: payload
  });
}

