const express = require('express');
const router = express.Router();
const { startProxyServer, stopProxyServer, getProxyStatus } = require('../proxy-server');
const {
  setProxyConfig,
  restoreSettings,
  deleteBackup,
  isProxyConfig,
  getCurrentProxyPort,
  settingsExists,
  hasBackup,
  readSettings
} = require('../services/settings-manager');
const { getAllChannels, markChannelAsRecentlyUsed, extractApiKeyFromHelper } = require('../services/channels');
const { clearNativeOAuth } = require('../services/native-oauth-adapters');
const { clearAllLogs } = require('../websocket-server');
const { PATHS, NATIVE_PATHS, ensureStorageDirMigrated } = require('../../config/paths');
const fs = require('fs');
const path = require('path');

function sanitizeChannelForResponse(channel) {
  if (!channel) return null;
  return {
    id: channel.id,
    name: channel.name,
    baseUrl: channel.baseUrl,
    websiteUrl: channel.websiteUrl
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
  const filePath = PATHS.activeChannel.claude;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
}


// 加载上次激活的渠道ID
function loadActiveChannelId() {
  ensureStorageDirMigrated();
  const filePath = PATHS.activeChannel.claude;
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      return data.activeChannelId || null;
    }
  } catch (error) {
    console.error('[Proxy] Error loading active channel ID:', error);
  }
  return null;
}

// 从 settings.json 找到当前激活的渠道（多级回退策略）
function findActiveChannelFromSettings() {
  try {
    const settings = readSettings();
    const baseUrl = settings?.env?.ANTHROPIC_BASE_URL || '';
    const { readNativeOAuth } = require('../services/native-oauth-adapters');
    const nativeOAuth = readNativeOAuth('claude');

    // 兼容多种 API Key 格式（与 channels.js 保持一致）
    let apiKey = settings?.env?.ANTHROPIC_API_KEY || '';
    if (!apiKey && !nativeOAuth) {
      apiKey = settings?.env?.ANTHROPIC_AUTH_TOKEN || '';
    }

    // 如果 apiKey 仍为空，尝试从 apiKeyHelper 提取
    if (!apiKey && settings?.apiKeyHelper) {
      apiKey = extractApiKeyFromHelper(settings.apiKeyHelper);
    }

    const channels = getAllChannels();

    // Level 1: Exact match (baseUrl + apiKey)
    if (baseUrl && apiKey && !baseUrl.includes('127.0.0.1')) {
      let matchingChannel = channels.find(ch =>
        ch.baseUrl === baseUrl && ch.apiKey === apiKey
      );
      if (matchingChannel) {
        console.log(`[Proxy] Level 1 - Exact match: ${matchingChannel.name}`);
        return matchingChannel;
      }

      // Level 2: Match by baseUrl only (when apiKey differs)
      matchingChannel = channels.find(ch => ch.baseUrl === baseUrl);
      if (matchingChannel) {
        console.log(`[Proxy] Level 2 - Matched by baseUrl only: ${matchingChannel.name}`);
        return matchingChannel;
      }
    } else {
      console.log('[Proxy] settings.json has no valid baseUrl/apiKey, falling back to channel list');
    }

    // Level 3: Use active-channel.json for last known active channel
    const activeChannelId = loadActiveChannelId();
    if (activeChannelId) {
      const matchingChannel = channels.find(ch => ch.id === activeChannelId);
      if (matchingChannel) {
        console.log(`[Proxy] Level 3 - Using last active channel: ${matchingChannel.name}`);
        return matchingChannel;
      }
    }

    // Level 4: Return first enabled channel as last resort
    const fallbackChannel = channels.find(ch => ch.enabled !== false);
    if (fallbackChannel) {
      console.log(`[Proxy] Level 4 - Using first enabled channel: ${fallbackChannel.name}`);
      return fallbackChannel;
    }

    console.log('[Proxy] No matching channel found after all fallback levels');
    return null;
  } catch (err) {
    console.error('[Proxy] Error finding active channel:', err);
    return null;
  }
}

