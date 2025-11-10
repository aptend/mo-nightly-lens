import { createActionsClient as createCoreActionsClient } from '../../../core/github/actions-client.js';
import { createGitHubRequest } from './api-client.js';

export function createActionsClient({ repo, token, apiBase } = {}) {
  const request = createGitHubRequest({
    token,
    baseUrl: apiBase
  });

  return createCoreActionsClient({
    repo,
    request
  });
}


