function resolveUrl(pathOrUrl, baseUrl) {
  if (typeof pathOrUrl !== 'string' || pathOrUrl.length === 0) {
    throw new Error('URL is required when calling githubApiRequest.');
  }

  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return pathOrUrl;
  }

  const base = baseUrl || 'https://api.github.com';
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${normalizedPath}`;
}

export async function githubApiRequest(
  pathOrUrl,
  tokenOrOptions = undefined,
  maybeOptions = {},
  { baseUrl } = {}
) {
  let token = tokenOrOptions;
  let options = maybeOptions;

  if (typeof tokenOrOptions === 'object' && tokenOrOptions !== null) {
    options = tokenOrOptions;
    token = undefined;
  }

  const {
    method = 'GET',
    body,
    headers: extraHeaders = {},
    responseType = 'auto'
  } = options || {};

  const url = resolveUrl(pathOrUrl, baseUrl);

  const requestBody =
    body == null
      ? undefined
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'daily-check-extension',
    ...extraHeaders
  };

  if (token) {
    headers.Authorization = `token ${token}`;
  }

  if (requestBody != null && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: requestBody
  });

  if (!response.ok) {
    const raw = await response.text();
    const error = new Error(
      `GitHub API request failed: ${response.status} ${response.statusText}\n${raw}`
    );
    error.status = response.status;
    error.responseBody = raw;
    throw error;
  }

  if (responseType === 'raw') {
    return await response.text();
  }

  if (response.status === 204) {
    return null;
  }

  if (responseType === 'json') {
    return await response.json();
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

export function createGitHubRequest({ token, baseUrl } = {}) {
  return (pathOrUrl, options) =>
    githubApiRequest(pathOrUrl, token, options, { baseUrl });
}


