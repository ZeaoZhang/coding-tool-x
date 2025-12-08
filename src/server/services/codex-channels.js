const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;
const { getCodexDir } = require('./codex-config');
const { injectEnvToShell, removeEnvFromShell, isProxyConfig } = require('./codex-settings-manager');

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

        // 自动注入环境变量（从 Codex 迁移过来时使用）
        if (apiKey && envKey) {
          const injectResult = injectEnvToShell(envKey, apiKey);
          if (injectResult.success) {
            console.log(`[Codex Channels] Environment variable ${envKey} injected during initialization`);
          }
        }
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

  // 注入该渠道的环境变量（用于直接使用 codex 命令）
  if (apiKey && envKey) {
    const injectResult = injectEnvToShell(envKey, apiKey);
    if (injectResult.success) {
      console.log(`[Codex Channels] Environment variable ${envKey} injected for new channel`);
    } else {
      console.warn(`[Codex Channels] Failed to inject ${envKey}: ${injectResult.error}`);
    }
  }

  // 注意：不再自动写入 config.toml，只在开启代理控制时才同步
  // writeCodexConfigForMultiChannel(data.channels);

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

  // 检查 providerKey 冲突
  if (updates.providerKey && updates.providerKey !== oldChannel.providerKey) {
    const existing = data.channels.find(c => c.providerKey === updates.providerKey && c.id !== channelId);
    if (existing) {
      throw new Error(`Provider key "${updates.providerKey}" already exists`);
    }
  }

  const newChannel = {
    ...oldChannel,
    ...updates,
    id: channelId, // 保持 ID 不变
    createdAt: oldChannel.createdAt, // 保持创建时间
    updatedAt: Date.now()
  };

  data.channels[index] = newChannel;
  saveChannels(data);

  // 处理环境变量更新
  // 如果 envKey 或 apiKey 变化，需要更新环境变量
  const oldEnvKey = oldChannel.envKey;
  const newEnvKey = newChannel.envKey;
  const oldApiKey = oldChannel.apiKey;
  const newApiKey = newChannel.apiKey;

  // 如果 envKey 改变，删除旧的，注入新的
  if (oldEnvKey !== newEnvKey && oldEnvKey) {
    const removeResult = removeEnvFromShell(oldEnvKey);
    if (removeResult.success) {
      console.log(`[Codex Channels] Old environment variable ${oldEnvKey} removed`);
    }
  }

  // 如果有新的 API Key，注入到环境变量
  if (newApiKey && newEnvKey) {
    const injectResult = injectEnvToShell(newEnvKey, newApiKey);
    if (injectResult.success) {
      console.log(`[Codex Channels] Environment variable ${newEnvKey} updated`);
    }
  }

  // 注意：不再自动写入 config.toml，只在开启代理控制时才同步
  // writeCodexConfigForMultiChannel(data.channels);

  return data.channels[index];
}

// 删除渠道
function deleteChannel(channelId) {
  const data = loadChannels();

  const index = data.channels.findIndex(c => c.id === channelId);
  if (index === -1) {
    throw new Error('Channel not found');
  }

  const deletedChannel = data.channels[index];
  data.channels.splice(index, 1);
  saveChannels(data);

  // 从 shell 配置文件移除该渠道的环境变量
  if (deletedChannel.envKey) {
    const removeResult = removeEnvFromShell(deletedChannel.envKey);
    if (removeResult.success) {
      console.log(`[Codex Channels] Environment variable ${deletedChannel.envKey} removed`);
    } else {
      console.warn(`[Codex Channels] Failed to remove ${deletedChannel.envKey}: ${removeResult.error}`);
    }
  }

  // 注意：不再自动写入 config.toml，只在开启代理控制时才同步
  // writeCodexConfigForMultiChannel(data.channels);

  return { success: true };
}

/**
 * 写入 Codex 配置文件（多渠道模式）
 *
 * 关键改进：
 * 1. 完整保留现有配置（mcp_servers, projects 等）
 * 2. 如果已启用动态切换（cc-proxy），不覆盖 model_provider
 * 3. 使用 TOML 序列化而不是字符串拼接，确保配置完整性
 */
