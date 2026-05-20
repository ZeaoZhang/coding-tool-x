const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const {
  startPiProxyServer,
  stopPiProxyServer,
  getPiProxyStatus
} = require('../pi-proxy-server');
const {
  getChannels,
  getEnabledChannels,
  markChannelAsRecentlyUsed
} = require('../services/pi-channels');
const { getSchedulerState } = require('../services/channel-scheduler');
const { PATHS, ensureStorageDirMigrated } = require('../../config/paths');

function sanitizeChannel(channel) {
  if (!channel) return null;
  return {
    id: channel.id,
    name: channel.name,
    baseUrl: channel.baseUrl,
    websiteUrl: channel.websiteUrl
  };
}

function selectLatestEnabledChannel(channels) {
  const enabledChannels = (channels || []).filter(ch => ch.enabled !== false);
  if (enabledChannels.length === 0) return null;
  return enabledChannels.reduce((latest, current) => {
    const latestTs = Number(latest?.updatedAt || latest?.createdAt || 0);
    const currentTs = Number(current?.updatedAt || current?.createdAt || 0);
    return currentTs > latestTs ? current : latest;
  }, enabledChannels[0]);
}

function saveActiveChannelId(channelId) {
  ensureStorageDirMigrated();
  const filePath = PATHS.activeChannel.pi;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
}

function loadActiveChannelId() {
  ensureStorageDirMigrated();
  try {
    if (!fs.existsSync(PATHS.activeChannel.pi)) return null;
    const data = JSON.parse(fs.readFileSync(PATHS.activeChannel.pi, 'utf8'));
    return data.activeChannelId || null;
  } catch {
    return null;
  }
}

function removeActiveChannelFile() {
  ensureStorageDirMigrated();
  if (fs.existsSync(PATHS.activeChannel.pi)) {
    fs.unlinkSync(PATHS.activeChannel.pi);
  }
}

function resolveActiveChannel(channels, activeChannelId = null) {
  if (!Array.isArray(channels) || channels.length === 0) return null;
  if (activeChannelId) {
    const matched = channels.find(channel => channel.id === activeChannelId);
    if (matched) return matched;
  }
  return selectLatestEnabledChannel(channels)
    || channels.find(channel => channel.enabled !== false)
    || channels[0]
    || null;
}

router.get('/status', (req, res) => {
  try {
    const proxy = getPiProxyStatus();
    const { channels } = getChannels();
    const enabledChannels = channels.filter(ch => ch.enabled !== false);
    const activeChannel = resolveActiveChannel(channels, loadActiveChannelId());
    res.json({
      proxy,
      config: {
        mode: 'managed-provider-extension',
        nativeProxyProtocol: false
      },
      activeChannel: sanitizeChannel(activeChannel),
      enabledChannelsCount: enabledChannels.length,
      totalChannelsCount: channels.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/start', async (req, res) => {
  try {
    const enabledChannels = getEnabledChannels();
    if (enabledChannels.length === 0) {
      return res.status(400).json({
        error: 'No enabled Pi channel found. Please create and enable a channel first.'
      });
    }

    let currentChannel = selectLatestEnabledChannel(enabledChannels) || enabledChannels[0];
    currentChannel = markChannelAsRecentlyUsed(currentChannel.id);
    saveActiveChannelId(currentChannel.id);

    const proxyResult = await startPiProxyServer();
    if (!proxyResult.success) {
      return res.status(500).json({ error: 'Failed to start Pi managed provider extension' });
    }

    const { broadcastProxyState, broadcastSchedulerState } = require('../websocket-server');
    const updatedStatus = getPiProxyStatus();
    const { channels: latestChannels } = getChannels();
    const activeChannel = latestChannels.find(channel => channel.id === currentChannel.id) || currentChannel;
    broadcastProxyState('pi', updatedStatus, activeChannel, latestChannels);
    broadcastSchedulerState('pi', getSchedulerState('pi'));

    res.json({
      success: true,
      port: proxyResult.port,
      activeChannel: sanitizeChannel(activeChannel),
      mode: 'managed-provider-extension',
      message: `Pi managed provider extension enabled, active channel: ${activeChannel.name}`
    });
  } catch (error) {
    console.error('[Pi Proxy] Start failed:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/stop', async (req, res) => {
  try {
    const result = await stopPiProxyServer();
    removeActiveChannelFile();
    const { broadcastProxyState, broadcastSchedulerState } = require('../websocket-server');
    const { channels } = getChannels();
    broadcastProxyState('pi', getPiProxyStatus(), null, channels);
    broadcastSchedulerState('pi', getSchedulerState('pi'));
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Pi Proxy] Stop failed:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
