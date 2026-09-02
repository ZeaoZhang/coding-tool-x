const express = require('express');
const { getPlatformRuntime } = require('../../platforms/runtime');
const router = express.Router();
const {
  getAllChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  getCurrentSettings,
  getBestChannelForRestore,
  syncCurrentClaudeChannel
} = require('../../platforms/drivers/claude/channels-implementation');
const { getSchedulerState } = require('../services/channel-scheduler');
const { getChannelHealthStatus, getAllChannelHealthStatus, resetChannelHealth } = require('../services/channel-health');
const { fetchModelsFromProvider } = require('../services/model-detector');
const {
  testChannelSpeed,
  getLatencyLevel,
  sanitizeBatchConcurrency,
  runWithConcurrencyLimit
} = require('../services/speed-test');
const { normalizeGatewaySourceType } = require('../services/base/proxy-utils');
const { getDefaultSpeedTestModelByToolType } = require('../../config/model-metadata');
const { broadcastLog, broadcastProxyState, broadcastSchedulerState } = require('../websocket-server');
const { clearRedirectCache } = require('../../platforms/drivers/claude/proxy-implementation');
const CLAUDE_GATEWAY_SOURCE_TYPE = 'claude';

function getDefaultClaudeModel() {
  return getDefaultSpeedTestModelByToolType('claude');
}

function resolveClaudeGatewaySourceType(channel, requestedType) {
  return normalizeGatewaySourceType(requestedType || channel?.gatewaySourceType, 'claude');
}

function getDefaultModelsForGatewaySourceType(gatewaySourceType) {
  if (gatewaySourceType === 'openai_compatible' || gatewaySourceType === 'codex') {
    const model = getDefaultSpeedTestModelByToolType('codex');
    return model ? [model] : [];
  }
  const model = getDefaultClaudeModel();
  return model ? [model] : [];
}

