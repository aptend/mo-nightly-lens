function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new Error('DashScope chat completion expects messages array.');
  }

  return messages.map((message) => {
    if (!message || typeof message !== 'object') {
      throw new Error('Each message must be an object with role and content.');
    }
    const role = message.role || 'user';
    const text =
      typeof message.content === 'string'
        ? message.content
        : String(message.content ?? '');

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

function normalizeBaseUrl(base) {
  const value = typeof base === 'string' && base.trim().length > 0 ? base.trim() : '';
  if (!value) {
    return 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation';
  }
  return value.replace(/\/+$/, '');
}

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

  const url = `${normalizeBaseUrl(apiBase)}/generation`;
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


