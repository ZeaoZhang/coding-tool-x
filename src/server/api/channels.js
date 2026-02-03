const express = require('express');
const router = express.Router();
const {
  getAllChannels,
  applyChannelToSettings,
  createChannel,
  updateChannel,
  deleteChannel,
  getCurrentSettings,
  getBestChannelForRestore,
  updateClaudeSettingsWithModelConfig
} = require('../services/channels');
const { getSchedulerState } = require('../services/channel-scheduler');
const { getChannelHealthStatus, getAllChannelHealthStatus, resetChannelHealth } = require('../services/channel-health');
const { testChannelSpeed, testMultipleChannels, getLatencyLevel } = require('../services/speed-test');
const { fetchModelsFromProvider } = require('../services/model-detector');
const { broadcastLog, broadcastProxyState, broadcastSchedulerState } = require('../websocket-server');
const { clearRedirectCache } = require('../proxy-server');

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
    const settings = getCurrentSettings();
    const channels = getAllChannels();
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

// POST /api/channels - Create new channel
router.post('/', (req, res) => {
  try {
    const { name, baseUrl, apiKey, websiteUrl, enabled, weight, maxConcurrency } = req.body;

    if (!name || !baseUrl || !apiKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const channel = createChannel(name, baseUrl, apiKey, websiteUrl, {
      enabled,
      weight,
      maxConcurrency
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
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = deleteChannel(id);
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
    const channel = applyChannelToSettings(id);

    // Check if proxy is running
    const { getProxyStatus } = require('../proxy-server');
    const proxyStatus = getProxyStatus();

    broadcastLog({
      type: 'action',
      action: 'apply_settings',
      message: `已将 (${channel.name}) 渠道写入配置文件中`,
      channelName: channel.name,
      timestamp: Date.now(),
      source: 'claude'
    });

    // Stop proxy if running
    if (proxyStatus && proxyStatus.running) {
      console.log(`Proxy is running, stopping to apply channel settings: ${channel.name}`);

      // Stop proxy and restore backup
      const { stopProxyServer } = require('../proxy-server');
      await stopProxyServer({ clearStartTime: false });

      // Re-apply channel settings after proxy stop to prevent race condition
      // (stopProxyServer restores backup, then we overwrite it with current channel)
      updateClaudeSettingsWithModelConfig(channel);

      console.log(`✅ 已停���动态切换，默认使用当前渠道`);
      broadcastLog({
        type: 'action',
        action: 'stop_proxy',
        message: `已停止动态切换，默认使用当前渠道`,
        timestamp: Date.now(),
        source: 'claude'
      });

      // 广播代理状态更新，通知前端代理已停止
      const { broadcastProxyState } = require('../websocket-server');
      broadcastProxyState('claude', {
        running: false,
        port: null,
        runtime: null,
        startTime: null
      }, null, getAllChannels());
    }

    res.json({
      message: `已将 (${channel.name}) 渠道写入配置文件中`,
      channel
    });
  } catch (error) {
    console.error('Error applying channel to settings:', error);
    res.status(500).json({ error: error.message });
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

    // Claude 渠道使用 'claude' 类型
    const result = await testChannelSpeed(channel, timeout, 'claude');
    result.level = getLatencyLevel(result.latency);

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
    const VALID_CHANNEL_TYPES = ['claude', 'codex', 'gemini', 'openai_compatible'];
    const { type = 'claude' } = req.query;

    if (!VALID_CHANNEL_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid channel type', channelId: id });
    }

    const channels = getAllChannels();
    const channel = channels.find(ch => ch.id === id);

    if (!channel) {
      return res.status(404).json({ error: '渠道不存在' });
    }

    // If no type specified or type is 'claude', auto-detect
    let channelType = type;
    if (!type || type === 'claude') {
      const { detectChannelType } = require('../services/model-detector');
      channelType = detectChannelType(channel);
      console.log(`[API] Auto-detected channel type: ${channelType} for ${channel.name}`);
    }

    const result = await fetchModelsFromProvider(channel, channelType);

    res.json({
      channelId: id,
      models: result.models,
      supported: result.supported,
      cached: result.cached,
      fetchedAt: result.lastChecked || new Date().toISOString(),
      error: result.error
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
    const { timeout = 10000 } = req.body;
    const channels = getAllChannels();

    if (channels.length === 0) {
      return res.json({ results: [], message: '没有可测试的渠道' });
    }

    // Claude 渠道使用 'claude' 类型
    const results = await testMultipleChannels(channels, timeout, 'claude');
    // 添加延迟等级
    results.forEach(r => {
      r.level = getLatencyLevel(r.latency);
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
    console.error('Error testing all channels speed:', error);
    res.status(500).json({ error: error.message });
  }
});

// 计算平均延迟
function calculateAvgLatency(results) {
  const successResults = results.filter(r => r.success && r.latency);
  if (successResults.length === 0) return null;
  const sum = successResults.reduce((acc, r) => acc + r.latency, 0);
  return Math.round(sum / successResults.length);
}

module.exports = router;
