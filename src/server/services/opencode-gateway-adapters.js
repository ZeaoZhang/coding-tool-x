function cloneJsonCompatible(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function extractTextFragments(value, fragments) {
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
    value.forEach(item => extractTextFragments(item, fragments));
    return;
  }
  if (typeof value !== 'object') return;

  if (typeof value.text === 'string') {
    extractTextFragments(value.text, fragments);
    return;
  }
  if (typeof value.input_text === 'string') {
    extractTextFragments(value.input_text, fragments);
    return;
  }
  if (typeof value.output_text === 'string') {
    extractTextFragments(value.output_text, fragments);
    return;
  }
  if (value.content !== undefined) {
    extractTextFragments(value.content, fragments);
    return;
  }
  if (Array.isArray(value.parts)) {
    extractTextFragments(value.parts, fragments);
  }
}

function extractText(value) {
  const fragments = [];
  extractTextFragments(value, fragments);
  return fragments.join('\n').trim();
}

function parseBase64DataUrl(dataUrl = '') {
  const value = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  if (!value) return null;
  const matched = value.match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!matched) return null;
  return {
    mediaType: String(matched[1] || '').trim(),
    data: String(matched[2] || '')
  };
}

function normalizeOpenAiImageBlock(value) {
  let imageUrl = '';
  if (typeof value === 'string') {
    imageUrl = value;
  } else if (value && typeof value === 'object') {
    if (typeof value.url === 'string') {
      imageUrl = value.url;
    } else if (typeof value.image_url === 'string') {
      imageUrl = value.image_url;
    } else if (value.image_url && typeof value.image_url === 'object' && typeof value.image_url.url === 'string') {
      imageUrl = value.image_url.url;
    }
  }

  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;

  const dataUrl = parseBase64DataUrl(trimmed);
  if (dataUrl) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: dataUrl.mediaType || 'image/png',
        data: dataUrl.data
      }
    };
  }

  return {
    type: 'image',
    source: {
      type: 'url',
      url: trimmed
    }
  };
}

function normalizeOpenAiFileBlock(value) {
  if (!value || typeof value !== 'object') return null;

  const fileNode = (value.file && typeof value.file === 'object') ? value.file : value;
  const fileData = typeof fileNode.file_data === 'string' ? fileNode.file_data.trim() : '';
  const fileUrl = typeof fileNode.file_url === 'string' ? fileNode.file_url.trim() : '';
  const fileId = typeof fileNode.file_id === 'string' ? fileNode.file_id.trim() : '';

  if (fileData) {
    const dataUrl = parseBase64DataUrl(fileData);
    if (dataUrl) {
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: dataUrl.mediaType || 'application/octet-stream',
          data: dataUrl.data
        }
      };
    }

    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/octet-stream',
        data: fileData
      }
    };
  }

  if (fileUrl) {
    return {
      type: 'document',
      source: {
        type: 'url',
        url: fileUrl
      }
    };
  }

  if (fileId) {
    return {
      type: 'text',
      text: `[input_file:${fileId}]`
    };
  }

  return null;
}

function normalizeOpenAiContentItemToClaudeBlocks(item) {
  if (item === null || item === undefined) return [];

  if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
    const text = String(item);
    return text.trim() ? [{ type: 'text', text }] : [];
  }

  if (Array.isArray(item)) {
    return item.flatMap(normalizeOpenAiContentItemToClaudeBlocks);
  }

  if (typeof item !== 'object') return [];

  const itemType = String(item.type || '').trim().toLowerCase();
  if (itemType === 'tool_use') {
    return [item];
  }
  if (itemType === 'tool_result') {
    return [item];
  }

  if (itemType === 'image' && item.source && typeof item.source === 'object') {
    return [item];
  }
  if (itemType === 'document' && item.source && typeof item.source === 'object') {
    return [item];
  }

  if (itemType === 'text' || itemType === 'input_text' || itemType === 'output_text') {
    const text = typeof item.text === 'string' ? item.text : '';
    if (!text.trim()) return [];
    const block = { type: 'text', text };
    if (item.cache_control && typeof item.cache_control === 'object') {
      block.cache_control = item.cache_control;
    }
    return [block];
  }

  if (itemType === 'image_url' || itemType === 'input_image') {
    const imageBlock = normalizeOpenAiImageBlock(item);
    return imageBlock ? [imageBlock] : [];
  }

  if (itemType === 'file' || itemType === 'input_file') {
    const fileBlock = normalizeOpenAiFileBlock(item);
    return fileBlock ? [fileBlock] : [];
  }

  if (item.image_url !== undefined || item.url !== undefined) {
    const imageBlock = normalizeOpenAiImageBlock(item);
    if (imageBlock) return [imageBlock];
  }

  if (item.file !== undefined || item.file_data !== undefined || item.file_url !== undefined || item.file_id !== undefined) {
    const fileBlock = normalizeOpenAiFileBlock(item);
    if (fileBlock) return [fileBlock];
  }

  const fallbackText = extractText(item);
  return fallbackText ? [{ type: 'text', text: fallbackText }] : [];
}

