const fs = require('fs');
const path = require('path');
const BaseChannelService = require('../../../server/services/base/base-channel-service');
const { isProxyConfig } = require('./native-config-implementation');
const { PATHS, NATIVE_PATHS } = require('../../../config/paths');
const { clearNativeOAuth } = require('../shared/native-oauth-adapters');
const { isWindowsLikePlatform } = require('../../../utils/home-dir');
const { normalizeGatewaySourceType } = require('../../../server/services/base/proxy-utils');
const {
  createSkippedResult,
  isLocalProxyBaseUrl,
  resolveExistingActiveChannel,
  upsertSyncedChannels
} = require('../../../server/services/channel-sync-utils');

// ── Claude 特有工具函数 ──

function getActiveChannelIdPath() {
  const dir = path.dirname(PATHS.activeChannel.claude);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return PATHS.activeChannel.claude;
}

function getClaudeSettingsPath() {
  return NATIVE_PATHS.claude.settings;
}

function saveActiveChannelId(channelId) {
  const filePath = getActiveChannelIdPath();
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
}

function loadActiveChannelId() {
  const filePath = getActiveChannelIdPath();
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      return data.activeChannelId || null;
    }
  } catch (error) {
    console.error('Error loading active channel ID:', error);
  }
  return null;
}

function extractApiKeyFromHelper(apiKeyHelper) {
  if (typeof apiKeyHelper !== 'string' || !apiKeyHelper.trim()) {
    return '';
  }
  const helper = apiKeyHelper.trim();
  let match = helper.match(/^echo\s+["']([^"']+)["']$/i);
  if (match && match[1]) return match[1];
  match = helper.match(/^echo\s+([^\s].*)$/i);
  if (match && match[1]) return match[1].trim();
  match = helper.match(/^cmd(?:\.exe)?\s*\/c\s+echo\s+([^\s].*)$/i);
  if (match && match[1]) return match[1].trim();
  match = helper.match(/^printf\s+["'][^"']*["']\s+["']([^"']+)["']$/i);
  if (match && match[1]) return match[1];
  return '';
}

function buildApiKeyHelperCommand(value) {
  if (isWindowsLikePlatform(process.platform, process.env)) {
    return `cmd /c echo ${value}`;
  }
  return `echo '${value}'`;
}

// ── Claude 原生设置写入 ──

