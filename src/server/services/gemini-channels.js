const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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

// 获取 Gemini 配置目录
function getGeminiDir() {
  return path.join(os.homedir(), '.gemini');
}

// 获取渠道存储文件路径
function getChannelsFilePath() {
  const ccToolDir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(ccToolDir)) {
    fs.mkdirSync(ccToolDir, { recursive: true });
  }
  return path.join(ccToolDir, 'gemini-channels.json');
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
      data.channels = data.channels.map(ch => ({
        ...ch,
        enabled: ch.enabled !== false, // 默认启用
        weight: ch.weight || 1,
        maxConcurrency: ch.maxConcurrency || null
      }));
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
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  data.channels.push(newChannel);
  saveChannels(data);

  // 写入 Gemini 配置文件
  writeGeminiConfigForMultiChannel(data.channels);

  return newChannel;
}

// 更新渠道
function updateChannel(channelId, updates) {
  const data = loadChannels();
  const index = data.channels.findIndex(c => c.id === channelId);

  if (index === -1) {
    throw new Error('Channel not found');
  }

  const channel = data.channels[index];

  // 检查名称冲突
  if (updates.name && updates.name !== channel.name) {
    const existing = data.channels.find(c => c.name === updates.name && c.id !== channelId);
    if (existing) {
      throw new Error(`Channel name "${updates.name}" already exists`);
    }
  }

  data.channels[index] = {
    ...channel,
    ...updates,
    id: channelId, // 保持 ID 不变
    createdAt: channel.createdAt, // 保持创建时间
    updatedAt: Date.now()
  };

  saveChannels(data);

  // 更新 Gemini 配置文件
  writeGeminiConfigForMultiChannel(data.channels);

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

  // 更新 Gemini 配置文件
  writeGeminiConfigForMultiChannel(data.channels);

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
  const envContent = `GOOGLE_GEMINI_BASE_URL=${defaultChannel.baseUrl}
GEMINI_API_KEY=${defaultChannel.apiKey}
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
  saveChannelOrder,
  isProxyConfig,
  getGeminiDir
};
