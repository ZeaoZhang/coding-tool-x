const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS, NATIVE_PATHS } = require('../../config/paths');
const { resolveChannelWebsiteUrl } = require('../../config/channel-preset-websites');
const { clearNativeOAuth } = require('./native-oauth-adapters');
const { normalizeGatewaySourceType } = require('./base/proxy-utils');

const GEMINI_API_FORMATS = new Set(['gemini_api', 'vertex_ai_v1']);

function normalizeGeminiApiFormat(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return GEMINI_API_FORMATS.has(normalized) ? normalized : 'gemini_api';
}

/**
 * Gemini 渠道管理服务（多渠道架构）
 *
 * Gemini 配置结构:
 * - .env: 环境变量配置 (GOOGLE_GEMINI_BASE_URL, GEMINI_API_KEY, GEMINI_MODEL)
 * - settings.json: 认证模式和 MCP 配置
 * - 我们的 gemini-channels.json: 完整渠道信息(用于管理)
 *
 * 多渠道模式：
 * - 使用 enabled 字段标记渠道是否启用
 * - 使用 weight 和 maxConcurrency 控制负载均衡
 */

// normalizeGatewaySourceType imported from base/proxy-utils

// 获取 Gemini 配置目录
function getGeminiDir() {
  return path.dirname(NATIVE_PATHS.gemini.env);
}

// 获取渠道存储文件路径
function getChannelsFilePath() {
  const channelsDir = path.dirname(PATHS.channels.gemini);
  if (!fs.existsSync(channelsDir)) {
    fs.mkdirSync(channelsDir, { recursive: true });
  }
  return PATHS.channels.gemini;
}

function readExistingGeminiEnv() {
  const envPath = path.join(getGeminiDir(), '.env');
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const env = {};
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        env[match[1].trim()] = match[2].trim();
      }
    });
  } catch (err) {
    return {};
  }

  return env;
}

function writeGeminiEnv(env = {}) {
  const envPath = path.join(getGeminiDir(), '.env');
  const content = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  fs.writeFileSync(envPath, content ? `${content}\n` : '', 'utf8');
  if (process.platform !== 'win32') {
    fs.chmodSync(envPath, 0o600);
  }
}