// GET /api/channels - Get all channels with health status
router.get('/', (req, res) => {
  try {
    const channels = getAllChannels();
    // 为每个渠道附加健康状态
    const channelsWithHealth = channels.map(ch => ({
      ...ch,
      health: getChannelHealthStatus(ch.id)
    }));
    res.json({ channels: channelsWithHealth });
  } catch (error) {
    console.error('Error fetching channels:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/pool/status', (req, res) => {
  try {
    const source = req.query.source || 'claude';
    const scheduler = getSchedulerState(source);
    res.json({ source, scheduler });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/channels/current - Get current settings
router.get('/current', (req, res) => {
  try {
    const channels = getAllChannels();
    const settings = getCurrentSettings(channels);
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

// POST /api/channels/sync-current - Sync current native/ctx channel into channel list
router.post('/sync-current', (req, res) => {
  try {
    const result = syncCurrentClaudeChannel();
    res.json(result);
    broadcastSchedulerState('claude', getSchedulerState('claude'));
  } catch (error) {
    console.error('Error syncing current Claude channel:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/channels - Create new channel
router.post('/', (req, res) => {
  try {
    const {
      name,
      baseUrl,
      apiKey,
      websiteUrl,
      enabled,
      weight,
      maxConcurrency,
      presetId,
      modelConfig,
      modelRedirects,
      proxyUrl,
      speedTestModel,
      gatewaySourceType,
      targetApi,
      balanceToken,
      balanceUserId
    } = req.body;

    if (!name || !baseUrl) {
      return res.status(400).json({ error: 'Missing required fields: name, baseUrl' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'Missing required fields: apiKey' });
    }

    const channel = createChannel(name, baseUrl, apiKey, websiteUrl, {
      enabled,
      weight,
      maxConcurrency,
      presetId,
      modelConfig,
      modelRedirects: modelRedirects || [],
      proxyUrl: proxyUrl || '',
      speedTestModel: speedTestModel || null,
      gatewaySourceType,
      targetApi,
      balanceToken: balanceToken || '',
      balanceUserId: balanceUserId || null
    });
    res.json({ channel });
    broadcastSchedulerState('claude', getSchedulerState('claude'));
  } catch (error) {
    console.error('Error creating channel:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/channels/best-for-restore - Get best channel for restore (must be before /:id)
router.get('/best-for-restore', (req, res) => {
  try {
    const channel = getBestChannelForRestore();
    res.json({ channel });
  } catch (error) {
    console.error('Error getting best channel for restore:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/channels/:id - Update channel
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const channel = updateChannel(id, updates);
    // 清除该渠道的模型重定向日志缓存，使下次请求时重新打印
    clearRedirectCache(id);
    res.json({ channel });
    broadcastSchedulerState('claude', getSchedulerState('claude'));
  } catch (error) {
    console.error('Error updating channel:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/channels/:id - Delete channel
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteChannel(id);
    res.json(result);
    broadcastSchedulerState('claude', getSchedulerState('claude'));
  } catch (error) {
    console.error('Error deleting channel:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/apply-to-settings', async (req, res) => {
  try {
    const { id } = req.params;
    const runtime = getPlatformRuntime();
    const channelsDriver = runtime.getDriver('claude', 'channels');
    const channel = channelsDriver.applyChannelToSettings(id);
    const proxyDriver = runtime.getDriver('claude', 'proxy');
    const proxyStatus = proxyDriver && typeof proxyDriver.status === 'function'
      ? await proxyDriver.status()
      : null;

    broadcastLog({
      type: 'action',
      action: 'apply_settings',
      message: `已将 (${channel.name}) 渠道写入配置文件中`,
      channelName: channel.name,
      timestamp: Date.now(),
      source: 'claude'
    });

    if (proxyStatus && proxyStatus.running) {
      console.log(`Proxy is running, stopping to apply channel settings: ${channel.name}`);
      await proxyDriver.stop({ clearStartTime: false });
      const nativeDriver = runtime.getDriver('claude', 'nativeConfig');
      nativeDriver.deleteBackup();
      nativeDriver.clearActiveChannelMarker();
      channelsDriver.updateClaudeSettingsWithModelConfig(channel);

      console.log(`[OK] 已停止动态切换，默认使用当前渠道`);
      broadcastLog({
        type: 'action',
        action: 'stop_proxy',
        message: `已停止动态切换，默认使用当前渠道`,
        timestamp: Date.now(),
        source: 'claude'
      });

      broadcastProxyState('claude', {
        running: false,
        port: null,
        runtime: null,
        startTime: null
      }, null, channelsDriver.getAllChannels());
    }

    res.json({
      message: `已将 (${channel.name}) 渠道写入配置文件中`,
      channel
    });
  } catch (error) {
    console.error('Error applying channel to settings:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// POST /api/channels/:id/reset-health - Reset channel health status
router.post('/:id/reset-health', (req, res) => {
  try {
    const { id } = req.params;
    resetChannelHealth(id, 'claude');
    res.json({
      success: true,
      message: '渠道健康状态已重置',
      health: getChannelHealthStatus(id)
    });
  } catch (error) {
    console.error('Error resetting channel health:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/channels/:id/speed-test - Test single channel speed
router.post('/:id/speed-test', async (req, res) => {
  try {
    const { id } = req.params;
    const { timeout = 10000 } = req.body;
    const channels = getAllChannels();
    const channel = channels.find(ch => ch.id === id);

    if (!channel) {
      return res.status(404).json({ error: '渠道不存在' });
    }

    const speedTestType = resolveClaudeGatewaySourceType(channel);
    const result = await testChannelSpeed(channel, timeout, speedTestType);
    result.level = getLatencyLevel(result.latency);
    result.gatewaySourceType = speedTestType;

    res.json(result);
  } catch (error) {
    console.error('Error testing channel speed:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/channels/:id/models - Get available models for a channel
router.get('/:id/models', async (req, res) => {
  try {
    const { id } = req.params;

    const channels = getAllChannels();
    const channel = channels.find(ch => ch.id === id);

    if (!channel) {
      return res.status(404).json({ error: '渠道不存在' });
    }

    const gatewaySourceType = resolveClaudeGatewaySourceType(channel, req.query.type);
    const fallbackModels = getDefaultModelsForGatewaySourceType(gatewaySourceType);
    let result;

    if (gatewaySourceType === 'openai_compatible' || gatewaySourceType === 'codex') {
      try {
        result = await fetchModelsFromProvider(channel, gatewaySourceType);
      } catch (error) {
        result = {
          models: [],
          supported: true,
          cached: false,
          fallbackUsed: true,
          lastChecked: new Date().toISOString(),
          error: error.message || '获取模型列表失败',
          errorHint: '已回退到默认模型列表'
        };
      }

      if (!Array.isArray(result.models) || result.models.length === 0) {
        result = {
          ...result,
          models: fallbackModels,
          fallbackUsed: true,
          error: result.error || (fallbackModels.length > 0 ? null : '未配置默认模型列表'),
          errorHint: result.errorHint || (fallbackModels.length > 0 ? '已回退到默认模型列表' : '请在设置中配置默认模型')
        };
      }
    } else {
      const now = new Date().toISOString();
      result = {
        models: fallbackModels,
        supported: fallbackModels.length > 0,
        cached: false,
        fallbackUsed: false,
        lastChecked: now,
        error: fallbackModels.length > 0 ? null : '未配置默认模型列表',
        errorHint: fallbackModels.length > 0 ? null : '请在设置中配置 Claude 默认模型'
      };
    }

    res.json({
      channelId: id,
      gatewaySourceType,
      models: result.models,
      supported: result.supported,
      fallbackUsed: result.fallbackUsed,
      cached: result.cached,
      fetchedAt: result.lastChecked || new Date().toISOString(),
      error: result.error,
      errorHint: result.errorHint
    });
  } catch (error) {
    console.error('Error fetching channel models:', error);
    res.status(500).json({
      error: '获取模型列表失败',
      channelId: req.params.id
    });
  }
});

// POST /api/channels/speed-test-all - Test all channels speed
router.post('/speed-test-all', async (req, res) => {
  try {
    const { timeout = 10000, concurrency } = req.body || {};
    const channels = getAllChannels();
    const safeConcurrency = sanitizeBatchConcurrency(concurrency);

    if (channels.length === 0) {
      return res.json({ results: [], message: '没有可测试的渠道' });
    }

    const results = await runWithConcurrencyLimit(
      channels,
      safeConcurrency,
      async channel => {
        const speedTestType = resolveClaudeGatewaySourceType(channel);
        const result = await testChannelSpeed(channel, timeout, speedTestType);
        result.level = getLatencyLevel(result.latency);
        result.gatewaySourceType = speedTestType;
        return result;
      }
    );

    // 与其他渠道保持一致：成功在前，成功结果按延迟升序
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
    console.error('Error testing all channels speed:', error);
    res.status(500).json({ error: error.message });
  }
});

// 计算平均延迟
function calculateAvgLatency(results) {
  const successResults = results.filter(
    r => r.success && r.latency !== null && r.latency !== undefined
  );
  if (successResults.length === 0) return null;
  const sum = successResults.reduce((acc, r) => acc + r.latency, 0);
  return Math.round(sum / successResults.length);
}

module.exports = router;
