const fs = require('fs');
const { isProxyConfig } = require('./settings-manager');
const { PATHS, NATIVE_PATHS } = require('../../config/paths');
const { clearNativeOAuth } = require('./native-oauth-adapters');

function getChannelsFilePath() {
  const dir = PATHS.base;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return PATHS.channels.claude;
}

function getActiveChannelIdPath() {
  const dir = PATHS.base;
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

let channelsCache = null;
let channelsCacheInitialized = false;
const DEFAULT_CHANNELS = { channels: [] };

function normalizeNumber(value, defaultValue, max = null) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return defaultValue;
  }
  if (max !== null && num > max) {
    return max;
  }
  return num;
}

function normalizeGatewaySourceType(value, fallback = 'claude') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'claude') return 'claude';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'gemini') return 'gemini';
  return fallback;
}

function extractApiKeyFromHelper(apiKeyHelper) {
  if (typeof apiKeyHelper !== 'string' || !apiKeyHelper.trim()) {
    return '';
  }

  const helper = apiKeyHelper.trim();
  let match = helper.match(/^echo\s+["']([^"']+)["']$/);
  if (match && match[1]) {
    return match[1];
  }

  match = helper.match(/^printf\s+["'][^"']*["']\s+["']([^"']+)["']$/);
  if (match && match[1]) {
    return match[1];
  }

  return '';
}

function buildApiKeyHelperCommand() {
  // 避免把明文 API Key 写入可执行命令，降低注入风险
  return 'printf "%s" "${ANTHROPIC_AUTH_TOKEN:-${ANTHROPIC_API_KEY:-}}"';
}

function applyChannelDefaults(channel) {
  const normalized = { ...channel };
  if (normalized.enabled === undefined) {
    normalized.enabled = true;
  } else {
    normalized.enabled = !!normalized.enabled;
  }

  normalized.weight = normalizeNumber(normalized.weight, 1, 100);

  if (normalized.maxConcurrency === undefined ||
      normalized.maxConcurrency === null ||
      normalized.maxConcurrency === 0) {
    normalized.maxConcurrency = null;
  } else {
    normalized.maxConcurrency = normalizeNumber(normalized.maxConcurrency, 1, 100);
  }

  normalized.gatewaySourceType = normalizeGatewaySourceType(normalized.gatewaySourceType, 'claude');

  return normalized;
}

function readChannelsFromFile() {
  const filePath = getChannelsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      data.channels = (data.channels || []).map(applyChannelDefaults);
      return data;
    }
  } catch (error) {
    console.error('Error loading channels:', error);
  }
  return { ...DEFAULT_CHANNELS };
}

function initializeChannelsCache() {
  if (channelsCacheInitialized) return;
  channelsCache = readChannelsFromFile();
  channelsCacheInitialized = true;

  try {
    const filePath = getChannelsFilePath();
    fs.watchFile(filePath, { persistent: false }, () => {
      channelsCache = readChannelsFromFile();
    });
  } catch (err) {
    console.error('Failed to watch channels file:', err);
  }
}

function loadChannels() {
  if (!channelsCacheInitialized) {
    initializeChannelsCache();
  }
  return JSON.parse(JSON.stringify(channelsCache));
}

