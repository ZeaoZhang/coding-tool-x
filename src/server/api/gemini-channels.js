const express = require('express');
const router = express.Router();
const {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  getEnabledChannels,
  saveChannelOrder
} = require('../services/gemini-channels');
const { getSchedulerState } = require('../services/channel-scheduler');
const { getChannelHealthStatus, resetChannelHealth } = require('../services/channel-health');
const { broadcastSchedulerState } = require('../websocket-server');
const { isGeminiInstalled } = require('../services/gemini-config');
const {
  testChannelSpeed,
  getLatencyLevel,
  sanitizeBatchConcurrency,
  runWithConcurrencyLimit
} = require('../services/speed-test');
const { clearGeminiRedirectCache } = require('../gemini-proxy-server');
const {
  probeModelAvailability,
  fetchModelsFromProvider
} = require('../services/model-detector');
const GEMINI_GATEWAY_SOURCE_TYPE = 'gemini';

module.exports = (config) => {
  /**
   * GET /api/gemini/channels
   * 获取所有 Gemini 渠道（包含健康状态）
   */
  router.get('/', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.json({
          channels: [],
          error: 'Gemini CLI not installed'
        });
      }

      const data = getChannels();
      // 为每个渠道添加健康状态
      const channelsWithHealth = (data.channels || []).map(ch => ({
        ...ch,
        health: getChannelHealthStatus(ch.id, 'gemini')
      }));
      res.json({ channels: channelsWithHealth });
    } catch (err) {
      console.error('[Gemini Channels API] Failed to get channels:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/gemini/channels/:id/models
   * 获取渠道可用模型列表
   */
  router.get('/:id/models', async (req, res) => {
    try {
      const { id } = req.params;
      const channels = getChannels().channels || [];
      const channel = channels.find(ch => ch.id === id);

      if (!channel) {
        return res.status(404).json({ error: '渠道不存在' });
      }

      const gatewaySourceType = GEMINI_GATEWAY_SOURCE_TYPE;
      const listResult = await fetchModelsFromProvider(channel, 'openai_compatible');
      const listedModels = Array.isArray(listResult.models) ? listResult.models : [];
      let result;

      if (listedModels.length > 0) {
        result = {
          models: listedModels,
          supported: true,
          cached: !!listResult.cached,
          fallbackUsed: false,
          lastChecked: listResult.lastChecked || new Date().toISOString(),
          error: null,
          errorHint: null
        };
      } else {
        const usingConfiguredProbe = !!listResult.disabledByConfig;
        const probe = await probeModelAvailability(channel, gatewaySourceType, {
          stopOnFirstAvailable: false
        });
        const probedModels = Array.isArray(probe.availableModels) ? probe.availableModels : [];

        result = {
          models: probedModels,
          supported: probedModels.length > 0,
          cached: !!probe.cached || !!listResult.cached,
          fallbackUsed: false,
          lastChecked: probe.lastChecked || listResult.lastChecked || new Date().toISOString(),
          error: probedModels.length > 0 ? null : (listResult.error || '无法获取可用模型'),
          errorHint: probedModels.length > 0
            ? (usingConfiguredProbe ? '已按设置跳过 /v1/models，使用默认模型探测结果' : '模型列表接口不可用，已自动切换为模型探测结果')
            : (listResult.errorHint || (usingConfiguredProbe
              ? '已按设置跳过 /v1/models，且默认模型探测无可用结果'
              : '模型列表接口不可用且模型探测无可用结果'))
        };
      }

      res.json({
        channelId: id,
        gatewaySourceType,
        models: result.models,
        supported: result.supported,
        cached: result.cached,
        fallbackUsed: result.fallbackUsed,
        fetchedAt: result.lastChecked || new Date().toISOString(),
        error: result.error,
        errorHint: result.errorHint
      });
    } catch (error) {
      console.error('[Gemini Channels API] Error fetching models:', error);
      res.status(500).json({
        error: '获取模型列表失败',
        channelId: req.params.id
      });
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

      const {
        name,
        baseUrl,
        apiKey,
        model,
        websiteUrl,
        enabled,
        weight,
        maxConcurrency,
        modelRedirects,
        speedTestModel,
        presetId,
        gatewaySourceType
      } = req.body;

      if (!name || !baseUrl) {
        return res.status(400).json({ error: 'Missing required fields: name, baseUrl' });
      }

      if (!apiKey) {
        return res.status(400).json({ error: 'Missing required fields: apiKey' });
      }

      const channel = createChannel(name, baseUrl, apiKey, model || 'gemini-2.5-pro', {
        websiteUrl,
        enabled,
        weight,
        maxConcurrency,
        modelRedirects: modelRedirects || [],
        speedTestModel: speedTestModel || null,
        presetId: presetId || null,
        gatewaySourceType
      });
      res.json(channel);
      broadcastSchedulerState('gemini', getSchedulerState('gemini'));
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
      // 清除该渠道的模型重定向日志缓存，使下次请求时重新打印
      clearGeminiRedirectCache(channelId);
      res.json(channel);
      broadcastSchedulerState('gemini', getSchedulerState('gemini'));
    } catch (err) {
      console.error('[Gemini Channels API] Failed to update channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/gemini/channels/:channelId
   * 删除渠道
   */
  router.delete('/:channelId', async (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { channelId } = req.params;
      const result = await deleteChannel(channelId);
      res.json(result);
      broadcastSchedulerState('gemini', getSchedulerState('gemini'));
    } catch (err) {
      console.error('[Gemini Channels API] Failed to delete channel:', err);
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
   * GET /api/gemini/channels/enabled
   * 获取所有启用的渠道（供调度器使用）
   */
  router.get('/enabled', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.json({ channels: [] });
      }

      const channels = getEnabledChannels();
      res.json({ channels });
    } catch (err) {
      console.error('[Gemini Channels API] Failed to get enabled channels:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/gemini/channels/:channelId/speed-test
   * 测试单个渠道速度
   */
  router.post('/:channelId/speed-test', async (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { channelId } = req.params;
      const { timeout = 10000 } = req.body;
      const data = getChannels();
      const channel = data.channels.find(ch => ch.id === channelId);

      if (!channel) {
        return res.status(404).json({ error: '渠道不存在' });
      }

      const speedTestType = GEMINI_GATEWAY_SOURCE_TYPE;
      const result = await testChannelSpeed(channel, timeout, speedTestType);
      result.level = getLatencyLevel(result.latency);
      result.gatewaySourceType = speedTestType;

      res.json(result);
    } catch (error) {
      console.error('[Gemini Channels API] Error testing channel speed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/gemini/channels/speed-test-all
   * 测试所有渠道速度
   */
  router.post('/speed-test-all', async (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.json({ results: [], message: 'Gemini CLI not installed' });
      }

      const { timeout = 10000, concurrency } = req.body || {};
      const data = getChannels();
      const channels = data.channels || [];
      const safeConcurrency = sanitizeBatchConcurrency(concurrency);

      if (channels.length === 0) {
        return res.json({ results: [], message: '没有可测试的渠道' });
      }

      const results = await runWithConcurrencyLimit(
        channels,
        safeConcurrency,
        async channel => {
          const speedTestType = GEMINI_GATEWAY_SOURCE_TYPE;
          const result = await testChannelSpeed(channel, timeout, speedTestType);
          result.level = getLatencyLevel(result.latency);
          result.gatewaySourceType = speedTestType;
          return result;
        }
      );

      // 成功在前，成功结果按延迟升序
      results.sort((a, b) => {
        if (a.success && !b.success) return -1;
        if (!a.success && b.success) return 1;
        if (a.success && b.success) {
          const aLatency = (a.latency === null || a.latency === undefined) ? Infinity : a.latency;
          const bLatency = (b.latency === null || b.latency === undefined) ? Infinity : b.latency;
          return aLatency - bLatency;
        }
        return 0;
      });

      res.json({
        results,
        summary: {
          total: results.length,
          success: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          avgLatency: calculateAvgLatency(results),
          concurrency: safeConcurrency
        }
      });
    } catch (error) {
      console.error('[Gemini Channels API] Error testing all channels speed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/gemini/channels/:channelId/reset-health
   * 重置渠道健康状态
   */
  router.post('/:channelId/reset-health', (req, res) => {
    try {
      if (!isGeminiInstalled()) {
        return res.status(404).json({ error: 'Gemini CLI not installed' });
      }

      const { channelId } = req.params;
      resetChannelHealth(channelId, 'gemini');
      broadcastSchedulerState('gemini', getSchedulerState('gemini'));

      res.json({
        success: true,
        message: '渠道健康状态已重置',
        health: getChannelHealthStatus(channelId, 'gemini')
      });
    } catch (error) {
      console.error('[Gemini Channels API] Error resetting channel health:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};

// 计算平均延迟
function calculateAvgLatency(results) {
  const successResults = results.filter(
    r => r.success && r.latency !== null && r.latency !== undefined
  );
  if (successResults.length === 0) return null;
  const sum = successResults.reduce((acc, r) => acc + r.latency, 0);
  return Math.round(sum / successResults.length);
}
