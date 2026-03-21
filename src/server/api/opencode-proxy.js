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
  deleteBackup,
  isProxyConfig,
  getCurrentProxyPort,
  readConfig,
  selectConfigPath
} = require('../services/opencode-settings-manager');
const {
  getChannels,
  getEnabledChannels,
  applyChannelToSettings,
  getEffectiveApiKeyCandidates
} = require('../services/opencode-channels');
const { getSchedulerState } = require('../services/channel-scheduler');
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

function selectLatestEnabledChannel(channels) {
  if (!Array.isArray(channels) || channels.length === 0) return null;
  const enabledChannels = channels.filter(ch => ch.enabled !== false);
  if (enabledChannels.length === 0) return null;
  return enabledChannels.reduce((latest, current) => {
    const latestTs = Number(latest?.updatedAt || latest?.createdAt || 0);
    const currentTs = Number(current?.updatedAt || current?.createdAt || 0);
    return currentTs > latestTs ? current : latest;
  }, enabledChannels[0]);
}

function resolveActiveChannel(channels, activeChannelId = null) {
  if (!Array.isArray(channels) || channels.length === 0) {
    return null;
  }

  if (activeChannelId) {
    const matched = channels.find(channel => channel.id === activeChannelId);
    if (matched) {
      return matched;
    }
  }

  return selectLatestEnabledChannel(channels)
    || channels.find(channel => channel.enabled !== false)
    || channels[0]
    || null;
}

function sanitizeManagedProviderId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'channel';
}

function getCurrentProviderIdFromConfig(config) {
  const modelRef = String(config?.model || '').trim();
  if (modelRef.includes('/')) {
    return modelRef.split('/')[0].trim();
  }

  const providerIds = config?.provider && typeof config.provider === 'object'
    ? Object.keys(config.provider).filter(Boolean)
    : [];

  return providerIds.length === 1 ? providerIds[0] : '';
}

function getManagedProviderIdsForChannel(channel) {
  const providerKey = String(channel?.providerKey || '').trim();
  const fallbackName = String(channel?.name || '').trim();
  const base = providerKey || fallbackName || 'ctx-channel';
  return new Set([
    providerKey,
    sanitizeManagedProviderId(base)
  ].filter(Boolean));
}

function findActiveChannelFromNativeConfig(channels = []) {
  if (!Array.isArray(channels) || channels.length === 0) {
    return null;
  }

  try {
    const configPath = selectConfigPath();
    if (!configPath || !fs.existsSync(configPath)) {
      return null;
    }

    const config = readConfig(configPath);
    const providerId = getCurrentProviderIdFromConfig(config);
    const provider = providerId && config?.provider && typeof config.provider === 'object'
      ? config.provider[providerId]
      : null;
    const baseUrl = String(provider?.options?.baseURL || '').trim();
    const apiKey = String(provider?.options?.apiKey || '').trim();

    if (providerId) {
      const providerMatched = channels.find((channel) => getManagedProviderIdsForChannel(channel).has(providerId));
      if (providerMatched) {
        return providerMatched;
      }
    }

    if (baseUrl && apiKey) {
      const exactMatched = channels.find((channel) => (
        channel.baseUrl === baseUrl && getEffectiveApiKeyCandidates(channel).includes(apiKey)
      ));
      if (exactMatched) {
        return exactMatched;
      }
    }

    if (baseUrl) {
      return channels.find((channel) => channel.baseUrl === baseUrl) || null;
    }
  } catch (error) {
    console.warn('[OpenCode Proxy] Failed to infer native active channel:', error.message);
  }

  return null;
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

function loadActiveChannelId() {
  ensureStorageDirMigrated();
  const filePath = PATHS.activeChannel.opencode;
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      return data.activeChannelId || null;
    }
  } catch (error) {
    console.error('[OpenCode Proxy] Error loading active channel ID:', error);
  }
  return null;
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
    const activeChannel = resolveActiveChannel(channels, loadActiveChannelId());
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
    if (enabledChannels.length === 0) {
      return res.status(400).json({
        error: 'No enabled OpenCode channel found. Please create and enable a channel first.'
      });
    }

    const { channels: allChannels } = getChannels();
    const currentChannel = findActiveChannelFromNativeConfig(allChannels) || enabledChannels[0];

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

    const primaryProxyChannel = enabledChannels[0] || currentChannel;
    const activeModel = primaryProxyChannel?.model || primaryProxyChannel?.speedTestModel || null;
    setProxyConfig(proxyResult.port, { channels: channelPayloads, model: activeModel });

    // 5. 广播状态更新
    const { broadcastProxyState } = require('../websocket-server');
    const updatedStatus = getOpenCodeProxyStatus();
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
    const { channels } = getChannels();
    const activeChannelId = loadActiveChannelId();
    const activeChannel = resolveActiveChannel(channels, activeChannelId);

    // 2. 停止代理服务器
    const proxyResult = await stopOpenCodeProxyServer();
    const hadBackup = hasBackup();

    // 3. 删除激活渠道文件
    removeActiveChannelFile();

    // 4. 恢复单渠道模式
    // 不恢复整个备份，避免覆盖用户在动态切换期间对 MCP 等配置的修改
    if (hadBackup) {
      deleteBackup();
      console.log('[OpenCode Proxy] Discarded backup (MCP changes preserved)');
    }

    // 5. 停止动态切换后回到单渠道模式：保留激活渠道，禁用其他渠道
    if (activeChannel) {
      applyChannelToSettings(activeChannel.id);
      console.log(`[OpenCode Proxy] Single-channel mode restored: ${activeChannel.name}`);
    }

    // 6. 广播状态更新（使用最新渠道列表，刷新前端缓存）
    const { broadcastProxyState, broadcastSchedulerState } = require('../websocket-server');
    const updatedStatus = getOpenCodeProxyStatus();
    const { channels: latestChannels } = getChannels();
    const latestActiveChannel = latestChannels.find(ch => ch.enabled !== false) || null;
    broadcastProxyState('opencode', updatedStatus, latestActiveChannel, latestChannels);
    broadcastSchedulerState('opencode', getSchedulerState('opencode'));

    res.json({
      success: true,
      message: `OpenCode proxy stopped${latestActiveChannel ? ' (channel: ' + latestActiveChannel.name + ')' : ''}`,
      port: proxyResult.port,
      restoredChannel: latestActiveChannel?.name || null
    });
  } catch (error) {
    console.error('[OpenCode Proxy] Error stopping proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