// 检查是否在代理模式
function isProxyConfig() {
  const envPath = path.join(getGeminiDir(), '.env');
  if (!fs.existsSync(envPath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    // 检查 GOOGLE_GEMINI_BASE_URL 是否指向本地代理
    const match = content.match(/GOOGLE_GEMINI_BASE_URL\s*=\s*(.+)/);
    if (match) {
      const baseUrl = match[1].trim();
      return baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost');
    }
  } catch (err) {
    console.error('[Gemini Channels] Error checking proxy config:', err);
  }

  return false;
}

// 读取所有渠道(从我们的存储文件)
function loadChannels() {
  const filePath = getChannelsFilePath();

  if (!fs.existsSync(filePath)) {
    // 尝试从 .env 初始化
    return initializeFromEnv();
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    // 确保渠道有 enabled 字段（兼容旧数据）
    if (data.channels) {
      data.channels = data.channels.map(ch => {
        const normalized = {
          ...ch,
          enabled: ch.enabled !== false, // 默认启用
          weight: ch.weight || 1,
          maxConcurrency: ch.maxConcurrency || null,
          balanceToken: ch.balanceToken || '',
          balanceUserId: ch.balanceUserId || null,
          modelRedirects: ch.modelRedirects || [],
          speedTestModel: ch.speedTestModel || null,
          apiFormat: normalizeGeminiApiFormat(ch.apiFormat),
          gatewaySourceType: normalizeGatewaySourceType(ch.gatewaySourceType, 'gemini')
        };
        normalized.websiteUrl = resolveChannelWebsiteUrl('gemini', normalized);
        return normalized;
      });
    }
    return data;
  } catch (err) {
    console.error('[Gemini Channels] Failed to parse channels file:', err);
    return { channels: [] };
  }
}

// 从现有 .env 初始化渠道
function initializeFromEnv() {
  const envPath = path.join(getGeminiDir(), '.env');

  const defaultData = { channels: [] };

  if (!fs.existsSync(envPath)) {
    saveChannels(defaultData);
    return defaultData;
  }

  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const env = {};

    // 解析 .env 文件
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        env[match[1].trim()] = match[2].trim();
      }
    });

    if (env.GOOGLE_GEMINI_BASE_URL && env.GEMINI_API_KEY) {
      const channel = {
        id: crypto.randomUUID(),
        name: 'Default',
        baseUrl: env.GOOGLE_GEMINI_BASE_URL,
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL || 'gemini-2.5-pro',
        enabled: true,
        weight: 1,
        maxConcurrency: null,
        balanceToken: '',
        balanceUserId: null,
        apiFormat: 'gemini_api',
        gatewaySourceType: 'gemini',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      channel.websiteUrl = resolveChannelWebsiteUrl('gemini', channel);

      const data = {
        channels: [channel]
      };

      saveChannels(data);
      return data;
    }

    saveChannels(defaultData);
    return defaultData;
  } catch (err) {
    console.error('[Gemini Channels] Failed to initialize from .env:', err);
    saveChannels(defaultData);
    return defaultData;
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
function createChannel(name, baseUrl, apiKey, model = 'gemini-2.5-pro', extraConfig = {}) {
  const data = loadChannels();

  // 检查名称是否已存在
  const existing = data.channels.find(c => c.name === name);
  if (existing) {
    throw new Error(`Channel name "${name}" already exists`);
  }

  const newChannel = {
    id: crypto.randomUUID(),
    name,
    baseUrl,
    apiKey,
    model,
    websiteUrl: extraConfig.websiteUrl || '',
    enabled: extraConfig.enabled !== false, // 默认启用
    weight: extraConfig.weight || 1,
    maxConcurrency: extraConfig.maxConcurrency || null,
    balanceToken: extraConfig.balanceToken || '',
    balanceUserId: extraConfig.balanceUserId || null,
    modelRedirects: extraConfig.modelRedirects || [],
    speedTestModel: extraConfig.speedTestModel || null,
    apiFormat: normalizeGeminiApiFormat(extraConfig.apiFormat),
    gatewaySourceType: normalizeGatewaySourceType(extraConfig.gatewaySourceType, 'gemini'),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  newChannel.websiteUrl = resolveChannelWebsiteUrl('gemini', newChannel);

  data.channels.push(newChannel);
  saveChannels(data);

  // 仅在非动态切换模式下写入 Gemini 配置文件
  const { getGeminiProxyStatus } = require('../gemini-proxy-server');
  const proxyStatus = getGeminiProxyStatus();
  if (!proxyStatus.running) {
    writeGeminiConfigForMultiChannel(data.channels);
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

  // 检查名称冲突
  if (updates.name && updates.name !== oldChannel.name) {
    const existing = data.channels.find(c => c.name === updates.name && c.id !== channelId);
    if (existing) {
      throw new Error(`Channel name "${updates.name}" already exists`);
    }
  }

  const merged = { ...oldChannel, ...updates };
  const nextChannel = {
    ...merged,
    id: channelId, // 保持 ID 不变
    createdAt: oldChannel.createdAt, // 保持创建时间
    modelRedirects: updates.modelRedirects !== undefined ? updates.modelRedirects : (oldChannel.modelRedirects || []),
    speedTestModel: updates.speedTestModel !== undefined ? updates.speedTestModel : (oldChannel.speedTestModel || null),
    apiFormat: updates.apiFormat !== undefined ? normalizeGeminiApiFormat(updates.apiFormat) : normalizeGeminiApiFormat(oldChannel.apiFormat),
    balanceToken: updates.balanceToken !== undefined ? updates.balanceToken : (oldChannel.balanceToken || ''),
    balanceUserId: updates.balanceUserId !== undefined ? updates.balanceUserId : (oldChannel.balanceUserId || null),
    gatewaySourceType: normalizeGatewaySourceType(merged.gatewaySourceType, 'gemini'),
    updatedAt: Date.now()
  };
  nextChannel.websiteUrl = resolveChannelWebsiteUrl('gemini', nextChannel);
  data.channels[index] = nextChannel;

  // Get proxy status
  const { getGeminiProxyStatus } = require('../gemini-proxy-server');
  const proxyStatus = getGeminiProxyStatus();
  const isProxyRunning = proxyStatus.running;

  // Single-channel enforcement: enabling a channel disables all others ONLY when proxy is OFF
  // When proxy is ON (dynamic switching), multiple channels can be enabled simultaneously
  if (!isProxyRunning && nextChannel.enabled && !oldChannel.enabled) {
    data.channels.forEach((ch, i) => {
      if (i !== index && ch.enabled) {
        ch.enabled = false;
      }
    });
    console.log(`[Gemini Single-channel mode] Enabled "${nextChannel.name}", disabled all others`);
  }

  saveChannels(data);

  // Only sync .env when proxy is OFF.
  // In dynamic switching mode, defer local config writes until proxy stop.
  if (!isProxyRunning && nextChannel.enabled) {
    console.log(`[Gemini Settings-sync] Channel "${nextChannel.name}" enabled, syncing .env...`);
    applyChannelToSettings(channelId, data.channels);
  } else if (!isProxyRunning) {
    // 更新 Gemini 配置文件 (full rewrite for non-active-channel changes)
    writeGeminiConfigForMultiChannel(data.channels);
  }

  return data.channels[index];
}

/**
 * 将指定渠道应用到 Gemini 配置文件
 *
 * @param {string} channelId - 渠道 ID
 * @param {Array} channels - 渠道列表（可选，避免重复读取）
 * @returns {Object} 应用的渠道
 */
function applyChannelToSettings(channelId, channels = null) {
  const data = channels ? { channels } : loadChannels();
  const channel = data.channels.find(c => c.id === channelId);

  if (!channel) {
    throw new Error('Channel not found');
  }

  // In single-channel mode, only this channel should be enabled
  data.channels.forEach(ch => {
    ch.enabled = ch.id === channelId;
  });
  // Only persist when we loaded from disk (not when called with in-memory channels from updateChannel)
  if (!channels) {
    saveChannels(data);
  }

  clearNativeOAuth('gemini');

  const geminiDir = getGeminiDir();

  if (!fs.existsSync(geminiDir)) {
    fs.mkdirSync(geminiDir, { recursive: true });
  }

  const env = readExistingGeminiEnv();
  const effectiveApiKey = getEffectiveApiKey(channel) || '';
  env.GOOGLE_GEMINI_BASE_URL = channel.baseUrl;
  env.GEMINI_API_KEY = effectiveApiKey;
  env.GEMINI_MODEL = channel.model;
  writeGeminiEnv(env);

  // 确保 settings.json 存在并配置正确的认证模式
  const settingsPath = path.join(geminiDir, 'settings.json');
  let settings = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      console.warn('[Gemini Channels] Failed to read settings.json, creating new');
    }
  }

  // 设置认证模式为 gemini-api-key（第三方 API）
  settings.security = settings.security || {};
  settings.security.auth = settings.security.auth || {};
  settings.security.auth.selectedType = 'gemini-api-key';

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  console.log(`[Gemini Channels] Applied channel ${channel.name} to .env`);
  return channel;
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

  // 仅在非动态切换模式下更新 Gemini 配置文件
  const { getGeminiProxyStatus } = require('../gemini-proxy-server');
  const proxyStatus = getGeminiProxyStatus();
  if (!proxyStatus.running) {
    writeGeminiConfigForMultiChannel(data.channels);
  }

  return { success: true };
}

// 写入 Gemini 配置文件 (.env) - 多渠道模式
function writeGeminiConfigForMultiChannel(allChannels) {
  const geminiDir = getGeminiDir();

  if (!fs.existsSync(geminiDir)) {
    fs.mkdirSync(geminiDir, { recursive: true });
  }

  // 获取第一个启用的渠道作为默认配置
  const enabledChannels = allChannels.filter(c => c.enabled !== false);
  const defaultChannel = enabledChannels[0] || allChannels[0];

  const env = readExistingGeminiEnv();

  if (!defaultChannel) {
    delete env.GOOGLE_GEMINI_BASE_URL;
    delete env.GEMINI_API_KEY;
    delete env.GEMINI_MODEL;
    writeGeminiEnv(env);
    return;
  }

  const effectiveApiKey = getEffectiveApiKey(defaultChannel) || '';
  env.GOOGLE_GEMINI_BASE_URL = defaultChannel.baseUrl;
  env.GEMINI_API_KEY = effectiveApiKey;
  env.GEMINI_MODEL = defaultChannel.model;
  writeGeminiEnv(env);

  // 确保 settings.json 存在并配置正确的认证模式
  const settingsPath = path.join(geminiDir, 'settings.json');
  let settings = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      console.warn('[Gemini Channels] Failed to read settings.json, creating new');
    }
  }

  // 设置认证模式为 gemini-api-key（第三方 API）
  settings.security = settings.security || {};
  settings.security.auth = settings.security.auth || {};
  settings.security.auth.selectedType = 'gemini-api-key';

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