function saveChannels(data) {
  const filePath = getChannelsFilePath();
  const payload = {
    ...data,
    channels: (data.channels || []).map(applyChannelDefaults)
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  channelsCache = JSON.parse(JSON.stringify(payload));
}

function getCurrentSettings() {
  try {
    const settingsPath = getClaudeSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const nativeOAuth = require('./native-oauth-adapters').readNativeOAuth('claude');

    let baseUrl = settings.env?.ANTHROPIC_BASE_URL || '';
    let apiKey = settings.env?.ANTHROPIC_API_KEY || '';
    if (!apiKey && !nativeOAuth) {
      apiKey = settings.env?.ANTHROPIC_AUTH_TOKEN || '';
    }

    if (!apiKey && settings.apiKeyHelper) {
      apiKey = extractApiKeyFromHelper(settings.apiKeyHelper);
    }

    if (!baseUrl && !apiKey) {
      return null;
    }

    return { baseUrl, apiKey };
  } catch (error) {
    console.error('Error reading current settings:', error);
    return null;
  }
}

function getBestChannelForRestore() {
  const data = loadChannels();
  const enabledChannels = data.channels.filter(ch => ch.enabled !== false);

  if (enabledChannels.length === 0) {
    return data.channels[0];
  }

  enabledChannels.sort((a, b) => (b.weight || 1) - (a.weight || 1));
  return enabledChannels[0];
}

function getAllChannels() {
  const data = loadChannels();
  return data.channels;
}

function getCurrentChannel() {
  const channels = getAllChannels();
  if (!Array.isArray(channels) || channels.length === 0) {
    return null;
  }

  const activeChannelId = loadActiveChannelId();
  if (activeChannelId) {
    const matched = channels.find(ch => ch.id === activeChannelId);
    if (matched) {
      return matched;
    }
  }

  return channels.find(ch => ch.enabled !== false) || channels[0];
}

function createChannel(name, baseUrl, apiKey, websiteUrl, extraConfig = {}) {
  const data = loadChannels();
  const newChannel = applyChannelDefaults({
    id: `channel-${Date.now()}`,
    name,
    baseUrl,
    apiKey,
    createdAt: Date.now(),
    websiteUrl: websiteUrl || undefined,
    enabled: extraConfig.enabled !== undefined ? !!extraConfig.enabled : true,
    weight: extraConfig.weight,
    maxConcurrency: extraConfig.maxConcurrency,
    presetId: extraConfig.presetId || 'official',
    modelConfig: extraConfig.modelConfig || null,
    modelRedirects: extraConfig.modelRedirects || [],
    proxyUrl: extraConfig.proxyUrl || '',
    speedTestModel: extraConfig.speedTestModel || null,
    gatewaySourceType: normalizeGatewaySourceType(extraConfig.gatewaySourceType, 'claude')
  });

  data.channels.push(newChannel);
  saveChannels(data);
  return newChannel;
}

function updateChannel(id, updates) {
  const data = loadChannels();
  const index = data.channels.findIndex(ch => ch.id === id);

  if (index === -1) {
    throw new Error('Channel not found');
  }

  // Store old channel data before updates
  const oldChannel = { ...data.channels[index] };

  const merged = { ...data.channels[index], ...updates };
  const nextChannel = applyChannelDefaults({
    ...merged,
    weight: merged.weight,
    maxConcurrency: merged.maxConcurrency,
    enabled: merged.enabled,
    presetId: merged.presetId,
    modelConfig: merged.modelConfig,
    modelRedirects: merged.modelRedirects || [],
    proxyUrl: merged.proxyUrl,
    speedTestModel: merged.speedTestModel,
    gatewaySourceType: normalizeGatewaySourceType(merged.gatewaySourceType, 'claude'),
    updatedAt: Date.now()
  });
  data.channels[index] = nextChannel;

  // Get proxy status
  const { getProxyStatus } = require('../proxy-server');
  const proxyStatus = getProxyStatus();
  const isProxyRunning = proxyStatus.running;

  // Single-channel enforcement: enabling a channel disables all others ONLY when proxy is OFF
  // When proxy is ON (dynamic switching), multiple channels can be enabled simultaneously
  if (!isProxyRunning && nextChannel.enabled && !oldChannel.enabled) {
    data.channels.forEach((ch, i) => {
      if (i !== index && ch.enabled) {
        ch.enabled = false;
      }
    });
    console.log(`[Single-channel mode] Enabled "${nextChannel.name}", disabled all others`);
  }

  saveChannels(data);

  // Sync settings.json only when proxy is OFF.
  // In dynamic switching mode, defer local config writes until proxy stop.
  if (!isProxyRunning && nextChannel.enabled) {
    console.log(`[Settings-sync] Channel "${nextChannel.name}" enabled, syncing settings.json...`);
    updateClaudeSettingsWithModelConfig(nextChannel);
  }

  return data.channels[index];
}

async function deleteChannel(id) {
  const data = loadChannels();
  const index = data.channels.findIndex(ch => ch.id === id);

  if (index === -1) {
    throw new Error('Channel not found');
  }

  data.channels.splice(index, 1);
  saveChannels(data);

  return { success: true };
}

function applyChannelToSettings(id) {
  const data = loadChannels();
  const channel = data.channels.find(ch => ch.id === id);

  if (!channel) {
    throw new Error('Channel not found');
  }

  // In single-channel mode, only this channel should be enabled
  data.channels.forEach(ch => {
    ch.enabled = ch.id === id;
  });
  saveChannels(data);
  updateClaudeSettingsWithModelConfig(channel);

  return channel;
}

function updateClaudeSettingsWithModelConfig(channel) {
  clearNativeOAuth('claude');
  const settingsPath = getClaudeSettingsPath();

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

  settings.apiKeyHelper = buildApiKeyHelperCommand();

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

function updateClaudeSettings(baseUrl, apiKey) {
  const settingsPath = getClaudeSettingsPath();

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

  settings.apiKeyHelper = buildApiKeyHelperCommand();

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

function getEffectiveApiKey(channel) {
  return channel.apiKey || null;
}

function disableAllChannels() {
  const data = loadChannels();
  data.channels.forEach(ch => { ch.enabled = false; });
  saveChannels(data);
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
  disableAllChannels
};