function normalizeOpenAiContentToClaudeBlocks(content) {
  return normalizeOpenAiContentItemToClaudeBlocks(content);
}

function normalizeOpenAiRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'assistant' || value === 'model') return 'assistant';
  if (value === 'system' || value === 'developer') return 'system';
  if (value === 'tool') return 'tool';
  return 'user';
}

function isResponsesPath(pathname) {
  const normalized = String(pathname || '').trim().replace(/\/+$/, '') || '/';
  return normalized.endsWith('/v1/responses') || normalized.endsWith('/responses');
}

function isChatCompletionsPath(pathname) {
  const normalized = String(pathname || '').trim().replace(/\/+$/, '') || '/';
  return normalized.endsWith('/v1/chat/completions') || normalized.endsWith('/chat/completions');
}

function normalizeReasoningEffortToClaude(reasoningEffort) {
  const effort = String(reasoningEffort || '').trim().toLowerCase();
  if (!effort) return undefined;
  if (effort === 'none') return { type: 'disabled' };
  if (effort === 'auto') return { type: 'enabled' };
  if (effort === 'low') return { type: 'enabled', budget_tokens: 2048 };
  if (effort === 'medium') return { type: 'enabled', budget_tokens: 8192 };
  if (effort === 'high') return { type: 'enabled', budget_tokens: 24576 };
  return undefined;
}