function updateClaudeSettingsWithModelConfig(channel) {
  clearNativeOAuth('claude');
  const settingsPath = getClaudeSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  if (!settings.env) {
    settings.env = {};
  }

  const { baseUrl, apiKey, modelConfig, presetId, proxyUrl } = channel;

  settings.env.ANTHROPIC_BASE_URL = baseUrl;
  settings.env.ANTHROPIC_API_KEY = apiKey;
  delete settings.env.ANTHROPIC_AUTH_TOKEN;
  delete settings.env.CLAUDE_CODE_OAUTH_TOKEN;

  if (presetId && presetId !== 'official' && modelConfig) {
    if (modelConfig.model) {
      settings.env.ANTHROPIC_MODEL = modelConfig.model;
    }
    if (modelConfig.haikuModel) {
      settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = modelConfig.haikuModel;
    }
    if (modelConfig.sonnetModel) {
      settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = modelConfig.sonnetModel;
    }
    if (modelConfig.opusModel) {
      settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = modelConfig.opusModel;
    }
  } else {
    delete settings.env.ANTHROPIC_MODEL;
    delete settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    delete settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  }

  if (proxyUrl) {
    settings.env.HTTPS_PROXY = proxyUrl;
    settings.env.HTTP_PROXY = proxyUrl;
  } else {
    delete settings.env.HTTPS_PROXY;
    delete settings.env.HTTP_PROXY;
    delete settings.env.NO_PROXY;
  }

  if (settings.env && Object.keys(settings.env).length === 0) {
    delete settings.env;
  }

  settings.apiKeyHelper = buildApiKeyHelperCommand(apiKey);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

function updateClaudeSettings(baseUrl, apiKey) {
  const settingsPath = getClaudeSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  if (!settings.env) {
    settings.env = {};
  }

  const useAuthToken = settings.env.ANTHROPIC_AUTH_TOKEN !== undefined;
  const useApiKey = settings.env.ANTHROPIC_API_KEY !== undefined;

  settings.env.ANTHROPIC_BASE_URL = baseUrl;

  if (useAuthToken || (!useAuthToken && !useApiKey)) {
    settings.env.ANTHROPIC_AUTH_TOKEN = apiKey;
    delete settings.env.ANTHROPIC_API_KEY;
  } else {
    settings.env.ANTHROPIC_API_KEY = apiKey;
  }

  if (settings.env && Object.keys(settings.env).length === 0) {
    delete settings.env;
  }

  settings.apiKeyHelper = buildApiKeyHelperCommand(apiKey);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

function resolveCurrentManagedChannel(channels = []) {
  const allChannels = Array.isArray(channels) ? channels : [];
  return allChannels.find(ch => ch.enabled !== false) || null;
}

function normalizeClaudeTargetApi(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'chat' || normalized === 'chat/completions' || normalized === 'chat.completions') {
    return 'chat.completions';
  }
  return 'responses';
}

function isOfficialOpenAiBaseUrl(baseUrl = '') {
  try {
    const parsed = new URL(String(baseUrl || '').trim());
    return String(parsed.hostname || '').trim().toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

function isOpenAiCompatibleGateway(channel) {
  return normalizeGatewaySourceType(channel?.gatewaySourceType, 'claude') === 'openai_compatible';
}

// ── ClaudeChannelService ──

class ClaudeChannelService extends BaseChannelService {
  constructor() {
    super({
      platform: 'claude',
      channelsFilePath: PATHS.channels.claude,
      defaultGatewaySource: 'claude',
      isProxyRunning: () => isProxyConfig(),
    });
    // Claude 特有：文件监听缓存
    this._cache = null;
    this._cacheInitialized = false;
    this._watchRegistered = false;
  }

  _generateId() {
    return `channel-${Date.now()}`;
  }

  _applyDefaults(channel) {
    const normalized = super._applyDefaults(channel);
    normalized.presetId = normalized.presetId || 'official';
    normalized.modelConfig = normalized.modelConfig || {};
    normalized.modelRedirects = Array.isArray(normalized.modelRedirects) ? normalized.modelRedirects : [];
    normalized.proxyUrl = normalized.proxyUrl || '';
    normalized.speedTestModel = normalized.speedTestModel || null;
    normalized.targetApi = normalizeClaudeTargetApi(normalized.targetApi);
    if (isOpenAiCompatibleGateway(normalized) && !isOfficialOpenAiBaseUrl(normalized.baseUrl)) {
      normalized.targetApi = 'chat.completions';
    }
    return normalized;
  }

  loadChannels() {
    const data = super.loadChannels();
    this._cache = data;
    this._cacheInitialized = true;

    if (!this._watchRegistered) {
      try {
        fs.watchFile(this.channelsFilePath, { interval: 2000 }, () => {
          this.invalidate();
          this._cache = null;
          this._cacheInitialized = false;
        });
        this._watchRegistered = true;
      } catch (_) {}
    }

    return data;
  }

  saveChannels(data) {
    super.saveChannels(data);
    this._cache = data;
    this._cacheInitialized = true;
  }

  _onAfterCreate(channel, _allChannels) {
    if (!isProxyConfig() && channel.enabled !== false && !isOpenAiCompatibleGateway(channel)) {
      this._applyToNativeSettings(channel);
    }
  }

  _onAfterUpdate(oldChannel, nextChannel, allChannels) {
    if (isProxyConfig()) {
      return;
    }

    if (oldChannel.enabled === false && nextChannel.enabled !== false) {
      if (!isOpenAiCompatibleGateway(nextChannel)) {
        this._applyToNativeSettings(nextChannel);
      }
      return;
    }

    const activeChannel = resolveCurrentManagedChannel(allChannels);
    if (
      nextChannel.enabled !== false
      && activeChannel?.id === nextChannel.id
      && !isOpenAiCompatibleGateway(nextChannel)
    ) {
      this._applyToNativeSettings(nextChannel);
    }
  }

  _onAfterDelete(_channel, allChannels) {
    if (isProxyConfig()) {
      return;
    }

    const activeChannel = resolveCurrentManagedChannel(allChannels);
    if (activeChannel && !isOpenAiCompatibleGateway(activeChannel)) {
      this._applyToNativeSettings(activeChannel);
    }
  }

  applyChannelToSettings(channelId) {
    const data = this.loadChannels();
    const channel = data.channels.find(ch => ch.id === channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    if (isOpenAiCompatibleGateway(channel)) {
      const error = new Error('OpenAI 格式渠道需要通过 Claude 代理使用，请先启动代理。');
      error.statusCode = 400;
      throw error;
    }

    return super.applyChannelToSettings(channelId);
  }

  _applyToNativeSettings(channel) {
    updateClaudeSettingsWithModelConfig(channel);
  }

  getEffectiveApiKey(channel) {
    return channel?.apiKey || null;
  }
}

// ── 单例 + 兼容导出 ──

const service = new ClaudeChannelService();

function getAllChannels() {
  const data = service.loadChannels();
  return data.channels;
}

function getCurrentChannel(channels = getAllChannels()) {
  const activeId = loadActiveChannelId();
  if (activeId) {
    const active = channels.find(ch => ch.id === activeId);
    if (active) return active;
  }
  return channels.find(ch => ch.enabled !== false) || channels[0] || null;
}

function getCurrentSettings(channels) {
  const channel = getCurrentChannel(channels);
  if (!channel) return null;
  return {
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    channelName: channel.name,
    channelId: channel.id,
  };
}

function readClaudeNativeSettings() {
  const settingsPath = getClaudeSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read Claude settings.json: ${error.message}`);
  }
}

function readClaudeNativeOAuth() {
  try {
    const adapters = require('../shared/native-oauth-adapters');
    return typeof adapters.readNativeOAuth === 'function'
      ? adapters.readNativeOAuth('claude')
      : null;
  } catch {
    return null;
  }
}

function buildClaudeSyncCandidate(settings, channels) {
  const env = settings?.env && typeof settings.env === 'object' ? settings.env : {};
  const baseUrl = String(env.ANTHROPIC_BASE_URL || '').trim();

  if (isLocalProxyBaseUrl(baseUrl)) {
    const existing = resolveExistingActiveChannel('claude', channels);
    if (existing) {
      return {
        skip: true,
        channel: existing,
        warning: 'Claude 当前配置指向 ctx 代理；对应渠道已在列表中，未重复导入。'
      };
    }
    return {
      skip: true,
      warning: 'Claude 当前配置指向 ctx 代理，但没有找到可匹配的现有渠道。请先确认 ctx 渠道列表。'
    };
  }

  const helperKey = extractApiKeyFromHelper(settings?.apiKeyHelper);
  const apiKey = String(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || helperKey || '').trim();
  const hasOAuth = Boolean(env.CLAUDE_CODE_OAUTH_TOKEN || readClaudeNativeOAuth());
  const existingByBaseUrl = baseUrl
    ? channels.find(ch => String(ch.baseUrl || '').trim() === baseUrl)
    : null;

  if (!apiKey) {
    if (existingByBaseUrl) {
      return {
        skip: true,
        channel: existingByBaseUrl,
        warning: 'Claude 当前配置未暴露 API Key；已找到同 baseUrl 渠道，未重复导入。'
      };
    }
    return {
      skip: true,
      warning: hasOAuth
        ? 'Claude 当前配置是 OAuth/登录态，OAuth 渠道不支持同步导入。'
        : 'Claude 当前配置缺少 API Key，无法同步导入。'
    };
  }

  const modelConfig = {
    model: env.ANTHROPIC_MODEL || '',
    haikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
    sonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
    opusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL || ''
  };
  Object.keys(modelConfig).forEach((key) => {
    if (!modelConfig[key]) delete modelConfig[key];
  });

  const finalBaseUrl = baseUrl || 'https://api.anthropic.com';
  return {
    name: existingByBaseUrl?.name || 'Claude 当前配置',
    baseUrl: finalBaseUrl,
    apiKey,
    presetId: finalBaseUrl.includes('api.anthropic.com') ? 'official' : 'custom',
    modelConfig,
    proxyUrl: env.HTTPS_PROXY || env.HTTP_PROXY || '',
    targetApi: 'responses',
    gatewaySourceType: 'claude',
    credentialSource: env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? 'config' : 'apiKeyHelper'
  };
}

function syncCurrentClaudeChannel() {
  const data = service.loadChannels();
  const channels = Array.isArray(data.channels) ? data.channels : [];
  const settings = readClaudeNativeSettings();
  const candidate = buildClaudeSyncCandidate(settings, channels);

  if (candidate?.skip) {
    return createSkippedResult('claude', candidate.warning, candidate.channel);
  }

  return upsertSyncedChannels({
    toolType: 'claude',
    loadChannels: () => service.loadChannels(),
    saveChannels: payload => service.saveChannels(payload),
    applyDefaults: channel => service._applyDefaults(channel),
    candidates: [candidate],
    matchers: [
      (channel, current) => channel.baseUrl === current.baseUrl && channel.apiKey === current.apiKey,
      (channel, current) => channel.baseUrl === current.baseUrl && channel.targetApi === current.targetApi
    ]
  });
}

function getBestChannelForRestore() {
  const channels = getAllChannels();
  const enabled = channels.filter(ch => ch.enabled !== false);
  if (enabled.length > 0) return enabled[0];
  return channels[0] || null;
}

function createChannel(name, baseUrl, apiKey, websiteUrl, extraConfig) {
  return service.createChannel({
    name,
    baseUrl,
    apiKey,
    websiteUrl,
    ...extraConfig,
  });
}

function updateChannel(id, updates) {
  return service.updateChannel(id, updates);
}

function markChannelAsRecentlyUsed(id) {
  return service.updateChannel(id, {});
}

function deleteChannel(id) {
  return service.deleteChannel(id);
}

function applyChannelToSettings(id) {
  return service.applyChannelToSettings(id);
}

function getEffectiveApiKey(channel) {
  return service.getEffectiveApiKey(channel);
}

function disableAllChannels() {
  return service.disableAllChannels();
}

module.exports = {
  getAllChannels,
  getCurrentChannel,
  getCurrentSettings,
  createChannel,
  updateChannel,
  markChannelAsRecentlyUsed,
  deleteChannel,
  applyChannelToSettings,
  getBestChannelForRestore,
  updateClaudeSettings,
  updateClaudeSettingsWithModelConfig,
  getEffectiveApiKey,
  disableAllChannels,
  extractApiKeyFromHelper,
  syncCurrentClaudeChannel,
};
