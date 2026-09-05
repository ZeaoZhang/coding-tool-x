'use strict';

const crypto = require('crypto');

const MANAGED_PREFIX = 'ctx-';
const SUPPORTED_PROVIDER_APIS = new Set([
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'azure-openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'google-gemini-cli',
  'google-vertex'
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeProviderId(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'provider';
}

function getProviderKey(channel = {}) {
  return normalizeText(channel.providerKey || channel.provider || channel.name || channel.id);
}

function getProviderApi(channel = {}) {
  return normalizeText(channel.providerApi || channel.api || channel.wireApi || 'openai-completions');
}

function getRoutingGroup(channel = {}) {
  return normalizeText(channel.routingGroup) || normalizeText(channel.id);
}

function stableToken(secret, namespace, value, length = 24) {
  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(`${namespace}\0${value}`)
    .digest('hex')
    .slice(0, length);
}

function stablePublicId(namespace, value, length = 8) {
  return crypto
    .createHash('sha256')
    .update(`${namespace}\0${value}`)
    .digest('hex')
    .slice(0, length);
}

function normalizeRedirects(channel = {}) {
  const redirects = Array.isArray(channel.modelRedirects) ? channel.modelRedirects : [];
  return JSON.stringify(redirects);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function getModelCapabilityMap(channel = {}) {
  const result = new Map();
  const add = (raw) => {
    const model = typeof raw === 'string' ? { id: raw } : raw;
    const id = normalizeText(model?.id || model?.name);
    if (!id || result.has(id)) return;
    const capability = { ...(model || {}) };
    delete capability.id;
    delete capability.name;
    delete capability.baseUrl;
    delete capability.headers;
    result.set(id, JSON.stringify(canonicalize(capability)));
  };
  (Array.isArray(channel.models) ? channel.models : []).forEach(add);
  (Array.isArray(channel.allowedModels) ? channel.allowedModels : []).forEach(add);
  add(channel.model);
  return result;
}

function getGroupKey(channel = {}) {
  return [
    getProviderKey(channel),
    getProviderApi(channel),
    getRoutingGroup(channel)
  ].join('\0');
}

function assertCompatibleGroup(channels = []) {
  if (channels.length <= 1) return;
  const first = channels[0];
  const expectedApi = getProviderApi(first);
  const expectedProvider = getProviderKey(first);
  const expectedRedirects = normalizeRedirects(first);
  const expectedAuthMode = normalizeText(first.authMode) || 'api_key';
  const expectedCapabilities = getModelCapabilityMap(first);

  channels.slice(1).forEach((channel) => {
    if (getProviderKey(channel) !== expectedProvider) {
      throw new Error(`OMP routing group "${getRoutingGroup(first)}" mixes providerKey values`);
    }
    if (getProviderApi(channel) !== expectedApi) {
      throw new Error(`OMP routing group "${getRoutingGroup(first)}" mixes providerApi values`);
    }
    if (normalizeRedirects(channel) !== expectedRedirects) {
      throw new Error(`OMP routing group "${getRoutingGroup(first)}" has inconsistent modelRedirects`);
    }
    if ((normalizeText(channel.authMode) || 'api_key') !== expectedAuthMode) {
      throw new Error(`OMP routing group "${getRoutingGroup(first)}" mixes authMode values`);
    }
    const actualCapabilities = getModelCapabilityMap(channel);
    expectedCapabilities.forEach((capability, modelId) => {
      if (actualCapabilities.has(modelId) && actualCapabilities.get(modelId) !== capability) {
        throw new Error(
          `OMP routing group "${getRoutingGroup(first)}" has incompatible capability metadata for model "${modelId}"`
        );
      }
    });
  });
}

function sanitizeProviderConfig(channel = {}) {
  const source = channel.providerConfig && typeof channel.providerConfig === 'object'
    && !Array.isArray(channel.providerConfig)
    ? channel.providerConfig
    : {};
  const next = { ...source };
  for (const key of ['baseUrl', 'base_url', 'apiKey', 'api_key', 'headers', 'auth']) {
    delete next[key];
  }
  return next;
}

function sanitizeModels(channel = {}) {
  return (Array.isArray(channel.models) ? channel.models : []).map((model) => {
    if (!model || typeof model !== 'object' || Array.isArray(model)) return model;
    const next = { ...model };
    delete next.baseUrl;
    delete next.headers;
    return next;
  });
}

function mergeGroupField(channels = [], field) {
  const seen = new Set();
  const result = [];
  channels.forEach((channel) => {
    const values = Array.isArray(channel?.[field]) ? channel[field] : [];
    values.forEach((value) => {
      const id = normalizeText(typeof value === 'string' ? value : (value?.id || value?.name));
      if (!id || seen.has(id.toLowerCase())) return;
      seen.add(id.toLowerCase());
      result.push(value);
    });
  });
  return result;
}

function buildManagedBaseUrl(host, port, routeToken) {
  return `http://${host}:${port}/omp/${routeToken}`;
}

function prepareManagedOmpChannels(channels = [], gateway = {}) {
  const host = normalizeText(gateway.host) || '127.0.0.1';
  const port = Number(gateway.port);
  const secret = normalizeText(gateway.secret);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('OMP gateway port is required before managed providers can be generated');
  }
  if (!secret) {
    throw new Error('OMP gateway secret is required before managed providers can be generated');
  }

  const enabled = channels.filter(channel => (
    channel
    && channel.enabled !== false
    && (channel.baseUrl || normalizeText(channel.authMode) === 'oauth')
  ));
  const groups = new Map();
  enabled.forEach((channel) => {
    const key = getGroupKey(channel);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(channel);
  });

  const providerCounts = new Map();
  groups.forEach((groupChannels) => {
    const providerId = normalizeProviderId(getProviderKey(groupChannels[0]));
    providerCounts.set(providerId, (providerCounts.get(providerId) || 0) + 1);
  });

  const routes = [];
  const managedChannels = [];
  const unsupportedChannels = [];

  groups.forEach((groupChannels, groupKey) => {
    assertCompatibleGroup(groupChannels);
    const template = groupChannels[0];
    if (!SUPPORTED_PROVIDER_APIS.has(getProviderApi(template))) {
      groupChannels.forEach(channel => unsupportedChannels.push({
        id: channel.id,
        name: channel.name,
        reason: 'unsupported-provider-api'
      }));
      return;
    }
    const authMode = normalizeText(template.authMode) || 'api_key';
    const transport = normalizeText(template.transport || template.providerConfig?.transport);
    const supportedOAuthIds = new Set(
      Array.isArray(gateway.supportedOAuthChannelIds) ? gateway.supportedOAuthChannelIds : []
    );
    const oauthGatewayUnavailable = authMode === 'oauth' && (
      groupChannels.some(channel => (
        !normalizeText(channel.baseUrl)
        || !normalizeText(channel.apiKey)
        || normalizeText(channel.transport || channel.providerConfig?.transport) !== 'pi-native'
        || !supportedOAuthIds.has(channel.id)
      ))
    );
    if (oauthGatewayUnavailable) {
      groupChannels.forEach(channel => unsupportedChannels.push({
        id: channel.id,
        name: channel.name,
        reason: 'oauth-auth-gateway-unavailable'
      }));
      return;
    }

    const providerId = normalizeProviderId(getProviderKey(template));
    const routeToken = stableToken(secret, 'route', groupKey);
    const capability = `ctx_${stableToken(secret, 'capability', groupKey, 40)}`;
    const multipleGroups = providerCounts.get(providerId) > 1;
    const managedProviderId = multipleGroups
      ? `${MANAGED_PREFIX}${providerId}-${stablePublicId('provider', groupKey)}`
      : `${MANAGED_PREFIX}${providerId}`;
    const routingGroup = getRoutingGroup(template);
    const mergedModels = sanitizeModels({
      models: mergeGroupField(groupChannels, 'models')
    });
    const mergedAllowedModels = mergeGroupField(groupChannels, 'allowedModels');

    const route = {
      token: routeToken,
      capability,
      routingGroup,
      providerKey: getProviderKey(template),
      providerApi: getProviderApi(template),
      managedProviderId,
      channelIds: groupChannels.map(channel => channel.id),
      authMode
    };
    routes.push(route);

    managedChannels.push({
      ...template,
      id: `omp-route-${routeToken}`,
      managedProviderId,
      originalProviderId: getProviderKey(template),
      routingGroup,
      baseUrl: buildManagedBaseUrl(host, port, routeToken),
      apiKey: authMode === 'none' ? '' : capability,
      authMode,
      providerConfig: sanitizeProviderConfig(template),
      headers: undefined,
      auth: authMode === 'none' ? 'none' : undefined,
      models: mergedModels,
      allowedModels: mergedAllowedModels,
      _ompGatewayRoute: route
    });
  });

  return { routes, managedChannels, unsupportedChannels };
}

function resolveOmpGatewayRoute(pathname, channels, gateway) {
  const match = String(pathname || '').match(/^\/omp\/([a-f0-9]{24})(\/.*|$)/);
  if (!match) return null;
  const prepared = prepareManagedOmpChannels(channels, gateway);
  const route = prepared.routes.find(item => item.token === match[1]);
  if (!route) return null;
  return {
    ...route,
    upstreamPath: match[2] || '/'
  };
}

module.exports = {
  prepareManagedOmpChannels,
  resolveOmpGatewayRoute,
  getRoutingGroup,
  getProviderKey,
  getProviderApi
};
