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
const { testChannelSpeed } = require('../services/speed-test');
const { clearOpenCodeRedirectCache } = require('../opencode-proxy-server');
const {
  fetchModelsFromProvider,
  probeModelAvailability,
  getModelPriority
} = require('../services/model-detector');

module.exports = (config) => {
  function uniqueModels(models = []) {
    const seen = new Set();
    const result = [];
    models.forEach((model) => {
      if (typeof model !== 'string') return;
      const trimmed = model.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(trimmed);
    });
    return result;
  }

  function collectChannelPreferredModels(channel) {
    const candidates = [];
    if (!channel || typeof channel !== 'object') return candidates;

    candidates.push(channel.model);
    candidates.push(channel.speedTestModel);

    const modelConfig = channel.modelConfig;
    if (modelConfig && typeof modelConfig === 'object') {
      candidates.push(modelConfig.model);
      candidates.push(modelConfig.opusModel);
      candidates.push(modelConfig.sonnetModel);
      candidates.push(modelConfig.haikuModel);
    }

    if (Array.isArray(channel.modelRedirects)) {
      channel.modelRedirects.forEach((rule) => {
        candidates.push(rule?.from);
        candidates.push(rule?.to);
      });
    }

    return uniqueModels(candidates);
  }

  function resolveGatewaySourceType(channel) {
    const value = String(channel?.gatewaySourceType || '').trim().toLowerCase();
    if (value === 'claude') return 'claude';
    if (value === 'gemini') return 'gemini';
    return 'codex';
  }

  function mapGatewaySourceTypeToSpeedTestType(channel) {
    return resolveGatewaySourceType(channel);
  }

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

      const gatewaySourceType = resolveGatewaySourceType(channel);
      const preferredModels = collectChannelPreferredModels(channel);
      let result;

      if (gatewaySourceType === 'codex') {
        const listResult = await fetchModelsFromProvider(channel, 'openai_compatible');
        const listedModels = Array.isArray(listResult.models) ? listResult.models : [];

        if (listedModels.length > 0) {
          result = listResult;
        } else {
          const probe = await probeModelAvailability(channel, 'codex', {
            stopOnFirstAvailable: true,
            preferredModels
          });
          const probedModels = Array.isArray(probe.availableModels) ? probe.availableModels : [];
          const fallbackModels = uniqueModels([...preferredModels, ...getModelPriority('codex')]);

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
            result = {
              models: fallbackModels,
              supported: false,
              cached: !!probe.cached || !!listResult.cached,
              fallbackUsed: true,
              lastChecked: probe.lastChecked || listResult.lastChecked || new Date().toISOString(),
              error: listResult.error || '无法探测到可用模型',
              errorHint: listResult.errorHint || '已回退到默认模型候选，请确认网关入口类型与 API Key 权限'
            };
          }
        }
      } else {
        const probe = await probeModelAvailability(channel, gatewaySourceType, {
          stopOnFirstAvailable: true,
          preferredModels
        });
        const probedModels = Array.isArray(probe.availableModels) ? probe.availableModels : [];
        const fallbackModels = uniqueModels([
          ...preferredModels,
          ...getModelPriority(gatewaySourceType)
        ]);
        const models = probedModels.length > 0 ? probedModels : fallbackModels;

        result = {
          models,
          supported: probedModels.length > 0,
          cached: !!probe.cached,
          fallbackUsed: probedModels.length === 0,
          lastChecked: probe.lastChecked || new Date().toISOString(),
          error: probedModels.length > 0 ? null : '无法探测到可用模型',
          errorHint: probedModels.length > 0
            ? null
            : '已回退到默认模型候选，请确认网关入口类型与 API Key 权限'
        };
      }

      res.json({
        channelId: channelId,
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
      const {
        name,
        baseUrl,
        apiKey,
        wireApi,
        enabled,
        weight,
        maxConcurrency,
        model,
        gatewaySourceType,
        modelRedirects,
        speedTestModel,
        presetId,
        websiteUrl
      } = req.body;

      if (!name || !baseUrl) {
        return res.status(400).json({ error: 'Missing required fields: name and baseUrl' });
      }

      if (!apiKey) {
        return res.status(400).json({ error: 'API Key is required' });
      }

      const channel = createChannel(name, baseUrl, apiKey, {
        wireApi: wireApi || 'openai',
        enabled,
        weight,
        maxConcurrency,
        model,
        gatewaySourceType,
        modelRedirects: modelRedirects || [],
        speedTestModel: speedTestModel || null,
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
  router.delete('/:channelId', async (req, res) => {
    try {
      const { channelId } = req.params;
      const result = await deleteChannel(channelId);
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

      const speedTestType = mapGatewaySourceTypeToSpeedTestType(channel);
      const result = await testChannelSpeed(channel, timeout, speedTestType);
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
      const results = await Promise.all(
        channels.map(channel => {
          const speedTestType = mapGatewaySourceTypeToSpeedTestType(channel);
          return testChannelSpeed(channel, timeout, speedTestType);
        })
      );

      // 与 testMultipleChannels 保持一致的排序：成功在前，成功按延迟升序
      results.sort((a, b) => {
        if (a.success && !b.success) return -1;
        if (!a.success && b.success) return 1;
        if (a.success && b.success) return (a.latency || Infinity) - (b.latency || Infinity);
        return 0;
      });
      
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
