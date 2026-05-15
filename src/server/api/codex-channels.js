const express = require('express');
const router = express.Router();
const fs = require('fs');
const {
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  getEnabledChannels,
  saveChannelOrder,
  applyChannelToSettings
} = require('../services/codex-channels');
const { getSchedulerState } = require('../services/channel-scheduler');
const { getChannelHealthStatus, resetChannelHealth } = require('../services/channel-health');
const { broadcastSchedulerState, broadcastLog } = require('../websocket-server');
const { isCodexInstalled } = require('../services/codex-config');
const {
  testChannelSpeed,
  getLatencyLevel,
  sanitizeBatchConcurrency,
  runWithConcurrencyLimit
} = require('../services/speed-test');
const { clearCodexRedirectCache } = require('../codex-proxy-server');
const { deleteBackup } = require('../services/codex-settings-manager');
const { PATHS } = require('../../config/paths');
const { getDefaultSpeedTestModelByToolType } = require('../../config/model-metadata');
const CODEX_GATEWAY_SOURCE_TYPE = 'codex';
const CODEX_PROVIDER_KEY_PATTERN = /^[a-z0-9_-]+$/i;

function getDefaultCodexModel() {
  return getDefaultSpeedTestModelByToolType('codex');
}

function validateCodexProviderKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return 'Missing required fields: providerKey';
  }
  if (!CODEX_PROVIDER_KEY_PATTERN.test(normalized)) {
    return 'Invalid providerKey: only letters, numbers, underscores, and hyphens are allowed';
  }
  if (normalized.toLowerCase() === 'openai') {
    return 'Invalid providerKey: "openai" is reserved for the built-in OpenAI provider';
  }
  return '';
}

