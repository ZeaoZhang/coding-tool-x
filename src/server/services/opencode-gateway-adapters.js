'use strict';

const { createCodexRequest } = require('./codex-wire');
const {
  createClaudeRequest,
  stripClaudeToolNamePrefix
} = require('./claude-wire');
const { createGeminiRequest } = require('./gemini-wire');

function convertOpenCodePayloadToClaude(pathname, payload = {}, fallbackModel = '', options = {}) {
  return createClaudeRequest(pathname, payload, {
    fallbackModel,
    sessionUserId: options.sessionUserId,
    networkHeaders: false
  }).body;
}

function convertOpenCodePayloadToCodexResponses(payload = {}, fallbackModel = '') {
  const converted = createCodexRequest(payload, { fallbackModel });
  return {
    requestBody: converted.body,
    model: converted.model
  };
}

function convertOpenCodePayloadToGemini(pathname, payload = {}, fallbackModel = '') {
  const converted = createGeminiRequest(pathname, payload, {
    fallbackModel,
    networkHeaders: false,
    useCli: false
  });
  return {
    model: converted.model,
    requestBody: converted.body
  };
}

module.exports = {
  convertOpenCodePayloadToClaude,
  convertOpenCodePayloadToCodexResponses,
  convertOpenCodePayloadToGemini,
  stripClaudeToolNamePrefix
};
