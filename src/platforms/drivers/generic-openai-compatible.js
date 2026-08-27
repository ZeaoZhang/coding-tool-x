'use strict';

function requestFailure(platform, error, message = 'OpenAI-compatible request failed') {
  const result = new Error(message);
  result.platform = platform;
  result.capability = 'channels';
  result.operation = 'request';
  if (error) Object.defineProperty(result, 'cause', { value: error, enumerable: false });
  return result;
}

function createGenericOpenAICompatibleDriver({ platform, manifest = {}, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = String((manifest.paths && manifest.paths.baseUrl) || manifest.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error(`Missing base URL for ${platform}`);
  return {
    platform,
    capability: 'channels',
    normalizeEndpoint(pathname = '') {
      return `${baseUrl}/${String(pathname).replace(/^\/+/, '')}`;
    },
    buildHeaders(channel = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (channel.apiKey) headers.Authorization = `Bearer ${channel.apiKey}`;
      return headers;
    },
    async request(pathname, channel, init = {}) {
      try {
        const response = await fetchImpl(this.normalizeEndpoint(pathname), {
          ...init,
          headers: { ...this.buildHeaders(channel), ...(init.headers || {}) }
        });
        if (!response.ok) {
          const cause = new Error(`HTTP ${response.status}`);
          throw requestFailure(platform, cause, `OpenAI-compatible request failed: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        if (error && error.platform === platform && error.operation === 'request') throw error;
        throw requestFailure(platform, error);
      }
    }
  };
}

module.exports = { createGenericOpenAICompatibleDriver };
