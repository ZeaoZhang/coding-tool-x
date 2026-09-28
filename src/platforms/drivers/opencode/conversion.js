'use strict';

function createDriver(context = {}) {
  const converter = require('./gateway-converter');
  const {
    loadLatestProxyRequestHeaders,
    loadLatestProxyRequestSnapshot
  } = require('../../../server/services/request-logger');
  const target = context.platform || 'opencode';

  function getOmpTargetContext() {
    const snapshot = loadLatestProxyRequestSnapshot('omp');
    const providerApi = snapshot?.route?.providerApi;
    const targetApi = providerApi === 'openai-completions'
      ? 'chat.completions'
      : ['openai-responses', 'openai-codex-responses', 'azure-openai-responses'].includes(providerApi)
        ? 'responses'
        : null;
    return { snapshot, providerApi, targetApi };
  }

  function convertPayload({ sourceType, payload, options = {} } = {}) {
    const ompContext = target === 'omp' ? getOmpTargetContext() : null;
    if (ompContext && !ompContext.targetApi) {
      throw new Error('The latest OMP request log does not identify a supported OpenAI-compatible provider API. Send an OMP request through an OpenAI-compatible route, then retry.');
    }
    const requestedTargetApi = options.targetApi || options.api;
    if (ompContext && requestedTargetApi && requestedTargetApi !== ompContext.targetApi) {
      throw new Error(`The latest OMP request uses ${ompContext.providerApi}; conversion only supports ${ompContext.targetApi}.`);
    }
    const result = converter.convertToOpenCodePayload({
      sourceType,
      payload,
      options: ompContext ? { ...options, targetApi: ompContext.targetApi } : options
    });
    return {
      ...result,
      target,
      ...(ompContext?.snapshot?.route?.path ? { endpoint: ompContext.snapshot.route.path } : {}),
      requestHeaders: loadLatestProxyRequestHeaders(target)
    };
  }

  return {
    platform: context.platform,
    capability: 'conversion',
    formats() {
      const ompContext = target === 'omp' ? getOmpTargetContext() : null;
      const targetApis = target === 'omp'
        ? (ompContext.targetApi ? [ompContext.targetApi] : [])
        : converter.SUPPORTED_TARGET_APIS;
      return {
        sourceTypes: converter.SUPPORTED_SOURCE_TYPES,
        formats: converter.SUPPORTED_SOURCE_TYPES.map(type => ({
          id: type,
          name: type === 'claude' ? 'Claude Code' : type === 'codex' ? 'Codex' : 'Gemini'
        })),
        targetApis,
        defaultTargetApi: targetApis[0] || null,
        endpoints: ompContext
          ? (ompContext.targetApi && ompContext.snapshot?.route?.path
            ? { [ompContext.targetApi]: ompContext.snapshot.route.path }
            : {})
          : {
            responses: '/v1/responses',
            'chat.completions': '/v1/chat/completions'
          }
      };
    },
    getFormats() {
      return this.formats();
    },
    normalizeSourceType: converter.normalizeSourceType,
    convertSource(sourceType, payload, options = {}) {
      const handlers = {
        claude: converter.convertClaudeToOpenCodePayload,
        codex: converter.convertCodexToOpenCodePayload,
        gemini: converter.convertGeminiToOpenCodePayload
      };
      if (target === 'omp') return convertPayload({ sourceType, payload, options });
      return {
        ...(handlers[sourceType] || converter.convertToOpenCodePayload)({ sourceType, payload, options }),
        target,
        requestHeaders: loadLatestProxyRequestHeaders(target)
      };
    },
    convert({ sourceType, payload, options = {} } = {}) {
      return convertPayload({ sourceType, payload, options });
    }
  };
}

module.exports = { createDriver };
