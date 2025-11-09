import http from 'http';
import https from 'https';

import { HttpsProxyAgent } from 'https-proxy-agent';

import { getGitHubCookies, getProxyUrl } from '../config/index.js';

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let cachedCookies = null;
let cachedCookieHeader = null;

function resolveProxyAgent() {
  const proxyUrl = getProxyUrl() || process.env.GH_PROXY_URL;
  return proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
}

const proxyAgent = resolveProxyAgent();

export function loadGitHubCookies() {
  if (!cachedCookies) {
    cachedCookies = getGitHubCookies();
    cachedCookieHeader = null;
  }
  return cachedCookies;
}

export function getCookieHeader() {
  if (!cachedCookieHeader) {
    const cookies = loadGitHubCookies();
    cachedCookieHeader = Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  return cachedCookieHeader;
}

function createRequestHeaders(urlObj, extraHeaders = {}) {
  const headers = {
    'User-Agent': DEFAULT_USER_AGENT,
    Accept: extraHeaders.Accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    ...extraHeaders
  };

  if (urlObj.hostname.endsWith('github.com')) {
    headers.Cookie = getCookieHeader();
  } else {
    delete headers.Cookie;
  }

  return headers;
}

function requestOnce(url, options = {}) {
  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === 'https:';
  const transport = isHttps ? https : http;

  const headers = createRequestHeaders(urlObj, options.headers);

  const requestOptions = {
    method: options.method || 'GET',
    headers,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    agent: options.agent ?? proxyAgent
  };

  return new Promise((resolve, reject) => {
    const req = transport.request(urlObj, requestOptions, (res) => {
      const chunks = [];

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          res,
          buffer: Buffer.concat(chunks)
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

export async function fetchWithSession(url, options = {}) {
  const followRedirects = options.followRedirects ?? true;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let currentUrl = url;
  let redirectCount = 0;

  while (true) {
    const { res, buffer } = await requestOnce(currentUrl, options);
    const status = res.statusCode || 0;

    if (
      followRedirects &&
      status >= 300 &&
      status < 400 &&
      res.headers.location &&
      redirectCount < maxRedirects
    ) {
      const nextUrl = new URL(res.headers.location, currentUrl);
      currentUrl = nextUrl.toString();
      redirectCount += 1;
      continue;
    }

    return {
      status,
      headers: res.headers,
      body: buffer,
      url: currentUrl
    };
  }
}

export function hasValidSessionCookies() {
  const cookies = loadGitHubCookies();
  return Boolean(cookies.user_session && cookies._gh_sess);
}


