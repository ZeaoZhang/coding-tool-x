const express = require('express');
const router = express.Router();
const {
  startOpenCodeProxyServer,
  stopOpenCodeProxyServer,
  getOpenCodeProxyStatus
} = require('../opencode-proxy-server');
const { getChannels, getEnabledChannels } = require('../services/opencode-channels');
const fs = require('fs');
const path = require('path');
const os = require('os');

function sanitizeChannel(channel) {
  if (!channel) return null;
  return {
    id: channel.id,
    name: channel.name,
    baseUrl: channel.baseUrl,
    websiteUrl: channel.websiteUrl
  };
}

// 保存激活渠道ID
function saveActiveChannelId(channelId) {
  const dir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, 'opencode-active-channel.json');
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
}

// 删除激活渠道文件
function removeActiveChannelFile() {
  const filePath = path.join(os.homedir(), '.claude', 'cc-tool', 'opencode-active-channel.json');
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log('[OpenCode Proxy] Removed opencode-active-channel.json');
  }
}

// 获取代理状态
router.get('/status', (req, res) => {
  try {
    const proxyStatus = getOpenCodeProxyStatus();
    const { channels } = getChannels();
    const enabledChannels = channels.filter(ch => ch.enabled !== false);
    const activeChannel = enabledChannels[0];

    res.json({
      proxy: proxyStatus,
      activeChannel: sanitizeChannel(activeChannel),
      enabledChannelsCount: enabledChannels.length,
      totalChannelsCount: channels.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动代理
router.post('/start', async (req, res) => {
  try {
    // 1. 获取当前启用的渠道
    const enabledChannels = getEnabledChannels();
    const currentChannel = enabledChannels[0];

    if (!currentChannel) {
      return res.status(400).json({
        error: 'No enabled OpenCode channel found. Please create and enable a channel first.'
      });
    }

    // 2. 保存当前激活渠道ID
    saveActiveChannelId(currentChannel.id);
    console.log(`[OpenCode Proxy] Saved active channel: ${currentChannel.name} (${currentChannel.id})`);

    // 3. 启动代理服务器
    const proxyResult = await startOpenCodeProxyServer();

    if (!proxyResult.success) {
      return res.status(500).json({ error: 'Failed to start OpenCode proxy server' });
    }

    // 4. 广播状态更新
    const { broadcastProxyState } = require('../websocket-server');
    const updatedStatus = getOpenCodeProxyStatus();
    const { channels: allChannels } = getChannels();
    broadcastProxyState('opencode', updatedStatus, currentChannel, allChannels);

    res.json({
      success: true,
      port: proxyResult.port,
      activeChannel: sanitizeChannel(currentChannel),
      message: `OpenCode proxy started on port ${proxyResult.port}, active channel: ${currentChannel.name}`
    });
  } catch (error) {
    console.error('[OpenCode Proxy] Error starting proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

// 停止代理
router.post('/stop', async (req, res) => {
  try {
    // 1. 获取当前渠道信息
    const { channels } = getChannels();
    const enabledChannels = channels.filter(ch => ch.enabled !== false);
    const activeChannel = enabledChannels[0];

    // 2. 停止代理服务器
    const proxyResult = await stopOpenCodeProxyServer();

    // 3. 删除激活渠道文件
    removeActiveChannelFile();

    // 4. 广播状态更新
    const { broadcastProxyState } = require('../websocket-server');
    const updatedStatus = getOpenCodeProxyStatus();
    broadcastProxyState('opencode', updatedStatus, activeChannel, channels);

    res.json({
      success: true,
      message: `OpenCode proxy stopped${activeChannel ? ' (channel: ' + activeChannel.name + ')' : ''}`,
      port: proxyResult.port
    });
  } catch (error) {
    console.error('[OpenCode Proxy] Error stopping proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