function generateToolCallId() {
  return `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseToolArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeToolResultContent(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function ensureClaudeToolNamePrefix(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return '';
  return trimmed.startsWith('mcp_') ? trimmed : `mcp_${trimmed}`;
}

function stripClaudeToolNamePrefix(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return '';
  if (!trimmed.startsWith('mcp_')) return trimmed;
  const stripped = trimmed.slice(4).trim();
  return stripped || trimmed;
}

function transformIdentityTextToClaudeCode(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(/open\s*code/gi, 'Claude Code');
}

function buildAssistantToolUseMessageFromFunctionCall(item) {
  const functionPayload = (item?.function && typeof item.function === 'object')
    ? item.function
    : item;
  const rawName = functionPayload?.name || item?.name;
  if (!rawName) return null;

  const callId = functionPayload?.call_id || item?.call_id || functionPayload?.id || item?.id || generateToolCallId();
  const argumentsSource = functionPayload?.arguments ?? item?.arguments ?? functionPayload?.input ?? item?.input;
  const input = parseToolArguments(argumentsSource);

  return {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: callId,
        name: rawName,
        input
      }
    ]
  };
}

function buildUserToolResultMessage(item) {
  const callId = item?.call_id || item?.tool_call_id || item?.id || generateToolCallId();
  const outputSource = item?.output ?? item?.content ?? '';
  const content = normalizeToolResultContent(outputSource);

  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: callId,
        content
      }
    ]
  };
}

function normalizeOpenCodeMessages(pathname, payload = {}) {
  const systemBlocks = [];
  const messages = [];

  if (isResponsesPath(pathname) && typeof payload.instructions === 'string' && payload.instructions.trim()) {
    systemBlocks.push({ type: 'text', text: payload.instructions.trim() });
  }

  const appendMessage = (role, content, topLevelCacheControl) => {
    const normalizedRole = normalizeOpenAiRole(role);
    const contentBlocks = normalizeOpenAiContentToClaudeBlocks(content);
    if (normalizedRole === 'system') {
      const blocks = contentBlocks
        .filter(block => block && block.type === 'text' && typeof block.text === 'string' && block.text.trim());
      blocks.forEach((block, idx) => {
        const systemBlock = { type: 'text', text: block.text };
        if (block.cache_control && typeof block.cache_control === 'object') {
          systemBlock.cache_control = block.cache_control;
        } else if (topLevelCacheControl && typeof topLevelCacheControl === 'object' && idx === blocks.length - 1) {
          systemBlock.cache_control = topLevelCacheControl;
        }
        systemBlocks.push(systemBlock);
      });
      return;
    }

    if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) return;
    if (topLevelCacheControl && typeof topLevelCacheControl === 'object' && contentBlocks.length > 0) {
      const lastBlock = contentBlocks[contentBlocks.length - 1];
      if (!lastBlock.cache_control) lastBlock.cache_control = topLevelCacheControl;
    }
    messages.push({
      role: normalizedRole === 'assistant' ? 'assistant' : 'user',
      content: contentBlocks
    });
  };

  if (isResponsesPath(pathname)) {
    if (typeof payload.input === 'string') {
      appendMessage('user', payload.input);
    } else if (Array.isArray(payload.input)) {
      payload.input.forEach(item => {
        if (!item || typeof item !== 'object') return;
        if (item.type === 'function_call') {
          const assistantToolUse = buildAssistantToolUseMessageFromFunctionCall(item);
          if (assistantToolUse) {
            messages.push(assistantToolUse);
          }
          return;
        }
        if (item.type === 'function_call_output') {
          messages.push(buildUserToolResultMessage(item));
          return;
        }
        if (item.type === 'message' || item.role) {
          appendMessage(item.role, item.content, item.cache_control);
        }
      });
    }
  }

  if (isChatCompletionsPath(pathname) && Array.isArray(payload.messages)) {
    payload.messages.forEach(message => {
      if (!message || typeof message !== 'object') return;
      if (message.role === 'tool') {
        messages.push(buildUserToolResultMessage(message));
        return;
      }
      if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        const assistantContent = normalizeOpenAiContentToClaudeBlocks(message.content);

        message.tool_calls.forEach(toolCall => {
          if (!toolCall || typeof toolCall !== 'object') return;
          const functionPayload = (toolCall.function && typeof toolCall.function === 'object')
            ? toolCall.function
            : toolCall;
          const rawName = functionPayload.name || toolCall.name;
          if (!rawName) return;
          assistantContent.push({
            type: 'tool_use',
            id: toolCall.id || functionPayload.call_id || generateToolCallId(),
            name: rawName,
            input: parseToolArguments(functionPayload.arguments ?? functionPayload.input)
          });
        });

        if (assistantContent.length > 0) {
          messages.push({
            role: 'assistant',
            content: assistantContent
          });
        }
        return;
      }
      appendMessage(message.role, message.content, message.cache_control);
    });
  }

  if (messages.length === 0) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }]
    });
  }

  return {
    systemBlocks,
    messages
  };
}

function buildClaudeCodeUserId(seed = '') {
  const normalizedSeed = normalizeClaudeSessionSeed(seed);
  const sessionId = normalizedSeed || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `user_${'0'.repeat(64)}_account__session_${sessionId}`;
}

function normalizeSessionKeyValue(value) {
  const source = Array.isArray(value) ? value[0] : value;
  if (typeof source !== 'string') return '';
  const normalized = source.trim();
  if (!normalized) return '';
  const lowered = normalized.toLowerCase();
  if (lowered === 'undefined' || lowered === '[undefined]' || lowered === 'null' || lowered === '[null]' || lowered === 'nan' || lowered === '[nan]') {
    return '';
  }
  return normalized;
}

function normalizeClaudeSessionSeed(value) {
  const normalized = normalizeSessionKeyValue(value);
  if (!normalized) return '';
  return normalized
    .replace(/^user_[0-9a-f]{64}_account__session_/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
}

function extractClaudeSessionSeedFromUserId(value = '') {
  const normalized = normalizeSessionKeyValue(value);
  if (!normalized) return '';
  const matched = normalized.match(/^user_[0-9a-f]{64}_account__session_(.+)$/i);
  if (!matched) return '';
  return normalizeClaudeSessionSeed(matched[1] || '');
}

function getClaudeSessionSeedAllowList() {
  const envSeeds = String(
    process.env.OPENCODE_CLAUDE_FALLBACK_SESSION_SEEDS || 'session_test,session,sessiontest,session_'
  )
    .split(',')
    .map(seed => normalizeClaudeSessionSeed(seed))
    .filter(Boolean);
  const fallbackSeed = normalizeClaudeSessionSeed(process.env.OPENCODE_CLAUDE_FALLBACK_SESSION_SEED || 'session_test');
  return Array.from(new Set([
    ...envSeeds,
    fallbackSeed,
    'session_test',
    'session',
    'sessiontest',
    'session_'
  ].filter(Boolean)));
}

function isValidClaudeCodeUserId(value = '', options = {}) {
  const normalized = normalizeSessionKeyValue(value);
  if (!normalized) return false;
  const matched = normalized.match(/^user_[0-9a-f]{64}_account__session_([a-zA-Z0-9_-]{1,64})$/i);
  if (!matched) return false;
  if (!options.enforceAllowedSeed) return true;
  const allowedSeeds = Array.isArray(options.allowedSeeds) && options.allowedSeeds.length > 0
    ? options.allowedSeeds
    : getClaudeSessionSeedAllowList();
  const seed = normalizeClaudeSessionSeed(matched[1] || '');
  return !!seed && allowedSeeds.includes(seed);
}

function normalizeClaudeMetadata(metadata, fallbackUserId = '') {
  const normalized = (metadata && typeof metadata === 'object' && !Array.isArray(metadata))
    ? { ...metadata }
    : {};
  const allowedSeeds = getClaudeSessionSeedAllowList();
  const userId = normalizeSessionKeyValue(normalized.user_id);
  const fallbackValue = normalizeSessionKeyValue(fallbackUserId);
  if (isValidClaudeCodeUserId(userId, { enforceAllowedSeed: true, allowedSeeds })) {
    normalized.user_id = userId;
    return normalized;
  }
  if (isValidClaudeCodeUserId(fallbackValue, { enforceAllowedSeed: true, allowedSeeds })) {
    normalized.user_id = fallbackValue;
    return normalized;
  }
  const fallbackSeedRaw = extractClaudeSessionSeedFromUserId(fallbackValue) || normalizeClaudeSessionSeed(fallbackValue);
  const fallbackSeed = allowedSeeds.includes(fallbackSeedRaw) ? fallbackSeedRaw : (allowedSeeds[0] || 'session_test');
  normalized.user_id = buildClaudeCodeUserId(fallbackSeed);
  return normalized;
}

function normalizeStopSequences(stopValue) {
  if (!stopValue) return undefined;
  if (typeof stopValue === 'string') {
    const normalized = normalizeSessionKeyValue(stopValue);
    if (normalized) return [normalized];
    return undefined;
  }
  if (Array.isArray(stopValue)) {
    const sequences = stopValue
      .filter(item => typeof item === 'string')
      .map(item => normalizeSessionKeyValue(item))
      .filter(Boolean);
    return sequences.length > 0 ? sequences : undefined;
  }
  return undefined;
}

function normalizeToolChoiceToClaude(toolChoice) {
  if (!toolChoice) return undefined;

  if (typeof toolChoice === 'string') {
    if (toolChoice === 'auto') return { type: 'auto' };
    if (toolChoice === 'required') return { type: 'any' };
    return undefined;
  }

  if (typeof toolChoice === 'object') {
    if (toolChoice.type === 'function' && toolChoice.function?.name) {
      return { type: 'tool', name: ensureClaudeToolNamePrefix(toolChoice.function.name) };
    }
    if (toolChoice.type === 'function' && toolChoice.name) {
      return { type: 'tool', name: ensureClaudeToolNamePrefix(toolChoice.name) };
    }
    if (toolChoice.type === 'auto') return { type: 'auto' };
    if (toolChoice.type === 'required') return { type: 'any' };
  }

  return undefined;
}

function normalizeOpenAiToolsToClaude(tools = []) {
  if (!Array.isArray(tools)) return [];

  const normalized = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;

    if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
      const fn = tool.function;
      if (!fn.name) continue;
      normalized.push({
        name: ensureClaudeToolNamePrefix(fn.name),
        description: transformIdentityTextToClaudeCode(fn.description || ''),
        input_schema: fn.parameters || { type: 'object', properties: {} }
      });
      continue;
    }

    if (tool.type === 'function' && tool.name) {
      normalized.push({
        name: ensureClaudeToolNamePrefix(tool.name),
        description: transformIdentityTextToClaudeCode(tool.description || ''),
        input_schema: tool.parameters || { type: 'object', properties: {} }
      });
    }
  }

  return normalized;
}

function applyPromptCachingToClaudePayload(converted) {
  const EPHEMERAL = { type: 'ephemeral' };

  let messageBreakpoints = 0;
  if (Array.isArray(converted.messages)) {
    converted.messages.forEach(msg => {
      if (Array.isArray(msg.content)) {
        msg.content.forEach(block => {
          if (block.cache_control) messageBreakpoints++;
          if (block.type === 'tool_result' && Array.isArray(block.content)) {
            block.content.forEach(inner => {
              if (inner.cache_control) messageBreakpoints++;
            });
          }
        });
      }
    });
  }

  let systemBreakpoints = 0;
  if (Array.isArray(converted.system)) {
    converted.system.forEach(block => {
      if (block.cache_control) systemBreakpoints++;
    });
  }

  if (systemBreakpoints === 0 && Array.isArray(converted.system) && converted.system.length > 0) {
    const last = converted.system[converted.system.length - 1];
    if (!last.cache_control) last.cache_control = EPHEMERAL;
  }

  if (messageBreakpoints === 0 && systemBreakpoints === 0) {
    if (Array.isArray(converted.messages) && converted.messages.length > 0) {
      for (const msg of converted.messages.slice(-2)) {
        if (Array.isArray(msg.content) && msg.content.length > 0) {
          const last = msg.content[msg.content.length - 1];
          if (!last.cache_control) last.cache_control = EPHEMERAL;
        }
      }
    }
  }
}

function applyClaudeToolNamePrefixToMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages.map(message => {
    if (!message || typeof message !== 'object' || !Array.isArray(message.content)) {
      return message;
    }

    const content = message.content.map(block => {
      if (!block || typeof block !== 'object') return block;
      if (block.type !== 'tool_use' || !block.name) return block;
      return {
        ...block,
        name: ensureClaudeToolNamePrefix(block.name)
      };
    });

    return {
      ...message,
      content
    };
  });
}

function convertOpenCodePayloadToClaude(pathname, payload = {}, fallbackModel = '', options = {}) {
  const normalized = normalizeOpenCodeMessages(pathname, payload);
  const maxTokens = Number(payload.max_output_tokens ?? payload.max_tokens);
  const stopSequences = normalizeStopSequences(payload.stop);
  const thinking = normalizeReasoningEffortToClaude(payload.reasoning_effort);
  const CLAUDE_CODE_IDENTITY_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

  const converted = {
    model: payload.model || fallbackModel || 'claude-sonnet-4-20250514',
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.round(maxTokens) : 4096,
    stream: false,
    messages: applyClaudeToolNamePrefixToMessages(normalized.messages)
  };

  if (normalized.systemBlocks && normalized.systemBlocks.length > 0) {
    converted.system = normalized.systemBlocks
      .map(block => {
        if (!block || typeof block !== 'object') return null;
        if (block.type !== 'text') return block;
        return {
          ...block,
          text: transformIdentityTextToClaudeCode(block.text || '')
        };
      })
      .filter(Boolean);
  }

  if (!Array.isArray(converted.system) || converted.system.length === 0) {
    converted.system = [{ type: 'text', text: CLAUDE_CODE_IDENTITY_PROMPT }];
  }

  const tools = normalizeOpenAiToolsToClaude(payload.tools || []);
  if (tools.length > 0) {
    converted.tools = tools;
  }

  const toolChoice = normalizeToolChoiceToClaude(payload.tool_choice);
  if (toolChoice) {
    converted.tool_choice = toolChoice;
  }
  if (stopSequences) {
    converted.stop_sequences = stopSequences;
  }
  if (thinking) {
    converted.thinking = thinking;
  }

  if (Number.isFinite(Number(payload.temperature))) {
    converted.temperature = Number(payload.temperature);
  }
  if (Number.isFinite(Number(payload.top_p))) {
    converted.top_p = Number(payload.top_p);
  }
  if (Number.isFinite(Number(payload.top_k))) {
    converted.top_k = Number(payload.top_k);
  }

  converted.metadata = normalizeClaudeMetadata(payload.metadata, options.sessionUserId);

  applyPromptCachingToClaudePayload(converted);

  return converted;
}

function normalizeCodexResponsesInput(inputValue) {
  if (typeof inputValue === 'string') {
    return [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: inputValue
          }
        ]
      }
    ];
  }

  if (!Array.isArray(inputValue)) return undefined;
  return inputValue.map(item => {
    if (!item || typeof item !== 'object') return item;
    const clonedItem = cloneJsonCompatible(item);
    if (String(clonedItem?.role || '').trim().toLowerCase() === 'system') {
      clonedItem.role = 'developer';
    }
    return clonedItem;
  });
}

function convertOpenCodePayloadToCodexResponses(payload = {}, fallbackModel = '') {
  const requestBody = cloneJsonCompatible((payload && typeof payload === 'object') ? payload : {});

  if (requestBody.model === undefined && fallbackModel) {
    requestBody.model = fallbackModel;
  }

  const normalizedInput = normalizeCodexResponsesInput(requestBody.input);
  if (normalizedInput !== undefined) {
    requestBody.input = normalizedInput;
  }

  requestBody.stream = true;
  requestBody.store = false;
  if (requestBody.parallel_tool_calls === undefined) {
    requestBody.parallel_tool_calls = true;
  }
  if (typeof requestBody.instructions !== 'string') {
    requestBody.instructions = '';
  }

  const include = Array.isArray(requestBody.include)
    ? requestBody.include.filter(item => typeof item === 'string' && item.trim())
    : [];
  if (!include.includes('reasoning.encrypted_content')) {
    include.push('reasoning.encrypted_content');
  }
  requestBody.include = include;

  delete requestBody.max_output_tokens;
  delete requestBody.max_completion_tokens;
  delete requestBody.temperature;
  delete requestBody.top_p;
  delete requestBody.service_tier;
  delete requestBody.user;
  delete requestBody.previous_response_id;
  delete requestBody.prompt_cache_retention;
  delete requestBody.safety_identifier;

  return {
    requestBody,
    model: requestBody.model || fallbackModel || ''
  };
}

function normalizeOpenAiToolsToGemini(tools = []) {
  if (!Array.isArray(tools)) return [];

  const functionDeclarations = [];
  const builtInTools = [];
  const appendBuiltInTool = (toolNode) => {
    if (!toolNode || typeof toolNode !== 'object') return;
    builtInTools.push(toolNode);
  };

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;

    if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
      const fn = tool.function;
      if (!fn.name) continue;
      functionDeclarations.push({
        name: fn.name,
        description: fn.description || '',
        parameters: fn.parameters || { type: 'object', properties: {} }
      });
      continue;
    }

    if (tool.type === 'function' && tool.name) {
      functionDeclarations.push({
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters || { type: 'object', properties: {} }
      });
      continue;
    }

    const normalizedType = String(tool.type || '').trim().toLowerCase();

    if (tool.google_search && typeof tool.google_search === 'object') {
      appendBuiltInTool({ googleSearch: tool.google_search });
      continue;
    }
    if (tool.code_execution && typeof tool.code_execution === 'object') {
      appendBuiltInTool({ codeExecution: tool.code_execution });
      continue;
    }
    if (tool.url_context && typeof tool.url_context === 'object') {
      appendBuiltInTool({ urlContext: tool.url_context });
      continue;
    }

    if (normalizedType === 'google_search' || normalizedType === 'web_search' || normalizedType === 'web_search_preview') {
      const searchConfig = (tool.web_search && typeof tool.web_search === 'object')
        ? tool.web_search
        : ((tool.googleSearch && typeof tool.googleSearch === 'object') ? tool.googleSearch : {});
      appendBuiltInTool({ googleSearch: searchConfig });
      continue;
    }

    if (normalizedType === 'code_execution' || normalizedType === 'code_interpreter') {
      const executionConfig = (tool.codeExecution && typeof tool.codeExecution === 'object')
        ? tool.codeExecution
        : {};
      appendBuiltInTool({ codeExecution: executionConfig });
      continue;
    }

    if (normalizedType === 'url_context') {
      const urlContextConfig = (tool.urlContext && typeof tool.urlContext === 'object')
        ? tool.urlContext
        : {};
      appendBuiltInTool({ urlContext: urlContextConfig });
    }
  }

  const normalizedTools = [];
  if (functionDeclarations.length > 0) {
    normalizedTools.push({ functionDeclarations });
  }
  if (builtInTools.length > 0) {
    normalizedTools.push(...builtInTools);
  }
  return normalizedTools;
}

function normalizeToolChoiceToGemini(toolChoice) {
  if (!toolChoice) return undefined;

  if (typeof toolChoice === 'string') {
    if (toolChoice === 'auto') return { functionCallingConfig: { mode: 'AUTO' } };
    if (toolChoice === 'required') return { functionCallingConfig: { mode: 'ANY' } };
    if (toolChoice === 'none') return { functionCallingConfig: { mode: 'NONE' } };
    return undefined;
  }

  if (typeof toolChoice === 'object') {
    const functionName = toolChoice.function?.name || toolChoice.name;
    if (toolChoice.type === 'function' && functionName) {
      return {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [functionName]
        }
      };
    }
    if (toolChoice.type === 'auto') return { functionCallingConfig: { mode: 'AUTO' } };
    if (toolChoice.type === 'required') return { functionCallingConfig: { mode: 'ANY' } };
    if (toolChoice.type === 'none') return { functionCallingConfig: { mode: 'NONE' } };
  }

  return undefined;
}

function normalizeReasoningEffortToGemini(reasoningEffort) {
  const effort = String(reasoningEffort || '').trim().toLowerCase();
  if (!effort) return undefined;
  if (effort === 'none') {
    return {
      includeThoughts: false,
      thinkingBudget: 0
    };
  }
  if (effort === 'auto') {
    return {
      includeThoughts: true,
      thinkingBudget: -1
    };
  }
  if (effort === 'low' || effort === 'medium' || effort === 'high') {
    return {
      includeThoughts: true,
      thinkingLevel: effort
    };
  }
  return undefined;
}

function normalizeGeminiResponseModalities(modalities) {
  if (!Array.isArray(modalities)) return undefined;
  const mapped = modalities
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .map(item => {
      if (item === 'text') return 'TEXT';
      if (item === 'image') return 'IMAGE';
      return '';
    })
    .filter(Boolean);
  return mapped.length > 0 ? mapped : undefined;
}

function normalizeGeminiFunctionResponsePayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return { content: '' };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return { content: value };
    }
    return { content: value };
  }
  return { content: normalizeToolResultContent(value) };
}

function normalizeGeminiMediaType(value, fallback = 'application/octet-stream') {
  const mediaType = typeof value === 'string' ? value.trim() : '';
  return mediaType || fallback;
}

function buildGeminiPartFromClaudeMediaBlock(block) {
  if (!block || typeof block !== 'object') return null;
  const source = (block.source && typeof block.source === 'object') ? block.source : null;
  if (!source) return null;

  const blockType = String(block.type || '').trim().toLowerCase();
  const defaultMimeType = blockType === 'image' ? 'image/png' : 'application/octet-stream';
  const sourceType = String(source.type || '').trim().toLowerCase();
  const mediaType = normalizeGeminiMediaType(source.media_type || source.mime_type, defaultMimeType);

  if (sourceType === 'base64' && typeof source.data === 'string' && source.data.trim()) {
    return {
      inlineData: {
        mimeType: mediaType,
        data: source.data
      }
    };
  }

  if (sourceType === 'url' && typeof source.url === 'string' && source.url.trim()) {
    return {
      fileData: {
        mimeType: mediaType,
        fileUri: source.url.trim()
      }
    };
  }

  return null;
}

function buildGeminiContents(messages = []) {
  const contents = [];
  const toolNameById = new Map();

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    const contentBlocks = Array.isArray(message.content) ? message.content : [message.content];
    const parts = [];

    for (const block of contentBlocks) {
      if (!block || typeof block !== 'object') {
        const text = extractText(block);
        if (text) parts.push({ text });
        continue;
      }

      if (block.type === 'tool_use' && block.name) {
        const callId = String(block.id || generateToolCallId());
        const args = (block.input && typeof block.input === 'object' && !Array.isArray(block.input))
          ? block.input
          : {};
        toolNameById.set(callId, block.name);
        parts.push({
          functionCall: {
            name: block.name,
            args
          }
        });
        continue;
      }

      if (block.type === 'tool_result') {
        const toolUseId = String(block.tool_use_id || block.id || '');
        const toolName = block.name || toolNameById.get(toolUseId);
        if (!toolName) {
          const text = normalizeToolResultContent(block.content);
          if (text) parts.push({ text });
          continue;
        }

        parts.push({
          functionResponse: {
            name: toolName,
            response: normalizeGeminiFunctionResponsePayload(block.content)
          }
        });
        continue;
      }

      if (block.type === 'image' || block.type === 'document') {
        const mediaPart = buildGeminiPartFromClaudeMediaBlock(block);
        if (mediaPart) {
          parts.push(mediaPart);
          continue;
        }
      }

      const text = extractText(block);
      if (text) parts.push({ text });
    }

    if (parts.length === 0) continue;
    contents.push({ role, parts });
  }

  return contents;
}

function convertOpenCodePayloadToGemini(pathname, payload = {}, fallbackModel = '') {
  const normalized = normalizeOpenCodeMessages(pathname, payload);
  const maxTokens = Number(payload.max_output_tokens ?? payload.max_tokens);
  const stopSequences = normalizeStopSequences(payload.stop);
  const tools = normalizeOpenAiToolsToGemini(payload.tools || []);
  const toolConfig = normalizeToolChoiceToGemini(payload.tool_choice);
  const thinkingConfig = normalizeReasoningEffortToGemini(payload.reasoning_effort);
  const candidateCount = Number(payload.n);
  const responseModalities = normalizeGeminiResponseModalities(payload.modalities);
  const imageConfig = (payload.image_config && typeof payload.image_config === 'object' && !Array.isArray(payload.image_config))
    ? payload.image_config
    : null;

  const requestBody = {
    contents: buildGeminiContents(normalized.messages)
  };

  if (normalized.systemBlocks && normalized.systemBlocks.length > 0) {
    requestBody.systemInstruction = {
      parts: normalized.systemBlocks.map(block => ({ text: block.text || '' })).filter(p => p.text)
    };
  }

  const generationConfig = {};
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    generationConfig.maxOutputTokens = Math.round(maxTokens);
  }
  if (Number.isFinite(Number(payload.temperature))) {
    generationConfig.temperature = Number(payload.temperature);
  }
  if (Number.isFinite(Number(payload.top_p))) {
    generationConfig.topP = Number(payload.top_p);
  }
  if (Number.isFinite(Number(payload.top_k))) {
    generationConfig.topK = Number(payload.top_k);
  }
  if (stopSequences) {
    generationConfig.stopSequences = stopSequences;
  }
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }
  if (Number.isFinite(candidateCount) && candidateCount > 1) {
    generationConfig.candidateCount = Math.round(candidateCount);
  }
  if (responseModalities) {
    generationConfig.responseModalities = responseModalities;
  }
  if (imageConfig) {
    const mappedImageConfig = {};
    if (typeof imageConfig.aspect_ratio === 'string' && imageConfig.aspect_ratio.trim()) {
      mappedImageConfig.aspectRatio = imageConfig.aspect_ratio.trim();
    }
    if (typeof imageConfig.image_size === 'string' && imageConfig.image_size.trim()) {
      mappedImageConfig.imageSize = imageConfig.image_size.trim();
    }
    if (Object.keys(mappedImageConfig).length > 0) {
      generationConfig.imageConfig = mappedImageConfig;
    }
  }
  if (Object.keys(generationConfig).length > 0) {
    requestBody.generationConfig = generationConfig;
  }

  if (tools.length > 0) {
    requestBody.tools = tools;
  }
  if (toolConfig) {
    requestBody.toolConfig = toolConfig;
  }

  return {
    model: payload.model || fallbackModel || '',
    requestBody
  };
}

module.exports = {
  convertOpenCodePayloadToClaude,
  convertOpenCodePayloadToCodexResponses,
  convertOpenCodePayloadToGemini,
  stripClaudeToolNamePrefix
};
