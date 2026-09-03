/**
 * OpenCode Gateway Converter
 *
 * Convert Claude Code / Codex / Gemini request payloads into
 * OpenCode-compatible OpenAI wire format.
 *
 * Default target wire format:
 * - OpenAI Responses API (/v1/responses)
 *
 * Optional target wire format:
 * - OpenAI Chat Completions API (/v1/chat/completions)
 */

const { ensureOpenAiStreamUsage } = require('../../../shared/proxy-utils');

const SUPPORTED_SOURCE_TYPES = ['claude', 'codex', 'gemini'];
const SUPPORTED_TARGET_APIS = ['responses', 'chat.completions'];

function normalizeSourceType(sourceType) {
  const value = String(sourceType || '').trim().toLowerCase();
  if (value === 'claude' || value === 'claude-code' || value === 'claude_code') return 'claude';
  if (value === 'codex' || value === 'codex-cli' || value === 'codex_cli') return 'codex';
  if (value === 'gemini' || value === 'gemini-cli' || value === 'gemini_cli') return 'gemini';
  return value;
}

function normalizeTargetApi(targetApi) {
  if (targetApi === undefined || targetApi === null || targetApi === '') {
    return 'responses';
  }

  const value = String(targetApi).trim().toLowerCase();

  if (value === 'responses' || value === 'response') {
    return 'responses';
  }
  if (
    value === 'chat' ||
    value === 'chat-completions' ||
    value === 'chat_completions' ||
    value === 'chat/completions' ||
    value === 'chat.completions'
  ) {
    return 'chat.completions';
  }
  return value;
}

function safeClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (isFiniteNumber(value)) return value;
  }
  return undefined;
}

function appendTextFragments(value, fragments, state) {
  if (value === null || value === undefined) return;

  if (typeof value === 'string') {
    if (value.trim()) fragments.push(value);
    return;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    fragments.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(item => appendTextFragments(item, fragments, state));
    return;
  }

  if (typeof value !== 'object') return;

  if (typeof value.text === 'string') {
    appendTextFragments(value.text, fragments, state);
    return;
  }
  if (typeof value.input_text === 'string') {
    appendTextFragments(value.input_text, fragments, state);
    return;
  }
  if (typeof value.output_text === 'string') {
    appendTextFragments(value.output_text, fragments, state);
    return;
  }
  if (typeof value.content === 'string' || Array.isArray(value.content)) {
    appendTextFragments(value.content, fragments, state);
    return;
  }
  if (Array.isArray(value.parts)) {
    appendTextFragments(value.parts, fragments, state);
    return;
  }

  if (value.type && value.type !== 'text' && value.type !== 'input_text' && value.type !== 'output_text') {
    state.nonTextItems += 1;
  }
}

function extractText(value) {
  const fragments = [];
  const state = { nonTextItems: 0 };
  appendTextFragments(value, fragments, state);

  return {
    text: fragments.join('\n').trim(),
    nonTextItems: state.nonTextItems
  };
}

function buildResponseMessage(role, text) {
  return {
    type: 'message',
    role,
    content: [
      {
        type: 'input_text',
        text
      }
    ]
  };
}

function coerceRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'assistant' || value === 'model') return 'assistant';
  if (value === 'system') return 'system';
  if (value === 'tool') return 'tool';
  return 'user';
}

function normalizeOpenAiToolsToFunctions(tools = [], warnings = []) {
  if (!Array.isArray(tools)) return [];

  const mapped = [];
  tools.forEach((tool, index) => {
    if (!tool || typeof tool !== 'object') return;

    if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
      const fn = tool.function;
      if (!fn.name) {
        warnings.push(`Tool at index ${index} missing function.name and was ignored.`);
        return;
      }
      mapped.push({
        type: 'function',
        name: fn.name,
        description: fn.description || '',
        parameters: fn.parameters || { type: 'object', properties: {} }
      });
      return;
    }

    if (tool.type === 'function' && tool.name) {
      mapped.push({
        type: 'function',
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters || { type: 'object', properties: {} }
      });
    }
  });

  return mapped;
}

function normalizeClaudeTools(tools = [], warnings = []) {
  if (!Array.isArray(tools)) return [];

  const mapped = [];
  tools.forEach((tool, index) => {
    if (!tool || typeof tool !== 'object') return;
    if (!tool.name) {
      warnings.push(`Claude tool at index ${index} missing name and was ignored.`);
      return;
    }
    mapped.push({
      type: 'function',
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || tool.parameters || { type: 'object', properties: {} }
    });
  });

  return mapped;
}

