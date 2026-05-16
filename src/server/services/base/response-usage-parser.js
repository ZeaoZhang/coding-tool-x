/**
 * response-usage-parser.js - 统一响应解析器
 *
 * 从各种 AI 提供商（Claude / OpenAI / Gemini）的 SSE 事件和
 * 非流式 JSON 响应中提取模型名称和 token 用量信息。
 *
 * 所有 proxy server 共用此模块，避免重复代码，
 * 并确保模型重定向后仍能正确解析不同格式的响应。
 */

function readNumericField(source, keys = []) {
  for (const key of keys) {
    if (!source || source[key] === undefined || source[key] === null) {
      continue;
    }
    const value = Number(source[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function readNestedNumericField(source, pathVariants = []) {
  for (const path of pathVariants) {
    let current = source;
    let missing = false;
    for (const segment of path) {
      if (!current || typeof current !== 'object' || !(segment in current)) {
        missing = true;
        break;
      }
      current = current[segment];
    }
    if (missing || current === undefined || current === null) {
      continue;
    }
    const value = Number(current);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function parseUsageObject(rawUsage) {
  if (!rawUsage || typeof rawUsage !== 'object') {
    return null;
  }

  const tokens = {};
  const hasAnthropicCacheFields =
    rawUsage.cache_creation_input_tokens !== undefined ||
    rawUsage.cache_read_input_tokens !== undefined ||
    rawUsage.cacheCreationInputTokens !== undefined ||
    rawUsage.cacheReadInputTokens !== undefined;
  const hasOpenAiPromptFields =
    rawUsage.prompt_tokens !== undefined ||
    rawUsage.promptTokens !== undefined ||
    rawUsage.prompt_tokens_details !== undefined ||
    rawUsage.promptTokensDetails !== undefined;
  const hasOpenAiResponseFields =
    rawUsage.input_tokens_details !== undefined ||
    rawUsage.inputTokensDetails !== undefined ||
    rawUsage.output_tokens_details !== undefined ||
    rawUsage.outputTokensDetails !== undefined;
  const hasOpenAiCompatibilityFields =
    hasOpenAiPromptFields ||
    hasOpenAiResponseFields ||
    rawUsage.cached_tokens !== undefined ||
    rawUsage.cachedTokens !== undefined ||
    rawUsage.reasoning_tokens !== undefined ||
    rawUsage.reasoningTokens !== undefined ||
    rawUsage.completion_tokens_details !== undefined ||
    rawUsage.completionTokensDetails !== undefined;

  const input = readNumericField(rawUsage, ['input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens']);
  if (input !== undefined) tokens.input = input;

  const output = readNumericField(rawUsage, ['output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens']);
  if (output !== undefined) tokens.output = output;

  const total = readNumericField(rawUsage, ['total_tokens', 'totalTokens']);
  if (total !== undefined) tokens.total = total;

  const cacheCreation = readNumericField(rawUsage, ['cache_creation_input_tokens', 'cacheCreationInputTokens'])
    ?? readNestedNumericField(rawUsage, [
      ['prompt_tokens_details', 'cache_creation_input_tokens'],
      ['promptTokensDetails', 'cacheCreationInputTokens']
    ]);
  if (cacheCreation !== undefined) tokens.cacheCreation = cacheCreation;

  const cacheRead = readNumericField(rawUsage, ['cache_read_input_tokens', 'cacheReadInputTokens']);
  if (cacheRead !== undefined) tokens.cacheRead = cacheRead;

  const cached = readNumericField(rawUsage, ['cached_tokens', 'cachedTokens'])
    ?? readNestedNumericField(rawUsage, [
      ['input_tokens_details', 'cached_tokens'],
      ['prompt_tokens_details', 'cached_tokens'],
      ['inputTokensDetails', 'cachedTokens'],
      ['promptTokensDetails', 'cachedTokens']
    ]);
  if (cached !== undefined) tokens.cached = cached;

  const reasoning = readNumericField(rawUsage, ['reasoning_tokens', 'reasoningTokens'])
    ?? readNestedNumericField(rawUsage, [
      ['completion_tokens_details', 'reasoning_tokens'],
      ['output_tokens_details', 'reasoning_tokens'],
      ['completionTokensDetails', 'reasoningTokens'],
      ['outputTokensDetails', 'reasoningTokens']
    ]);
  if (reasoning !== undefined) tokens.reasoning = reasoning;

  if (tokens.total === undefined && tokens.input !== undefined && tokens.output !== undefined && !hasAnthropicCacheFields) {
    tokens.total = tokens.input + tokens.output;
  }

  // OpenAI/OpenAI-compatible usage commonly reports prompt/input totals that
  // already include cache hits. Align with OpenCode's provider contract by
  // moving cached prompt tokens into a dedicated field and keeping input as the
  // net uncached prompt tokens.
  if (!hasAnthropicCacheFields && hasOpenAiCompatibilityFields && tokens.cached !== undefined && tokens.input !== undefined) {
    tokens.input = Math.max(tokens.input - tokens.cached, 0);
  }

  if (Object.keys(tokens).length === 0) {
    return null;
  }

  return tokens;
}

/**
 * 从单个 SSE 事件的 parsed JSON 中提取 model 和 token 信息。
 * 自动检测 Claude / OpenAI / Gemini 格式。
 *
 * @param {object} parsed - JSON.parse 后的事件数据
 * @param {string} [eventType=''] - SSE event: 行的值（如 'message_start'）
 * @returns {{ model: string|null, tokens: object|null, isDone: boolean }}
 */
function parseSSEUsage(parsed, eventType) {
  if (!parsed || typeof parsed !== 'object') {
    return { model: null, tokens: null, isDone: false };
  }

  let model = null;
  let tokens = null;
  let isDone = false;

  // === Claude SSE 格式 ===
  // event: message_start → parsed.message.model
  // event: message_delta / message_stop → parsed.usage
  if (eventType === 'message_start' && parsed.message && parsed.message.model) {
    model = parsed.message.model;
  }
  if (!tokens && parsed.message && parsed.message.usage) {
    tokens = parseUsageObject(parsed.message.usage);
  }
  if (eventType === 'message_stop') {
    isDone = true;
  }

  // === OpenAI Responses API 格式 ===
  // data: {"type": "response.completed", "response": {"model", "usage": {...}}}
  if ((parsed.type === 'response.completed' || parsed.type === 'response.incomplete') && parsed.response) {
    if (parsed.response.model) {
      model = parsed.response.model;
    }
    if (parsed.response.usage) {
      tokens = parseUsageObject(parsed.response.usage);
    }
    isDone = true;
  }

  // === parsed.usage（Claude 原生 + OpenAI Chat Completions 共用） ===
  if (!tokens && parsed.usage) {
    tokens = parseUsageObject(parsed.usage);
  }

  if (!tokens && parsed.tokenUsage) {
    tokens = parseUsageObject(parsed.tokenUsage);
  }
  if (!tokens && parsed.token_usage) {
    tokens = parseUsageObject(parsed.token_usage);
  }

  // === Gemini Native 格式 ===
  // parsed.usageMetadata.{promptTokenCount, candidatesTokenCount, ...}
  if (!tokens && parsed.usageMetadata) {
    tokens = {
      input: parsed.usageMetadata.promptTokenCount || 0,
      output: parsed.usageMetadata.candidatesTokenCount || 0,
      total: parsed.usageMetadata.totalTokenCount || 0,
    };
    if (parsed.usageMetadata.cachedContentTokenCount) {
      tokens.cached = parsed.usageMetadata.cachedContentTokenCount;
    }
    if (parsed.usageMetadata.thoughtsTokenCount) {
      tokens.reasoning = parsed.usageMetadata.thoughtsTokenCount;
    }
  }

  // === 通用 model fallback ===
  if (!model && parsed.model) {
    model = parsed.model;
  }

  return { model, tokens, isDone };
}

/**
 * 从完整的非流式 JSON 响应中提取 model 和 token 信息。
 *
 * @param {object} parsed - JSON.parse 后的完整响应
 * @returns {{ model: string|null, tokens: object|null, isDone: boolean }}
 */
function parseNonStreamingUsage(parsed) {
  return parseSSEUsage(parsed, '');
}

function splitSSEEvents(buffer = '') {
  const normalized = String(buffer || '');
  const events = [];
  let cursor = 0;
  const separator = /\r?\n\r?\n/g;
  let match;

  while ((match = separator.exec(normalized)) !== null) {
    events.push(normalized.slice(cursor, match.index));
    cursor = separator.lastIndex;
  }

  return {
    events,
    remainder: normalized.slice(cursor)
  };
}

function parseSSEEventText(eventText = '') {
  if (!String(eventText || '').trim()) {
    return null;
  }

  let eventType = '';
  const dataLines = [];

  String(eventText).split(/\r?\n/).forEach((line) => {
    if (line.startsWith('event:')) {
      eventType = line.substring(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.substring(5).trim());
    }
  });

  const data = dataLines.join('\n');
  if (!data || data === '[DONE]') {
    return null;
  }

  return { eventType, data };
}

/**
 * 将解析结果合并到 tokenData 对象。
 *
 * @param {object} tokenData - 各 proxy 的 tokenData 累积对象
 * @param {{ model: string|null, tokens: object|null, isDone: boolean }} usage - parseSSEUsage 的返回值
 */
function mergeUsageIntoTokenData(tokenData, usage) {
  if (usage.model) {
    tokenData.model = usage.model;
  }
  if (usage.tokens) {
    if (usage.tokens.input !== undefined) tokenData.inputTokens = usage.tokens.input;
    if (usage.tokens.output !== undefined) tokenData.outputTokens = usage.tokens.output;
    if (usage.tokens.cacheCreation !== undefined) tokenData.cacheCreation = usage.tokens.cacheCreation;
    if (usage.tokens.cacheRead !== undefined) tokenData.cacheRead = usage.tokens.cacheRead;
    if (usage.tokens.cached !== undefined) tokenData.cachedTokens = usage.tokens.cached;
    if (usage.tokens.reasoning !== undefined) tokenData.reasoningTokens = usage.tokens.reasoning;
    if (usage.tokens.total !== undefined) tokenData.totalTokens = usage.tokens.total;
  }
}

/**
 * 创建统一的 tokenData 初始结构。
 *
 * @returns {object}
 */
function createTokenData() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreation: 0,
    cacheRead: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    model: ''
  };
}

module.exports = {
  parseSSEUsage,
  parseNonStreamingUsage,
  splitSSEEvents,
  parseSSEEventText,
  mergeUsageIntoTokenData,
  createTokenData
};
