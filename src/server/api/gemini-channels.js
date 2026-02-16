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
const { testChannelSpeed, getLatencyLevel } = require('../services/speed-test');
const { clearGeminiRedirectCache } = require('../gemini-proxy-server');
const {
  fetchModelsFromProvider,
  probeModelAvailability,
  getModelPriority,
  detectChannelType
} = require('../services/model-detector');

function mapDetectedTypeToGatewayType(detectedType, fallback = 'gemini') {
  if (detectedType === 'claude') return 'claude';
  if (detectedType === 'codex') return 'codex';
  if (detectedType === 'gemini') return 'gemini';
  if (detectedType === 'openai_compatible') return 'codex';
  return fallback;
}

function resolveGatewaySourceType(channel) {
  const normalized = String(channel?.gatewaySourceType || '').trim().toLowerCase();
  if (normalized === 'claude') return 'claude';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'gemini') return 'gemini';

  const detected = detectChannelType(channel || {});
  return mapDetectedTypeToGatewayType(detected, 'gemini');
}

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

      const gatewaySourceType = resolveGatewaySourceType(channel);
      let result;

      if (gatewaySourceType === 'codex') {
        const listResult = await fetchModelsFromProvider(channel, 'openai_compatible');
        const listedModels = Array.isArray(listResult.models) ? listResult.models : [];

        if (listedModels.length > 0) {
          result = listResult;
        } else {
          const probe = await probeModelAvailability(channel, 'codex');
          const probedModels = Array.isArray(probe.availableModels) ? probe.availableModels : [];

          if (probedModels.length > 0) {
            result = {
              models: probedModels,
              supported: true,
              cached: !!probe.cached,
              fallbackUsed: false,
              lastChecked: probe.lastChecked || listResult.lastChecked || new Date().toISOString(),
              error: null,
              errorHint: listResult.error
                ? '模型列表接口不可用，已自动切换为模型探测结果'
                : null
            };
          } else {
            const fallbackModels = getModelPriority('codex');
            result = {
              models: fallbackModels,
              supported: false,
              cached: !!probe.cached || !!listResult.cached,
              fallbackUsed: true,
              lastChecked: probe.lastChecked || listResult.lastChecked || new Date().toISOString(),
              error: listResult.error || '无法探测可用模型，已使用默认模型列表',
              errorHint: listResult.errorHint || '该入口不支持模型列表接口，已回退到默认模型优先级'
            };
          }
        }
      } else {
        const probe = await probeModelAvailability(channel, gatewaySourceType);
        const probedModels = Array.isArray(probe.availableModels) ? probe.availableModels : [];
        const fallbackModels = getModelPriority(gatewaySourceType);
        const models = probedModels.length > 0 ? probedModels : fallbackModels;

        result = {
          models,
          supported: probedModels.length > 0,
          cached: !!probe.cached,
          fallbackUsed: probedModels.length === 0,
          lastChecked: probe.lastChecked || new Date().toISOString(),
          error: probedModels.length > 0 ? null : '无法探测可用模型，已使用默认模型列表',
          errorHint: probedModels.length > 0
            ? null
            : '该入口不支持模型列表接口，已回退到默认模型优先级'
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

      const speedTestType = resolveGatewaySourceType(channel);
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

      const { timeout = 10000 } = req.body;
      const data = getChannels();
      const channels = data.channels || [];

      if (channels.length === 0) {
        return res.json({ results: [], message: '没有可测试的渠道' });
      }

      const results = await Promise.all(
        channels.map(async channel => {
          const speedTestType = resolveGatewaySourceType(channel);
          const result = await testChannelSpeed(channel, timeout, speedTestType);
          result.level = getLatencyLevel(result.latency);
          result.gatewaySourceType = speedTestType;
          return result;
        })
      );

      // 成功在前，成功结果按延迟升序
      results.sort((a, b) => {
        if (a.success && !b.success) return -1;
        if (!a.success && b.success) return 1;
        if (a.success && b.success) return (a.latency || Infinity) - (b.latency || Infinity);
        return 0;
      });

      res.json({
        results,
        summary: {
          total: results.length,
          success: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          avgLatency: calculateAvgLatency(results)
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
  const successResults = results.filter(r => r.success && r.latency);
  if (successResults.length === 0) return null;
  const sum = successResults.reduce((acc, r) => acc + r.latency, 0);
  return Math.round(sum / successResults.length);
}
