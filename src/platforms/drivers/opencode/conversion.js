'use strict';

function createDriver(context = {}) {
  const converter = require('./gateway-converter');
  return {
    platform: context.platform,
    capability: 'conversion',
    formats() {
      return {
        sourceTypes: converter.SUPPORTED_SOURCE_TYPES,
        formats: converter.SUPPORTED_SOURCE_TYPES.map(type => ({
          id: type,
          name: type === 'claude' ? 'Claude Code' : type === 'codex' ? 'Codex' : 'Gemini'
        })),
        targetApis: converter.SUPPORTED_TARGET_APIS,
        defaultTargetApi: 'responses',
        endpoints: {
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
      return (handlers[sourceType] || converter.convertToOpenCodePayload)({ sourceType, payload, options });
    },
    convert({ sourceType, payload, options = {} } = {}) {
      return converter.convertToOpenCodePayload({ sourceType, payload, options });
    }
  };
}

module.exports = { createDriver };
