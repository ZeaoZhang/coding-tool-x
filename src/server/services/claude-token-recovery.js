const http = require('http');
const https = require('https');

const CLAUDE_COUNT_TOKENS_BETA_HEADER = 'claude-code-20250219,token-counting-2024-11-01';
const CLAUDE_COUNT_TOKENS_USER_AGENT = 'claude-cli/2.1.59 (external, cli)';
const DEFAULT_TIMEOUT_MS = 5000;

function cloneJsonCompatible(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function toArrayContent(content) {
  if (Array.isArray(content)) {
    return content.map(item => cloneJsonCompatible(item));
  }
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : [];
  }
  if (content && typeof content === 'object') {
    return [cloneJsonCompatible(content)];
  }
  return [];
}

function createClaudeStreamRecoveryState() {
  return {
    model: '',
    blockTypeByIndex: new Map(),
    textByIndex: new Map(),
    toolUseByIndex: new Map()
  };
}

function appendTextDelta(state, index, value) {
  const previous = state.textByIndex.get(index) || '';
  state.textByIndex.set(index, previous + value);
}

function appendToolInputDelta(state, index, value) {
  const current = state.toolUseByIndex.get(index) || {
    id: `toolu_recovered_${index}`,
    name: '',
    inputJson: ''
  };
  current.inputJson = `${current.inputJson || ''}${value}`;
  state.toolUseByIndex.set(index, current);
}

function mergeClaudeStreamEvent(state, eventType, parsed) {
  if (!state || !parsed || typeof parsed !== 'object') {
    return;
  }

  if (eventType === 'message_start' && parsed.message && typeof parsed.message === 'object') {
    const model = typeof parsed.message.model === 'string' ? parsed.message.model.trim() : '';
    if (model) {
      state.model = model;
    }
  } else if (!state.model && typeof parsed.model === 'string' && parsed.model.trim()) {
    state.model = parsed.model.trim();
  }

  if (eventType === 'content_block_start') {
    const index = Number(parsed.index);
    const blockIndex = Number.isFinite(index) ? index : 0;
    const block = (parsed.content_block && typeof parsed.content_block === 'object') ? parsed.content_block : {};
    const blockType = typeof block.type === 'string' ? block.type : '';
    if (!blockType) {
      return;
    }

    state.blockTypeByIndex.set(blockIndex, blockType);

    if (blockType === 'text' && typeof block.text === 'string') {
      state.textByIndex.set(blockIndex, block.text);
      return;
    }

    if (blockType === 'tool_use') {
      state.toolUseByIndex.set(blockIndex, {
        id: String(block.id || `toolu_recovered_${blockIndex}`),
        name: typeof block.name === 'string' ? block.name : '',
        inputJson: block.input && typeof block.input === 'object' && !Array.isArray(block.input)
          ? JSON.stringify(block.input)
          : ''
      });
    }
    return;
  }

  if (eventType !== 'content_block_delta') {
    return;
  }

  const index = Number(parsed.index);
  const blockIndex = Number.isFinite(index) ? index : 0;
  const delta = (parsed.delta && typeof parsed.delta === 'object') ? parsed.delta : {};

  if (delta.type === 'text_delta' && typeof delta.text === 'string') {
    appendTextDelta(state, blockIndex, delta.text);
    return;
  }

  if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
    appendToolInputDelta(state, blockIndex, delta.partial_json);
  }
}

