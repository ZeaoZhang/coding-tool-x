const express = require('express');
const router = express.Router();
const {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  saveChannelOrder
} = require('../services/omp-channels');
const { isOmpInstalled } = require('../services/omp-sessions');
const { getSchedulerState } = require('../services/channel-scheduler');
const { getChannelHealthStatus, resetChannelHealth } = require('../services/channel-health');
const { broadcastSchedulerState } = require('../websocket-server');
const {
  testChannelSpeed,
  sanitizeBatchConcurrency,
  runWithConcurrencyLimit
} = require('../services/speed-test');
const {
  fetchModelsFromProvider,
  probeModelAvailability
} = require('../services/model-detector');
const {
  findAuthProviderForKey,
  getOmpAuthProviderSnapshot
} = require('../services/omp-auth-providers');

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
  if (value === 'codex') return 'codex';
  if (value === 'gemini') return 'gemini';
  if (value === 'opencode') return 'opencode';
  if (value === 'openai_compatible') return 'openai_compatible';
  return 'openai_compatible';
}

function collectPreferredModels(channel = {}) {
  return uniqueModels([
    channel.model,
    channel.speedTestModel,
    ...(Array.isArray(channel.allowedModels) ? channel.allowedModels : []),
    ...(Array.isArray(channel.modelRedirects)
      ? channel.modelRedirects.flatMap(rule => [rule?.from, rule?.to])
      : [])
  ]);
}

function resolveModelDiscoverySourceType(gatewaySourceType) {
  return gatewaySourceType === 'opencode' ? 'openai_compatible' : gatewaySourceType;
}

async function discoverOmpModels(channel, gatewaySourceType, { forceRefresh = false } = {}) {
  if (channel?.authMode === 'oauth' && !String(channel.apiKey || '').trim()) {
    const preferredModels = collectPreferredModels(channel);
    return {
      models: preferredModels,
      supported: preferredModels.length > 0,
      cached: false,
      fallbackUsed: true,
      fetchedAt: new Date().toISOString(),
      error: preferredModels.length > 0 ? null : 'OAuth 渠道未配置 API Key，无法直接调用远端模型列表接口',
      errorHint: '请手动填写默认模型、测速模型或可用模型；运行时由 OMP 的登录凭证提供访问权限'
    };
  }

  const discoverySourceType = resolveModelDiscoverySourceType(gatewaySourceType);
  const listResult = await fetchModelsFromProvider(channel, discoverySourceType, {
    useV1ModelsEndpoint: true,
    forceRefresh
  });
  const listedModels = Array.isArray(listResult.models) ? uniqueModels(listResult.models) : [];

  if (listedModels.length > 0) {
    return {
      models: listedModels,
      supported: true,
      cached: !!listResult.cached,
      fallbackUsed: false,
      fetchedAt: listResult.lastChecked || new Date().toISOString(),
      error: null,
      errorHint: null
    };
  }

  const probe = await probeModelAvailability(channel, discoverySourceType, {
    stopOnFirstAvailable: false,
    preferredModels: collectPreferredModels(channel),
    forceRefresh
  });
  const probedModels = Array.isArray(probe.availableModels) ? uniqueModels(probe.availableModels) : [];

  return {
    models: probedModels,
    supported: probedModels.length > 0,
    cached: !!probe.cached || !!listResult.cached,
    fallbackUsed: probedModels.length > 0,
    fetchedAt: probe.lastChecked || listResult.lastChecked || new Date().toISOString(),
    error: probedModels.length > 0 ? null : (listResult.error || '无法获取可用模型'),
    errorHint: probedModels.length > 0
      ? '模型列表接口不可用，已自动切换为模型探测结果'
      : (listResult.errorHint || '请手动填写模型名称')
  };
}

