const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * OpenCode 渠道管理服务
 * 存储位置: ~/.cc-tool/opencode-channels.json
 */

function normalizeGatewaySourceType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'claude') return 'claude';
  if (normalized === 'gemini') return 'gemini';
  return 'codex';
}

// 获取渠道存储文件路径
function getChannelsFilePath() {
  const ccToolDir = path.join(os.homedir(), '.cc-tool');
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
      data.channels = data.channels.map(ch => {
        const normalized = {
          ...ch,
          enabled: ch.enabled !== false,
          weight: ch.weight || 1,
          maxConcurrency: ch.maxConcurrency || null,
          modelRedirects: ch.modelRedirects || [],
          speedTestModel: ch.speedTestModel || null,
          wireApi: ch.wireApi || 'openai',  // OpenCode 默认使用 OpenAI 兼容格式
          gatewaySourceType: normalizeGatewaySourceType(ch.gatewaySourceType),
          allowedModels: ch.allowedModels || []
        };
        normalized.providerKey = deriveProviderKey(normalized);
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
    speedTestModel: extraConfig.speedTestModel || null,
    model: extraConfig.model || null,
    gatewaySourceType: normalizeGatewaySourceType(extraConfig.gatewaySourceType),
    providerKey: extraConfig.providerKey || null,
    presetId: extraConfig.presetId || null,
    websiteUrl: extraConfig.websiteUrl || '',
    allowedModels: extraConfig.allowedModels || [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  newChannel.providerKey = extraConfig.providerKey || deriveProviderKey(newChannel);

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

  const merged = {
    ...oldChannel,
    ...updates,
    id: channelId,
    createdAt: oldChannel.createdAt,
    modelRedirects: updates.modelRedirects !== undefined ? updates.modelRedirects : (oldChannel.modelRedirects || []),
    speedTestModel: updates.speedTestModel !== undefined ? updates.speedTestModel : (oldChannel.speedTestModel || null),
    gatewaySourceType: normalizeGatewaySourceType(
      updates.gatewaySourceType !== undefined
        ? updates.gatewaySourceType
        : oldChannel.gatewaySourceType
    ),
    updatedAt: Date.now()
  };
  merged.providerKey = updates.providerKey || deriveProviderKey(merged);
  data.channels[index] = merged;

  saveChannels(data);
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
 */
async function getEffectiveApiKey(channel) {
  return channel.apiKey || null;
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
