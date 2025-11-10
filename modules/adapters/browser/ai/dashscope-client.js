import { buildRequestPayload, normalizeBaseUrl } from '../../../core/ai/dashscope.js';

export async function createDashscopeChatCompletion({
  model,
  messages,
  temperature,
  responseFormat,
  apiKey,
  apiBase
}) {
  if (!apiKey) {
    throw new Error('AI summary API key is not configured.');
  }

  const base = normalizeBaseUrl(apiBase, {
    defaultBase: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation',
    requireAbsolute: true
  });

  const payload = buildRequestPayload({
    model,
    messages,
    temperature,
    responseFormat
  });

  const url = `${base}/generation`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-DashScope-Async': 'disable',
      'X-DashScope-Enable-Https': 'true',
      'User-Agent': 'daily-check-extension'
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `DashScope request failed (${response.status} ${response.statusText || ''}): ${
        raw || 'no response body'
      }`
    );
  }

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse DashScope response as JSON: ${error.message}\n${raw}`);
  }
}


