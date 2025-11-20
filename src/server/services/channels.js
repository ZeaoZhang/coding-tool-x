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

// Load channels from file
function loadChannels() {
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
  return { channels: [] };
}

// Save channels to file
function saveChannels(data) {
  const filePath = getChannelsFilePath();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Get current settings from settings.json
function getCurrentSettings() {
  try {
    const settingsPath = getClaudeSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // Read from env object
    const baseUrl = settings.env?.ANTHROPIC_BASE_URL || '';
    const apiKey = settings.env?.ANTHROPIC_API_KEY || '';

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

  // Check if we're in proxy mode
  if (isProxyConfig()) {
    // Proxy mode: only save active channel ID, don't modify settings.json
    saveActiveChannelId(id);
    console.log(`✅ Activated channel in proxy mode: ${channel.name}`);
  } else {
    // Normal mode: update Claude settings.json
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

  // Update env fields
  settings.env.ANTHROPIC_BASE_URL = baseUrl;
  settings.env.ANTHROPIC_API_KEY = apiKey;

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