function normalizeGeminiTools(tools = [], warnings = []) {
  if (!Array.isArray(tools)) return [];

  const mapped = [];
  tools.forEach((tool, toolIndex) => {
    if (!tool || typeof tool !== 'object') return;

    if (Array.isArray(tool.functionDeclarations)) {
      tool.functionDeclarations.forEach((decl, declIndex) => {
        if (!decl || typeof decl !== 'object') return;
        if (!decl.name) {
          warnings.push(`Gemini function declaration at ${toolIndex}:${declIndex} missing name and was ignored.`);
          return;
        }
        mapped.push({
          type: 'function',
          name: decl.name,
          description: decl.description || '',
          parameters: decl.parameters || { type: 'object', properties: {} }
        });
      });
      return;
    }

    if (tool.type === 'function' && tool.name) {
      mapped.push({
        type: 'function',
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters || { type: 'object', properties: {} }
      });
    }
  });

  return mapped;
}

function normalizeClaudePayload(payload, options, warnings) {
  const systemText = extractText(payload.system).text;
  const messages = [];

  if (Array.isArray(payload.messages)) {
    payload.messages.forEach((message, index) => {
      if (!message || typeof message !== 'object') return;
      const role = coerceRole(message.role);
      const { text, nonTextItems } = extractText(message.content);

      if (nonTextItems > 0) {
        warnings.push(`Claude message ${index} contains non-text content; only text was preserved.`);
      }

      if (!text) return;

      if (role === 'system') {
        warnings.push(`Claude message ${index} has role=system; merged into instructions.`);
      }

      if (role === 'system') return;
      messages.push({ role: role === 'tool' ? 'assistant' : role, text });
    });
  }

  return {
    model: payload.model || options.defaultModel || 'gpt-4o-mini',
    systemText,
    messages,
    tools: normalizeClaudeTools(payload.tools, warnings),
    toolChoice: payload.tool_choice,
    maxOutputTokens: firstFiniteNumber(options.maxOutputTokens, payload.max_output_tokens, payload.max_tokens),
    stream: typeof options.stream === 'boolean' ? options.stream : payload.stream,
    store: typeof options.store === 'boolean' ? options.store : payload.store,
    temperature: firstFiniteNumber(payload.temperature),
    topP: firstFiniteNumber(payload.top_p)
  };
}

function normalizeOpenAiChatLikePayload(payload, options, warnings) {
  const messages = [];
  const systemParts = [];

  if (Array.isArray(payload.messages)) {
    payload.messages.forEach((message, index) => {
      if (!message || typeof message !== 'object') return;
      const role = coerceRole(message.role);
      const { text, nonTextItems } = extractText(message.content);

      if (nonTextItems > 0) {
        warnings.push(`Message ${index} contains non-text content; only text was preserved.`);
      }

      if (!text) return;

      if (role === 'system') {
        systemParts.push(text);
        return;
      }

      if (role === 'tool') {
        warnings.push(`Message ${index} has role=tool and was flattened to assistant text.`);
        messages.push({ role: 'assistant', text });
        return;
      }

      messages.push({ role, text });
    });
  }

  if (typeof payload.input === 'string') {
    messages.push({ role: 'user', text: payload.input });
  }

  return {
    model: payload.model || options.defaultModel || 'gpt-4o-mini',
    systemText: systemParts.join('\n\n').trim(),
    messages,
    tools: normalizeOpenAiToolsToFunctions(payload.tools, warnings),
    toolChoice: payload.tool_choice,
    maxOutputTokens: firstFiniteNumber(options.maxOutputTokens, payload.max_output_tokens, payload.max_tokens),
    stream: typeof options.stream === 'boolean' ? options.stream : payload.stream,
    store: typeof options.store === 'boolean' ? options.store : payload.store,
    temperature: firstFiniteNumber(payload.temperature),
    topP: firstFiniteNumber(payload.top_p),
    stop: payload.stop
  };
}

function extractMessagesFromResponsesInput(input, warnings) {
  if (!Array.isArray(input)) return [];

  const messages = [];
  input.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;

    if (item.type === 'message') {
      const role = coerceRole(item.role);
      const { text, nonTextItems } = extractText(item.content);
      if (nonTextItems > 0) {
        warnings.push(`Responses input item ${index} contains non-text blocks; only text was preserved.`);
      }
      if (!text) return;
      messages.push({ role: role === 'tool' ? 'assistant' : role, text });
      return;
    }

    // Compatibility path: some callers pass chat-like message items in input.
    if (item.role && item.content !== undefined) {
      const role = coerceRole(item.role);
      const { text } = extractText(item.content);
      if (!text) return;
      messages.push({ role: role === 'tool' ? 'assistant' : role, text });
      return;
    }

    if (item.type === 'function_call' || item.type === 'function_call_output') {
      warnings.push(`Responses input item ${index} is ${item.type}; preserved for /v1/responses only.`);
      return;
    }
  });

  return messages;
}