module.exports = (config) => {
  /**
   * GET /api/codex/channels
   * 获取所有 Codex 渠道（包含健康状态）
   */
  router.get('/', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.json({
          channels: [],
          error: 'Codex CLI not installed'
        });
      }

      const data = getChannels();
      // 为每个渠道添加健康状态
      const channelsWithHealth = (data.channels || []).map(ch => ({
        ...ch,
        health: getChannelHealthStatus(ch.id, 'codex')
      }));
      res.json({ channels: channelsWithHealth });
    } catch (err) {
      console.error('[Codex Channels API] Failed to get channels:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/codex/channels/:id/models
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

      const gatewaySourceType = CODEX_GATEWAY_SOURCE_TYPE;
      const models = [getDefaultCodexModel()];
      const result = {
        models,
        supported: models.length > 0,
        cached: false,
        fallbackUsed: false,
        lastChecked: new Date().toISOString(),
        error: models.length > 0 ? null : '未配置默认模型列表',
        errorHint: models.length > 0 ? null : '请在设置中配置 Codex 默认模型'
      };

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
      console.error('[Codex Channels API] Error fetching models:', error);
      res.status(500).json({
        error: '获取模型列表失败',
        channelId: req.params.id
      });
    }
  });

  /**
   * POST /api/codex/channels
   * 创建新渠道
   * Body: { name, providerKey, baseUrl, apiKey, websiteUrl }
   */
  router.post('/', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const {
        name,
        providerKey,
        baseUrl,
        apiKey,
        websiteUrl,
        enabled,
        weight,
        maxConcurrency,
        modelRedirects,
        speedTestModel,
        presetId,
        gatewaySourceType,
        balanceToken,
        balanceUserId
      } = req.body;

      if (!name || !providerKey || !baseUrl) {
        return res.status(400).json({ error: 'Missing required fields: name, providerKey, baseUrl' });
      }

      if (!apiKey) {
        return res.status(400).json({ error: 'Missing required fields: apiKey' });
      }

      const providerKeyError = validateCodexProviderKey(providerKey);
      if (providerKeyError) {
        return res.status(400).json({ error: providerKeyError });
      }

      // wireApi 固定为 'responses' (OpenAI Responses API 格式)
      const channel = createChannel(name, providerKey, baseUrl, apiKey, 'responses', {
        websiteUrl,
        enabled,
        weight,
        maxConcurrency,
        modelRedirects: modelRedirects || [],
        speedTestModel: speedTestModel || null,
        presetId: presetId || null,
        gatewaySourceType,
        balanceToken: balanceToken || '',
        balanceUserId: balanceUserId || null,
        requiresOpenaiAuth: false
      });
      res.json(channel);
      broadcastSchedulerState('codex', getSchedulerState('codex'));
    } catch (err) {
      console.error('[Codex Channels API] Failed to create channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/codex/channels/:channelId
   * 更新渠道
   */
  router.put('/:channelId', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { channelId } = req.params;
      const updates = req.body;
      const currentChannel = getChannels().channels.find(channel => channel.id === channelId) || null;
      const finalApiKey = Object.prototype.hasOwnProperty.call(updates, 'apiKey')
        ? updates.apiKey
        : currentChannel?.apiKey;
      if (Object.prototype.hasOwnProperty.call(updates, 'providerKey')) {
        const providerKeyError = validateCodexProviderKey(updates.providerKey);
        if (providerKeyError) {
          return res.status(400).json({ error: providerKeyError });
        }
      }
      if (currentChannel) {
        if (!finalApiKey) {
          return res.status(400).json({ error: 'Missing required fields: apiKey' });
        }
        updates.requiresOpenaiAuth = false;
      }

      const channel = updateChannel(channelId, updates);
      // 清除该渠道的模型重定向日志缓存，使下次请求时重新打印
      clearCodexRedirectCache(channelId);
      res.json(channel);
      broadcastSchedulerState('codex', getSchedulerState('codex'));
    } catch (err) {
      if (err?.message === 'Channel not found') {
        console.warn(`[Codex Channels API] Ignored update for missing channel: ${req.params.channelId}`);
        return res.status(404).json({ error: 'Channel not found' });
      }
      console.error('[Codex Channels API] Failed to update channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/codex/channels/:channelId
   * 删除渠道
   */
  router.delete('/:channelId', async (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { channelId } = req.params;
      const result = await deleteChannel(channelId);
      res.json(result);
      broadcastSchedulerState('codex', getSchedulerState('codex'));
    } catch (err) {
      console.error('[Codex Channels API] Failed to delete channel:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/codex/channels/order
   * 保存渠道顺序
   */
  router.post('/order', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { order } = req.body;

      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array' });
      }

      saveChannelOrder(order);
      res.json({ success: true });
    } catch (err) {
      console.error('[Codex Channels API] Failed to save channel order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/codex/channels/enabled
   * 获取所有启用的渠道（供调度器使用）
   */
  router.get('/enabled', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.json({ channels: [] });
      }

      const channels = getEnabledChannels();
      res.json({ channels });
    } catch (err) {
      console.error('[Codex Channels API] Failed to get enabled channels:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/codex/channels/:channelId/speed-test
   * 测试单个渠道速度
   */
  router.post('/:channelId/speed-test', async (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { channelId } = req.params;
      const { timeout = 10000 } = req.body;
      const data = getChannels();
      const channel = data.channels.find(ch => ch.id === channelId);

      if (!channel) {
        return res.status(404).json({ error: '渠道不存在' });
      }

      const speedTestType = CODEX_GATEWAY_SOURCE_TYPE;
      const result = await testChannelSpeed(channel, timeout, speedTestType);
      result.level = getLatencyLevel(result.latency);
      result.gatewaySourceType = speedTestType;

      res.json(result);
    } catch (error) {
      console.error('[Codex Channels API] Error testing channel speed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/codex/channels/speed-test-all
   * 测试所有渠道速度
   */
  router.post('/speed-test-all', async (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.json({ results: [], message: 'Codex CLI not installed' });
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
          const speedTestType = CODEX_GATEWAY_SOURCE_TYPE;
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
      console.error('[Codex Channels API] Error testing all channels speed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/codex/channels/:channelId/apply-to-settings
   * 将渠道应用到 Codex 配置文件
   */
  router.post('/:channelId/apply-to-settings', async (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { channelId } = req.params;
      const channel = applyChannelToSettings(channelId);

      // 如果代理正在运行，停止它
      const { getCodexProxyStatus, stopCodexProxyServer } = require('../codex-proxy-server');
      const proxyStatus = getCodexProxyStatus();

      if (proxyStatus && proxyStatus.running) {
        console.log(`Codex proxy is running, stopping to apply channel settings: ${channel.name}`);
        await stopCodexProxyServer({ clearStartTime: false });
        deleteBackup();
        try {
          fs.unlinkSync(PATHS.activeChannel.codex);
        } catch {
          // ignore missing active channel marker
        }

        broadcastLog({
          type: 'action',
          action: 'stop_proxy',
          message: `已停止动态切换，默认使用当前渠道`,
          timestamp: Date.now(),
          source: 'codex'
        });
      }

      broadcastLog({
        type: 'action',
        action: 'apply_settings',
        message: `已将 (${channel.name}) 渠道写入配置文件中`,
        channelName: channel.name,
        timestamp: Date.now(),
        source: 'codex'
      });

      res.json({
        message: `已将 (${channel.name}) 渠道写入配置文件中`,
        channel
      });
    } catch (error) {
      console.error('[Codex Channels API] Error applying channel to settings:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/codex/channels/:channelId/reset-health
   * 重置渠道健康状态
   */
  router.post('/:channelId/reset-health', (req, res) => {
    try {
      if (!isCodexInstalled()) {
        return res.status(404).json({ error: 'Codex CLI not installed' });
      }

      const { channelId } = req.params;
      resetChannelHealth(channelId, 'codex');
      broadcastSchedulerState('codex', getSchedulerState('codex'));

      res.json({
        success: true,
        message: '渠道健康状态已重置',
        health: getChannelHealthStatus(channelId, 'codex')
      });
    } catch (error) {
      console.error('[Codex Channels API] Error resetting channel health:', error);
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
