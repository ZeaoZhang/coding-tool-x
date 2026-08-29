const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('../../config/paths');
const { resolveChannelWebsiteUrl } = require('../../config/channel-preset-websites');
const {
  setChannelConfig,
  clearManagedChannelConfig,
  readConfig,
  selectConfigPath
} = require('./opencode-settings-manager');
const { normalizeGatewaySourceType } = require('./base/proxy-utils');
const {
  createSkippedResult,
  isLocalProxyBaseUrl,
  resolveApiKeyValue,
  resolveExistingActiveChannel,
  upsertSyncedChannels
} = require('./channel-sync-utils');

function clearChannelBalanceCache(channel) {
  try {
    require('./channel-balance').clearChannelBalanceCache('opencode', channel);
  } catch (_) {
    // Balance cache invalidation is best-effort and should not block channel updates.
  }
}

/**
 * OpenCode 渠道管理服务
 * 存储位置: ~/.cc-tool/opencode-channels.json
 */

// normalizeGatewaySourceType imported from base/proxy-utils
// OpenCode default fallback is 'codex'

function normalizeApiKey(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed || '';
}

function normalizeHostFromBaseUrl(baseUrl) {
  const value = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return String(parsed.hostname || '').trim().toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeChannelName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// 获取渠道存储文件路径
function getChannelsFilePath() {
  const channelsDir = path.dirname(PATHS.channels.opencode);
  if (!fs.existsSync(channelsDir)) {
    fs.mkdirSync(channelsDir, { recursive: true });
  }
  return PATHS.channels.opencode;
}

function getCodexChannelsFilePath() {
  const channelsDir = path.dirname(PATHS.channels.codex);
  if (!fs.existsSync(channelsDir)) {
    fs.mkdirSync(channelsDir, { recursive: true });
  }
  return PATHS.channels.codex;
}

// 读取所有渠道
function loadChannels() {
  const filePath = getChannelsFilePath();

  if (!fs.existsSync(filePath)) {
    return { channels: [] };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    // 确保渠道有必要字段（兼容旧数据）
    if (data.channels) {
      data.channels = data.channels.map(ch => {
        const normalized = {
          ...ch,
          enabled: ch.enabled !== false,
          weight: ch.weight || 1,
          maxConcurrency: ch.maxConcurrency || null,
          balanceToken: ch.balanceToken || '',
          balanceUserId: ch.balanceUserId || null,
          modelRedirects: ch.modelRedirects || [],
          speedTestModel: ch.speedTestModel || null,
          wireApi: ch.wireApi || 'openai',  // OpenCode 默认使用 OpenAI 兼容格式
          gatewaySourceType: normalizeGatewaySourceType(ch.gatewaySourceType, 'codex'),
          allowedModels: ch.allowedModels || []
        };
        normalized.providerKey = ch.providerKey || deriveProviderKey(normalized);
        normalized.websiteUrl = resolveChannelWebsiteUrl('opencode', normalized);
        return normalized;
      });
    }
    return data;
  } catch (err) {
    console.error('[OpenCode Channels] Failed to parse channels file:', err);
    return { channels: [] };
  }
}

function deriveProviderKey(channel) {
  const base = channel.wireApi || channel.providerKey || 'opencode';
  if (typeof base === 'string' && base.startsWith('opencode_')) {
    return base;
  }
  return `opencode_${base}`;
}

function sanitizeOpenCodeProviderId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'channel';
}

function getOpenCodeProxyRunning() {
  const { getOpenCodeProxyStatus } = require('../opencode-proxy-server');
  return Boolean(getOpenCodeProxyStatus()?.running);
}

function resolveCurrentManagedChannel(channels = []) {
  const allChannels = Array.isArray(channels) ? channels : [];
  return allChannels.find(channel => channel.enabled !== false) || null;
}

function syncManagedChannelConfig(channels = [], preferredChannel = null) {
  const targetChannel = preferredChannel && preferredChannel.enabled !== false
    ? preferredChannel
    : resolveCurrentManagedChannel(channels);

  if (targetChannel) {
    setChannelConfig(buildNativeConfigChannel(targetChannel));
    return targetChannel;
  }

  clearManagedChannelConfig();
  return null;
}

