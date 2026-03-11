const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS, NATIVE_PATHS } = require('../../config/paths');

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

function normalizeGatewaySourceType(value, fallback = 'gemini') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'claude') return 'claude';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'gemini') return 'gemini';
  return fallback;
}

// 获取 Gemini 配置目录
function getGeminiDir() {
  return path.dirname(NATIVE_PATHS.gemini.env);
}

// 获取渠道存储文件路径
function getChannelsFilePath() {
  const ccToolDir = PATHS.base;
  if (!fs.existsSync(ccToolDir)) {
    fs.mkdirSync(ccToolDir, { recursive: true });
  }
  return PATHS.channels.gemini;
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
        return {
          ...ch,
          enabled: ch.enabled !== false, // 默认启用
          weight: ch.weight || 1,
          maxConcurrency: ch.maxConcurrency || null,
          modelRedirects: ch.modelRedirects || [],
          speedTestModel: ch.speedTestModel || null,
          gatewaySourceType: normalizeGatewaySourceType(ch.gatewaySourceType, 'gemini')
        };
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
        gatewaySourceType: 'gemini',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

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
    modelRedirects: extraConfig.modelRedirects || [],
    speedTestModel: extraConfig.speedTestModel || null,
    gatewaySourceType: normalizeGatewaySourceType(extraConfig.gatewaySourceType, 'gemini'),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

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
    gatewaySourceType: normalizeGatewaySourceType(merged.gatewaySourceType, 'gemini'),
    updatedAt: Date.now()
  };
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

  // Prevent disabling last enabled channel when proxy is OFF
  if (!isProxyRunning && !nextChannel.enabled && oldChannel.enabled) {
    const enabledCount = data.channels.filter(ch => ch.enabled).length;
    if (enabledCount === 0) {
      throw new Error('无法禁用最后一个启用的渠道。请先启用其他渠道或启动动态切换。');
    }
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

  const geminiDir = getGeminiDir();

  if (!fs.existsSync(geminiDir)) {
    fs.mkdirSync(geminiDir, { recursive: true });
  }

  const envPath = path.join(geminiDir, '.env');

  // 构建 .env 内容
  const effectiveApiKey = getEffectiveApiKey(channel) || '';
  const envContent = `GOOGLE_GEMINI_BASE_URL=${channel.baseUrl}
GEMINI_API_KEY=${effectiveApiKey}
GEMINI_MODEL=${channel.model}
`;

  fs.writeFileSync(envPath, envContent, 'utf8');

  // 设置 .env 文件权限为 600 (仅所有者可读写)
  if (process.platform !== 'win32') {
    fs.chmodSync(envPath, 0o600);
  }

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

  const envPath = path.join(geminiDir, '.env');

  // 获取第一个启用的渠道作为默认配置
  const enabledChannels = allChannels.filter(c => c.enabled !== false);
  const defaultChannel = enabledChannels[0] || allChannels[0];

  if (!defaultChannel) {
    // 没有渠道，写入空配置
    const envContent = `# Gemini Configuration\n# No channels configured\n`;
    fs.writeFileSync(envPath, envContent, 'utf8');
    return;
  }

  // 构建 .env 内容
  const effectiveApiKey = getEffectiveApiKey(defaultChannel) || '';
  const envContent = `GOOGLE_GEMINI_BASE_URL=${defaultChannel.baseUrl}
GEMINI_API_KEY=${effectiveApiKey}
GEMINI_MODEL=${defaultChannel.model}
`;

  fs.writeFileSync(envPath, envContent, 'utf8');

  // 设置 .env 文件权限为 600 (仅所有者可读写)
  if (process.platform !== 'win32') {
    fs.chmodSync(envPath, 0o600);
  }

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

module.exports = {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  getEnabledChannels,
  getEffectiveApiKey,
  saveChannelOrder,
  isProxyConfig,
  getGeminiDir,
  applyChannelToSettings
};
