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
const {
  testChannelSpeed,
  sanitizeBatchConcurrency,
  runWithConcurrencyLimit
} = require('../services/speed-test');
const {
  clearOpenCodeRedirectCache,
  collectProxyModelList,
  getOpenCodeProxyStatus
} = require('../opencode-proxy-server');
const { setProxyConfig } = require('../services/opencode-settings-manager');
const {
  fetchModelsFromProvider,
  clearCache
} = require('../services/model-detector');
const { getDefaultSpeedTestModelByToolType } = require('../../config/model-metadata');

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

  function resolveGatewaySourceType(channel) {
    const value = String(channel?.gatewaySourceType || '').trim().toLowerCase();
    if (value === 'claude') return 'claude';
    if (value === 'gemini') return 'gemini';
    return 'codex';
  }

  function mapGatewaySourceTypeToSpeedTestType(channel) {
    return resolveGatewaySourceType(channel);
  }

  function isConverterEntryChannel(channel) {
    const presetId = String(channel?.presetId || '').trim().toLowerCase();
    return presetId === 'entry_claude' || presetId === 'entry_codex' || presetId === 'entry_gemini';
  }

  function getDefaultModelsByGatewaySourceType(gatewaySourceType) {
    if (gatewaySourceType === 'claude') return [getDefaultSpeedTestModelByToolType('claude')];
    if (gatewaySourceType === 'gemini') return [getDefaultSpeedTestModelByToolType('gemini')];
    return [getDefaultSpeedTestModelByToolType('codex')];
  }

  function refreshEditedChannelModelCache(channelId) {
    if (!channelId) return;
    clearCache(channelId);
  }

  async function syncOpenCodeProxyConfigByCache() {
    const proxyStatus = getOpenCodeProxyStatus();
    if (!proxyStatus?.running || !Number.isFinite(proxyStatus?.port)) {
      return;
    }

    const channels = getChannels().channels || [];
    const enabledChannels = channels.filter(ch => ch.enabled !== false);

    // Collect per-channel model lists for per-channel provider generation
    let detectedModels = [];
    try {
      detectedModels = await collectProxyModelList(enabledChannels, { useCacheOnly: true }) || [];
    } catch (error) {
      console.warn('[OpenCode Channels API] Failed to collect cached models while syncing proxy config:', error.message);
    }

    const channelPayloads = enabledChannels.map((ch) => {
      let models;
      if (Array.isArray(ch.allowedModels) && ch.allowedModels.length > 0) {
        // User explicitly selected models for this channel
        models = ch.allowedModels;
      } else {
        // Fall back to configured + detected models
        models = uniqueModels([
          ch.model,
          ch.speedTestModel,
          ...(Array.isArray(ch.modelRedirects)
            ? ch.modelRedirects.flatMap(r => [r?.from, r?.to])
            : []),
          ...detectedModels
        ]);
      }
      return {
        name: ch.name,
        providerKey: ch.providerKey || ch.name,
        model: ch.model || null,
        models
      };
    });

    const currentChannel = enabledChannels[0];
    const activeModel = currentChannel?.model || currentChannel?.speedTestModel || null;
    setProxyConfig(proxyStatus.port, { channels: channelPayloads, model: activeModel });
  }

  async function refreshEditedChannelAndSyncProxy(channelId) {
    try {
      await refreshEditedChannelModelCache(channelId);
    } catch (error) {
      console.warn('[OpenCode Channels API] Refresh edited channel model cache failed:', error.message);
    }

    try {
      await syncOpenCodeProxyConfigByCache();
    } catch (error) {
      console.warn('[OpenCode Channels API] Sync proxy config after channel edit failed:', error.message);
    }
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
      if (isConverterEntryChannel(channel)) {
        const models = uniqueModels(getDefaultModelsByGatewaySourceType(gatewaySourceType));
        const now = new Date().toISOString();
        return res.json({
          channelId: channelId,
          gatewaySourceType,
          models,
          supported: models.length > 0,
          cached: false,
          fallbackUsed: false,
          fetchedAt: now,
          error: models.length > 0 ? null : '未配置默认模型列表',
          errorHint: models.length > 0 ? null : '请在设置中配置对应工具类型的默认模型'
        });
      }

      const listResult = await fetchModelsFromProvider(channel, 'openai_compatible');
      const listedModels = Array.isArray(listResult.models) ? uniqueModels(listResult.models) : [];
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
        result = {
          models: [],
          supported: false,
          cached: !!listResult.cached,
          fallbackUsed: false,
          lastChecked: listResult.lastChecked || new Date().toISOString(),
          error: listResult.error || '该渠道未返回可用模型列表',
          errorHint: listResult.errorHint || '仅 OpenCode 非转换入口使用 /v1/models，请检查接口配置'
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
  router.post('/', async (req, res) => {
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
        allowedModels
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
        allowedModels: allowedModels || []
      });

      clearOpenCodeRedirectCache(channel.id);
      await refreshEditedChannelAndSyncProxy(channel.id);
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
  router.put('/:channelId', async (req, res) => {
    try {
      const { channelId } = req.params;
      const updates = req.body;

      const channel = updateChannel(channelId, updates);
      clearOpenCodeRedirectCache(channelId);
      await refreshEditedChannelAndSyncProxy(channelId);
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
      clearOpenCodeRedirectCache(channelId);
      await refreshEditedChannelAndSyncProxy(channelId);
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
