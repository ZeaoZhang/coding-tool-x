const express = require('express');
const router = express.Router();
const {
  startCodexProxyServer,
  stopCodexProxyServer,
  getCodexProxyStatus
} = require('../codex-proxy-server');
const {
  setProxyConfig,
  restoreSettings,
  isProxyConfig,
  getCurrentProxyPort,
  configExists,
  hasBackup,
  readConfig
} = require('../services/codex-settings-manager');
const { getChannels, getEnabledChannels } = require('../services/codex-channels');
const { clearNativeOAuth } = require('../services/native-oauth-adapters');
const { clearAllLogs } = require('../websocket-server');
const { PATHS, ensureStorageDirMigrated } = require('../../config/paths');
const fs = require('fs');
const path = require('path');

function sanitizeChannel(channel) {
  if (!channel) return null;
  return {
    id: channel.id,
    name: channel.name,
    baseUrl: channel.baseUrl,
    websiteUrl: channel.websiteUrl,
    providerKey: channel.providerKey
  };
}

function selectLatestEnabledChannel(channels) {
  if (!Array.isArray(channels) || channels.length === 0) return null;
  const enabledChannels = channels.filter(ch => ch.enabled !== false);
  if (enabledChannels.length === 0) return null;
  return enabledChannels.reduce((latest, current) => {
    const latestTs = Number(latest?.updatedAt || latest?.createdAt || 0);
    const currentTs = Number(current?.updatedAt || current?.createdAt || 0);
    return currentTs > latestTs ? current : latest;
  }, enabledChannels[0]);
}

function resolveActiveChannel(channels, activeChannelId = null) {
  if (!Array.isArray(channels) || channels.length === 0) {
    return null;
  }

  if (activeChannelId) {
    const matched = channels.find(channel => channel.id === activeChannelId);
    if (matched) {
      return matched;
    }
  }

  return selectLatestEnabledChannel(channels)
    || channels.find(channel => channel.enabled !== false)
    || channels[0]
    || null;
}

// 保存激活渠道ID
function saveActiveChannelId(channelId) {
  ensureStorageDirMigrated();
  const filePath = PATHS.activeChannel.codex;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
}

function loadActiveChannelId() {
  ensureStorageDirMigrated();
  const filePath = PATHS.activeChannel.codex;
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      return data.activeChannelId || null;
    }
  } catch (error) {
    console.error('[Codex Proxy] Error loading active channel ID:', error);
  }
  return null;
}

function removeActiveChannelFile() {
  ensureStorageDirMigrated();
  const filePath = PATHS.activeChannel.codex;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log('[Codex Proxy] Removed codex-active-channel.json');
  }
}

