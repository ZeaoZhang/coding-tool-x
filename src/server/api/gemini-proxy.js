const express = require('express');
const router = express.Router();
const {
  startGeminiProxyServer,
  stopGeminiProxyServer,
  getGeminiProxyStatus
} = require('../gemini-proxy-server');
const {
  setProxyConfig,
  restoreSettings,
  deleteBackup,
  isProxyConfig,
  getCurrentProxyPort,
  configExists,
  hasBackup,
  readEnv
} = require('../services/gemini-settings-manager');
const { getChannels, getEnabledChannels } = require('../services/gemini-channels');
const { clearNativeOAuth } = require('../services/native-oauth-adapters');
const { PATHS, ensureStorageDirMigrated } = require('../../config/paths');
const fs = require('fs');
const path = require('path');

function sanitizeChannel(channel) {
  if (!channel) return null;
  const { apiKey, ...rest } = channel;
  return rest;
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
  const filePath = PATHS.activeChannel.gemini;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
}

function loadActiveChannelId() {
  ensureStorageDirMigrated();
  const filePath = PATHS.activeChannel.gemini;
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      return data.activeChannelId || null;
    }
  } catch (error) {
    console.error('[Gemini Proxy] Error loading active channel ID:', error);
  }
  return null;
}

function removeActiveChannelFile() {
  ensureStorageDirMigrated();
  const filePath = PATHS.activeChannel.gemini;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log('[Gemini Proxy] Removed gemini-active-channel.json');
  }
}

// 获取代理状态
router.get('/status', (req, res) => {
  try {
    const proxyStatus = getGeminiProxyStatus();
    const configStatus = {
      isProxyConfig: isProxyConfig(),
      configExists: configExists(),
      hasBackup: hasBackup(),
      currentProxyPort: getCurrentProxyPort()
    };
    const { channels } = getChannels();
    const activeChannel = resolveActiveChannel(channels, loadActiveChannelId());

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
    // 1. 检查 Gemini 配置文件是否存在
    if (!configExists()) {
      return res.status(400).json({
        error: 'Gemini .env not found. Please run Gemini CLI at least once or create ~/.gemini/.env manually.'
      });
    }

    // 2. 获取当前启用的渠道（优先使用当前 .env 对应的渠道）
    const enabledChannels = getEnabledChannels();
    let currentChannel = null;
    try {
      const env = readEnv();
      const baseUrl = env?.GOOGLE_GEMINI_BASE_URL;
      const apiKey = env?.GEMINI_API_KEY;
      const model = env?.GEMINI_MODEL;
      currentChannel = enabledChannels.find(ch =>
        ch.baseUrl === baseUrl && ch.apiKey === apiKey && (!model || ch.model === model)
      ) || enabledChannels.find(ch => ch.baseUrl === baseUrl && ch.apiKey === apiKey) || null;
    } catch (err) {
      // ignore and fallback
    }
    if (!currentChannel) {
      currentChannel = enabledChannels[0] || null;
    }
    if (!currentChannel) {
      return res.status(400).json({
        error: 'No enabled Gemini channel found. Please create and enable a channel first.'
      });
    }

    // 3. 保存当前激活渠道ID（用于代理模式）
    saveActiveChannelId(currentChannel.id);
    console.log(`[Gemini Proxy] Saved active channel: ${currentChannel.name} (${currentChannel.id})`);

    // 4. 启动代理服务器
    const proxyResult = await startGeminiProxyServer();

    if (!proxyResult.success) {
      return res.status(500).json({ error: 'Failed to start Gemini proxy server' });
    }

    // 5. 设置代理配置（备份并修改 .env 和 settings.json）
    clearNativeOAuth('gemini');
    setProxyConfig(proxyResult.port);

    const { broadcastProxyState } = require('../websocket-server');
    const proxyStatus = getGeminiProxyStatus();
    const { channels: allChannels } = getChannels();
    const activeChannel = allChannels.filter(ch => ch.enabled !== false)[0];
    broadcastProxyState('gemini', proxyStatus, activeChannel, allChannels);

    res.json({
      success: true,
      port: proxyResult.port,
      activeChannel: sanitizeChannel(currentChannel),
      message: `Gemini proxy started on port ${proxyResult.port}, active channel: ${currentChannel.name}`
    });
  } catch (error) {
    console.error('[Gemini Proxy] Error starting proxy:', error);
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
    const proxyResult = await stopGeminiProxyServer();
    const hadBackup = hasBackup();

    // 3. 恢复单渠道模式
    // 不恢复整个备份，避免覆盖用户在动态切换期间对 MCP 等配置的修改
    if (hadBackup) {
      deleteBackup();
      console.log('[Gemini Proxy] Discarded backup (MCP changes preserved)');
    }

    // 停止动态切换后回到单渠道模式：保留激活渠道，禁用其他渠道
    if (activeChannel) {
      const { applyChannelToSettings } = require('../services/gemini-channels');
      applyChannelToSettings(activeChannel.id);
      console.log(`[Gemini Proxy] Single-channel mode restored: ${activeChannel.name}`);
    }

    // 删除 gemini-active-channel.json
    removeActiveChannelFile();

    res.json({
      success: true,
      message: `Gemini proxy stopped, settings restored${activeChannel ? ' (channel: ' + activeChannel.name + ')' : ''}`,
      port: proxyResult.port,
      restoredChannel: activeChannel?.name
    });

    const { broadcastProxyState } = require('../websocket-server');
    const proxyStatus = getGeminiProxyStatus();
    const { channels: latestChannels } = getChannels();
    const latestActiveChannel = latestChannels.find(ch => ch.enabled !== false) || null;
    broadcastProxyState('gemini', proxyStatus, latestActiveChannel, latestChannels);
  } catch (error) {
    console.error('[Gemini Proxy] Error stopping proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
