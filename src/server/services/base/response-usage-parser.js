/**
 * response-usage-parser.js - 统一响应解析器
 *
 * 从各种 AI 提供商（Claude / OpenAI / Gemini）的 SSE 事件和
 * 非流式 JSON 响应中提取模型名称和 token 用量信息。
 *
 * 所有 proxy server 共用此模块，避免重复代码，
 * 并确保模型重定向后仍能正确解析不同格式的响应。
 */

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
  if (eventType === 'message_stop') {
    isDone = true;
  }

  // === OpenAI Responses API 格式 ===
  // data: {"type": "response.completed", "response": {"model", "usage": {...}}}
  if (parsed.type === 'response.completed' && parsed.response) {
    if (parsed.response.model) {
      model = parsed.response.model;
    }
    if (parsed.response.usage) {
      tokens = {
        input: parsed.response.usage.input_tokens || 0,
        output: parsed.response.usage.output_tokens || 0,
        total: parsed.response.usage.total_tokens || 0,
      };
      if (parsed.response.usage.input_tokens_details &&
          parsed.response.usage.input_tokens_details.cached_tokens !== undefined) {
        tokens.cached = parsed.response.usage.input_tokens_details.cached_tokens;
      }
      if (parsed.response.usage.output_tokens_details &&
          parsed.response.usage.output_tokens_details.reasoning_tokens !== undefined) {
        tokens.reasoning = parsed.response.usage.output_tokens_details.reasoning_tokens;
      }
    }
    isDone = true;
  }

  // === parsed.usage（Claude 原生 + OpenAI Chat Completions 共用） ===
  if (!tokens && parsed.usage) {
    const t = {};

    // Claude 格式字段
    if (parsed.usage.input_tokens !== undefined) {
      t.input = parsed.usage.input_tokens;
    }
    if (parsed.usage.output_tokens !== undefined) {
      t.output = parsed.usage.output_tokens;
    }
    if (parsed.usage.cache_creation_input_tokens !== undefined) {
      t.cacheCreation = parsed.usage.cache_creation_input_tokens;
    }
    if (parsed.usage.cache_read_input_tokens !== undefined) {
      t.cacheRead = parsed.usage.cache_read_input_tokens;
    }

    // OpenAI Chat Completions 格式字段（fallback）
    if (t.input === undefined && parsed.usage.prompt_tokens !== undefined) {
      t.input = parsed.usage.prompt_tokens;
    }
    if (t.output === undefined && parsed.usage.completion_tokens !== undefined) {
      t.output = parsed.usage.completion_tokens;
    }
    if (parsed.usage.total_tokens !== undefined) {
      t.total = parsed.usage.total_tokens;
    }

    // OpenAI detailed breakdowns
    if (parsed.usage.input_tokens_details &&
        parsed.usage.input_tokens_details.cached_tokens !== undefined) {
      t.cached = parsed.usage.input_tokens_details.cached_tokens;
    }
    if (parsed.usage.output_tokens_details &&
        parsed.usage.output_tokens_details.reasoning_tokens !== undefined) {
      t.reasoning = parsed.usage.output_tokens_details.reasoning_tokens;
    }

    // Gemini cache in OpenAI compat mode
    if (parsed.usage.prompt_tokens_details &&
        parsed.usage.prompt_tokens_details.cached_tokens !== undefined) {
      t.cached = parsed.usage.prompt_tokens_details.cached_tokens;
    }

    if (Object.keys(t).length > 0) {
      tokens = t;
    }
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
  mergeUsageIntoTokenData,
  createTokenData
};
