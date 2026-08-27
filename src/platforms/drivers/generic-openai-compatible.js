'use strict';

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
      const response = await fetchImpl(this.normalizeEndpoint(pathname), {
        ...init,
        headers: { ...this.buildHeaders(channel), ...(init.headers || {}) }
      });
      if (!response.ok) {
        throw new Error(`OpenAI-compatible request failed: ${response.status}`);
      }
      return response.json();
    }
  };
}

module.exports = { createGenericOpenAICompatibleDriver };
