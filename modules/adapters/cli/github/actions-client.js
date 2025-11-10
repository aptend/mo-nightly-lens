import { createActionsClient as createCoreActionsClient } from '../../../core/github/actions-client.js';
import { createGitHubRequest, resolveGitHubToken } from './api-client.js';

export function createActionsClient({ repo, token } = {}) {
  const resolvedToken = resolveGitHubToken(token);
  const request = createGitHubRequest({ token: resolvedToken });

  return createCoreActionsClient({
    repo,
    request
  });
}


