const fs = require('fs');
const path = require('path');
const os = require('os');
const { isProxyConfig } = require('./settings-manager');

function getChannelsFilePath() {
  const dir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'channels.json');
}

function getActiveChannelIdPath() {
  const dir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'active-channel.json');
}

function getClaudeSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
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

    let baseUrl = settings.env?.ANTHROPIC_BASE_URL || '';
    let apiKey = settings.env?.ANTHROPIC_API_KEY ||
                 settings.env?.ANTHROPIC_AUTH_TOKEN ||
                 '';

    if (!apiKey && settings.apiKeyHelper) {
      const match = settings.apiKeyHelper.match(/['"]([^'"]+)['"]/);
      if (match && match[1]) {
        apiKey = match[1];
      }
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
    proxyUrl: extraConfig.proxyUrl || ''
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

  const merged = { ...data.channels[index], ...updates };
  data.channels[index] = applyChannelDefaults({
    ...merged,
    weight: merged.weight,
    maxConcurrency: merged.maxConcurrency,
    enabled: merged.enabled,
    presetId: merged.presetId,
    modelConfig: merged.modelConfig,
    proxyUrl: merged.proxyUrl
  });

  saveChannels(data);
  return data.channels[index];
}

function deleteChannel(id) {
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

  channel.enabled = true;
  saveChannels(data);
  updateClaudeSettingsWithModelConfig(channel);

  return channel;
}

function updateClaudeSettingsWithModelConfig(channel) {
  const settingsPath = getClaudeSettingsPath();

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  if (!settings.env) {
    settings.env = {};
  }

  const { baseUrl, apiKey, modelConfig, presetId, proxyUrl } = channel;

  const useAuthToken = settings.env.ANTHROPIC_AUTH_TOKEN !== undefined;
  const useApiKey = settings.env.ANTHROPIC_API_KEY !== undefined;

  settings.env.ANTHROPIC_BASE_URL = baseUrl;

  if (useAuthToken || (!useAuthToken && !useApiKey)) {
    settings.env.ANTHROPIC_AUTH_TOKEN = apiKey;
    delete settings.env.ANTHROPIC_API_KEY;
  } else {
    settings.env.ANTHROPIC_API_KEY = apiKey;
  }

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

  settings.apiKeyHelper = `echo '${apiKey}'`;

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

  settings.apiKeyHelper = `echo '${apiKey}'`;

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

module.exports = {
  getAllChannels,
  getCurrentSettings,
  createChannel,
  updateChannel,
  deleteChannel,
  applyChannelToSettings,
  getBestChannelForRestore,
  updateClaudeSettings
};