function normalizeCodexPayload(payload, options, warnings) {
  const isResponsesShape =
    Array.isArray(payload.input) ||
    typeof payload.input === 'string' ||
    typeof payload.instructions === 'string';

  if (isResponsesShape) {
    const request = safeClone(payload);

    if (typeof request.input === 'string') {
      request.input = [buildResponseMessage('user', request.input)];
    }

    if (!request.model) {
      request.model = options.defaultModel || 'gpt-4o-mini';
    }
    if (typeof options.stream === 'boolean') {
      request.stream = options.stream;
    } else if (typeof request.stream !== 'boolean') {
      request.stream = false;
    }
    if (typeof options.store === 'boolean') {
      request.store = options.store;
    } else if (typeof request.store !== 'boolean') {
      request.store = false;
    }
    if (isFiniteNumber(options.maxOutputTokens)) {
      request.max_output_tokens = options.maxOutputTokens;
    }

    return {
      prebuiltResponses: request,
      model: request.model,
      systemText: typeof request.instructions === 'string' ? request.instructions : '',
      messages: extractMessagesFromResponsesInput(request.input, warnings),
      tools: normalizeOpenAiToolsToFunctions(request.tools, warnings),
      toolChoice: request.tool_choice,
      maxOutputTokens: firstFiniteNumber(request.max_output_tokens),
      stream: request.stream,
      store: request.store,
      temperature: firstFiniteNumber(request.temperature),
      topP: firstFiniteNumber(request.top_p),
      stop: request.stop
    };
  }

  return normalizeOpenAiChatLikePayload(payload, options, warnings);
}

function normalizeGeminiPayload(payload, options, warnings) {
  // Some gateways already expose Gemini as OpenAI-compatible chat format.
  if (Array.isArray(payload.messages)) {
    return normalizeOpenAiChatLikePayload(payload, options, warnings);
  }

  const messages = [];
  const systemText = extractText(
    payload.system_instruction ||
    payload.systemInstruction ||
    payload.system
  ).text;

  if (Array.isArray(payload.contents)) {
    payload.contents.forEach((content, index) => {
      if (!content || typeof content !== 'object') return;
      const role = coerceRole(content.role);
      const { text, nonTextItems } = extractText(content.parts || content.content);

      if (nonTextItems > 0) {
        warnings.push(`Gemini content ${index} contains non-text parts; only text was preserved.`);
      }
      if (!text) return;

      if (role === 'system') return;
      messages.push({ role: role === 'tool' ? 'assistant' : role, text });
    });
  } else if (typeof payload.prompt === 'string' && payload.prompt.trim()) {
    messages.push({ role: 'user', text: payload.prompt.trim() });
  }

  const generationConfig = payload.generationConfig || payload.generation_config || {};

  return {
    model: payload.model || options.defaultModel || 'gemini-2.5-pro',
    systemText,
    messages,
    tools: normalizeGeminiTools(payload.tools, warnings),
    maxOutputTokens: firstFiniteNumber(
      options.maxOutputTokens,
      payload.max_output_tokens,
      payload.max_tokens,
      generationConfig.maxOutputTokens
    ),
    stream: typeof options.stream === 'boolean' ? options.stream : payload.stream,
    store: typeof options.store === 'boolean' ? options.store : payload.store,
    temperature: firstFiniteNumber(payload.temperature, generationConfig.temperature),
    topP: firstFiniteNumber(payload.top_p, generationConfig.topP),
    topK: firstFiniteNumber(payload.top_k, generationConfig.topK),
    stop: payload.stop || generationConfig.stopSequences
  };
}

function buildResponsesRequest(normalized, options, warnings) {
  if (normalized.prebuiltResponses) {
    return safeClone(normalized.prebuiltResponses);
  }

  const input = normalized.messages.map(msg => buildResponseMessage(msg.role, msg.text));
  if (input.length === 0) {
    const fallbackPrompt = typeof options.fallbackUserPrompt === 'string'
      ? options.fallbackUserPrompt
      : 'Hello';
    warnings.push('No message content detected, inserted fallback user message.');
    input.push(buildResponseMessage('user', fallbackPrompt));
  }

  const request = {
    model: normalized.model,
    input,
    stream: typeof normalized.stream === 'boolean' ? normalized.stream : false,
    store: typeof normalized.store === 'boolean' ? normalized.store : false
  };

  if (normalized.systemText) request.instructions = normalized.systemText;
  if (isFiniteNumber(normalized.maxOutputTokens)) request.max_output_tokens = normalized.maxOutputTokens;
  if (Array.isArray(normalized.tools) && normalized.tools.length > 0) request.tools = normalized.tools;
  if (normalized.toolChoice !== undefined) request.tool_choice = normalized.toolChoice;
  if (isFiniteNumber(normalized.temperature)) request.temperature = normalized.temperature;
  if (isFiniteNumber(normalized.topP)) request.top_p = normalized.topP;
  if (isFiniteNumber(normalized.topK)) request.top_k = normalized.topK;
  if (normalized.stop !== undefined) request.stop = normalized.stop;

  return request;
}

