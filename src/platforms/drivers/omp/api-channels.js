const express = require('express');
const router = express.Router();
const {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  saveChannelOrder,
  syncCurrentOmpChannel
} = require('./channels-implementation');
const { isOmpInstalled } = require('./sessions-implementation');
const { getSchedulerState } = require('../../../server/services/channel-scheduler');
const { getChannelHealthStatus, resetChannelHealth } = require('../../../server/services/channel-health');
const { broadcastSchedulerState } = require('../../../server/websocket-server');
const {
  testChannelSpeed,
  sanitizeBatchConcurrency,
  runWithConcurrencyLimit
} = require('../../../server/services/speed-test');
const {
  fetchModelsFromProvider,
  probeModelAvailability
} = require('../../../server/services/model-detector');
const {
  findAuthProviderForKey,
  getCachedOmpAuthProviderSnapshot,
  getOmpAuthProviderCacheMeta
} = require('./auth-providers');
const {
  MODEL_SCHEMA_VERSION,
  MODEL_METADATA_MODES,
  getPublicModelFieldSchema,
  normalizeCatalogModelList,
  redactSensitiveFields,
  validateModelDefinitions,
  validateProviderConfig
} = require('../../../server/services/model-definition-schema');
const { getOmpCatalogModels } = require('./native-config-implementation');

const CHANNEL_LIST_AUTH_OPTIONS = { accountCheck: false, includeStatus: false };