function writeCodexConfigForMultiChannel(allChannels) {
  const codexDir = getCodexDir();

  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }

  const configPath = path.join(codexDir, 'config.toml');
  const authPath = path.join(codexDir, 'auth.json');

  // 读取现有配置，保留所有现有字段（特别是 mcp_servers, projects 等）
  let config = {
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
      const parsedConfig = toml.parse(content);

      // 深度合并，保留原有的所有配置
      config = {
        ...parsedConfig,
        // 只覆盖这些字段
        model: parsedConfig.model || config.model,
        model_reasoning_effort: parsedConfig.model_reasoning_effort || config.model_reasoning_effort,
        model_reasoning_summary_format: parsedConfig.model_reasoning_summary_format || config.model_reasoning_summary_format,
        network_access: parsedConfig.network_access || config.network_access,
        disable_response_storage: parsedConfig.disable_response_storage !== undefined ? parsedConfig.disable_response_storage : config.disable_response_storage,
        show_raw_agent_reasoning: parsedConfig.show_raw_agent_reasoning !== undefined ? parsedConfig.show_raw_agent_reasoning : config.show_raw_agent_reasoning,
        // mcp_servers 和 projects 会从 parsedConfig 自动继承
        // model_provider 会根据动态切换情况决定是否更新
      };
    } catch (err) {
      // ignore read error, use defaults
    }
  }

  // 判断是否已启用动态切换
  const isProxyMode = config.model_provider === 'cc-proxy';
  const existingProviders = (config && typeof config.model_providers === 'object') ? config.model_providers : {};
  const existingProxyProvider = existingProviders['cc-proxy'];

  // 只有当未启用动态切换时，才更新 model_provider
  if (!isProxyMode) {
    const enabledChannels = allChannels.filter(c => c.enabled !== false);
    const defaultProvider = enabledChannels[0]?.providerKey || allChannels[0]?.providerKey || 'openai';
    config.model_provider = defaultProvider;
  }

  // 重建 model_providers 配置，先保留已有的非渠道 provider，避免丢失用户自定义配置
  config.model_providers = { ...existingProviders };

  // 在代理模式下，先保留 cc-proxy provider，避免被覆盖导致缺少 provider
  if (isProxyMode) {
    if (existingProxyProvider) {
      config.model_providers['cc-proxy'] = existingProxyProvider;
    } else {
      // 回退默认的代理配置（使用默认端口），确保 provider 存在
      config.model_providers['cc-proxy'] = {
        name: 'cc-proxy',
        base_url: 'http://127.0.0.1:10089/v1',
        wire_api: 'responses',
        env_key: 'CC_PROXY_KEY'
      };
    }
  }

  for (const channel of allChannels) {
    config.model_providers[channel.providerKey] = {
      name: channel.name,
      base_url: channel.baseUrl,
      wire_api: channel.wireApi,
      env_key: channel.envKey,
      requires_openai_auth: channel.requiresOpenaiAuth !== false
    };

    // 添加额外查询参数(如 Azure 的 api-version)
    if (channel.queryParams && Object.keys(channel.queryParams).length > 0) {
      config.model_providers[channel.providerKey].query_params = channel.queryParams;
    }
  }

  // 使用 TOML 序列化写入配置（保留注释和格式）
  try {
    const tomlContent = tomlStringify(config);
    // 在开头添加标记注释
    const annotatedContent = `# Codex Configuration
# Managed by Coding-Tool
# WARNING: MCP servers and projects are preserved automatically

${tomlContent}`;

    fs.writeFileSync(configPath, annotatedContent, 'utf8');
  } catch (err) {
    console.error('[Codex Channels] Failed to write config with TOML stringify:', err);
    // 降级处理：如果 tomlStringify 失败，使用手工拼接（但这样会丢失注释）
    const fallbackContent = JSON.stringify(config, null, 2);
    fs.writeFileSync(configPath, fallbackContent, 'utf8');
  }

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

  // 注意：环境变量注入在 createChannel 和 updateChannel 时已经处理
  // 这里不再重复注入，避免多次写入 shell 配置文件
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

/**
 * 同步所有渠道的环境变量到 shell 配置文件
 * 确保用户可以直接使用 codex 命令而无需手动设置环境变量
 * 这个函数会在服务启动时自动调用
 */