// 获取代理状态
router.get('/status', (req, res) => {
  try {
    const proxyStatus = getProxyStatus();
    const channels = getAllChannels();
    const configStatus = {
      isProxyConfig: isProxyConfig(),
      settingsExists: settingsExists(),
      hasBackup: hasBackup(),
      currentProxyPort: getCurrentProxyPort()
    };

    res.json({
      proxy: proxyStatus,
      config: configStatus,
      channelsCount: channels.length,
      enabledChannelsCount: channels.filter(ch => ch.enabled !== false).length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动代理
router.post('/start', async (req, res) => {
  try {
    // 1. 检查配置文件是否存在
    if (!settingsExists()) {
      return res.status(400).json({
        error: 'Claude Code settings.json not found. Please run Claude Code at least once.'
      });
    }

    // Fix 4: Validate enabled channels count before starting proxy
    const allChannels = getAllChannels();
    const enabledCount = allChannels.filter(ch => ch.enabled !== false).length;
    if (enabledCount === 0) {
      return res.status(400).json({
        error: '没有启用的渠道。请至少启用一个渠道后再启动动态切换。'
      });
    }

    // 2. 从 settings.json 找到当前使用的渠道
    let currentChannel = findActiveChannelFromSettings();
    if (!currentChannel) {
      return res.status(400).json({
        error: '无法从 settings.json 识别当前渠道。请先激活一个渠道。'
      });
    }

    currentChannel = markChannelAsRecentlyUsed(currentChannel.id);

    // 3. 保存当前激活渠道ID（用于代理模式）
    saveActiveChannelId(currentChannel.id);
    console.log(`[OK] Saved active channel: ${currentChannel.name} (${currentChannel.id})`);

    // 4. 启动代理服务器
    const proxyResult = await startProxyServer();

    if (!proxyResult.success) {
      return res.status(500).json({ error: 'Failed to start proxy server' });
    }

    // 5. 设置代理配置（备份并修改 settings.json）
    clearNativeOAuth('claude');
    setProxyConfig(proxyResult.port);

    const updatedStatus = getProxyStatus();
    const channels = getAllChannels();
    const activeChannel = channels.find(ch => ch.id === currentChannel.id) || currentChannel;

    // 6. 通过 WebSocket 推送代理状态更新
    const { broadcastProxyState } = require('../websocket-server');
    broadcastProxyState('claude', updatedStatus, activeChannel, channels);

    res.json({
      success: true,
      port: proxyResult.port,
      activeChannel: sanitizeChannelForResponse(currentChannel),
      message: `代理已启动在端口 ${proxyResult.port}，当前渠道: ${currentChannel.name}`
    });
  } catch (error) {
    console.error('Error starting proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

// 停止代理
router.post('/stop', async (req, res) => {
  try {
    const channelsBeforeStop = getAllChannels();
    const activeChannelId = loadActiveChannelId();
    let restoredChannel = resolveActiveChannel(channelsBeforeStop, activeChannelId);

    // 1. 停止代理服务器
    const proxyResult = await stopProxyServer();
    const hadBackup = hasBackup();

    // 2. 恢复配置（优先恢复当前活动渠道，避免覆盖动态切换期间的设置变更）
    if (restoredChannel) {
      if (hadBackup) {
        deleteBackup();
        console.log('[OK] Discarded backup snapshot');
      }
    } else if (hadBackup) {
      restoreSettings();
      console.log('[OK] Restored settings from backup');
      const channels = getAllChannels();
      const currentSettings = require('../services/channels').getCurrentSettings();
      if (currentSettings) {
        restoredChannel = channels.find(ch =>
          ch.baseUrl === currentSettings.baseUrl && ch.apiKey === currentSettings.apiKey
        ) || null;
      }
    }

    // 停止动态切换后回到单渠道模式：保留激活渠道，禁用其他渠道
    if (restoredChannel) {
      const { applyChannelToSettings } = require('../services/channels');
      applyChannelToSettings(restoredChannel.id);
      console.log(`[OK] Single-channel mode restored: ${restoredChannel.name}`);
    }

    // 3. 删除备份文件和active-channel.json
    if (hadBackup && !restoredChannel) {
      const backupPath = NATIVE_PATHS.claude.settingsBackup;
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        console.log('[OK] Removed backup file');
      }
    }

    const activeChannelPath = PATHS.activeChannel.claude;
    if (fs.existsSync(activeChannelPath)) {
      fs.unlinkSync(activeChannelPath);
      console.log('[OK] Removed active-channel.json');
    }

    // 4. 通过 WebSocket 推送代理状态更新
    const { broadcastProxyState } = require('../websocket-server');
    const updatedStatus = getProxyStatus();
    const channels = getAllChannels();
    const activeChannel = channels.find(ch => ch.enabled !== false) || null;
    broadcastProxyState('claude', updatedStatus, activeChannel, channels);

    if (restoredChannel) {
      res.json({
        success: true,
        message: `代理已停止，配置已恢复到渠道: ${restoredChannel.name}`,
        port: proxyResult.port,
        restoredChannel: restoredChannel.name
      });
    } else {
      res.json({
        success: true,
        message: '代理已停止（无配置可恢复）',
        port: proxyResult.port
      });
    }
  } catch (error) {
    console.error('Error stopping proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

// 清空日志
router.post('/logs/clear', (req, res) => {
  try {
    clearAllLogs();
    res.json({ success: true, message: '日志已清空' });
  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
