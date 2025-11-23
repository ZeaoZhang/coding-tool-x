const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * Gemini 渠道管理服务
 *
 * Gemini 配置结构:
 * - .env: 环境变量配置 (GOOGLE_GEMINI_BASE_URL, GEMINI_API_KEY, GEMINI_MODEL)
 * - settings.json: 认证模式和 MCP 配置
 * - 我们的 gemini-channels.json: 完整渠道信息(用于管理)
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

// 获取激活渠道 ID 文件路径（代理模式使用）
function getActiveChannelIdPath() {
  const ccToolDir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(ccToolDir)) {
    fs.mkdirSync(ccToolDir, { recursive: true });
  }
  return path.join(ccToolDir, 'gemini-active-channel.json');
}

// 保存激活渠道 ID（代理模式使用）
function saveActiveChannelId(channelId) {
  const filePath = getActiveChannelIdPath();
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
}

// 加载激活渠道 ID（代理模式使用）
function loadActiveChannelId() {
  const filePath = getActiveChannelIdPath();
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      return data.activeChannelId || null;
    }
  } catch (error) {
    console.error('[Gemini Channels] Error loading active channel ID:', error);
  }
  return null;
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
    return JSON.parse(content);
  } catch (err) {
    console.error('[Gemini Channels] Failed to parse channels file:', err);
    return { channels: [], activeChannelId: null };
  }
}

// 从现有 .env 初始化渠道
function initializeFromEnv() {
  const envPath = path.join(getGeminiDir(), '.env');

  const defaultData = { channels: [], activeChannelId: null };

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
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const data = {
        channels: [channel],
        activeChannelId: channel.id
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

  // 检查是否在代理模式
  let activeChannelId = data.activeChannelId;
  if (isProxyConfig()) {
    // 代理模式：使用保存的激活渠道 ID
    const savedActiveId = loadActiveChannelId();
    if (savedActiveId) {
      activeChannelId = savedActiveId;
    }
  }

  // 标记当前激活的渠道
  const channels = data.channels.map(channel => ({
    ...channel,
    isActive: channel.id === activeChannelId
  }));

  return {
    channels,
    activeChannelId
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
    isActive: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  data.channels.push(newChannel);

  // 如果是第一个渠道，自动激活
  if (data.channels.length === 1 && !data.activeChannelId) {
    data.activeChannelId = newChannel.id;
    newChannel.isActive = true;
  }

  saveChannels(data);

  // 写入 Gemini 配置文件
  const activeChannel = data.channels.find(c => c.id === data.activeChannelId);
  if (activeChannel) {
    writeGeminiConfig(activeChannel);
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

  const channel = data.channels[index];
  const isActive = data.activeChannelId === channelId;

  // 不允许修改正在使用的渠道的关键配置
  if (isActive) {
    // 只允许修改名称
    data.channels[index] = {
      ...channel,
      name: updates.name || channel.name,
      updatedAt: Date.now()
    };
  } else {
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
  }

  saveChannels(data);

  // 更新 Gemini 配置文件
  const activeChannel = data.channels.find(c => c.id === data.activeChannelId);
  if (activeChannel) {
    writeGeminiConfig(activeChannel);
  }

  return data.channels[index];
}

// 删除渠道
function deleteChannel(channelId) {
  const data = loadChannels();

  // 不能删除当前使用的渠道
  if (data.activeChannelId === channelId) {
    throw new Error('Cannot delete active channel');
  }

  const index = data.channels.findIndex(c => c.id === channelId);
  if (index === -1) {
    throw new Error('Channel not found');
  }

  data.channels.splice(index, 1);
  saveChannels(data);

  return { success: true };
}

// 激活渠道(切换)
function activateChannel(channelId) {
  const data = loadChannels();
  const channel = data.channels.find(c => c.id === channelId);

  if (!channel) {
    throw new Error('Channel not found');
  }

  // 检查是否在代理模式
  if (isProxyConfig()) {
    // 代理模式：只保存激活渠道 ID，不修改 Gemini 配置文件
    saveActiveChannelId(channelId);
    console.log(`[Gemini Channels] Activated channel in proxy mode: ${channel.name}`);
  } else {
    // 普通模式：更新 Gemini 配置文件
    data.activeChannelId = channelId;
    saveChannels(data);

    // 写入 Gemini 配置文件
    try {
      writeGeminiConfig(channel);
    } catch (err) {
      console.error('[Gemini Channels] Failed to write Gemini config:', err);
      // 回滚
      data.activeChannelId = data.channels.find(c => c.isActive)?.id || null;
      saveChannels(data);
      throw new Error('Failed to update Gemini configuration: ' + err.message);
    }
    console.log(`[Gemini Channels] Activated channel in normal mode: ${channel.name}`);
  }

  return {
    success: true,
    channel: {
      ...channel,
      isActive: true
    }
  };
}

// 写入 Gemini 配置文件 (.env)
function writeGeminiConfig(activeChannel) {
  const geminiDir = getGeminiDir();

  if (!fs.existsSync(geminiDir)) {
    fs.mkdirSync(geminiDir, { recursive: true });
  }

  const envPath = path.join(geminiDir, '.env');

  // 构建 .env 内容
  const envContent = `GOOGLE_GEMINI_BASE_URL=${activeChannel.baseUrl}
GEMINI_API_KEY=${activeChannel.apiKey}
GEMINI_MODEL=${activeChannel.model}
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

// 获取当前激活的渠道
function getActiveChannel() {
  const data = loadChannels();

  // 检查是否在代理模式
  let activeChannelId = data.activeChannelId;
  if (isProxyConfig()) {
    // 代理模式：使用保存的激活渠道 ID
    const savedActiveId = loadActiveChannelId();
    if (savedActiveId) {
      activeChannelId = savedActiveId;
    }
  }

  if (!activeChannelId) {
    return null;
  }

  const channel = data.channels.find(c => c.id === activeChannelId);

  if (!channel) {
    return null;
  }

  return {
    ...channel,
    isActive: true
  };
}

// 别名：供代理服务器使用
function getActiveGeminiChannel() {
  return getActiveChannel();
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
  activateChannel,
  getActiveChannel,
  getActiveGeminiChannel,
  saveChannelOrder,
  isProxyConfig,
  getGeminiDir
};