function syncAllChannelEnvVars() {
  try {
    const data = loadChannels();
    const channels = data.channels || [];

    if (channels.length === 0) {
      return { success: true, synced: 0 };
    }

    let syncedCount = 0;
    const results = [];

    for (const channel of channels) {
      if (channel.apiKey && channel.envKey) {
        const injectResult = injectEnvToShell(channel.envKey, channel.apiKey);
        if (injectResult.success) {
          syncedCount++;
          results.push({ envKey: channel.envKey, success: true });
        } else {
          results.push({ envKey: channel.envKey, success: false, error: injectResult.error });
        }
      }
    }

    console.log(`[Codex Channels] Synced ${syncedCount} environment variables`);
    return { success: true, synced: syncedCount, results };
  } catch (err) {
    console.error('[Codex Channels] Failed to sync env vars:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 将指定渠道应用到 Codex 配置文件
 * 类似 Claude 的"写入配置"功能，将渠道设置为当前激活的 provider
 *
 * @param {string} channelId - 渠道 ID
 * @returns {Object} 应用结果
 */
function applyChannelToSettings(channelId) {
  const data = loadChannels();
  const channel = data.channels.find(c => c.id === channelId);

  if (!channel) {
    throw new Error('Channel not found');
  }

  const codexDir = getCodexDir();

  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }

  const configPath = path.join(codexDir, 'config.toml');
  const authPath = path.join(codexDir, 'auth.json');

  // 读取现有配置，保留 mcp_servers, projects 等
  let config = {
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
      const parsedConfig = toml.parse(content);
      // 深度合并，保留原有的所有配置
      config = { ...parsedConfig };
    } catch (err) {
      console.warn('[Codex Channels] Failed to read existing config, using defaults');
    }
  }

  // 设置当前渠道为 model_provider
  config.model_provider = channel.providerKey;

  // 确保 model_providers 对象存在
  if (!config.model_providers) {
    config.model_providers = {};
  }

  // 添加/更新当前渠道的 provider 配置
  config.model_providers[channel.providerKey] = {
    name: channel.name,
    base_url: channel.baseUrl,
    wire_api: channel.wireApi || 'responses',
    env_key: channel.envKey,
    requires_openai_auth: channel.requiresOpenaiAuth !== false
  };

  // 添加额外查询参数(如 Azure 的 api-version)
  if (channel.queryParams && Object.keys(channel.queryParams).length > 0) {
    config.model_providers[channel.providerKey].query_params = channel.queryParams;
  }

  // 使用 TOML 序列化写入配置
  try {
    const tomlContent = tomlStringify(config);
    const annotatedContent = `# Codex Configuration
# Managed by Coding-Tool
# Current provider: ${channel.name}

${tomlContent}`;

    fs.writeFileSync(configPath, annotatedContent, 'utf8');
    console.log(`[Codex Channels] Applied channel ${channel.name} to config.toml`);
  } catch (err) {
    console.error('[Codex Channels] Failed to write config with TOML stringify:', err);
    throw new Error('Failed to write config.toml: ' + err.message);
  }

  // 更新 auth.json
  let auth = {};
  if (fs.existsSync(authPath)) {
    try {
      auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    } catch (err) {
      console.warn('[Codex Channels] Failed to read auth.json, creating new');
    }
  }

  // 添加当前渠道的 API Key
  if (channel.apiKey && channel.envKey) {
    auth[channel.envKey] = channel.apiKey;
  }

  fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), 'utf8');

  // 注入环境变量到 shell 配置文件
  if (channel.apiKey && channel.envKey) {
    const injectResult = injectEnvToShell(channel.envKey, channel.apiKey);
    if (injectResult.success) {
      console.log(`[Codex Channels] Environment variable ${channel.envKey} injected`);
    }
  }

  return channel;
}

// 服务启动时自动同步环境变量（静默执行，不影响其他功能）
try {
  const data = loadChannels();
  if (data.channels && data.channels.length > 0) {
    syncAllChannelEnvVars();
  }
} catch (err) {
  // 静默失败，不影响模块加载
  console.warn('[Codex Channels] Auto sync env vars failed:', err.message);
}

module.exports = {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  getEnabledChannels,
  saveChannelOrder,
  syncAllChannelEnvVars,
  writeCodexConfigForMultiChannel,
  applyChannelToSettings
};
