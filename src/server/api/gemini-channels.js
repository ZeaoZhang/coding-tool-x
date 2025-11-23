const express = require('express');
const router = express.Router();
const {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  activateChannel,
  getActiveChannel,
  saveChannelOrder
} = require('../services/gemini-channels');
const { isGeminiInstalled } = require('../services/gemini-config');

module.exports = (config) => {
  /**
   * GET /api/gemini/channels
   * 获取所有 Gemini 渠道
   */
  router.get('/', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.json({
          channels: [],
          activeChannelId: null,
          error: 'Gemini CLI not installed'
        });
      }

      const data = getChannels();
      res.json(data);
    } catch (err) {
      console.error('[Gemini Channels API] Failed to get channels:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/gemini/channels
   * 创建新渠道
   * Body: { name, baseUrl, apiKey, model, websiteUrl }
   */
  router.post('/', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { name, baseUrl, apiKey, model, websiteUrl } = req.body;

      if (!name || !baseUrl || !apiKey) {
        return res.status(400).json({ error: 'Missing required fields: name, baseUrl, apiKey' });
      }

      const channel = createChannel(name, baseUrl, apiKey, model || 'gemini-2.5-pro', { websiteUrl });
      res.json(channel);
    } catch (err) {
      console.error('[Gemini Channels API] Failed to create channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/gemini/channels/:channelId
   * 更新渠道
   */
  router.put('/:channelId', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { channelId } = req.params;
      const updates = req.body;

      const channel = updateChannel(channelId, updates);
      res.json(channel);
    } catch (err) {
      console.error('[Gemini Channels API] Failed to update channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/gemini/channels/:channelId
   * 删除渠道
   */
  router.delete('/:channelId', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { channelId } = req.params;
      const result = deleteChannel(channelId);
      res.json(result);
    } catch (err) {
      console.error('[Gemini Channels API] Failed to delete channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/gemini/channels/:channelId/activate
   * 激活渠道(切换)
   */
  router.post('/:channelId/activate', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { channelId } = req.params;
      const result = activateChannel(channelId);

      // 广播切换日志
      const { broadcastLog } = require('../websocket-server');
      broadcastLog({
        type: 'action',
        action: 'switch_gemini_channel',
        message: `切换到 Gemini 渠道: ${result.channel.name}`,
        channelId: result.channel.id,
        channelName: result.channel.name,
        timestamp: Date.now(),
        source: 'gemini'
      });

      res.json(result);
    } catch (err) {
      console.error('[Gemini Channels API] Failed to activate channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/gemini/channels/order
   * 保存渠道顺序
   */
  router.post('/order', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { order } = req.body;

      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }

      saveChannelOrder(order);
      res.json({ success: true });
    } catch (err) {
      console.error('[Gemini Channels API] Failed to save channel order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/gemini/channels/active
   * 获取当前激活的渠道
   */
  router.get('/active', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.json({ channel: null });
      }

      const channel = getActiveChannel();
      res.json({ channel });
    } catch (err) {
      console.error('[Gemini Channels API] Failed to get active channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
