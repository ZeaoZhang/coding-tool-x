'use strict';

// ---------------------------------------------------------------------------
// Neutral OpenCode normalization primitives
// ---------------------------------------------------------------------------
// Shared by claude-wire and gemini-wire. Provider-specific conversion,
// auth, envelope, and URL construction remain in each wire module.
// ---------------------------------------------------------------------------

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
    } else if (
      value.image_url &&
      typeof value.image_url === 'object' &&
      typeof value.image_url.url === 'string'
    ) {
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

  const fileNode =
    value.file && typeof value.file === 'object' ? value.file : value;
  const fileData =
    typeof fileNode.file_data === 'string' ? fileNode.file_data.trim() : '';
  const fileUrl =
    typeof fileNode.file_url === 'string' ? fileNode.file_url.trim() : '';
  const fileId =
    typeof fileNode.file_id === 'string' ? fileNode.file_id.trim() : '';

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

  if (
    typeof item === 'string' ||
    typeof item === 'number' ||
    typeof item === 'boolean'
  ) {
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
  if (
    itemType === 'document' &&
    item.source &&
    typeof item.source === 'object'
  ) {
    return [item];
  }

  if (
    itemType === 'text' ||
    itemType === 'input_text' ||
    itemType === 'output_text'
  ) {
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

  if (
    item.file !== undefined ||
    item.file_data !== undefined ||
    item.file_url !== undefined ||
    item.file_id !== undefined
  ) {
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
  const normalized =
    String(pathname || '').trim().replace(/\/+$/, '') || '/';
  return (
    normalized.endsWith('/v1/responses') || normalized.endsWith('/responses')
  );
}

function isChatCompletionsPath(pathname) {
  const normalized =
    String(pathname || '').trim().replace(/\/+$/, '') || '/';
  return (
    normalized.endsWith('/v1/chat/completions') ||
    normalized.endsWith('/chat/completions')
  );
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
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeStopSequences(stopValue) {
  if (!stopValue) return undefined;
  if (typeof stopValue === 'string') {
    const normalized = String(stopValue).trim();
    if (normalized) return [normalized];
    return undefined;
  }
  if (Array.isArray(stopValue)) {
    const sequences = stopValue
      .filter(item => typeof item === 'string')
      .map(item => String(item).trim())
      .filter(Boolean);
    return sequences.length > 0 ? sequences : undefined;
  }
  return undefined;
}

function buildAssistantToolUseMessageFromFunctionCall(item) {
  const functionPayload =
    item?.function && typeof item.function === 'object'
      ? item.function
      : item;
  const rawName = functionPayload?.name || item?.name;
  if (!rawName) return null;

  const callId =
    functionPayload?.call_id ||
    item?.call_id ||
    functionPayload?.id ||
    item?.id ||
    generateToolCallId();
  const argumentsSource =
    functionPayload?.arguments ??
    item?.arguments ??
    functionPayload?.input ??
    item?.input;
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
  const callId =
    item?.call_id || item?.tool_call_id || item?.id || generateToolCallId();
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

  if (
    isResponsesPath(pathname) &&
    typeof payload.instructions === 'string' &&
    payload.instructions.trim()
  ) {
    systemBlocks.push({
      type: 'text',
      text: payload.instructions.trim()
    });
  }

  const appendMessage = (role, content, topLevelCacheControl) => {
    const normalizedRole = normalizeOpenAiRole(role);
    const contentBlocks = normalizeOpenAiContentToClaudeBlocks(content);
    if (normalizedRole === 'system') {
      const blocks = contentBlocks.filter(
        block =>
          block &&
          block.type === 'text' &&
          typeof block.text === 'string' &&
          block.text.trim()
      );
      blocks.forEach((block, idx) => {
        const systemBlock = { type: 'text', text: block.text };
        if (block.cache_control && typeof block.cache_control === 'object') {
          systemBlock.cache_control = block.cache_control;
        } else if (
          topLevelCacheControl &&
          typeof topLevelCacheControl === 'object' &&
          idx === blocks.length - 1
        ) {
          systemBlock.cache_control = topLevelCacheControl;
        }
        systemBlocks.push(systemBlock);
      });
      return;
    }

    if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) return;
    if (
      topLevelCacheControl &&
      typeof topLevelCacheControl === 'object' &&
      contentBlocks.length > 0
    ) {
      const lastBlock = contentBlocks[contentBlocks.length - 1];
      if (!lastBlock.cache_control)
        lastBlock.cache_control = topLevelCacheControl;
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
          const assistantToolUse =
            buildAssistantToolUseMessageFromFunctionCall(item);
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

  // Chat-completions conversion also applies to generic non-Responses paths
  // (e.g. probe payloads sent against /v1/messages), so wire callers keep a
  // single conversion path.
  if (
    Array.isArray(payload.messages) &&
    (isChatCompletionsPath(pathname) || !isResponsesPath(pathname))
  ) {
    payload.messages.forEach(message => {
      if (!message || typeof message !== 'object') return;
      if (message.role === 'tool') {
        messages.push(buildUserToolResultMessage(message));
        return;
      }
      if (
        message.role === 'assistant' &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0
      ) {
        const assistantContent = normalizeOpenAiContentToClaudeBlocks(
          message.content
        );

        message.tool_calls.forEach(toolCall => {
          if (!toolCall || typeof toolCall !== 'object') return;
          const functionPayload =
            toolCall.function && typeof toolCall.function === 'object'
              ? toolCall.function
              : toolCall;
          const rawName = functionPayload.name || toolCall.name;
          if (!rawName) return;
          assistantContent.push({
            type: 'tool_use',
            id:
              toolCall.id || functionPayload.call_id || generateToolCallId(),
            name: rawName,
            input: parseToolArguments(
              functionPayload.arguments ?? functionPayload.input
            )
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
      appendMessage(
        message.role,
        message.content,
        message.cache_control
      );
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

module.exports = {
  extractTextFragments,
  extractText,
  parseBase64DataUrl,
  normalizeOpenAiImageBlock,
  normalizeOpenAiFileBlock,
  normalizeOpenAiContentItemToClaudeBlocks,
  normalizeOpenAiContentToClaudeBlocks,
  normalizeOpenAiRole,
  isResponsesPath,
  isChatCompletionsPath,
  generateToolCallId,
  parseToolArguments,
  normalizeToolResultContent,
  normalizeStopSequences,
  buildAssistantToolUseMessageFromFunctionCall,
  buildUserToolResultMessage,
  normalizeOpenCodeMessages
};
