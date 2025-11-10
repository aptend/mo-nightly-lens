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

export function buildRequestPayload({
  model,
  messages,
  temperature,
  responseFormat
}) {
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

  return payload;
}

export function normalizeBaseUrl(base, { defaultBase, requireAbsolute = false } = {}) {
  const trimmed =
    typeof base === 'string' && base.trim().length > 0
      ? base.trim()
      : typeof defaultBase === 'string'
        ? defaultBase.trim()
        : '';

  if (!trimmed) {
    throw new Error('DashScope API base URL is required.');
  }

  if (requireAbsolute && !/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      `DashScope API base must be an absolute URL. Received "${trimmed}".`
    );
  }

  return trimmed.replace(/\/+$/, '');
}


