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
  hasBackup
} = require('../services/codex-settings-manager');
const { getChannels, getEnabledChannels } = require('../services/codex-channels');
const { clearAllLogs } = require('../websocket-server');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

// 保存激活渠道ID
function saveActiveChannelId(channelId) {
  const dir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, 'codex-active-channel.json');
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
}

// 获取代理状态
router.get('/status', (req, res) => {
  try {
    const proxyStatus = getCodexProxyStatus();
    const { channels } = getChannels();
    const enabledChannels = channels.filter(ch => ch.enabled !== false);
    const activeChannel = enabledChannels[0]; // 多渠道模式：第一个启用的渠道
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

    // 2. 获取当前启用的渠道（多渠道模式）
    const enabledChannels = getEnabledChannels();
    const currentChannel = enabledChannels[0];
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
    // 1. 获取当前启用的渠道（多渠道模式）
    const { channels } = getChannels();
    const enabledChannels = channels.filter(ch => ch.enabled !== false);
    const activeChannel = enabledChannels[0];

    // 2. 停止代理服务器
    const proxyResult = await stopCodexProxyServer();

    // 3. 恢复原始配置
    const { broadcastProxyState } = require('../websocket-server');

    if (hasBackup()) {
      restoreSettings();
      console.log('[Codex Proxy] Restored settings from backup');

      // 删除 active-channel.json
      const activeChannelPath = path.join(os.homedir(), '.claude', 'cc-tool', 'codex-active-channel.json');
      if (fs.existsSync(activeChannelPath)) {
        fs.unlinkSync(activeChannelPath);
        console.log('[Codex Proxy] Removed codex-active-channel.json');
      }

      const response = {
        success: true,
        message: `Codex proxy stopped, settings restored${activeChannel ? ' (channel: ' + activeChannel.name + ')' : ''}`,
        port: proxyResult.port,
        restoredChannel: activeChannel?.name
      };
      res.json(response);

      const updatedStatus = getCodexProxyStatus();
      broadcastProxyState('codex', updatedStatus, activeChannel, channels);
    } else {
      res.json({
        success: true,
        message: 'Codex proxy stopped (no backup to restore)',
        port: proxyResult.port
      });

      const updatedStatus = getCodexProxyStatus();
      broadcastProxyState('codex', updatedStatus, activeChannel, channels);
    }
  } catch (error) {
    console.error('[Codex Proxy] Error stopping proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
