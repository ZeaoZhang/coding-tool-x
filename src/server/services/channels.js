const fs = require('fs');
const path = require('path');
const os = require('os');
const { isProxyConfig } = require('./settings-manager');

// Get channels config file path
function getChannelsFilePath() {
  const dir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'channels.json');
}

// Get active channel ID file path (for proxy mode)
function getActiveChannelIdPath() {
  const dir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'active-channel.json');
}

// Get Claude settings file path
function getClaudeSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

// Save active channel ID (for proxy mode)
function saveActiveChannelId(channelId) {
  const filePath = getActiveChannelIdPath();
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
}

// Load active channel ID (for proxy mode)
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

// 内存缓存
let channelsCache = null;
let channelsCacheInitialized = false;

const DEFAULT_CHANNELS = { channels: [] };

function normalizeNumber(value, defaultValue) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return defaultValue;
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

  normalized.weight = normalizeNumber(normalized.weight, 1);

  // maxConcurrency: undefined/0/null 表示无限制
  if (normalized.maxConcurrency === undefined ||
      normalized.maxConcurrency === null ||
      normalized.maxConcurrency === 0) {
    normalized.maxConcurrency = null; // null 表示无限制
  } else {
    normalized.maxConcurrency = normalizeNumber(normalized.maxConcurrency, 1);
  }

  return normalized;
}

// 从文件读取并缓存
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

  // Return empty channels list if file doesn't exist
  return { ...DEFAULT_CHANNELS };
}

// 初始化缓存（延迟初始化）
function initializeChannelsCache() {
  if (channelsCacheInitialized) return;
  channelsCache = readChannelsFromFile();
  channelsCacheInitialized = true;

  // 监听文件变化，更新缓存
  try {
    const filePath = getChannelsFilePath();
    fs.watchFile(filePath, { persistent: false }, () => {
      channelsCache = readChannelsFromFile();
    });
  } catch (err) {
    console.error('Failed to watch channels file:', err);
  }
}

// Load channels from file（使用缓存）
function loadChannels() {
  if (!channelsCacheInitialized) {
    initializeChannelsCache();
  }
  return JSON.parse(JSON.stringify(channelsCache)); // 深拷贝返回
}

// Save channels to file（同时更新缓存）
function saveChannels(data) {
  const filePath = getChannelsFilePath();
  const payload = {
    ...data,
    channels: (data.channels || []).map(applyChannelDefaults)
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  // 同时更新缓存
  channelsCache = JSON.parse(JSON.stringify(payload));
}

// Get current settings from settings.json
function getCurrentSettings() {
  try {
    const settingsPath = getClaudeSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // Read baseUrl from env
    let baseUrl = settings.env?.ANTHROPIC_BASE_URL || '';

    // Read apiKey from multiple possible sources (兼容多种配置格式)
    let apiKey = settings.env?.ANTHROPIC_API_KEY ||        // 标准格式
                 settings.env?.ANTHROPIC_AUTH_TOKEN ||     // 88code等平台格式
                 '';

    // If apiKey is still empty, try to extract from apiKeyHelper
    if (!apiKey && settings.apiKeyHelper) {
      // apiKeyHelper format: echo 'sk-ant-xxx' or other shell commands
      const match = settings.apiKeyHelper.match(/['"]([^'"]+)['"]/);
      if (match && match[1]) {
        apiKey = match[1];
      }
    }

    // If no valid config, return null
    if (!baseUrl && !apiKey) {
      return null;
    }

    return { baseUrl, apiKey };
  } catch (error) {
    console.error('Error reading current settings:', error);
    return null;
  }
}

// Get best channel to restore when stopping proxy
function getBestChannelForRestore() {
  const data = loadChannels();
  const enabledChannels = data.channels.filter(ch => ch.enabled !== false);

  if (enabledChannels.length === 0) {
    return data.channels[0]; // If no enabled channels, return first one
  }

  // Sort by weight, highest weight first
  enabledChannels.sort((a, b) => (b.weight || 1) - (a.weight || 1));
  return enabledChannels[0];
}

// Get all channels
function getAllChannels() {
  const data = loadChannels();
  return data.channels;
}

// Create new channel
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
    weight: normalizeNumber(extraConfig.weight, 1),
    maxConcurrency: normalizeNumber(extraConfig.maxConcurrency, 1)
  });

  data.channels.push(newChannel);
  saveChannels(data);
  return newChannel;
}

// Update channel
function updateChannel(id, updates) {
  const data = loadChannels();
  const index = data.channels.findIndex(ch => ch.id === id);

  if (index === -1) {
    throw new Error('Channel not found');
  }

  // Allow all updates
  const merged = { ...data.channels[index], ...updates };
  data.channels[index] = applyChannelDefaults({
    ...merged,
    weight: merged.weight,
    maxConcurrency: merged.maxConcurrency,
    enabled: merged.enabled
  });

  saveChannels(data);
  return data.channels[index];
}

// Delete channel
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

// Apply channel to settings (write channel config to settings.json)
function applyChannelToSettings(id) {
  const data = loadChannels();
  const channel = data.channels.find(ch => ch.id === id);

  if (!channel) {
    throw new Error('Channel not found');
  }

  // 启用渠道（确保加入调度池）
  channel.enabled = true;
  saveChannels(data);

  // Update Claude settings.json
  updateClaudeSettings(channel.baseUrl, channel.apiKey);
  console.log(`✅ Applied channel settings to Claude: ${channel.name}`);

  return channel;
}

// Update Claude settings.json
function updateClaudeSettings(baseUrl, apiKey) {
  const settingsPath = getClaudeSettingsPath();

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  // Ensure env object exists
  if (!settings.env) {
    settings.env = {};
  }

  // 检测用户使用的是哪种 API Key 字段格式
  const useAuthToken = settings.env.ANTHROPIC_AUTH_TOKEN !== undefined;
  const useApiKey = settings.env.ANTHROPIC_API_KEY !== undefined;

  // Update env fields - 保持用户原有的格式
  settings.env.ANTHROPIC_BASE_URL = baseUrl;

  if (useAuthToken || (!useAuthToken && !useApiKey)) {
    // 如果使用 ANTHROPIC_AUTH_TOKEN 格式，或者两者都没有（新用户），优先使用 AUTH_TOKEN
    settings.env.ANTHROPIC_AUTH_TOKEN = apiKey;
    // 删除可能存在的 ANTHROPIC_API_KEY
    delete settings.env.ANTHROPIC_API_KEY;
  } else {
    // 使用标准的 ANTHROPIC_API_KEY 格式
    settings.env.ANTHROPIC_API_KEY = apiKey;
  }

  // Update apiKeyHelper (for compatibility)
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
  updateClaudeSettings // Export for proxy stop
};
