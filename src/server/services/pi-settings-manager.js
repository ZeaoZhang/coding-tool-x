const fs = require('fs');
const path = require('path');
const { getPiPaths, ensurePiDir } = require('./pi-config');

const MANAGED_HEADER = '// Managed by coding-tool-x. Do not edit while Pi provider channels are enabled.';

function normalizeProviderId(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'coding-tool-x';
}

function normalizeProviderApi(value = '') {
  const normalized = String(value || '').trim();
  return normalized || 'openai-completions';
}

function normalizeModels(channel = {}) {
  const models = [];
  const add = (value) => {
    const id = String(value || '').trim();
    if (!id || models.some(model => model.id === id)) return;
    models.push({
      id,
      name: id,
      reasoning: false,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096
    });
  };

  if (Array.isArray(channel.models)) {
    channel.models.forEach((model) => {
      if (typeof model === 'string') {
        add(model);
      } else if (model && typeof model === 'object') {
        const id = String(model.id || model.name || '').trim();
        if (!id || models.some(item => item.id === id)) return;
        models.push({
          id,
          name: model.name || id,
          reasoning: model.reasoning === true,
          input: Array.isArray(model.input) ? model.input : ['text', 'image'],
          cost: model.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: Number(model.contextWindow || model.context_window || 128000),
          maxTokens: Number(model.maxTokens || model.max_tokens || 4096)
        });
      }
    });
  }

  add(channel.model);
  add(channel.speedTestModel);
  if (Array.isArray(channel.allowedModels)) {
    channel.allowedModels.forEach(add);
  }

  return models;
}

function buildProviderEntry(channel = {}) {
  const providerId = normalizeProviderId(channel.providerKey || channel.provider || channel.name || channel.id);
  const entry = {
    id: providerId,
    name: channel.name || providerId,
    baseUrl: String(channel.baseUrl || '').trim(),
    apiKey: String(channel.apiKey || '').trim(),
    api: normalizeProviderApi(channel.providerApi || channel.api || channel.wireApi),
    models: normalizeModels(channel)
  };

  if (channel.headers && typeof channel.headers === 'object' && !Array.isArray(channel.headers)) {
    entry.headers = channel.headers;
  }

  return entry;
}

function buildManagedExtensionSource(channels = []) {
  const providers = channels
    .filter(channel => channel && channel.enabled !== false && channel.baseUrl)
    .map(buildProviderEntry);

  if (providers.length === 0) {
    return `${MANAGED_HEADER}\nexport default function () {}\n`;
  }

  return `${MANAGED_HEADER}
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const providers = ${JSON.stringify(providers, null, 2)};

export default function (pi: ExtensionAPI) {
  for (const provider of providers) {
    pi.registerProvider(provider.id, {
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      api: provider.api,
      headers: provider.headers,
      models: provider.models
    });
  }
}
`;
}

function writeManagedProviderExtension(channels = []) {
  const paths = getPiPaths();
  ensurePiDir(path.dirname(paths.managedProviderExtension));
  fs.writeFileSync(paths.managedProviderExtension, buildManagedExtensionSource(channels), 'utf8');
  return paths.managedProviderExtension;
}

function removeManagedProviderExtension() {
  const target = getPiPaths().managedProviderExtension;
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

function isManagedProviderExtensionActive() {
  return fs.existsSync(getPiPaths().managedProviderExtension);
}

module.exports = {
  buildManagedExtensionSource,
  buildProviderEntry,
  isManagedProviderExtensionActive,
  normalizeProviderId,
  removeManagedProviderExtension,
  writeManagedProviderExtension
};
