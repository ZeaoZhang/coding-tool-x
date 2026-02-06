const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * OpenCode 渠道管理服务
 * 存储位置: ~/.claude/cc-tool/opencode-channels.json
 */

// 获取渠道存储文件路径
function getChannelsFilePath() {
  const ccToolDir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(ccToolDir)) {
    fs.mkdirSync(ccToolDir, { recursive: true });
  }
  return path.join(ccToolDir, 'opencode-channels.json');
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
      data.channels = data.channels.map(ch => ({
        ...ch,
        enabled: ch.enabled !== false,
        weight: ch.weight || 1,
        maxConcurrency: ch.maxConcurrency || null,
        modelRedirects: ch.modelRedirects || [],
        authType: ch.authType || 'apiKey',
        wireApi: ch.wireApi || 'openai'  // OpenCode 默认使用 OpenAI 兼容格式
      }));
    }
    return data;
  } catch (err) {
    console.error('[OpenCode Channels] Failed to parse channels file:', err);
    return { channels: [] };
  }
}

// 保存渠道数据
function saveChannels(data) {
  const filePath = getChannelsFilePath();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
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

  const newChannel = {
    id: crypto.randomUUID(),
    name,
    baseUrl,
    apiKey,
    wireApi: extraConfig.wireApi || 'openai',
    enabled: extraConfig.enabled !== false,
    weight: extraConfig.weight || 1,
    maxConcurrency: extraConfig.maxConcurrency || null,
    modelRedirects: extraConfig.modelRedirects || [],
    model: extraConfig.model || null,
    authType: extraConfig.authType || 'apiKey',
    oauthProvider: extraConfig.oauthProvider || null,
    oauthTokenId: extraConfig.oauthTokenId || null,
    presetId: extraConfig.presetId || null,
    websiteUrl: extraConfig.websiteUrl || '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  data.channels.push(newChannel);
  saveChannels(data);

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

  data.channels[index] = {
    ...oldChannel,
    ...updates,
    id: channelId,
    createdAt: oldChannel.createdAt,
    modelRedirects: updates.modelRedirects || oldChannel.modelRedirects || [],
    updatedAt: Date.now()
  };

  saveChannels(data);
  return data.channels[index];
}

// 删除渠道
function deleteChannel(channelId) {
  const data = loadChannels();
  const index = data.channels.findIndex(c => c.id === channelId);

  if (index === -1) {
    throw new Error('Channel not found');
  }

  data.channels.splice(index, 1);
  saveChannels(data);

  return { success: true };
}

// 获取所有启用的渠道
function getEnabledChannels() {
  const data = loadChannels();
  return data.channels.filter(c => c.enabled !== false);
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

/**
 * 获取渠道的有效 API Key
 * OAuth 认证时返回 access token，否则返回静态 API Key
 */
function getEffectiveApiKey(channel) {
  if (channel.authType === 'oauth' && channel.oauthTokenId) {
    const { getToken, isTokenExpired } = require('./oauth-token-storage');
    const token = getToken(channel.oauthTokenId);
    if (token && !isTokenExpired(token)) {
      return token.accessToken;
    }
    return null;
  }
  return channel.apiKey;
}

module.exports = {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  getEnabledChannels,
  saveChannelOrder,
  getEffectiveApiKey
};