// 保存渠道数据
function invalidateDashboardSource() {
  try {
    require('./snapshot-cache').invalidateDashboardSourceSnapshot('opencode');
  } catch (_) {}
}

// 保存渠道数据
function saveChannels(data) {
  const filePath = getChannelsFilePath();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  invalidateDashboardSource();
}

// 获取所有渠道
function getChannels() {
  const data = loadChannels();
  return {
    channels: data.channels || []
  };
}

// 添加渠道
function createChannel(name, baseUrl, apiKey, extraConfig = {}) {
  const data = loadChannels();
  const isProxyRunning = getOpenCodeProxyRunning();

  const newChannel = {
    id: crypto.randomUUID(),
    name,
    baseUrl,
    apiKey,
    wireApi: extraConfig.wireApi || 'openai',
    enabled: extraConfig.enabled !== false,
    weight: extraConfig.weight || 1,
    maxConcurrency: extraConfig.maxConcurrency || null,
    balanceToken: extraConfig.balanceToken || '',
    balanceUserId: extraConfig.balanceUserId || null,
    modelRedirects: extraConfig.modelRedirects || [],
    speedTestModel: extraConfig.speedTestModel || null,
    model: extraConfig.model || null,
    gatewaySourceType: normalizeGatewaySourceType(extraConfig.gatewaySourceType, 'codex'),
    providerKey: extraConfig.providerKey || null,
    presetId: extraConfig.presetId || null,
    websiteUrl: extraConfig.websiteUrl || '',
    allowedModels: extraConfig.allowedModels || [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  newChannel.providerKey = extraConfig.providerKey || deriveProviderKey(newChannel);
  newChannel.websiteUrl = resolveChannelWebsiteUrl('opencode', newChannel);

  data.channels.push(newChannel);

  if (!isProxyRunning && newChannel.enabled !== false) {
    data.channels.forEach((channel, index) => {
      if (index !== data.channels.length - 1 && channel.enabled) {
        channel.enabled = false;
      }
    });
    console.log(`[OpenCode Single-channel mode] Enabled "${newChannel.name}", disabled all others`);
  }

  saveChannels(data);

  if (!isProxyRunning && newChannel.enabled !== false) {
    syncManagedChannelConfig(data.channels, newChannel);
  }

  return newChannel;
}

// 更新渠道
function updateChannel(channelId, updates) {
  const data = loadChannels();
  const index = data.channels.findIndex(c => c.id === channelId);

  if (index === -1) {
    throw new Error('Channel not found');
  }

  const oldChannel = data.channels[index];

  const merged = {
    ...oldChannel,
    ...updates,
    id: channelId,
    createdAt: oldChannel.createdAt,
    modelRedirects: updates.modelRedirects !== undefined ? updates.modelRedirects : (oldChannel.modelRedirects || []),
    speedTestModel: updates.speedTestModel !== undefined ? updates.speedTestModel : (oldChannel.speedTestModel || null),
    balanceToken: updates.balanceToken !== undefined ? updates.balanceToken : (oldChannel.balanceToken || ''),
    balanceUserId: updates.balanceUserId !== undefined ? updates.balanceUserId : (oldChannel.balanceUserId || null),
    gatewaySourceType: normalizeGatewaySourceType(
      updates.gatewaySourceType !== undefined
        ? updates.gatewaySourceType
        : oldChannel.gatewaySourceType,
      'codex'
    ),
    updatedAt: Date.now()
  };
  merged.providerKey = updates.providerKey || oldChannel.providerKey || deriveProviderKey(merged);
  merged.websiteUrl = resolveChannelWebsiteUrl('opencode', merged);
  data.channels[index] = merged;

  const isProxyRunning = getOpenCodeProxyRunning();

  // Single-channel enforcement when proxy is OFF: enabling a channel disables all others
  if (!isProxyRunning && merged.enabled && !oldChannel.enabled) {
    data.channels.forEach((ch, i) => {
      if (i !== index && ch.enabled) {
        ch.enabled = false;
      }
    });
    console.log(`[OpenCode Single-channel mode] Enabled "${merged.name}", disabled all others`);
  }

  saveChannels(data);
  if (oldChannel.enabled === false && merged.enabled !== false) {
    clearChannelBalanceCache(merged);
  }

  if (!isProxyRunning) {
    if (oldChannel.enabled === false && merged.enabled !== false) {
      syncManagedChannelConfig(data.channels, merged);
    } else {
      const activeChannel = resolveCurrentManagedChannel(data.channels);
      if (merged.enabled !== false && activeChannel?.id === merged.id) {
        syncManagedChannelConfig(data.channels, merged);
      }
    }
  }

  return data.channels[index];
}

// 删除渠道
async function deleteChannel(channelId) {
  const data = loadChannels();
  const index = data.channels.findIndex(c => c.id === channelId);

  if (index === -1) {
    throw new Error('Channel not found');
  }

  data.channels.splice(index, 1);
  saveChannels(data);

  if (!getOpenCodeProxyRunning()) {
    syncManagedChannelConfig(data.channels);
  }

  return { success: true };
}

// 获取所有启用的渠道
function getEnabledChannels() {
  const data = loadChannels();
  return data.channels.filter(c => c.enabled !== false);
}

function markChannelAsRecentlyUsed(channelId) {
  return updateChannel(channelId, {});
}

// 保存渠道顺序
function saveChannelOrder(order) {
  const data = loadChannels();

  const orderedChannels = [];
  for (const id of order) {
    const channel = data.channels.find(c => c.id === id);
    if (channel) {
      orderedChannels.push(channel);
    }
  }

  // 添加不在顺序中的渠道
  for (const channel of data.channels) {
    if (!orderedChannels.find(c => c.id === channel.id)) {
      orderedChannels.push(channel);
    }
  }

  data.channels = orderedChannels;
  saveChannels(data);
}

function applyChannelToSettings(channelId) {
  const data = loadChannels();
  const channel = data.channels.find(c => c.id === channelId);

  if (!channel) {
    throw new Error('Channel not found');
  }

  const wasEnabled = channel.enabled !== false;
  // In single-channel mode, only this channel should be enabled
  data.channels.forEach(ch => {
    ch.enabled = ch.id === channelId;
  });
  saveChannels(data);
  if (!wasEnabled) {
    clearChannelBalanceCache(channel);
  }

  setChannelConfig(buildNativeConfigChannel(channel));

  return channel;
}

function buildNativeConfigChannel(channel = {}) {
  const candidates = getEffectiveApiKeyCandidates(channel);
  const effectiveApiKey = candidates[0] || normalizeApiKey(channel.apiKey || channel.key || '');
  return {
    ...channel,
    apiKey: effectiveApiKey
  };
}

function loadCodexChannels() {
  const filePath = getCodexChannelsFilePath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    return Array.isArray(data?.channels) ? data.channels : [];
  } catch {
    return [];
  }
}

function collectCodexFallbackApiKeys(channel) {
  if (String(process.env.OPENCODE_DISABLE_CODEX_KEY_FALLBACK || '').trim() === '1') {
    return [];
  }

  const targetHost = normalizeHostFromBaseUrl(channel?.baseUrl);
  const targetName = normalizeChannelName(channel?.name);
  const targetId = String(channel?.id || '').trim();
  const codexChannels = loadCodexChannels();
  if (codexChannels.length === 0) {
    return [];
  }

  const matches = [];
  for (const codexChannel of codexChannels) {
    const apiKey = normalizeApiKey(codexChannel?.apiKey || codexChannel?.key || '');
    if (!apiKey) continue;

    const codexName = normalizeChannelName(codexChannel?.name);
    const codexHost = normalizeHostFromBaseUrl(codexChannel?.baseUrl);
    const codexId = String(codexChannel?.id || '').trim();

    let score = 0;
    if (targetHost && codexHost && targetHost === codexHost) {
      score += 100;
    }
    if (targetName && codexName && targetName === codexName) {
      score += 90;
    } else if (targetName && codexName && (targetName.includes(codexName) || codexName.includes(targetName))) {
      score += 60;
    }
    if (targetId && codexId && targetId === codexId) {
      score += 40;
    }
    if (codexChannel?.enabled !== false) {
      score += 10;
    }

    if (score > 0) {
      matches.push({ score, apiKey });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  const unique = [];
  const seen = new Set();
  for (const item of matches) {
    if (!item?.apiKey || seen.has(item.apiKey)) continue;
    seen.add(item.apiKey);
    unique.push(item.apiKey);
  }
  return unique;
}

function normalizeBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const lowered = value.trim().toLowerCase();
  if (lowered === '1' || lowered === 'true' || lowered === 'yes' || lowered === 'on') return true;
  if (lowered === '0' || lowered === 'false' || lowered === 'no' || lowered === 'off') return false;
  return null;
}

function getEffectiveApiKeyCandidates(channel) {
  const ownApiKey = normalizeApiKey(channel?.apiKey || channel?.key || '');
  const codexFallbackKeys = collectCodexFallbackApiKeys(channel);
  const explicitPreferCodex = normalizeBooleanLike(channel?.preferCodexApiKey);
  const envPreferCodex = normalizeBooleanLike(process.env.OPENCODE_PREFER_CODEX_API_KEY);
  const defaultPreferCodex = false;
  const preferCodex = explicitPreferCodex ?? envPreferCodex ?? defaultPreferCodex;

  const ordered = preferCodex
    ? [...codexFallbackKeys, ownApiKey]
    : [ownApiKey, ...codexFallbackKeys];

  const seen = new Set();
  const candidates = [];
  for (const key of ordered) {
    const normalized = normalizeApiKey(key);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push(normalized);
  }
  return candidates;
}

/**
 * 获取渠道的有效 API Key
 */
async function getEffectiveApiKey(channel) {
  const candidates = getEffectiveApiKeyCandidates(channel);
  return candidates[0] || null;
}

function disableAllChannels() {
  const data = loadChannels();
  data.channels.forEach(ch => { ch.enabled = false; });
  saveChannels(data);
}

function getCurrentOpenCodeProviderId(config = {}) {
  const modelRef = String(config?.model || '').trim();
  if (modelRef.includes('/')) {
    return modelRef.split('/')[0].trim();
  }
  const providers = config?.provider && typeof config.provider === 'object'
    ? Object.keys(config.provider).filter(Boolean)
    : [];
  return providers.length === 1 ? providers[0] : '';
}

function findOpenCodeExistingByProvider(channels = [], providerId = '', baseUrl = '') {
  const normalizedProviderId = sanitizeOpenCodeProviderId(providerId);
  const url = String(baseUrl || '').trim();
  return channels.find(channel => {
    const providerKeys = [
      channel.providerKey,
      sanitizeOpenCodeProviderId(channel.providerKey),
      sanitizeOpenCodeProviderId(channel.name)
    ].filter(Boolean);
    return providerKeys.includes(providerId) || providerKeys.includes(normalizedProviderId);
  }) || channels.find(channel => url && channel.baseUrl === url) || null;
}

function normalizeOpenCodeChannel(channel = {}) {
  const normalized = {
    ...channel,
    enabled: channel.enabled !== false,
    weight: channel.weight || 1,
    maxConcurrency: channel.maxConcurrency || null,
    balanceToken: channel.balanceToken || '',
    balanceUserId: channel.balanceUserId || null,
    modelRedirects: channel.modelRedirects || [],
    speedTestModel: channel.speedTestModel || null,
    wireApi: channel.wireApi || 'openai',
    gatewaySourceType: normalizeGatewaySourceType(channel.gatewaySourceType, 'codex'),
    allowedModels: Array.isArray(channel.allowedModels) ? channel.allowedModels : []
  };
  normalized.providerKey = normalized.providerKey || deriveProviderKey(normalized);
  normalized.websiteUrl = resolveChannelWebsiteUrl('opencode', normalized);
  return normalized;
}

function collectOpenCodeProviderModels(provider = {}) {
  const models = provider?.models && typeof provider.models === 'object' && !Array.isArray(provider.models)
    ? Object.keys(provider.models)
    : [];
  return models.map(model => String(model || '').trim()).filter(Boolean);
}

function buildOpenCodeSyncCandidate(config, channels) {
  const providerId = getCurrentOpenCodeProviderId(config);
  if (!providerId) {
    return {
      skip: true,
      warning: 'OpenCode 原生配置未明确当前 provider，无法同步当前渠道。'
    };
  }

  const provider = config?.provider?.[providerId] || null;
  if (!provider || typeof provider !== 'object') {
    return {
      skip: true,
      warning: `OpenCode 当前 provider "${providerId}" 未在配置中定义。`
    };
  }

  const baseUrl = String(provider?.options?.baseURL || provider?.options?.baseUrl || provider?.baseUrl || provider?.baseURL || '').trim();
  const rawApiKey = provider?.options?.apiKey || provider?.apiKey || provider?.key || '';
  const existing = findOpenCodeExistingByProvider(channels, providerId, baseUrl);
  const providerIsProxy = providerId === 'ctx-proxy'
    || rawApiKey === 'PROXY_KEY'
    || isLocalProxyBaseUrl(baseUrl);

  if (providerIsProxy) {
    const activeExisting = resolveExistingActiveChannel('opencode', channels)
      || existing;
    if (activeExisting) {
      return {
        skip: true,
        channel: activeExisting,
        warning: 'OpenCode 当前配置指向 ctx 代理；对应渠道已在列表中，未重复导入。'
      };
    }
    return {
      skip: true,
      warning: 'OpenCode 当前配置指向 ctx 代理，但没有找到可匹配的现有渠道。'
    };
  }

  const credential = resolveApiKeyValue(rawApiKey);
  const apiKey = credential.value || getEffectiveApiKeyCandidates(existing || {})[0] || '';
  if (!apiKey) {
    return {
      skip: true,
      channel: existing || null,
      warning: `OpenCode 当前 provider "${providerId}" 缺少可解析 API Key，无法同步导入。`
    };
  }

  const modelRef = String(config?.model || '').trim();
  const model = modelRef.startsWith(`${providerId}/`) ? modelRef.slice(providerId.length + 1) : '';
  const allowedModels = collectOpenCodeProviderModels(provider);
  return {
    name: existing?.name || provider.name || providerId,
    providerKey: providerId,
    baseUrl,
    apiKey,
    wireApi: existing?.wireApi || 'openai',
    model: model || existing?.model || allowedModels[0] || null,
    allowedModels,
    gatewaySourceType: existing?.gatewaySourceType || 'codex',
    credentialSource: credential.value ? credential.source : 'existing-channel'
  };
}

function syncCurrentOpenCodeChannel() {
  if (typeof readConfig !== 'function' || typeof selectConfigPath !== 'function') {
    return createSkippedResult('opencode', 'OpenCode 配置读取能力不可用，无法同步当前渠道。');
  }

  const data = loadChannels();
  const channels = Array.isArray(data.channels) ? data.channels : [];
  let config = {};
  try {
    const configPath = selectConfigPath();
    config = readConfig(configPath);
  } catch (error) {
    return createSkippedResult('opencode', `OpenCode 配置读取失败：${error.message}`);
  }

  const candidate = buildOpenCodeSyncCandidate(config, channels);
  if (candidate?.skip) {
    return createSkippedResult('opencode', candidate.warning, candidate.channel);
  }

  return upsertSyncedChannels({
    toolType: 'opencode',
    loadChannels,
    saveChannels,
    applyDefaults: normalizeOpenCodeChannel,
    candidates: [candidate],
    matchers: [
      (channel, current) => channel.providerKey && channel.providerKey === current.providerKey,
      (channel, current) => channel.baseUrl === current.baseUrl && channel.apiKey === current.apiKey
    ]
  });
}

module.exports = {
  getChannels,
  createChannel,
  updateChannel,
  markChannelAsRecentlyUsed,
  deleteChannel,
  getEnabledChannels,
  saveChannelOrder,
  applyChannelToSettings,
  getEffectiveApiKey,
  getEffectiveApiKeyCandidates,
  disableAllChannels,
  syncCurrentOpenCodeChannel
};
