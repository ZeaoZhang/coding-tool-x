'use strict';

const {
  normalizeOpenCodeMessages,
  generateToolCallId,
  normalizeToolResultContent,
  extractText,
  normalizeStopSequences
} = require('./opencode-normalization');

// ---------------------------------------------------------------------------
// Gemini CLI constants
// ---------------------------------------------------------------------------
const GEMINI_CLI_USER_AGENT = 'google-api-nodejs-client/9.15.1';
const GEMINI_CLI_API_CLIENT = 'gl-node/22.17.0';
const GEMINI_CLI_CLIENT_METADATA =
  'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI';
const GEMINI_PUBLIC_USER_AGENT = 'google-genai-sdk/0.8.0';

// ---------------------------------------------------------------------------
// Header override helper
// ---------------------------------------------------------------------------
function normalizeHeaderName(name) {
  return String(name || '').toLowerCase().trim();
}

/**
 * Merge explicit header overrides from options.headers and
 * options.providerConfig?.headers into a base headers map.
 * - Merges case-insensitively; explicit value wins.
 * - If either credential header (authorization or x-goog-api-key) is explicit,
 *   the generated opposite credential header is removed.
 */
function applyGeminiHeaderOverrides(baseHeaders, options = {}) {
  const merged = { ...baseHeaders };

  const overrideEntries = [];

  const headersSource = options.headers;
  if (headersSource && typeof headersSource === 'object' && !Array.isArray(headersSource)) {
    for (const [key, value] of Object.entries(headersSource)) {
      overrideEntries.push([normalizeHeaderName(key), String(value)]);
    }
  }

  const providerConfig = options.providerConfig;
  const providerHeaders =
    providerConfig &&
    typeof providerConfig === 'object' &&
    !Array.isArray(providerConfig)
      ? providerConfig.headers
      : undefined;
  if (providerHeaders && typeof providerHeaders === 'object' && !Array.isArray(providerHeaders)) {
    for (const [key, value] of Object.entries(providerHeaders)) {
      overrideEntries.push([normalizeHeaderName(key), String(value)]);
    }
  }

  for (const [lcKey, value] of overrideEntries) {
    merged[lcKey] = value;
  }

  // If either credential header is explicitly overridden, remove the
  // generated opposite credential.
  const hasExplicitAuth = overrideEntries.some(
    ([lcKey]) => lcKey === 'authorization'
  );
  const hasExplicitApiKey = overrideEntries.some(
    ([lcKey]) => lcKey === 'x-goog-api-key'
  );

  if (hasExplicitAuth && merged['x-goog-api-key'] !== undefined) {
    delete merged['x-goog-api-key'];
  }
  if (hasExplicitApiKey && merged['authorization'] !== undefined) {
    delete merged['authorization'];
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Gemini-specific conversion helpers
// ---------------------------------------------------------------------------
function normalizeOpenAiToolsToGemini(tools = []) {
  if (!Array.isArray(tools)) return [];

  const functionDeclarations = [];
  const builtInTools = [];
  const appendBuiltInTool = toolNode => {
    if (!toolNode || typeof toolNode !== 'object') return;
    builtInTools.push(toolNode);
  };

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;

    if (
      tool.type === 'function' &&
      tool.function &&
      typeof tool.function === 'object'
    ) {
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

    if (
      tool.google_search &&
      typeof tool.google_search === 'object'
    ) {
      appendBuiltInTool({ googleSearch: tool.google_search });
      continue;
    }
    if (
      tool.code_execution &&
      typeof tool.code_execution === 'object'
    ) {
      appendBuiltInTool({ codeExecution: tool.code_execution });
      continue;
    }
    if (
      tool.url_context &&
      typeof tool.url_context === 'object'
    ) {
      appendBuiltInTool({ urlContext: tool.url_context });
      continue;
    }

    if (
      normalizedType === 'google_search' ||
      normalizedType === 'web_search' ||
      normalizedType === 'web_search_preview'
    ) {
      const searchConfig =
        tool.web_search && typeof tool.web_search === 'object'
          ? tool.web_search
          : tool.googleSearch && typeof tool.googleSearch === 'object'
            ? tool.googleSearch
            : {};
      appendBuiltInTool({ googleSearch: searchConfig });
      continue;
    }

    if (
      normalizedType === 'code_execution' ||
      normalizedType === 'code_interpreter'
    ) {
      const executionConfig =
        tool.codeExecution && typeof tool.codeExecution === 'object'
          ? tool.codeExecution
          : {};
      appendBuiltInTool({ codeExecution: executionConfig });
      continue;
    }

    if (normalizedType === 'url_context') {
      const urlContextConfig =
        tool.urlContext && typeof tool.urlContext === 'object'
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
    if (toolChoice === 'auto')
      return { functionCallingConfig: { mode: 'AUTO' } };
    if (toolChoice === 'required')
      return { functionCallingConfig: { mode: 'ANY' } };
    if (toolChoice === 'none')
      return { functionCallingConfig: { mode: 'NONE' } };
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
    if (toolChoice.type === 'auto')
      return { functionCallingConfig: { mode: 'AUTO' } };
    if (toolChoice.type === 'required')
      return { functionCallingConfig: { mode: 'ANY' } };
    if (toolChoice.type === 'none')
      return { functionCallingConfig: { mode: 'NONE' } };
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

function normalizeGeminiMediaType(
  value,
  fallback = 'application/octet-stream'
) {
  const mediaType = typeof value === 'string' ? value.trim() : '';
  return mediaType || fallback;
}

function buildGeminiPartFromClaudeMediaBlock(block) {
  if (!block || typeof block !== 'object') return null;
  const source =
    block.source && typeof block.source === 'object'
      ? block.source
      : null;
  if (!source) return null;

  const blockType = String(block.type || '').trim().toLowerCase();
  const defaultMimeType =
    blockType === 'image' ? 'image/png' : 'application/octet-stream';
  const sourceType = String(source.type || '').trim().toLowerCase();
  const mediaType = normalizeGeminiMediaType(
    source.media_type || source.mime_type,
    defaultMimeType
  );

  if (
    sourceType === 'base64' &&
    typeof source.data === 'string' &&
    source.data.trim()
  ) {
    return {
      inlineData: {
        mimeType: mediaType,
        data: source.data
      }
    };
  }

  if (
    sourceType === 'url' &&
    typeof source.url === 'string' &&
    source.url.trim()
  ) {
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
    const contentBlocks = Array.isArray(message.content)
      ? message.content
      : [message.content];
    const parts = [];

    for (const block of contentBlocks) {
      if (!block || typeof block !== 'object') {
        const text = extractText(block);
        if (text) parts.push({ text });
        continue;
      }

      if (block.type === 'tool_use' && block.name) {
        const callId = String(block.id || generateToolCallId());
        const args =
          block.input &&
          typeof block.input === 'object' &&
          !Array.isArray(block.input)
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
            response: normalizeGeminiFunctionResponsePayload(
              block.content
            )
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

// ---------------------------------------------------------------------------
// Header construction
// ---------------------------------------------------------------------------
function buildGeminiPublicHeaders(apiKey, stream, networkHeaders, headerOptions) {
  if (!networkHeaders) {
    return applyGeminiHeaderOverrides({}, headerOptions);
  }

  const baseHeaders = {
    'x-goog-api-key': apiKey || '',
    'content-type': 'application/json',
    accept: stream ? 'text/event-stream' : 'application/json',
    'user-agent': GEMINI_PUBLIC_USER_AGENT
  };

  return applyGeminiHeaderOverrides(baseHeaders, headerOptions);
}

function buildGeminiCliHeaders(apiKey, stream, networkHeaders, headerOptions) {
  if (!networkHeaders) {
    return applyGeminiHeaderOverrides({}, headerOptions);
  }

  const baseHeaders = {
    authorization: apiKey ? `Bearer ${apiKey}` : '',
    'x-goog-api-key': apiKey || '',
    'content-type': 'application/json',
    accept: stream ? 'text/event-stream' : 'application/json',
    'user-agent': GEMINI_CLI_USER_AGENT,
    'x-goog-api-client': GEMINI_CLI_API_CLIENT,
    'client-metadata': GEMINI_CLI_CLIENT_METADATA
  };

  return applyGeminiHeaderOverrides(baseHeaders, headerOptions);
}

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

/**
 * Detect whether a Gemini base URL expects CLI (Cloud Code Assist) format.
 * Mirrors the proxy's shouldUseGeminiCliFormat.
 */
function shouldUseGeminiCliFormat(baseUrl = '') {
  let parsedUrl;
  try {
    parsedUrl = new URL(
      String(baseUrl || '').trim() ||
        'https://generativelanguage.googleapis.com'
    );
  } catch {
    return false;
  }

  const host = String(parsedUrl.hostname || '').toLowerCase();
  const pathname = parsedUrl.pathname.replace(/\/+$/, '');

  if (pathname.includes('/v1beta') || pathname.includes('/models/')) {
    return false;
  }
  if (
    pathname.includes('/v1internal') ||
    pathname.endsWith(':generateContent') ||
    pathname.endsWith(':streamGenerateContent')
  ) {
    return true;
  }
  if (host.includes('cloudcode-pa.googleapis.com')) {
    return true;
  }
  if (!pathname || pathname === '/') {
    return (
      !host.includes('generativelanguage.googleapis.com') &&
      !host.includes('aiplatform.googleapis.com')
    );
  }
  return false;
}

function buildGeminiCliTargetPath(parsedUrl, stream = false) {
  let pathname = parsedUrl.pathname.replace(/\/+$/, '');
  const method = stream ? 'streamGenerateContent' : 'generateContent';
  if (pathname.includes('/v1beta') || pathname.includes('/models/')) {
    return `/v1internal:${method}`;
  }

  if (!pathname || pathname === '/') {
    return `/v1internal:${method}`;
  }
  if (pathname.endsWith(':streamGenerateContent')) {
    return stream
      ? pathname
      : pathname.replace(/:streamGenerateContent$/, ':generateContent');
  }
  if (pathname.endsWith(':generateContent')) {
    return stream
      ? pathname.replace(/:generateContent$/, ':streamGenerateContent')
      : pathname;
  }
  if (pathname.endsWith('/v1internal')) {
    return `${pathname}:${method}`;
  }
  return `${pathname}/v1internal:${method}`;
}

function buildGeminiNativeTargetUrl(
  baseUrl = '',
  model = '',
  apiKey = '',
  options = {}
) {
  const modelName = String(model || '').trim();
  if (!modelName) return '';
  const stream = !!options.stream;

  const trimmed = String(baseUrl || '').trim();
  let targetUrl;
  try {
    targetUrl = new URL(
      trimmed || 'https://generativelanguage.googleapis.com'
    );
  } catch {
    // Non-empty but malformed base URL returns empty string
    if (trimmed) return '';
    targetUrl = new URL('https://generativelanguage.googleapis.com');
  }

  // Malformed URLs that parse without hostname (e.g. 'not-a-url:::')
  if (trimmed && !targetUrl.hostname) return '';

  let pathname = targetUrl.pathname.replace(/\/+$/, '');
  const modelsIndex = pathname.indexOf('/models');
  if (modelsIndex >= 0) {
    pathname = pathname.slice(0, modelsIndex);
  }

  let apiBasePath;
  if (!pathname || pathname === '/') {
    apiBasePath = '/v1beta';
  } else if (
    pathname.endsWith('/v1beta') ||
    pathname.endsWith('/v1')
  ) {
    apiBasePath = pathname;
  } else {
    apiBasePath = `${pathname}/v1beta`;
  }

  const method = stream ? 'streamGenerateContent' : 'generateContent';
  targetUrl.pathname = `${apiBasePath}/models/${encodeURIComponent(modelName)}:${method}`;
  if (apiKey) {
    targetUrl.searchParams.set('key', apiKey);
  }
  if (stream) {
    targetUrl.searchParams.set('alt', 'sse');
  }

  return targetUrl.toString();
}

/**
 * Build the Gemini target URL from a base URL, model, and api key.
 *
 * @param {string} baseUrl
 * @param {string} model
 * @param {string} apiKey
 * @param {object} [options={}] - { stream, useCli }
 * @returns {string} target URL or empty string for invalid
 */
function buildGeminiTargetUrl(baseUrl = '', model = '', apiKey = '', options = {}) {
  if (options.useCli) {
    const trimmed = String(baseUrl || '').trim();
    let targetUrl;
    try {
      targetUrl = new URL(
        trimmed || 'https://cloudcode-pa.googleapis.com'
      );
    } catch {
      // Non-empty but malformed base URL returns empty string
      if (trimmed) return '';
      targetUrl = new URL('https://cloudcode-pa.googleapis.com');
    }

    // Malformed URLs that parse without hostname (e.g. 'not-a-url:::')
    if (trimmed && !targetUrl.hostname) return '';

    targetUrl.pathname = buildGeminiCliTargetPath(
      targetUrl,
      !!options.stream
    );
    if (options.stream) {
      targetUrl.searchParams.set('alt', 'sse');
    }
    return targetUrl.toString();
  }

  return buildGeminiNativeTargetUrl(baseUrl, model, apiKey, options);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a Gemini API request from an OpenCode-compatible payload.
 *
 * @param {string} pathname - request path (e.g. /v1/chat/completions, /v1/responses)
 * @param {object} [payload={}] - OpenCode request body
 * @param {object} [options={}] -
 *   apiKey, fallbackModel, stream, useCli, networkHeaders, headers, providerConfig
 * @returns {{ body: object, headers: object, model: string, useCli: boolean }}
 */
function createGeminiRequest(pathname, payload = {}, options = {}) {
  const {
    apiKey = '',
    fallbackModel = '',
    stream = false,
    useCli = false,
    networkHeaders = true
  } = options;

  const model =
    payload.model || fallbackModel || '';

  const normalized = normalizeOpenCodeMessages(pathname, payload);
  const maxTokens = Number(payload.max_output_tokens ?? payload.max_tokens);
  const stopSequencesVal = normalizeStopSequences(payload.stop);
  const tools = normalizeOpenAiToolsToGemini(payload.tools || []);
  const toolConfig = normalizeToolChoiceToGemini(payload.tool_choice);
  const thinkingConfig = normalizeReasoningEffortToGemini(
    payload.reasoning_effort
  );
  const candidateCount = Number(payload.n);
  const responseModalities = normalizeGeminiResponseModalities(
    payload.modalities
  );
  const imageConfig =
    payload.image_config &&
    typeof payload.image_config === 'object' &&
    !Array.isArray(payload.image_config)
      ? payload.image_config
      : null;

  const innerBody = {
    contents: buildGeminiContents(normalized.messages)
  };

  if (
    normalized.systemBlocks &&
    normalized.systemBlocks.length > 0
  ) {
    innerBody.systemInstruction = {
      parts: normalized.systemBlocks
        .map(block => ({ text: block.text || '' }))
        .filter(p => p.text)
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
  if (stopSequencesVal) {
    generationConfig.stopSequences = stopSequencesVal;
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
    if (
      typeof imageConfig.aspect_ratio === 'string' &&
      imageConfig.aspect_ratio.trim()
    ) {
      mappedImageConfig.aspectRatio = imageConfig.aspect_ratio.trim();
    }
    if (
      typeof imageConfig.image_size === 'string' &&
      imageConfig.image_size.trim()
    ) {
      mappedImageConfig.imageSize = imageConfig.image_size.trim();
    }
    if (Object.keys(mappedImageConfig).length > 0) {
      generationConfig.imageConfig = mappedImageConfig;
    }
  }
  if (Object.keys(generationConfig).length > 0) {
    innerBody.generationConfig = generationConfig;
  }

  if (tools.length > 0) {
    innerBody.tools = tools;
  }
  if (toolConfig) {
    innerBody.toolConfig = toolConfig;
  }

  const body = useCli
    ? {
        project: '',
        model,
        request: innerBody
      }
    : innerBody;

  const headerOptions = {
    headers: options.headers,
    providerConfig: options.providerConfig
  };

  const headers = useCli
    ? buildGeminiCliHeaders(apiKey, stream, networkHeaders, headerOptions)
    : buildGeminiPublicHeaders(apiKey, stream, networkHeaders, headerOptions);

  return {
    body,
    headers,
    model,
    useCli
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  createGeminiRequest,
  buildGeminiTargetUrl,
  shouldUseGeminiCliFormat
};