function attachAuthProvider(channel, snapshot) {
  const authProvider = findAuthProviderForKey(channel.providerKey || channel.provider || channel.name, snapshot);
  if (!authProvider) return channel;
  return {
    ...channel,
    ompAuthProvider: {
      id: authProvider.id,
      name: authProvider.name,
      loggedIn: authProvider.loggedIn,
      accountCount: authProvider.accountCount,
      accounts: authProvider.accounts || [],
      checked: authProvider.checked,
      error: authProvider.error || null
    }
  };
}

module.exports = () => {
  router.get('/', (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.json({ channels: [], installed: false, error: 'OMP CLI not installed' });
      }
      const data = getChannels();
      const authSnapshot = getOmpAuthProviderSnapshot({ accountCheck: false, includeStatus: false });
      const channels = (data.channels || []).map(ch => ({
        ...attachAuthProvider(ch, authSnapshot),
        health: getChannelHealthStatus(ch.id, 'omp')
      }));
      res.json({ channels, installed: true });
    } catch (err) {
      console.error('[OMP Channels API] Failed to get channels:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/enabled', (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.json({ channels: [], installed: false, error: 'OMP CLI not installed' });
      }
      const data = getChannels();
      const authSnapshot = getOmpAuthProviderSnapshot({ accountCheck: false, includeStatus: false });
      const channels = (data.channels || [])
        .filter(ch => ch.enabled !== false)
        .map(ch => ({ ...attachAuthProvider(ch, authSnapshot), health: getChannelHealthStatus(ch.id, 'omp') }));
      res.json({ channels, installed: true });
    } catch (err) {
      console.error('[OMP Channels API] Failed to get enabled channels:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/probe-models', async (req, res) => {
    try {
      const {
        baseUrl,
        apiKey,
        gatewaySourceType,
        authMode,
        oauthProviderId,
        model,
        speedTestModel,
        allowedModels,
        modelRedirects
      } = req.body || {};
      if (!baseUrl) {
        return res.status(400).json({ error: 'baseUrl is required' });
      }
      const tempChannel = {
        name: 'Temporary OMP Channel',
        baseUrl,
        apiKey: apiKey || '',
        gatewaySourceType: gatewaySourceType || 'openai_compatible',
        authMode: authMode === 'oauth' ? 'oauth' : 'api_key',
        oauthProviderId: oauthProviderId || '',
        model: model || null,
        speedTestModel: speedTestModel || null,
        allowedModels: Array.isArray(allowedModels) ? allowedModels : [],
        modelRedirects: Array.isArray(modelRedirects) ? modelRedirects : []
      };
      const resolvedGatewaySourceType = resolveGatewaySourceType(tempChannel);
      const result = await discoverOmpModels(tempChannel, resolvedGatewaySourceType, { forceRefresh: true });
      res.json({
        models: result.models,
        supported: result.supported,
        fallbackUsed: result.fallbackUsed,
        error: result.error,
        errorHint: result.errorHint
      });
    } catch (error) {
      console.error('[OMP Channels API] Error probing models:', error);
      res.status(500).json({ error: 'Failed to probe models' });
    }
  });

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
      const result = await discoverOmpModels(channel, gatewaySourceType, { forceRefresh });

      res.json({
        channelId,
        gatewaySourceType,
        models: result.models,
        supported: result.supported,
        cached: result.cached,
        fallbackUsed: result.fallbackUsed,
        fetchedAt: result.fetchedAt,
        error: result.error,
        errorHint: result.errorHint
      });
    } catch (error) {
      console.error('[OMP Channels API] Error fetching models:', error);
      res.status(500).json({ error: 'Failed to fetch model list', channelId: req.params.channelId });
    }
  });

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
        allowedModels,
        speedTestModel,
        providerKey,
        providerApi,
        authMode,
        oauthProviderId,
        presetId,
        websiteUrl,
        balanceToken,
        balanceUserId
      } = req.body || {};

      if (!name || !baseUrl) {
        return res.status(400).json({ error: 'Missing required fields: name and baseUrl' });
      }
      const normalizedAuthMode = authMode === 'oauth' ? 'oauth' : 'api_key';
      if (!apiKey && normalizedAuthMode !== 'oauth') {
        return res.status(400).json({ error: 'API Key is required' });
      }

      const channel = createChannel(name, baseUrl, apiKey, {
        wireApi: wireApi || 'openai',
        providerApi: providerApi || wireApi || 'openai-completions',
        providerKey,
        authMode: normalizedAuthMode,
        oauthProviderId: oauthProviderId || providerKey || '',
        enabled,
        weight,
        maxConcurrency,
        model,
        gatewaySourceType: gatewaySourceType || 'openai_compatible',
        modelRedirects: modelRedirects || [],
        allowedModels: Array.isArray(allowedModels) ? allowedModels : [],
        speedTestModel: speedTestModel || null,
        presetId,
        websiteUrl: websiteUrl || '',
        balanceToken: balanceToken || '',
        balanceUserId: balanceUserId || null
      });
      res.json(channel);
      broadcastSchedulerState('omp', getSchedulerState('omp'));
    } catch (err) {
      console.error('[OMP Channels API] Failed to create channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/:channelId', (req, res) => {
    try {
      const channel = updateChannel(req.params.channelId, req.body || {});
      res.json(channel);
      broadcastSchedulerState('omp', getSchedulerState('omp'));
    } catch (err) {
      console.error('[OMP Channels API] Failed to update channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:channelId', async (req, res) => {
    try {
      const result = await deleteChannel(req.params.channelId);
      res.json(result);
      broadcastSchedulerState('omp', getSchedulerState('omp'));
    } catch (err) {
      console.error('[OMP Channels API] Failed to delete channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/order', (req, res) => {
    try {
      const { order } = req.body || {};
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'Order must be an array' });
      }
      saveChannelOrder(order);
      res.json({ success: true });
      broadcastSchedulerState('omp', getSchedulerState('omp'));
    } catch (err) {
      console.error('[OMP Channels API] Failed to save order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:channelId/reset-health', (req, res) => {
    try {
      resetChannelHealth(req.params.channelId, 'omp');
      res.json({ success: true });
      broadcastSchedulerState('omp', getSchedulerState('omp'));
    } catch (err) {
      console.error('[OMP Channels API] Failed to reset health:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:channelId/speed-test', async (req, res) => {
    try {
      const channel = (getChannels().channels || []).find(ch => ch.id === req.params.channelId);
      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      const result = await testChannelSpeed(channel, req.body?.timeout || 20000, resolveGatewaySourceType(channel), {
        authSourceType: 'omp'
      });
      res.json(result);
    } catch (error) {
      console.error('[OMP Channels API] Speed test failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/speed-test-all', async (req, res) => {
    try {
      const { timeout = 20000, concurrency } = req.body || {};
      const channels = getChannels().channels || [];
      const safeConcurrency = sanitizeBatchConcurrency(concurrency);
      const results = await runWithConcurrencyLimit(
        channels,
        safeConcurrency,
        channel => testChannelSpeed(channel, timeout, resolveGatewaySourceType(channel), {
          authSourceType: 'omp'
        })
      );
      results.sort((a, b) => {
        if (a.success && !b.success) return -1;
        if (!a.success && b.success) return 1;
        if (a.success && b.success) {
          return ((a.latency ?? Infinity) - (b.latency ?? Infinity));
        }
        return 0;
      });
      const successResults = results.filter(r => r.success);
      const successWithLatency = successResults.filter(r => r.latency !== null && r.latency !== undefined);
      res.json({
        results,
        summary: {
          total: results.length,
          success: successResults.length,
          failed: results.length - successResults.length,
          avgLatency: successWithLatency.length > 0
            ? Math.round(successWithLatency.reduce((sum, r) => sum + r.latency, 0) / successWithLatency.length)
            : null,
          concurrency: safeConcurrency
        }
      });
    } catch (error) {
      console.error('[OMP Channels API] Speed test all failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
