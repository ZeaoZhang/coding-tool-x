const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;
const { resolvePreferredHomeDir } = require('../../utils/home-dir');
const { getCodexDir } = require('./codex-config');
const { isProxyConfig } = require('./codex-settings-manager');
const { clearNativeOAuth } = require('./native-oauth-adapters');

const HOME_DIR = resolvePreferredHomeDir(process.platform, process.env, os.homedir());

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

function normalizeGatewaySourceType(value, fallback = 'codex') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'claude') return 'claude';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'gemini') return 'gemini';
  return fallback;
}

// 获取渠道存储文件路径
function getChannelsFilePath() {
  const ccToolDir = path.join(HOME_DIR, '.cc-tool');
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
      data.channels = data.channels.map(ch => {
        return {
          ...ch,
          enabled: ch.enabled !== false, // 默认启用
          weight: ch.weight || 1,
          maxConcurrency: ch.maxConcurrency || null,
          modelRedirects: ch.modelRedirects || [],
          speedTestModel: ch.speedTestModel || null,
          gatewaySourceType: normalizeGatewaySourceType(ch.gatewaySourceType, 'codex')
        };
      });
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
          gatewaySourceType: 'codex',
          createdAt: Date.now(),
          updatedAt: Date.now()
        });

        // auth.json 已写入 API Key，Codex 启动时优先读取 auth.json，无需注入 shell
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

function getDefaultCodexConfig() {
  return {
    model: 'gpt-4',
    model_reasoning_effort: 'high',
    model_reasoning_summary_format: 'experimental',
    network_access: 'enabled',
    disable_response_storage: false,
    show_raw_agent_reasoning: true
  };
}

function cloneConfigValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function readCodexConfigOrThrow(configPath, fallbackConfig = {}) {
  if (!fs.existsSync(configPath)) {
    return cloneConfigValue(fallbackConfig);
  }

  const content = fs.readFileSync(configPath, 'utf8');

  try {
    return toml.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse existing config.toml: ${err.message}`);
  }
}

function writeTextAtomic(filePath, content) {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore temp cleanup errors
      }
    }
  }
}

function writeAnnotatedCodexConfig(configPath, config, headerLines = []) {
  const tomlContent = tomlStringify(config);
  const prefix = headerLines.length > 0 ? `${headerLines.join('\n')}\n\n` : '';
  writeTextAtomic(configPath, `${prefix}${tomlContent}`);
}

function getManagedProviderKeys(channels = []) {
  const keys = new Set(['cc-proxy']);
  for (const channel of channels) {
    if (channel?.providerKey) {
      keys.add(channel.providerKey);
    }
  }
  return keys;
}

function pruneManagedProviders(existingProviders = {}, currentProviderKey, channels = []) {
  const managedProviderKeys = getManagedProviderKeys(channels);
  const preservedProviders = {};

  for (const [providerKey, providerConfig] of Object.entries(existingProviders)) {
    if (!managedProviderKeys.has(providerKey) || providerKey === currentProviderKey) {
      preservedProviders[providerKey] = providerConfig;
    }
  }

  return preservedProviders;
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
    modelRedirects: extraConfig.modelRedirects || [],
    speedTestModel: extraConfig.speedTestModel || null,
    gatewaySourceType: normalizeGatewaySourceType(extraConfig.gatewaySourceType, 'codex'),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  data.channels.push(newChannel);
  saveChannels(data);

  // auth.json 已写入 API Key（通过 writeCodexConfigForMultiChannel），Codex 优先读取 auth.json

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

  const merged = { ...oldChannel, ...updates };
  const newChannel = {
    ...merged,
    id: channelId, // 保持 ID 不变
    createdAt: oldChannel.createdAt, // 保持创建时间
    modelRedirects: merged.modelRedirects || [],
    speedTestModel: merged.speedTestModel !== undefined ? merged.speedTestModel : (oldChannel.speedTestModel || null),
    gatewaySourceType: normalizeGatewaySourceType(merged.gatewaySourceType, 'codex'),
    updatedAt: Date.now()
  };

  data.channels[index] = newChannel;

  // Get proxy status
  const { getCodexProxyStatus } = require('../codex-proxy-server');
  const proxyStatus = getCodexProxyStatus();
  const isProxyRunning = proxyStatus.running;

  // Single-channel enforcement: enabling a channel disables all others ONLY when proxy is OFF
  // When proxy is ON (dynamic switching), multiple channels can be enabled simultaneously
  if (!isProxyRunning && newChannel.enabled && !oldChannel.enabled) {
    data.channels.forEach((ch, i) => {
      if (i !== index && ch.enabled) {
        ch.enabled = false;
      }
    });
    console.log(`[Codex Single-channel mode] Enabled "${newChannel.name}", disabled all others`);
  }

  saveChannels(data);

  // Sync config.toml only when proxy is OFF.
  // In dynamic switching mode, defer local config writes until proxy stop.
  if (!isProxyRunning && newChannel.enabled) {
    console.log(`[Codex Settings-sync] Channel "${newChannel.name}" enabled, syncing config.toml...`);
    applyChannelToSettings(channelId);
  }

  // 处理环境变量更新
  // 如果 envKey 或 apiKey 变化，需要更新环境变量
  const oldEnvKey = oldChannel.envKey;
  const newEnvKey = newChannel.envKey;
  const newApiKey = newChannel.apiKey;
  const shouldRemoveOldEnv =
    !!oldEnvKey && (
      oldEnvKey !== newEnvKey ||
      !newApiKey ||
      newChannel.enabled === false
    );

  // auth.json 由 applyChannelToSettings/writeCodexConfigForMultiChannel 维护，Codex 优先读取 auth.json

  // 注意：不再自动写入 config.toml，只在开启代理控制时才同步
  // writeCodexConfigForMultiChannel(data.channels);

  return data.channels[index];
}

// 删除渠道
async function deleteChannel(channelId) {
  const data = loadChannels();

  const index = data.channels.findIndex(c => c.id === channelId);
  if (index === -1) {
    throw new Error('Channel not found');
  }

  const deletedChannel = data.channels[index];
  data.channels.splice(index, 1);
  saveChannels(data);

  // auth.json 中的 key 由 writeCodexConfigForMultiChannel 管理，删除渠道后下次写入时自动清理

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
  const defaultConfig = getDefaultCodexConfig();
  const parsedConfig = readCodexConfigOrThrow(configPath, defaultConfig);
  let config = {
    ...parsedConfig,
    model: parsedConfig.model || defaultConfig.model,
    model_reasoning_effort: parsedConfig.model_reasoning_effort || defaultConfig.model_reasoning_effort,
    model_reasoning_summary_format: parsedConfig.model_reasoning_summary_format || defaultConfig.model_reasoning_summary_format,
    network_access: parsedConfig.network_access || defaultConfig.network_access,
    disable_response_storage: parsedConfig.disable_response_storage !== undefined ? parsedConfig.disable_response_storage : defaultConfig.disable_response_storage,
    show_raw_agent_reasoning: parsedConfig.show_raw_agent_reasoning !== undefined ? parsedConfig.show_raw_agent_reasoning : defaultConfig.show_raw_agent_reasoning
  };

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
        base_url: 'http://127.0.0.1:20089/v1',
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

  writeAnnotatedCodexConfig(configPath, config, [
    '# Codex Configuration',
    '# Managed by Coding-Tool',
    '# WARNING: MCP servers and projects are preserved automatically'
  ]);

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
    if (channel.envKey && !channel.apiKey) {
      delete auth[channel.envKey];
    }
  }

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
  // Codex 优先从 auth.json 读取 API Key，无需注入 shell 配置文件
  return { success: true, synced: 0 };
}

/**
 * 将指定渠道应用到 Codex 配置文件
 * 类似 Claude 的"写入配置"功能，将渠道设置为当前激活的 provider
 *
 * @param {string} channelId - 渠道 ID
 * @param {Object} options - 可选参数
 * @param {boolean} options.pruneProviders - 是否清理 model_providers 仅保留当前渠道
 * @returns {Object} 应用结果
 */
function applyChannelToSettings(channelId, options = {}) {
  const data = loadChannels();
  const channel = data.channels.find(c => c.id === channelId);

  if (!channel) {
    throw new Error('Channel not found');
  }

  // In single-channel mode, only this channel should be enabled
  data.channels.forEach(ch => {
    ch.enabled = ch.id === channelId;
  });
  saveChannels(data);
  clearNativeOAuth('codex');

  const codexDir = getCodexDir();

  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }

  const configPath = path.join(codexDir, 'config.toml');
  const authPath = path.join(codexDir, 'auth.json');

  // 读取现有配置，保留 mcp_servers, projects 等
  let config = readCodexConfigOrThrow(configPath, getDefaultCodexConfig());

  // 设置当前渠道为 model_provider
  config.model_provider = channel.providerKey;

  // 可选：清理 provider，关闭动态切换后只保留当前渠道配置
  if (options.pruneProviders === true) {
    const existingProviders = (config.model_providers && typeof config.model_providers === 'object')
      ? config.model_providers
      : {};
    config.model_providers = pruneManagedProviders(existingProviders, channel.providerKey, data.channels);
  } else if (!config.model_providers || typeof config.model_providers !== 'object') {
    // 默认兼容历史行为：保留已有 provider
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

  writeAnnotatedCodexConfig(configPath, config, [
    '# Codex Configuration',
    '# Managed by Coding-Tool',
    `# Current provider: ${channel.name}`
  ]);
  console.log(`[Codex Channels] Applied channel ${channel.name} to config.toml`);

  // 更新 auth.json
  let auth = {};
  if (fs.existsSync(authPath)) {
    try {
      auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    } catch (err) {
      console.warn('[Codex Channels] Failed to read auth.json, creating new');
    }
  }

  if (channel.apiKey && channel.envKey) {
    auth[channel.envKey] = channel.apiKey;
  } else if (channel.envKey) {
    delete auth[channel.envKey];
  }

  // 清除 chatgpt token 认证字段，避免 Codex 优先用过期 token 而报 usage limit
  delete auth.tokens;
  delete auth.auth_mode;

  fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), 'utf8');

  // auth.json 已在上方写入 API Key，Codex 优先读取 auth.json，无需注入 shell

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

function getEffectiveApiKey(channel) {
  return channel.apiKey || null;
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
  deleteChannel,
  getEnabledChannels,
  saveChannelOrder,
  syncAllChannelEnvVars,
  writeCodexConfigForMultiChannel,
  applyChannelToSettings,
  getEffectiveApiKey,
  disableAllChannels
};