function parseToolInput(inputJson) {
  if (typeof inputJson !== 'string' || !inputJson.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(inputJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return {};
}

function buildAssistantMessageFromStreamState(state) {
  if (!state || !(state.blockTypeByIndex instanceof Map) || state.blockTypeByIndex.size === 0) {
    return null;
  }

  const content = [];
  const indexes = Array.from(state.blockTypeByIndex.keys())
    .map(value => Number(value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  indexes.forEach((index) => {
    const blockType = state.blockTypeByIndex.get(index);
    if (blockType === 'text') {
      const text = state.textByIndex.get(index) || '';
      if (text) {
        content.push({
          type: 'text',
          text
        });
      }
      return;
    }

    if (blockType === 'tool_use') {
      const toolUse = state.toolUseByIndex.get(index);
      if (!toolUse || !toolUse.name) {
        return;
      }
      content.push({
        type: 'tool_use',
        id: toolUse.id,
        name: toolUse.name,
        input: parseToolInput(toolUse.inputJson)
      });
    }
  });

  if (content.length === 0) {
    return null;
  }

  return {
    role: 'assistant',
    content
  };
}

function buildClaudeCountTokensTargetUrl(baseUrl = '') {
  let targetUrl;
  try {
    targetUrl = new URL(String(baseUrl || '').trim() || 'https://api.anthropic.com');
  } catch {
    targetUrl = new URL('https://api.anthropic.com');
  }

  let pathname = targetUrl.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') {
    pathname = '/v1/messages/count_tokens';
  } else if (pathname.endsWith('/messages/count_tokens')) {
    // noop
  } else if (pathname.endsWith('/messages')) {
    pathname = `${pathname}/count_tokens`;
  } else if (pathname.endsWith('/v1')) {
    pathname = `${pathname}/messages/count_tokens`;
  } else {
    pathname = `${pathname}/v1/messages/count_tokens`;
  }

  targetUrl.pathname = pathname;
  targetUrl.searchParams.set('beta', 'true');
  return targetUrl.toString();
}

function buildClaudeCountTokensHeaders(apiKey) {
  return {
    'x-api-key': apiKey,
    authorization: `Bearer ${apiKey}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': CLAUDE_COUNT_TOKENS_BETA_HEADER,
    'content-type': 'application/json',
    accept: 'application/json',
    'accept-encoding': 'gzip, deflate',
    'user-agent': CLAUDE_COUNT_TOKENS_USER_AGENT
  };
}

function postJson(url, headers, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const isHttps = target.protocol === 'https:';
    const client = isHttps ? https : http;
    const body = JSON.stringify(payload || {});
    const request = client.request({
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      let rawBody = '';
      response.on('data', (chunk) => {
        rawBody += chunk.toString('utf8');
      });
      response.on('end', () => {
        resolve({
          statusCode: Number(response.statusCode) || 500,
          headers: response.headers || {},
          rawBody
        });
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('count_tokens request timeout'));
    });
    request.write(body);
    request.end();
  });
}

function readCountTokensValue(responseBody) {
  if (!responseBody || typeof responseBody !== 'object') {
    return null;
  }

  const direct = Number(responseBody.input_tokens ?? responseBody.inputTokens);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const nested = Number(responseBody.usage?.input_tokens ?? responseBody.usage?.inputTokens);
  if (Number.isFinite(nested)) {
    return nested;
  }

  return null;
}

function buildClaudeCountTokensPayload(requestBody = {}) {
  const payload = {
    model: requestBody.model,
    messages: Array.isArray(requestBody.messages)
      ? requestBody.messages.map(message => cloneJsonCompatible(message))
      : []
  };

  if (requestBody.system !== undefined) {
    payload.system = cloneJsonCompatible(requestBody.system);
  }
  if (Array.isArray(requestBody.tools) && requestBody.tools.length > 0) {
    payload.tools = cloneJsonCompatible(requestBody.tools);
  }
  if (requestBody.tool_choice && typeof requestBody.tool_choice === 'object') {
    payload.tool_choice = cloneJsonCompatible(requestBody.tool_choice);
  }
  if (requestBody.metadata && typeof requestBody.metadata === 'object') {
    payload.metadata = cloneJsonCompatible(requestBody.metadata);
  }
  if (requestBody.thinking && typeof requestBody.thinking === 'object') {
    payload.thinking = cloneJsonCompatible(requestBody.thinking);
  }

  return payload;
}

async function countClaudeInputTokens({ baseUrl, apiKey, payload, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const response = await postJson(
    buildClaudeCountTokensTargetUrl(baseUrl),
    buildClaudeCountTokensHeaders(apiKey),
    payload,
    timeoutMs
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`count_tokens returned HTTP ${response.statusCode}`);
  }

  let parsedBody = null;
  try {
    parsedBody = response.rawBody ? JSON.parse(response.rawBody) : {};
  } catch {
    parsedBody = null;
  }

  const tokens = readCountTokensValue(parsedBody);
  if (!Number.isFinite(tokens)) {
    throw new Error('count_tokens response missing input_tokens');
  }

  return tokens;
}

function appendAssistantMessage(messages = [], assistantMessage) {
  const normalizedMessages = Array.isArray(messages)
    ? messages.map(message => cloneJsonCompatible(message))
    : [];

  normalizedMessages.push({
    role: 'assistant',
    content: toArrayContent(assistantMessage.content)
  });
  return normalizedMessages;
}

async function recoverClaudeUsageViaCountTokens({
  baseUrl,
  apiKey,
  requestBody,
  assistantMessage,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  if (!assistantMessage || !assistantMessage.content || !baseUrl || !apiKey) {
    return null;
  }

  const promptPayload = buildClaudeCountTokensPayload(requestBody);
  if (!promptPayload.model || !Array.isArray(promptPayload.messages)) {
    return null;
  }

  const promptTokens = await countClaudeInputTokens({
    baseUrl,
    apiKey,
    payload: promptPayload,
    timeoutMs
  });

  const promptWithAssistantPayload = {
    ...promptPayload,
    messages: appendAssistantMessage(promptPayload.messages, assistantMessage)
  };

  const promptPlusAssistantTokens = await countClaudeInputTokens({
    baseUrl,
    apiKey,
    payload: promptWithAssistantPayload,
    timeoutMs
  });

  return {
    inputTokens: promptTokens,
    outputTokens: Math.max(promptPlusAssistantTokens - promptTokens, 0)
  };
}

module.exports = {
  createClaudeStreamRecoveryState,
  mergeClaudeStreamEvent,
  buildAssistantMessageFromStreamState,
  buildClaudeCountTokensPayload,
  recoverClaudeUsageViaCountTokens
};