function validateOmpModelPayload(payload = {}) {
  if (payload.modelMetadataMode !== undefined && !MODEL_METADATA_MODES.includes(payload.modelMetadataMode)) {
    return `modelMetadataMode must be one of: ${MODEL_METADATA_MODES.join(', ')}`;
  }
  if (payload.models !== undefined) {
    const validation = validateModelDefinitions(payload.models);
    if (!validation.valid) return validation.error;
  }
  if (payload.modelBindings !== undefined && !Array.isArray(payload.modelBindings)) {
    return 'modelBindings must be an array';
  }
  if (payload.providerConfig !== undefined) {
    const validation = validateProviderConfig(payload.providerConfig);
    if (!validation.valid) return validation.error;
  }
  return null;
}

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
      stale: false,
      retryAfter: null,
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

  if (listResult.backoff || listResult.stale) {
    return {
      models: listedModels,
      supported: listedModels.length > 0,
      cached: !!listResult.cached,
      stale: true,
      retryAfter: listResult.retryAfter || null,
      fallbackUsed: false,
      fetchedAt: listResult.lastChecked || new Date().toISOString(),
      error: listResult.error || (listedModels.length > 0 ? null : '模型目录缓存已过期'),
      errorHint: listResult.errorHint || '可点击“刷新可选模型”更新，或手动填写模型名称。'
    };
  }

  if (listedModels.length > 0) {
    return {
      models: listedModels,
      supported: true,
      cached: !!listResult.cached,
      stale: false,
      retryAfter: null,
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
    stale: false,
    retryAfter: null,
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

function getAuthSnapshotForChannelList() {
  const snapshot = getCachedOmpAuthProviderSnapshot(CHANNEL_LIST_AUTH_OPTIONS);
  const meta = getOmpAuthProviderCacheMeta(CHANNEL_LIST_AUTH_OPTIONS);
  return {
    snapshot,
    meta: {
      ...meta,
      stale: !snapshot || Boolean(snapshot.stale),
      fallback: !snapshot
    }
  };
}

function buildUnavailableAuthProviderMeta(error) {
  return {
    cached: false,
    stale: false,
    refreshing: false,
    fallback: true,
    checkedAt: new Date().toISOString(),
    error: error || 'omp-not-available'
  };
}

module.exports = () => {
  router.get('/', (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.json({
          channels: [],
          installed: false,
          error: 'OMP CLI not installed',
          authProviderMeta: buildUnavailableAuthProviderMeta('OMP CLI not installed')
        });
      }
      const data = getChannels();
      const { snapshot: authSnapshot, meta: authProviderMeta } = getAuthSnapshotForChannelList();
      const channels = (data.channels || []).map(ch => ({
        ...attachAuthProvider(ch, authSnapshot),
        health: getChannelHealthStatus(ch.id, 'omp')
      }));
      res.json({ channels, installed: true, authProviderMeta });
    } catch (err) {
      console.error('[OMP Channels API] Failed to get channels:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/enabled', (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.json({
          channels: [],
          installed: false,
          error: 'OMP CLI not installed',
          authProviderMeta: buildUnavailableAuthProviderMeta('OMP CLI not installed')
        });
      }
      const data = getChannels();
      const { snapshot: authSnapshot, meta: authProviderMeta } = getAuthSnapshotForChannelList();
      const channels = (data.channels || [])
        .filter(ch => ch.enabled !== false)
        .map(ch => ({ ...attachAuthProvider(ch, authSnapshot), health: getChannelHealthStatus(ch.id, 'omp') }));
      res.json({ channels, installed: true, authProviderMeta });
    } catch (err) {
      console.error('[OMP Channels API] Failed to get enabled channels:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/sync-current', (req, res) => {
    try {
      if (!isOmpInstalled()) {
        return res.status(404).json({ error: 'OMP CLI not installed' });
      }

      const result = syncCurrentOmpChannel();
      res.json(result);
      broadcastSchedulerState('omp', getSchedulerState('omp'));
    } catch (err) {
      console.error('[OMP Channels API] Failed to sync current channel:', err);
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
        modelRedirects,
        forceRefresh
      } = req.body || {};
      if (!baseUrl) {
        return res.status(400).json({ error: 'baseUrl is required' });
      }
      const tempChannel = {
        name: 'Temporary OMP Channel',
        baseUrl,
        apiKey: apiKey || '',
        gatewaySourceType: gatewaySourceType || 'openai_compatible',
        authMode: ['api_key', 'oauth', 'none'].includes(authMode) ? authMode : 'api_key',
        oauthProviderId: oauthProviderId || '',
        model: model || null,
        speedTestModel: speedTestModel || null,
        allowedModels: Array.isArray(allowedModels) ? allowedModels : [],
        modelRedirects: Array.isArray(modelRedirects) ? modelRedirects : []
      };
      const resolvedGatewaySourceType = resolveGatewaySourceType(tempChannel);
      const result = await discoverOmpModels(tempChannel, resolvedGatewaySourceType, { forceRefresh: forceRefresh === true });
      res.json({
        models: result.models,
        supported: result.supported,
        fallbackUsed: result.fallbackUsed,
        cached: result.cached,
        stale: result.stale,
        retryAfter: result.retryAfter,
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
        stale: result.stale,
        retryAfter: result.retryAfter,
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

  router.post('/catalog-metadata', (req, res) => {
    try {
      const providerKey = String(req.body?.providerKey || '').trim();
      if (!providerKey) {
        return res.status(400).json({ error: 'providerKey is required' });
      }
      const requestedModelIds = uniqueModels([
        req.body?.model,
        req.body?.speedTestModel,
        ...(Array.isArray(req.body?.allowedModels) ? req.body.allowedModels : []),
        ...(Array.isArray(req.body?.models)
          ? req.body.models.map(model => typeof model === 'string' ? model : (model?.id || model?.name))
          : [])
      ]);
      const rawModels = getOmpCatalogModels(providerKey, {
        forceCatalogRefresh: req.body?.forceRefresh === true,
        catalogTimeout: 5000,
        requestedModelIds
      });
      const normalizedCatalog = normalizeCatalogModelList(rawModels);
      const models = normalizedCatalog.models.map(model => redactSensitiveFields(model));
      const warnings = normalizedCatalog.warnings.slice();
      if (models.length === 0) {
        warnings.push('OMP catalog did not return model metadata; existing manual definitions were left unchanged.');
      }
      res.json({
        schemaVersion: MODEL_SCHEMA_VERSION,
        fieldSchema: getPublicModelFieldSchema(),
        providerKey,
        models,
        warnings
      });
    } catch (error) {
      console.error('[OMP Channels API] Error reading OMP catalog metadata:', error);
      res.status(502).json({ error: 'Failed to read OMP model metadata' });
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
        routingGroup,
        presetId,
        websiteUrl,
        balanceToken,
        balanceUserId,
        models,
        modelMetadataMode,
        modelBindings,
        providerConfig
      } = req.body || {};

      const modelPayloadError = validateOmpModelPayload(req.body || {});
      if (modelPayloadError) {
        return res.status(400).json({ error: modelPayloadError });
      }

      if (!name || !baseUrl) {
        return res.status(400).json({ error: 'Missing required fields: name and baseUrl' });
      }
      const normalizedAuthMode = ['api_key', 'oauth', 'none'].includes(authMode) ? authMode : 'api_key';
      if (!apiKey && normalizedAuthMode === 'api_key') {
        return res.status(400).json({ error: 'API Key is required' });
      }

      const channel = createChannel(name, baseUrl, apiKey, {
        wireApi: wireApi || 'openai',
        providerApi: providerApi || wireApi || 'openai-completions',
        providerKey,
        authMode: normalizedAuthMode,
        oauthProviderId: normalizedAuthMode === 'oauth' ? (oauthProviderId || providerKey || '') : '',
        routingGroup: String(routingGroup || '').trim(),
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
        balanceUserId: balanceUserId || null,
        models: Array.isArray(models) ? models : [],
        modelMetadataMode: modelMetadataMode || 'auto',
        modelBindings: Array.isArray(modelBindings) ? modelBindings : [],
        providerConfig: providerConfig || {}
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
      const modelPayloadError = validateOmpModelPayload(req.body || {});
      if (modelPayloadError) {
        return res.status(400).json({ error: modelPayloadError });
      }
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
