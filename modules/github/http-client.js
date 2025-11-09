import https from 'https';

import { getGitHubApiBase, getGitHubToken } from '../config/index.js';

function resolveUrl(pathOrUrl) {
  if (typeof pathOrUrl !== 'string' || pathOrUrl.length === 0) {
    throw new Error('URL is required when calling githubApiRequest.');
  }

  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return pathOrUrl;
  }

  const base = getGitHubApiBase();
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${normalizedPath}`;
}

export function githubApiRequest(pathOrUrl, tokenOrOptions = getGitHubToken(), maybeOptions = {}) {
  let token = getGitHubToken();
  let options = {};

  if (typeof tokenOrOptions === 'string') {
    token = tokenOrOptions;
    options = maybeOptions || {};
  } else if (typeof tokenOrOptions === 'object' && tokenOrOptions !== null) {
    options = tokenOrOptions;
  }

  const {
    method = 'GET',
    body,
    headers: extraHeaders = {},
    responseType = 'auto'
  } = options;

  const url = resolveUrl(pathOrUrl);

  const requestBody =
    body == null
      ? undefined
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);

  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'daily-check-cli',
    ...extraHeaders
  };

  if (requestBody != null && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode || 0;

          if (status < 200 || status >= 300) {
            const error = new Error(
              `GitHub API request failed: ${status} ${res.statusMessage}\n${raw}`
            );
            error.status = status;
            error.responseBody = raw;
            reject(error);
            return;
          }

          if (responseType === 'raw') {
            resolve(raw);
            return;
          }

          if (raw.length === 0) {
            resolve(null);
            return;
          }

          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            if (responseType === 'json') {
              reject(
                new Error(`Failed to parse GitHub API response as JSON: ${error.message}\n${raw}`)
              );
              return;
            }
            resolve(raw);
          }
        });
      }
    );

    req.on('error', (error) => {
      reject(error);
    });

    if (requestBody != null) {
      req.write(requestBody);
    }

    req.end();
  });
}

export function resolveGitHubToken(providedToken) {
  if (providedToken && typeof providedToken === 'string') {
    return providedToken;
  }
  return getGitHubToken();
}