// 获取代理状态
router.get('/status', (req, res) => {
  try {
    const proxyStatus = getCodexProxyStatus();
    const { channels } = getChannels();
    const activeChannel = resolveActiveChannel(channels, loadActiveChannelId());
    const configStatus = {
      isProxyConfig: isProxyConfig(),
      configExists: configExists(),
      hasBackup: hasBackup(),
      currentProxyPort: getCurrentProxyPort()
    };

    res.json({
      proxy: proxyStatus,
      config: configStatus,
      activeChannel: sanitizeChannel(activeChannel)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动代理
router.post('/start', async (req, res) => {
  try {
    // 1. 检查 Codex 配置文件是否存在
    if (!configExists()) {
      return res.status(400).json({
        error: 'Codex config.toml not found. Please run Codex CLI at least once.'
      });
    }

    // 2. 获取当前启用的渠道（优先使用当前配置中正在使用的 provider）
    const enabledChannels = getEnabledChannels();
    let currentChannel = null;
    try {
      const currentProvider = readConfig()?.model_provider;
      if (currentProvider && currentProvider !== 'cc-proxy') {
        currentChannel = enabledChannels.find(ch => ch.providerKey === currentProvider) || null;
      }
    } catch (err) {
      // ignore and fallback
    }
    if (!currentChannel) {
      currentChannel = enabledChannels[0] || null;
    }
    if (!currentChannel) {
      return res.status(400).json({
        error: 'No enabled Codex channel found. Please create and enable a channel first.'
      });
    }

    // 3. 保存当前激活渠道ID（用于代理模式）
    saveActiveChannelId(currentChannel.id);
    console.log(`[Codex Proxy] Saved active channel: ${currentChannel.name} (${currentChannel.id})`);

    // 4. 启动代理服务器
    const proxyResult = await startCodexProxyServer();

    if (!proxyResult.success) {
      return res.status(500).json({ error: 'Failed to start Codex proxy server' });
    }

    // 5. 设置代理配置（备份并修改 config.toml 和 auth.json）
    clearNativeOAuth('codex');
    const configResult = setProxyConfig(proxyResult.port);

    const updatedStatus = getCodexProxyStatus();
    const { channels: allChannels } = getChannels();
    const activeChannel = allChannels.filter(ch => ch.enabled !== false)[0];
    const { broadcastProxyState } = require('../websocket-server');
    broadcastProxyState('codex', updatedStatus, activeChannel, allChannels);

    // 构建响应消息，包含环境变量提示（仅首次）
    let message = `Codex proxy started on port ${proxyResult.port}, active channel: ${currentChannel.name}`;
    let envHint = null;

    // 只有首次注入环境变量时才提示用户执行 source 命令
    if (configResult.envInjected && configResult.isFirstTime) {
      envHint = {
        command: configResult.sourceCommand,
        message: `首次启用需在 Codex 终端执行: ${configResult.sourceCommand}`
      };
    }

    res.json({
      success: true,
      port: proxyResult.port,
      activeChannel: sanitizeChannel(currentChannel),
      message,
      envHint
    });
  } catch (error) {
    console.error('[Codex Proxy] Error starting proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

// 停止代理
router.post('/stop', async (req, res) => {
  try {
    const { channels } = getChannels();
    const activeChannelId = loadActiveChannelId();
    const activeChannel = resolveActiveChannel(channels, activeChannelId);

    // 2. 停止代理服务器
    const proxyResult = await stopCodexProxyServer();
    const hadBackup = hasBackup();

    // 3. 恢复单渠道模式
    // 不恢复整个 config.toml 备份，避免两个问题：
    // - 备份中的旧 auth_mode/tokens 会导致 Codex 用 chatgpt token 认证 → usage limit
    // - 备份中的 mcp_servers 是旧状态，会覆盖用户在动态切换期间对 MCP 的修改
    // 直接丢弃备份，由 applyChannelToSettings 从当前 config.toml 写入正确渠道配置
    if (hadBackup) {
      const { deleteBackup } = require('../services/codex-settings-manager');
      deleteBackup();
      console.log('[Codex Proxy] Discarded backup (MCP changes preserved)');
    }

    const { broadcastProxyState } = require('../websocket-server');

    // 停止动态切换后回到单渠道模式：保留激活渠道，禁用其他渠道
    if (activeChannel) {
      const { applyChannelToSettings } = require('../services/codex-channels');
      applyChannelToSettings(activeChannel.id, { pruneProviders: true });
      console.log(`[Codex Proxy] Single-channel mode restored: ${activeChannel.name}`);
    }

    // 删除 active-channel.json
    removeActiveChannelFile();

    res.json({
      success: true,
      message: `Codex proxy stopped, settings restored${activeChannel ? ' (channel: ' + activeChannel.name + ')' : ''}`,
      port: proxyResult.port,
      restoredChannel: activeChannel?.name
    });

    const updatedStatus = getCodexProxyStatus();
    const { channels: latestChannels } = getChannels();
    const latestActiveChannel = latestChannels.find(ch => ch.enabled !== false) || null;
    broadcastProxyState('codex', updatedStatus, latestActiveChannel, latestChannels);
  } catch (error) {
    console.error('[Codex Proxy] Error stopping proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
