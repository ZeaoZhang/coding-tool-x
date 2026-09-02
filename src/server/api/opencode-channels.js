const express = require('express');
const router = express.Router();
const {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  saveChannelOrder,
  syncCurrentOpenCodeChannel
} = require('../../platforms/drivers/opencode/channels-implementation');
const { isOpenCodeInstalled } = require('../../platforms/drivers/opencode/sessions-implementation');
const { getSchedulerState } = require('../services/channel-scheduler');
const { getChannelHealthStatus, resetChannelHealth } = require('../services/channel-health');
const { broadcastSchedulerState } = require('../websocket-server');
const {
  testChannelSpeed,
  sanitizeBatchConcurrency,
  runWithConcurrencyLimit
} = require('../services/speed-test');
const { clearOpenCodeRedirectCache } = require('../../platforms/drivers/opencode/proxy-implementation');
const {
  fetchModelsFromProvider,
  probeModelAvailability
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
    if (value === 'codex') return 'codex';
    return 'openai_compatible';
  }

  function mapGatewaySourceTypeToSpeedTestType(channel) {
    return resolveGatewaySourceType(channel);
  }

  function isConverterPresetChannel(channel) {
    const presetId = String(channel?.presetId || '').trim().toLowerCase();
    return presetId === 'entry_claude' || presetId === 'entry_codex' || presetId === 'entry_gemini';
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
   * POST /api/opencode/channels/sync-current
   * 将当前 OpenCode 原生/ctx 配置同步到渠道列表
   */
  router.post('/sync-current', (req, res) => {
    try {
      if (!isOpenCodeInstalled()) {
        return res.status(404).json({ error: 'OpenCode CLI not installed' });
      }

      const result = syncCurrentOpenCodeChannel();
      res.json(result);
      broadcastSchedulerState('opencode', getSchedulerState('opencode'));
    } catch (err) {
      console.error('[OpenCode Channels API] Failed to sync current channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/opencode/channels/probe-models
   * 用临时配置（新建渠道时）获取模型列表，无需 channelId
   */
  router.post('/probe-models', async (req, res) => {
    try {
      const { baseUrl, apiKey, gatewaySourceType } = req.body;
      if (!baseUrl) {
        return res.status(400).json({ error: 'baseUrl is required' });
      }
      const tempChannel = { baseUrl, apiKey: apiKey || '', gatewaySourceType: gatewaySourceType || 'codex' };
      const gst = resolveGatewaySourceType(tempChannel);
      const listResult = await fetchModelsFromProvider(tempChannel, gst, { useV1ModelsEndpoint: true, forceRefresh: true });
      const listedModels = Array.isArray(listResult.models) ? uniqueModels(listResult.models) : [];
      res.json({
        models: listedModels,
        supported: listedModels.length > 0,
        error: listedModels.length > 0 ? null : (listResult.error || '未返回可用模型列表'),
        errorHint: listedModels.length > 0 ? null : (listResult.errorHint || '请手动填写模型名称')
      });
    } catch (error) {
      console.error('[OpenCode Channels API] Error probing models:', error);
      res.status(500).json({ error: 'Failed to probe models' });
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

      const forceRefresh = req.query.forceRefresh === 'true';
      const gatewaySourceType = resolveGatewaySourceType(channel);
      const preferredModels = collectChannelPreferredModels(channel);
      const listResult = await fetchModelsFromProvider(channel, gatewaySourceType, { useV1ModelsEndpoint: true, forceRefresh });
      const listedModels = Array.isArray(listResult.models) ? uniqueModels(listResult.models) : [];
      const shouldProbeByDefault = !!listResult.disabledByConfig;
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
      } else if (shouldProbeByDefault || isConverterPresetChannel(channel)) {
        const probe = await probeModelAvailability(channel, gatewaySourceType, {
          stopOnFirstAvailable: false,
          preferredModels
        });
        const probedModels = Array.isArray(probe.availableModels) ? uniqueModels(probe.availableModels) : [];

        result = {
          models: probedModels,
          supported: probedModels.length > 0,
          cached: !!probe.cached || !!listResult.cached,
          fallbackUsed: false,
          lastChecked: probe.lastChecked || listResult.lastChecked || new Date().toISOString(),
          error: probedModels.length > 0 ? null : (listResult.error || '无法获取可用模型'),
          errorHint: probedModels.length > 0
            ? (shouldProbeByDefault ? '已按设置跳过 /v1/models，使用默认模型探测结果' : '模型列表接口不可用，已自动切换为模型探测结果')
            : (listResult.errorHint || (shouldProbeByDefault
              ? '已按设置跳过 /v1/models，且默认模型探测无可用结果'
              : '模型列表接口不可用且模型探测无可用结果'))
        };
      } else {
        // 非入口转换器渠道：只请求 /v1/models，失败则返回空列表
        result = {
          models: [],
          supported: false,
          cached: !!listResult.cached,
          fallbackUsed: false,
          lastChecked: listResult.lastChecked || new Date().toISOString(),
          error: listResult.error || '该渠道未返回可用模型列表',
          errorHint: listResult.errorHint || '此类型渠道不执行模型探测，请检查 /v1/models 接口'
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
        websiteUrl,
        balanceToken,
        balanceUserId
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
        websiteUrl,
        balanceToken: balanceToken || '',
        balanceUserId: balanceUserId || null
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
      const { timeout = 20000, concurrency } = req.body || {};
      const channels = getChannels().channels || [];
      const safeConcurrency = sanitizeBatchConcurrency(concurrency);

      const results = await runWithConcurrencyLimit(
        channels,
        safeConcurrency,
        channel => {
          const speedTestType = mapGatewaySourceTypeToSpeedTestType(channel);
          return testChannelSpeed(channel, timeout, speedTestType);
        }
      );

      // 与 testMultipleChannels 保持一致的排序：成功在前，成功按延迟升序
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
      
      // 添加摘要统计
      const successResults = results.filter(r => r.success);
      const successWithLatency = successResults.filter(
        r => r.latency !== null && r.latency !== undefined
      );
      const summary = {
        total: results.length,
        success: successResults.length,
        failed: results.length - successResults.length,
        avgLatency: successWithLatency.length > 0
          ? Math.round(
            successWithLatency.reduce((sum, r) => sum + r.latency, 0) / successWithLatency.length
          )
          : null,
        concurrency: safeConcurrency
      };
      
      res.json({ results, summary });
    } catch (error) {
      console.error('[OpenCode Channels API] Speed test all failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
