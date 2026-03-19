const fs = require('fs');
const path = require('path');
const BaseChannelService = require('./base/base-channel-service');
const { isProxyConfig } = require('./settings-manager');
const { PATHS, NATIVE_PATHS } = require('../../config/paths');
const { clearNativeOAuth } = require('./native-oauth-adapters');
const { isWindowsLikePlatform } = require('../../utils/home-dir');

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
  let match = helper.match(/^echo\s+["']([^"']+)["']$/);
  if (match && match[1]) return match[1];
  match = helper.match(/^printf\s+["'][^"']*["']\s+["']([^"']+)["']$/);
  if (match && match[1]) return match[1];
  return '';
}

function buildApiKeyHelperCommand() {
  if (isWindowsLikePlatform(process.platform, process.env)) {
    return 'cmd /c echo ctx-managed';
  }
  return "echo 'ctx-managed'";
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

  settings.apiKeyHelper = buildApiKeyHelperCommand();
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

  settings.apiKeyHelper = buildApiKeyHelperCommand();
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

function resolveCurrentManagedChannel(channels = []) {
  const allChannels = Array.isArray(channels) ? channels : [];
  return allChannels.find(ch => ch.enabled !== false) || null;
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
  }

  _generateId() {
    return `channel-${Date.now()}`;
  }

  // Claude 使用缓存 + fs.watchFile
  loadChannels() {
    if (this._cacheInitialized && this._cache) {
      return { channels: this._cache.channels.map(ch => this._applyDefaults(ch)) };
    }

    const data = super.loadChannels();
    this._cache = data;
    this._cacheInitialized = true;

    // 设置文件监听
    try {
      fs.watchFile(this.channelsFilePath, { interval: 2000 }, () => {
        try {
          this._cache = null;
          this._cacheInitialized = false;
        } catch (_) {}
      });
    } catch (_) {}

    return data;
  }

  saveChannels(data) {
    super.saveChannels(data);
    this._cache = data;
    this._cacheInitialized = true;
  }

  _onAfterCreate(channel, _allChannels) {
    if (!isProxyConfig() && channel.enabled !== false) {
      this._applyToNativeSettings(channel);
    }
  }

  _onAfterUpdate(oldChannel, nextChannel, allChannels) {
    if (isProxyConfig()) {
      return;
    }

    if (oldChannel.enabled === false && nextChannel.enabled !== false) {
      this._applyToNativeSettings(nextChannel);
      return;
    }

    const activeChannel = resolveCurrentManagedChannel(allChannels);
    if (nextChannel.enabled !== false && activeChannel?.id === nextChannel.id) {
      this._applyToNativeSettings(nextChannel);
    }
  }

  _onAfterDelete(_channel, allChannels) {
    if (isProxyConfig()) {
      return;
    }

    const activeChannel = resolveCurrentManagedChannel(allChannels);
    if (activeChannel) {
      this._applyToNativeSettings(activeChannel);
    }
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

function getCurrentChannel() {
  const channels = getAllChannels();
  const activeId = loadActiveChannelId();
  if (activeId) {
    const active = channels.find(ch => ch.id === activeId);
    if (active) return active;
  }
  return channels.find(ch => ch.enabled !== false) || channels[0] || null;
}

function getCurrentSettings() {
  const channel = getCurrentChannel();
  if (!channel) return null;
  return {
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    channelName: channel.name,
    channelId: channel.id,
  };
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
  deleteChannel,
  applyChannelToSettings,
  getBestChannelForRestore,
  updateClaudeSettings,
  updateClaudeSettingsWithModelConfig,
  getEffectiveApiKey,
  disableAllChannels,
};