// 获取所有启用的渠道（供调度器使用）
function getEnabledChannels() {
  const data = loadChannels();
  return data.channels.filter(c => c.enabled !== false);
}

function markChannelAsRecentlyUsed(channelId) {
  return updateChannel(channelId, {});
}

function getEffectiveApiKey(channel) {
  return channel.apiKey || null;
}

// 保存渠道顺序
function saveChannelOrder(order) {
  const data = loadChannels();

  // 按照给定的顺序重新排列
  const orderedChannels = [];
  for (const id of order) {
    const channel = data.channels.find(c => c.id === id);
    if (channel) {
      orderedChannels.push(channel);
    }
  }

  // 添加不在顺序中的渠道(新添加的)
  for (const channel of data.channels) {
    if (!orderedChannels.find(c => c.id === channel.id)) {
      orderedChannels.push(channel);
    }
  }

  data.channels = orderedChannels;
  saveChannels(data);
}

function disableAllChannels() {
  const data = loadChannels();
  data.channels.forEach(ch => { ch.enabled = false; });
  saveChannels(data);
}

module.exports = {
  getChannels,
  createChannel,
  updateChannel,
  markChannelAsRecentlyUsed,
  deleteChannel,
  getEnabledChannels,
  getEffectiveApiKey,
  saveChannelOrder,
  isProxyConfig,
  getGeminiDir,
  applyChannelToSettings,
  disableAllChannels,
  _test: {
    normalizeGeminiApiFormat
  }
};
