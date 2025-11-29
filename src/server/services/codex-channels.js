const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const toml = require('toml');
const { getCodexDir } = require('./codex-config');

/**
 * Codex 渠道管理服务（多渠道架构）
 *
 * Codex 配置结构:
 * - config.toml: 主配置,包含 model_provider 和各提供商配置
 * - auth.json: API Key 存储
 * - 我们的 codex-channels.json: 完整渠道信息(用于管理)
 *
 * 多渠道模式：
 * - 使用 enabled 字段标记渠道是否启用
 * - 使用 weight 和 maxConcurrency 控制负载均衡
 */

// 获取渠道存储文件路径
function getChannelsFilePath() {
  const ccToolDir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(ccToolDir)) {
    fs.mkdirSync(ccToolDir, { recursive: true });
  }
  return path.join(ccToolDir, 'codex-channels.json');
}

// 读取所有渠道(从我们的存储文件)
function loadChannels() {
  const filePath = getChannelsFilePath();

  if (!fs.existsSync(filePath)) {
    // 尝试从 config.toml 初始化
    return initializeFromConfig();
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
    console.error('[Codex Channels] Failed to parse channels file:', err);
    return { channels: [] };
  }
}

// 从现有 config.toml 初始化渠道
function initializeFromConfig() {
  const configPath = path.join(getCodexDir(), 'config.toml');
  const authPath = path.join(getCodexDir(), 'auth.json');

  const defaultData = { channels: [] };

  if (!fs.existsSync(configPath)) {
    saveChannels(defaultData);
    return defaultData;
  }

  try {
    // 读取 config.toml
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = toml.parse(configContent);

    // 读取 auth.json
    let auth = {};
    if (fs.existsSync(authPath)) {
      auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    }

    // 从 model_providers 提取渠道
    const channels = [];
    if (config.model_providers) {
      for (const [providerKey, providerConfig] of Object.entries(config.model_providers)) {
        // env_key 优先级：配置的 env_key > PROVIDER_API_KEY > OPENAI_API_KEY
        let envKey = providerConfig.env_key || `${providerKey.toUpperCase()}_API_KEY`;
        let apiKey = auth[envKey] || '';

        // 如果没找到，尝试 OPENAI_API_KEY 作为通用 fallback
        if (!apiKey && auth['OPENAI_API_KEY']) {
          apiKey = auth['OPENAI_API_KEY'];
          envKey = 'OPENAI_API_KEY';
        }

        channels.push({
          id: crypto.randomUUID(),
          name: providerConfig.name || providerKey,
          providerKey,
          baseUrl: providerConfig.base_url || '',
          wireApi: providerConfig.wire_api || 'responses',
          envKey,
          apiKey,
          websiteUrl: providerConfig.website_url || '',
          requiresOpenaiAuth: providerConfig.requires_openai_auth !== false,
          queryParams: providerConfig.query_params || null,
          enabled: config.model_provider === providerKey, // 当前激活的渠道启用
          weight: 1,
          maxConcurrency: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
    }

    const data = {
      channels
    };

    saveChannels(data);
    return data;
  } catch (err) {
    console.error('[Codex Channels] Failed to initialize from config:', err);
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
function createChannel(name, providerKey, baseUrl, apiKey, wireApi = 'responses', extraConfig = {}) {
  const data = loadChannels();

  // 检查 providerKey 是否已存在
  const existing = data.channels.find(c => c.providerKey === providerKey);
  if (existing) {
    throw new Error(`Provider key "${providerKey}" already exists`);
  }

  const envKey = extraConfig.envKey || `${providerKey.toUpperCase()}_API_KEY`;

  const newChannel = {
    id: crypto.randomUUID(),
    name,
    providerKey,
    baseUrl,
    wireApi,
    envKey,
    apiKey,
    websiteUrl: extraConfig.websiteUrl || '',
    requiresOpenaiAuth: extraConfig.requiresOpenaiAuth !== false,
    queryParams: extraConfig.queryParams || null,
    enabled: extraConfig.enabled !== false, // 默认启用
    weight: extraConfig.weight || 1,
    maxConcurrency: extraConfig.maxConcurrency || null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  data.channels.push(newChannel);
  saveChannels(data);

  // 写入 Codex 配置文件
  writeCodexConfigForMultiChannel(data.channels);

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

  // 检查 providerKey 冲突
  if (updates.providerKey && updates.providerKey !== channel.providerKey) {
    const existing = data.channels.find(c => c.providerKey === updates.providerKey && c.id !== channelId);
    if (existing) {
      throw new Error(`Provider key "${updates.providerKey}" already exists`);
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

  // 更新 Codex 配置文件
  writeCodexConfigForMultiChannel(data.channels);

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

  // 更新 Codex 配置文件
  writeCodexConfigForMultiChannel(data.channels);

  return { success: true };
}

// 写入 Codex 配置文件（多渠道模式）
function writeCodexConfigForMultiChannel(allChannels) {
  const codexDir = getCodexDir();

  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }

  const configPath = path.join(codexDir, 'config.toml');
  const authPath = path.join(codexDir, 'auth.json');

  // 读取现有配置(保留其他字段)
  let existingConfig = {
    model: 'gpt-4',
    model_reasoning_effort: 'high',
    model_reasoning_summary_format: 'experimental',
    network_access: 'enabled',
    disable_response_storage: false,
    show_raw_agent_reasoning: true
  };

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      existingConfig = { ...existingConfig, ...toml.parse(content) };
    } catch (err) {
      console.warn('[Codex Channels] Failed to read existing config, using defaults');
    }
  }

  // 获取第一个启用的渠道作为默认 provider（Codex 配置要求）
  const enabledChannels = allChannels.filter(c => c.enabled !== false);
  const defaultProvider = enabledChannels[0]?.providerKey || allChannels[0]?.providerKey || 'openai';

  // 构建新的 config.toml
  let tomlContent = `# Codex Configuration
# Managed by Coding-Tool

# 当前使用的模型提供商
model_provider = "${defaultProvider}"

# 使用的模型
model = "${existingConfig.model || 'gpt-4'}"

# 推理强度 (low/medium/high)
model_reasoning_effort = "${existingConfig.model_reasoning_effort || 'high'}"

# 推理摘要格式
model_reasoning_summary_format = "${existingConfig.model_reasoning_summary_format || 'experimental'}"

# 网络访问 (enabled/restricted)
network_access = "${existingConfig.network_access || 'enabled'}"

# 是否禁用响应存储
disable_response_storage = ${existingConfig.disable_response_storage || false}

# 显示原始推理过程
show_raw_agent_reasoning = ${existingConfig.show_raw_agent_reasoning !== false}

`;

  // 添加所有提供商配置
  for (const channel of allChannels) {
    tomlContent += `\n[model_providers.${channel.providerKey}]
name = "${channel.name}"
base_url = "${channel.baseUrl}"
wire_api = "${channel.wireApi}"
env_key = "${channel.envKey}"
requires_openai_auth = ${channel.requiresOpenaiAuth !== false}
`;

    // 添加额外查询参数(如 Azure 的 api-version)
    if (channel.queryParams && Object.keys(channel.queryParams).length > 0) {
      tomlContent += `\n[model_providers.${channel.providerKey}.query_params]\n`;
      for (const [key, value] of Object.entries(channel.queryParams)) {
        tomlContent += `${key} = "${value}"\n`;
      }
    }
  }

  fs.writeFileSync(configPath, tomlContent, 'utf8');

  // 更新 auth.json
  let auth = {};
  if (fs.existsSync(authPath)) {
    try {
      auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    } catch (err) {
      console.warn('[Codex Channels] Failed to read auth.json, creating new');
    }
  }

  // 更新所有渠道的 API Key
  for (const channel of allChannels) {
    if (channel.apiKey) {
      auth[channel.envKey] = channel.apiKey;
    }
  }

  fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), 'utf8');
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
  saveChannelOrder
};
