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

// 从文件读取并缓存
function readChannelsFromFile() {
  const filePath = getChannelsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
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
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  // 同时更新缓存
  channelsCache = JSON.parse(JSON.stringify(data));
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

// Get all channels with correct active status based on current settings.json
function getAllChannels() {
  const data = loadChannels();

  // First, mark all channels as inactive
  data.channels.forEach(ch => { ch.isActive = false; });

  // Check if we're in proxy mode
  if (isProxyConfig()) {
    // Proxy mode: use saved active channel ID
    const activeChannelId = loadActiveChannelId();
    if (activeChannelId) {
      const activeChannel = data.channels.find(ch => ch.id === activeChannelId);
      if (activeChannel) {
        activeChannel.isActive = true;
      }
    }
  } else {
    // Normal mode: use settings.json to determine active channel
    const currentSettings = getCurrentSettings();

    if (currentSettings) {
      // Only proceed if we have valid apiKey
      if (!currentSettings.apiKey) {
        console.warn('Warning: Current settings has no API Key');
        return data.channels;
      }

      // Find matching channel by baseUrl and apiKey
      const matchingChannel = data.channels.find(ch =>
        ch.baseUrl === currentSettings.baseUrl &&
        ch.apiKey === currentSettings.apiKey
      );

      if (matchingChannel) {
        // Found a matching channel, mark it as active
        matchingChannel.isActive = true;
      } else {
        // No matching channel found, auto-save it as a new channel
        const newChannel = {
          id: `channel-${Date.now()}`,
          name: '当前使用',
          baseUrl: currentSettings.baseUrl,
          apiKey: currentSettings.apiKey,
          isActive: true,
          createdAt: Date.now()
        };
        data.channels.unshift(newChannel);
        saveChannels(data); // Save immediately so it persists
        console.log('Auto-created new channel from current settings:', newChannel.name);
      }
    }
  }

  return data.channels;
}

// Get current active channel
function getCurrentChannel() {
  const channels = getAllChannels();
  return channels.find(ch => ch.isActive) || null;
}

// Create new channel
function createChannel(name, baseUrl, apiKey, websiteUrl) {
  const data = loadChannels();
  const newChannel = {
    id: `channel-${Date.now()}`,
    name,
    baseUrl,
    apiKey,
    createdAt: Date.now()
  };

  if (websiteUrl) {
    newChannel.websiteUrl = websiteUrl;
  }

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

  // Check if this channel is currently active
  const currentSettings = getCurrentSettings();
  const channel = data.channels[index];
  const isActive = currentSettings &&
    channel.baseUrl === currentSettings.baseUrl &&
    channel.apiKey === currentSettings.apiKey;

  if (isActive) {
    // Only allow updating name and websiteUrl for active channel
    if (updates.name) {
      data.channels[index].name = updates.name;
    }
    if (updates.websiteUrl !== undefined) {
      data.channels[index].websiteUrl = updates.websiteUrl;
    }
  } else {
    // Allow all updates for inactive channels
    data.channels[index] = { ...data.channels[index], ...updates };
  }

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

  // Check if this channel is currently active
  const currentSettings = getCurrentSettings();
  const channel = data.channels[index];
  if (currentSettings &&
      channel.baseUrl === currentSettings.baseUrl &&
      channel.apiKey === currentSettings.apiKey) {
    throw new Error('Cannot delete active channel');
  }

  data.channels.splice(index, 1);
  saveChannels(data);
  return { success: true };
}

// Activate channel (switch to this channel)
function activateChannel(id) {
  const data = loadChannels();
  const channel = data.channels.find(ch => ch.id === id);

  if (!channel) {
    throw new Error('Channel not found');
  }

  // Always save active channel ID for UI consistency
  saveActiveChannelId(id);

  // Check if we're in proxy mode
  if (isProxyConfig()) {
    // Proxy mode: only save active channel ID, don't modify settings.json
    console.log(`✅ Activated channel in proxy mode: ${channel.name}`);
  } else {
    // Normal mode: also update Claude settings.json
    updateClaudeSettings(channel.baseUrl, channel.apiKey);
    console.log(`✅ Activated channel in normal mode: ${channel.name}`);
  }

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
  getCurrentChannel,
  getActiveChannel: getCurrentChannel, // Alias for proxy server
  createChannel,
  updateChannel,
  deleteChannel,
  activateChannel,
  updateClaudeSettings // Export for proxy stop
};