function toChatTool(tool) {
  if (!tool || typeof tool !== 'object') return null;

  if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
    return tool;
  }

  if (tool.type === 'function' && tool.name) {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters || { type: 'object', properties: {} }
      }
    };
  }

  return null;
}

function buildChatCompletionsRequest(normalized, options, warnings) {
  const messages = [];
  if (normalized.systemText) {
    messages.push({
      role: 'system',
      content: normalized.systemText
    });
  }

  normalized.messages.forEach(msg => {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    messages.push({
      role,
      content: msg.text
    });
  });

  if (messages.length === 0) {
    const fallbackPrompt = typeof options.fallbackUserPrompt === 'string'
      ? options.fallbackUserPrompt
      : 'Hello';
    warnings.push('No message content detected, inserted fallback user message.');
    messages.push({ role: 'user', content: fallbackPrompt });
  }

  const request = {
    model: normalized.model,
    messages,
    stream: typeof normalized.stream === 'boolean' ? normalized.stream : false
  };

  if (isFiniteNumber(normalized.maxOutputTokens)) request.max_tokens = normalized.maxOutputTokens;
  if (isFiniteNumber(normalized.temperature)) request.temperature = normalized.temperature;
  if (isFiniteNumber(normalized.topP)) request.top_p = normalized.topP;
  if (normalized.stop !== undefined) request.stop = normalized.stop;
  if (normalized.toolChoice !== undefined) request.tool_choice = normalized.toolChoice;

  if (Array.isArray(normalized.tools) && normalized.tools.length > 0) {
    const chatTools = normalized.tools.map(toChatTool).filter(Boolean);
    if (chatTools.length > 0) request.tools = chatTools;
  }

  ensureOpenAiStreamUsage(request);
  return request;
}

function convertNormalizedSourceToOpenCodePayload(normalizedSourceType, payload, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be a JSON object');
  }

  const targetApi = normalizeTargetApi(options.targetApi);
  if (!SUPPORTED_TARGET_APIS.includes(targetApi)) {
    throw new Error(`Unsupported targetApi: ${options.targetApi}`);
  }

  const warnings = [];
  let normalized;

  if (normalizedSourceType === 'claude') {
    normalized = normalizeClaudePayload(payload, options, warnings);
  } else if (normalizedSourceType === 'codex') {
    normalized = normalizeCodexPayload(payload, options, warnings);
  } else {
    normalized = normalizeGeminiPayload(payload, options, warnings);
  }

  if (!normalized.model) {
    normalized.model = options.defaultModel || 'gpt-4o-mini';
  }

  const requestBody = targetApi === 'responses'
    ? buildResponsesRequest(normalized, options, warnings)
    : buildChatCompletionsRequest(normalized, options, warnings);

  return {
    sourceType: normalizedSourceType,
    target: 'opencode',
    targetApi,
    endpoint: targetApi === 'responses' ? '/v1/responses' : '/v1/chat/completions',
    requestBody,
    warnings,
    meta: {
      model: requestBody.model,
      messageCount: Array.isArray(normalized.messages) ? normalized.messages.length : 0,
      hasSystemInstruction: Boolean(normalized.systemText)
    }
  };
}

function convertClaudeToOpenCodePayload({ payload, options = {} }) {
  return convertNormalizedSourceToOpenCodePayload('claude', payload, options);
}

function convertCodexToOpenCodePayload({ payload, options = {} }) {
  return convertNormalizedSourceToOpenCodePayload('codex', payload, options);
}

function convertGeminiToOpenCodePayload({ payload, options = {} }) {
  return convertNormalizedSourceToOpenCodePayload('gemini', payload, options);
}

function convertToOpenCodePayload({ sourceType, payload, options = {} }) {
  const normalizedSourceType = normalizeSourceType(sourceType);
  if (!SUPPORTED_SOURCE_TYPES.includes(normalizedSourceType)) {
    throw new Error(`Unsupported sourceType: ${sourceType}`);
  }

  if (normalizedSourceType === 'claude') {
    return convertClaudeToOpenCodePayload({ payload, options });
  }
  if (normalizedSourceType === 'codex') {
    return convertCodexToOpenCodePayload({ payload, options });
  }
  return convertGeminiToOpenCodePayload({ payload, options });
}

module.exports = {
  SUPPORTED_SOURCE_TYPES,
  SUPPORTED_TARGET_APIS,
  convertToOpenCodePayload,
  convertClaudeToOpenCodePayload,
  convertCodexToOpenCodePayload,
  convertGeminiToOpenCodePayload,
  normalizeSourceType
};
