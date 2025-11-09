import https from 'https';

import { HttpsProxyAgent } from 'https-proxy-agent';

import { getProxyUrl, getSummaryApiBase, getSummaryApiKey } from '../config/index.js';

function resolveProxyAgent() {
  const proxyUrl = getProxyUrl() || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
  return proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
}

const proxyAgent = resolveProxyAgent();

function ensureApiKey(providedKey) {
  const key = providedKey ?? getSummaryApiKey();
  if (!key) {
    throw new Error(
      'AI summary API key is not configured. Please set aiSummaries.apiKey in config/app-config.json.'
    );
  }
  return key;
}

function buildUrl(endpoint = '') {
  const base = getSummaryApiBase();
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    throw new Error(
      `Summary API base must be an absolute URL. Received "${base}". ` +
        'Example: https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation'
    );
  }
  const normalizedEndpoint = endpoint.replace(/^\/+/, '');
  const url = base.endsWith('/') ? base : `${base}/`;
  return new URL(normalizedEndpoint || 'generation', url).toString();
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new Error('DashScope chat completion expects messages array.');
  }

  return messages.map((message) => {
    if (!message || typeof message !== 'object') {
      throw new Error('Each message must be an object with role and content.');
    }
    const role = message.role || 'user';
    const text = typeof message.content === 'string' ? message.content : String(message.content ?? '');

    return {
      role,
      content: [
        {
          type: 'text',
          text
        }
      ]
    };
  });
}

export async function createDashscopeChatCompletion({
  model,
  messages,
  temperature,
  responseFormat,
  apiKey: explicitApiKey
}) {
  const apiKey = ensureApiKey(explicitApiKey);
  const url = buildUrl();

  const normalizedMessages = normalizeMessages(messages);

  const payload = {
    model,
    input: {
      messages: normalizedMessages
    },
    parameters: {}
  };

  if (typeof temperature === 'number') {
    payload.parameters.temperature = temperature;
  }

  if (responseFormat?.type === 'json_object') {
    payload.parameters.result_format = 'json';
  }

  const data = JSON.stringify(payload);
  const urlObj = new URL(url);

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-DashScope-Async': 'disable',
      'X-DashScope-Enable-Https': 'true',
      'User-Agent': 'daily-check-cli'
    },
    agent: proxyAgent
  };

  return new Promise((resolve, reject) => {
    const req = https.request(urlObj, options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        const statusCode = res.statusCode || 0;
        if (statusCode < 200 || statusCode >= 300) {
          const error = new Error(
            `DashScope request failed (${statusCode} ${res.statusMessage || ''}): ${responseData}`
          );
          error.statusCode = statusCode;
          error.responseBody = responseData;
          reject(error);
          return;
        }

        try {
          const parsed = responseData.length ? JSON.parse(responseData) : null;
          resolve(parsed);
        } catch (err) {
          reject(
            new Error(
              `Failed to parse DashScope response as JSON: ${err.message}\n${responseData}`
            )
          );
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

