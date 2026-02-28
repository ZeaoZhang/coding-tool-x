const express = require('express');
const router = express.Router();
const {
  startOpenCodeProxyServer,
  stopOpenCodeProxyServer,
  getOpenCodeProxyStatus,
  collectProxyModelList
} = require('../opencode-proxy-server');
const {
  configExists,
  hasBackup,
  setProxyConfig,
  restoreSettings,
  isProxyConfig,
  getCurrentProxyPort
} = require('../services/opencode-settings-manager');
const { getChannels, getEnabledChannels } = require('../services/opencode-channels');
const { PATHS, ensureStorageDirMigrated } = require('../../config/paths');
const fs = require('fs');
const path = require('path');

function sanitizeChannel(channel) {
  if (!channel) return null;
  return {
    id: channel.id,
    name: channel.name,
    baseUrl: channel.baseUrl,
    websiteUrl: channel.websiteUrl
  };
}

// 保存激活渠道ID
function saveActiveChannelId(channelId) {
  ensureStorageDirMigrated();
  const filePath = PATHS.activeChannel.opencode;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
}

// 删除激活渠道文件
function removeActiveChannelFile() {
  ensureStorageDirMigrated();
  const filePath = PATHS.activeChannel.opencode;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log('[OpenCode Proxy] Removed opencode-active-channel.json');
  }
}

// 获取代理状态
router.get('/status', (req, res) => {
  try {
    const proxyStatus = getOpenCodeProxyStatus();
    const { channels } = getChannels();
    const enabledChannels = channels.filter(ch => ch.enabled !== false);
    const activeChannel = enabledChannels[0];
    const configStatus = {
      isProxyConfig: isProxyConfig(),
      configExists: configExists(),
      hasBackup: hasBackup(),
      currentProxyPort: getCurrentProxyPort()
    };

    res.json({
      proxy: proxyStatus,
      config: configStatus,
      activeChannel: sanitizeChannel(activeChannel),
      enabledChannelsCount: enabledChannels.length,
      totalChannelsCount: channels.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动代理
router.post('/start', async (req, res) => {
  try {
    // 1. 获取当前启用的渠道
    const enabledChannels = getEnabledChannels();
    const currentChannel = enabledChannels[0];

    if (!currentChannel) {
      return res.status(400).json({
        error: 'No enabled OpenCode channel found. Please create and enable a channel first.'
      });
    }

    // 2. 保存当前激活渠道ID
    saveActiveChannelId(currentChannel.id);
    console.log(`[OpenCode Proxy] Saved active channel: ${currentChannel.name} (${currentChannel.id})`);

    // 3. 启动代理服务器
    const proxyResult = await startOpenCodeProxyServer();

    if (!proxyResult.success) {
      return res.status(500).json({ error: 'Failed to start OpenCode proxy server' });
    }

    // 4. 设置代理配置（写入 OpenCode 配置文件）
    // 收集每个渠道的模型列表，生成 per-channel provider 配置

    // 若渠道未显式填写模型，回退使用代理聚合模型（来自 /v1/models）。
    let detectedModels = [];
    try {
      detectedModels = await collectProxyModelList(enabledChannels, {
        useCacheOnly: true
      }) || [];
    } catch (error) {
      console.warn('[OpenCode Proxy] Failed to collect proxy models before writing config:', error.message);
    }

    const channelPayloads = enabledChannels.map((ch) => {
      let models;
      if (Array.isArray(ch.allowedModels) && ch.allowedModels.length > 0) {
        models = ch.allowedModels;
      } else {
        const seen = new Set();
        const collected = [];
        const add = (m) => {
          if (typeof m !== 'string') return;
          const t = m.trim();
          if (!t) return;
          const k = t.toLowerCase();
          if (seen.has(k)) return;
          seen.add(k);
          collected.push(t);
        };
        [ch.model, ch.speedTestModel].forEach(add);
        if (ch.modelConfig && typeof ch.modelConfig === 'object') {
          [ch.modelConfig.model, ch.modelConfig.opusModel, ch.modelConfig.sonnetModel, ch.modelConfig.haikuModel].forEach(add);
        }
        if (Array.isArray(ch.modelRedirects)) {
          ch.modelRedirects.forEach(r => { add(r && r.from); add(r && r.to); });
        }
        detectedModels.forEach(add);
        models = collected;
      }
      return {
        name: ch.name,
        providerKey: ch.providerKey || ch.name,
        model: ch.model || null,
        models
      };
    });

    const activeModel = currentChannel.model || currentChannel.speedTestModel || null;
    setProxyConfig(proxyResult.port, { channels: channelPayloads, model: activeModel });

    // 5. 广播状态更新
    const { broadcastProxyState } = require('../websocket-server');
    const updatedStatus = getOpenCodeProxyStatus();
    const { channels: allChannels } = getChannels();
    broadcastProxyState('opencode', updatedStatus, currentChannel, allChannels);

    res.json({
      success: true,
      port: proxyResult.port,
      activeChannel: sanitizeChannel(currentChannel),
      message: `OpenCode proxy started on port ${proxyResult.port}, active channel: ${currentChannel.name}`
    });
  } catch (error) {
    console.error('[OpenCode Proxy] Error starting proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

// 停止代理
router.post('/stop', async (req, res) => {
  try {
    // 1. 获取当前渠道信息
    const { channels } = getChannels();
    const enabledChannels = channels.filter(ch => ch.enabled !== false);
    const activeChannel = enabledChannels[0];

    // 2. 停止代理服务器
    const proxyResult = await stopOpenCodeProxyServer();

    // 3. 删除激活渠道文件
    removeActiveChannelFile();

    // 4. 恢复原始配置
    if (hasBackup()) {
      restoreSettings();
      console.log('[OpenCode Proxy] Restored settings from backup');
    }

    // 5. 广播状态更新
    const { broadcastProxyState } = require('../websocket-server');
    const updatedStatus = getOpenCodeProxyStatus();
    broadcastProxyState('opencode', updatedStatus, activeChannel, channels);

    res.json({
      success: true,
      message: `OpenCode proxy stopped${activeChannel ? ' (channel: ' + activeChannel.name + ')' : ''}`,
      port: proxyResult.port
    });
  } catch (error) {
    console.error('[OpenCode Proxy] Error stopping proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
