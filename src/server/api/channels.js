const express = require('express');
const router = express.Router();
const {
  getAllChannels,
  applyChannelToSettings,
  createChannel,
  updateChannel,
  deleteChannel,
  getCurrentSettings,
  getBestChannelForRestore
} = require('../services/channels');
const { broadcastLog, broadcastProxyState } = require('../websocket-server');

// GET /api/channels - Get all channels
router.get('/', (req, res) => {
  try {
    const channels = getAllChannels();
    res.json({ channels });
  } catch (error) {
    console.error('Error fetching channels:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/channels/current - Get current settings
router.get('/current', (req, res) => {
  try {
    const settings = getCurrentSettings();
    const channels = getAllChannels();
    let currentChannel = null;

    if (settings) {
      currentChannel = channels.find(ch =>
        ch.baseUrl === settings.baseUrl && ch.apiKey === settings.apiKey
      );
    }

    res.json({ channel: currentChannel, settings });
  } catch (error) {
    console.error('Error fetching current settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/channels - Create new channel
router.post('/', (req, res) => {
  try {
    const { name, baseUrl, apiKey, websiteUrl, enabled, weight, maxConcurrency } = req.body;

    if (!name || !baseUrl || !apiKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const channel = createChannel(name, baseUrl, apiKey, websiteUrl, {
      enabled,
      weight,
      maxConcurrency
    });
    res.json({ channel });
  } catch (error) {
    console.error('Error creating channel:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/channels/:id - Update channel
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const channel = updateChannel(id, updates);
    res.json({ channel });
  } catch (error) {
    console.error('Error updating channel:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/channels/:id - Delete channel
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = deleteChannel(id);
    res.json(result);
  } catch (error) {
    console.error('Error deleting channel:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/apply-to-settings', async (req, res) => {
  try {
    const { id } = req.params;
    const channel = applyChannelToSettings(id);

    // Check if proxy is running
    const { getProxyStatus } = require('../proxy-server');
    const proxyStatus = getProxyStatus();

    broadcastLog({
      type: 'action',
      action: 'apply_settings',
      message: `已将 (${channel.name}) 渠道写入配置文件中`,
      channelName: channel.name,
      timestamp: Date.now(),
      source: 'claude'
    });

    // Stop proxy if running
    if (proxyStatus && proxyStatus.running) {
      console.log(`Proxy is running, stopping to apply channel settings: ${channel.name}`);

      // Stop proxy and restore backup
      const { stopProxyServer } = require('../proxy-server');
      await stopProxyServer({ clearStartTime: false });

      console.log(`✅ 已停���动态切换，默认使用当前渠道`);
      broadcastLog({
        type: 'action',
        action: 'stop_proxy',
        message: `已停止动态切换，默认使用当前渠道`,
        timestamp: Date.now(),
        source: 'claude'
      });

      // 广播代理状态更新，通知前端代理已停止
      const { broadcastProxyState } = require('../websocket-server');
      broadcastProxyState('claude', {
        running: false,
        port: null,
        runtime: null,
        startTime: null
      }, null, getAllChannels());
    }

    res.json({
      message: `已将 (${channel.name}) 渠道写入配置文件中`,
      channel
    });
  } catch (error) {
    console.error('Error applying channel to settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/channels/best-for-restore - Get best channel for restore
router.get('/best-for-restore', (req, res) => {
  try {
    const channel = getBestChannelForRestore();
    res.json({ channel });
  } catch (error) {
    console.error('Error getting best channel for restore:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
