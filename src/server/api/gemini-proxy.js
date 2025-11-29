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
  isProxyConfig,
  getCurrentProxyPort,
  configExists,
  hasBackup
} = require('../services/gemini-settings-manager');
const { getChannels, getEnabledChannels } = require('../services/gemini-channels');
const fs = require('fs');
const path = require('path');
const os = require('os');

function sanitizeChannel(channel) {
  if (!channel) return null;
  const { apiKey, ...rest } = channel;
  return rest;
}

// 保存激活渠道ID
function saveActiveChannelId(channelId) {
  const dir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, 'gemini-active-channel.json');
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
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
    const enabledChannels = channels.filter(ch => ch.enabled !== false);
    const activeChannel = enabledChannels[0]; // 多渠道模式：第一个启用的渠道

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

    // 2. 获取当前启用的渠道（多渠道模式）
    const enabledChannels = getEnabledChannels();
    const currentChannel = enabledChannels[0];
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
    // 1. 获取当前启用的渠道（多渠道模式）
    const { channels } = getChannels();
    const enabledChannels = channels.filter(ch => ch.enabled !== false);
    const activeChannel = enabledChannels[0];

    // 2. 停止代理服务器
    const proxyResult = await stopGeminiProxyServer();

    // 3. 恢复原始配置
    const { broadcastProxyState } = require('../websocket-server');
    if (hasBackup()) {
      restoreSettings();
      console.log('[Gemini Proxy] Restored settings from backup');

      // 删除 gemini-active-channel.json
      const activeChannelPath = path.join(os.homedir(), '.claude', 'cc-tool', 'gemini-active-channel.json');
      if (fs.existsSync(activeChannelPath)) {
        fs.unlinkSync(activeChannelPath);
        console.log('[Gemini Proxy] Removed gemini-active-channel.json');
      }

      const response = {
        success: true,
        message: `Gemini proxy stopped, settings restored${activeChannel ? ' (channel: ' + activeChannel.name + ')' : ''}`,
        port: proxyResult.port,
        restoredChannel: activeChannel?.name
      };
      res.json(response);
    } else {
      res.json({
        success: true,
        message: 'Gemini proxy stopped (no backup to restore)',
        port: proxyResult.port
      });
    }

    const proxyStatus = getGeminiProxyStatus();
    const { channels: latestChannels } = getChannels();
    broadcastProxyState('gemini', proxyStatus, activeChannel, latestChannels);
  } catch (error) {
    console.error('[Gemini Proxy] Error stopping proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
