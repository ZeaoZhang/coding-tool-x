const express = require('express');
const router = express.Router();
const {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  saveChannelOrder
} = require('../services/opencode-channels');
const { isOpenCodeInstalled } = require('../services/opencode-sessions');
const { getSchedulerState } = require('../services/channel-scheduler');
const { getChannelHealthStatus, resetChannelHealth } = require('../services/channel-health');
const { broadcastSchedulerState } = require('../websocket-server');
const { testChannelSpeed, testMultipleChannels } = require('../services/speed-test');
const { clearOpenCodeRedirectCache } = require('../opencode-proxy-server');
const { fetchModelsFromProvider } = require('../services/model-detector');

module.exports = (config) => {
  /**
   * GET /api/opencode/channels
   * 获取所有 OpenCode 渠道
   */
  router.get('/', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.json({
          channels: [],
          installed: false,
          error: 'OpenCode CLI not installed'
        });
      }
      const data = getChannels();
      const channelsWithHealth = (data.channels || []).map(ch => ({
        ...ch,
        health: getChannelHealthStatus(ch.id, 'opencode')
      }));
      res.json({ channels: channelsWithHealth, installed: true });
    } catch (err) {
      console.error('[OpenCode Channels API] Failed to get channels:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/opencode/channels/enabled
   * 获取所有已启用的 OpenCode 渠道
   */
  router.get('/enabled', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.json({
          channels: [],
          installed: false,
          error: 'OpenCode CLI not installed'
        });
      }
      const data = getChannels();
      const enabledChannels = (data.channels || []).filter(ch => ch.enabled !== false);
      const channelsWithHealth = enabledChannels.map(ch => ({
        ...ch,
        health: getChannelHealthStatus(ch.id, 'opencode')
      }));
      res.json({ channels: channelsWithHealth, installed: true });
    } catch (err) {
      console.error('[OpenCode Channels API] Failed to get enabled channels:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/opencode/channels/:channelId/models
   * 获取渠道可用模型列表
   */
  router.get('/:channelId/models', async (req, res) => {
    try {
      const { channelId } = req.params;
      const channels = getChannels().channels || [];
      const channel = channels.find(ch => ch.id === channelId);

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const result = await fetchModelsFromProvider(channel, 'openai_compatible');

      res.json({
        channelId: channelId,
        models: result.models,
        supported: result.supported,
        cached: result.cached,
        fallbackUsed: result.fallbackUsed,
        fetchedAt: result.lastChecked || new Date().toISOString(),
        error: result.error,
        errorHint: result.errorHint
      });
    } catch (error) {
      console.error('[OpenCode Channels API] Error fetching models:', error);
      res.status(500).json({
        error: 'Failed to fetch model list',
        channelId: req.params.channelId
      });
    }
  });

  /**
   * POST /api/opencode/channels
   * 创建新渠道
   */
  router.post('/', (req, res) => {
    try {
      const { name, baseUrl, apiKey, wireApi, enabled, weight, maxConcurrency, model, authType, oauthProvider, oauthTokenId, presetId, websiteUrl } = req.body;

      if (!name || !baseUrl) {
        return res.status(400).json({ error: 'Missing required fields: name and baseUrl' });
      }

      // apiKey 可以为空（OAuth 认证时）
      if (!apiKey && authType !== 'oauth') {
        return res.status(400).json({ error: 'API Key is required for non-OAuth channels' });
      }

      const channel = createChannel(name, baseUrl, apiKey || '', {
        wireApi: wireApi || 'openai',
        enabled,
        weight,
        maxConcurrency,
        model,
        authType: authType || 'apiKey',
        oauthProvider,
        oauthTokenId,
        presetId,
        websiteUrl
      });

      res.json(channel);
      broadcastSchedulerState('opencode', getSchedulerState('opencode'));
    } catch (err) {
      console.error('[OpenCode Channels API] Failed to create channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/opencode/channels/:channelId
   * 更新渠道
   */
  router.put('/:channelId', (req, res) => {
    try {
      const { channelId } = req.params;
      const updates = req.body;

      const channel = updateChannel(channelId, updates);
      clearOpenCodeRedirectCache(channelId);
      res.json(channel);
      broadcastSchedulerState('opencode', getSchedulerState('opencode'));
    } catch (err) {
      console.error('[OpenCode Channels API] Failed to update channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/opencode/channels/:channelId
   * 删除渠道
   */
  router.delete('/:channelId', (req, res) => {
    try {
      const { channelId } = req.params;
      const result = deleteChannel(channelId);
      res.json(result);
      broadcastSchedulerState('opencode', getSchedulerState('opencode'));
    } catch (err) {
      console.error('[OpenCode Channels API] Failed to delete channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/opencode/channels/order
   * 保存渠道顺序
   */
  router.post('/order', (req, res) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'Order must be an array' });
      }
      saveChannelOrder(order);
      res.json({ success: true });
      broadcastSchedulerState('opencode', getSchedulerState('opencode'));
    } catch (err) {
      console.error('[OpenCode Channels API] Failed to save order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/opencode/channels/:channelId/reset-health
   * 重置渠道健康状态
   */
  router.post('/:channelId/reset-health', (req, res) => {
    try {
      const { channelId } = req.params;
      resetChannelHealth(channelId, 'opencode');
      res.json({ success: true });
      broadcastSchedulerState('opencode', getSchedulerState('opencode'));
    } catch (err) {
      console.error('[OpenCode Channels API] Failed to reset health:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/opencode/channels/:channelId/speed-test
   * 测试渠道速度
   */
  router.post('/:channelId/speed-test', async (req, res) => {
    try {
      const { channelId } = req.params;
      const { timeout = 20000 } = req.body;

      const channels = getChannels().channels || [];
      const channel = channels.find(ch => ch.id === channelId);

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const result = await testChannelSpeed(channel, 'opencode', timeout);
      res.json(result);
    } catch (error) {
      console.error('[OpenCode Channels API] Speed test failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/opencode/channels/speed-test-all
   * 测试所有渠道速度
   */
  router.post('/speed-test-all', async (req, res) => {
    try {
      const { timeout = 20000 } = req.body;
      const channels = getChannels().channels || [];

      const results = await testMultipleChannels(channels, 'opencode', timeout);
      
      // 添加摘要统计
      const successResults = results.filter(r => r.success);
      const summary = {
        total: results.length,
        success: successResults.length,
        failed: results.length - successResults.length,
        avgLatency: successResults.length > 0 
          ? Math.round(successResults.reduce((sum, r) => sum + (r.latency || 0), 0) / successResults.length)
          : 0
      };
      
      res.json({ results, summary });
    } catch (error) {
      console.error('[OpenCode Channels API] Speed test all failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
