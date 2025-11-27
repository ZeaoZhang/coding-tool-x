const express = require('express');
const router = express.Router();
const { startProxyServer, stopProxyServer, getProxyStatus } = require('../proxy-server');
const {
  setProxyConfig,
  restoreSettings,
  isProxyConfig,
  getCurrentProxyPort,
  settingsExists,
  hasBackup,
  readSettings
} = require('../services/settings-manager');
const { getAllChannels } = require('../services/channels');
const { clearAllLogs } = require('../websocket-server');
const fs = require('fs');
const path = require('path');
const os = require('os');

function sanitizeChannelForResponse(channel) {
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
  const dir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, 'active-channel.json');
  fs.writeFileSync(filePath, JSON.stringify({ activeChannelId: channelId }, null, 2), 'utf8');
}

// 从 settings.json 找到当前激活的渠道
function findActiveChannelFromSettings() {
  try {
    const settings = readSettings();
    const baseUrl = settings?.env?.ANTHROPIC_BASE_URL || '';

    // 兼容多种 API Key 格式（与 channels.js 保持一致）
    let apiKey = settings?.env?.ANTHROPIC_API_KEY ||        // 标准格式
                 settings?.env?.ANTHROPIC_AUTH_TOKEN ||     // 88code等平台格式
                 '';

    // 如果 apiKey 仍为空，尝试从 apiKeyHelper 提取
    if (!apiKey && settings?.apiKeyHelper) {
      const match = settings.apiKeyHelper.match(/['"]([^'"]+)['"]/);
      if (match && match[1]) {
        apiKey = match[1];
      }
    }

    if (!baseUrl || !apiKey || baseUrl.includes('127.0.0.1')) {
      return null;
    }

    // 找到匹配的渠道
    const channels = getAllChannels();
    const matchingChannel = channels.find(ch =>
      ch.baseUrl === baseUrl && ch.apiKey === apiKey
    );

    return matchingChannel;
  } catch (err) {
    console.error('Error finding active channel:', err);
    return null;
  }
}

// 获取代理状态
router.get('/status', (req, res) => {
  try {
    const proxyStatus = getProxyStatus();
    const channels = getAllChannels();
    const configStatus = {
      isProxyConfig: isProxyConfig(),
      settingsExists: settingsExists(),
      hasBackup: hasBackup(),
      currentProxyPort: getCurrentProxyPort()
    };

    res.json({
      proxy: proxyStatus,
      config: configStatus,
      channelsCount: channels.length,
      enabledChannelsCount: channels.filter(ch => ch.enabled !== false).length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启动代理
router.post('/start', async (req, res) => {
  try {
    // 1. 检查配置文件是否存在
    if (!settingsExists()) {
      return res.status(400).json({
        error: 'Claude Code settings.json not found. Please run Claude Code at least once.'
      });
    }

    // 2. 从 settings.json 找到当前使用的渠道
    const currentChannel = findActiveChannelFromSettings();
    if (!currentChannel) {
      return res.status(400).json({
        error: '无法从 settings.json 识别当前渠道。请先激活一个渠道。'
      });
    }

    // 3. 保存当前激活渠道ID（用于代理模式）
    saveActiveChannelId(currentChannel.id);
    console.log(`✅ Saved active channel: ${currentChannel.name} (${currentChannel.id})`);

    // 4. 启动代理服务器
    const proxyResult = await startProxyServer();

    if (!proxyResult.success) {
      return res.status(500).json({ error: 'Failed to start proxy server' });
    }

    // 5. 设置代理配置（备份并修改 settings.json）
    setProxyConfig(proxyResult.port);

    const updatedStatus = getProxyStatus();
    const channels = getAllChannels();
    const activeChannel = channels.find(ch => ch.isActive);

    // 6. 通过 WebSocket 推送代理状态更新
    const { broadcastProxyState } = require('../websocket-server');
    broadcastProxyState('claude', updatedStatus, activeChannel, channels);

    res.json({
      success: true,
      port: proxyResult.port,
      activeChannel: sanitizeChannelForResponse(currentChannel),
      message: `代理已启动在端口 ${proxyResult.port}，当前渠道: ${currentChannel.name}`
    });
  } catch (error) {
    console.error('Error starting proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

// 停止代理
router.post('/stop', async (req, res) => {
  try {
    // 1. 停止代理服务器
    const proxyResult = await stopProxyServer();

    // 2. 恢复配置（优先从备份，否则选择权重最高的启用渠道）
    let restoredChannel = null;

    // 优先尝试从备份恢复
    if (hasBackup()) {
      restoreSettings();
      console.log('✅ Restored settings from backup');

      // 尝试找到匹配的渠道
      const channels = getAllChannels();
      const currentSettings = require('../services/channels').getCurrentSettings();
      if (currentSettings) {
        restoredChannel = channels.find(ch =>
          ch.baseUrl === currentSettings.baseUrl && ch.apiKey === currentSettings.apiKey
        );
      }
    } else {
      // 没有备份，选择权重最高的启用渠道
      const { getBestChannelForRestore, updateClaudeSettings } = require('../services/channels');
      restoredChannel = getBestChannelForRestore();

      if (restoredChannel) {
        updateClaudeSettings(restoredChannel.baseUrl, restoredChannel.apiKey);
        console.log(`✅ Restored settings to best channel: ${restoredChannel.name}`);
      }
    }

    // 3. 删除备份文件和active-channel.json
    if (hasBackup()) {
      const backupPath = path.join(os.homedir(), '.claude', 'settings.json.cc-tool-backup');
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        console.log('✅ Removed backup file');
      }
    }

    const activeChannelPath = path.join(os.homedir(), '.claude', 'cc-tool', 'active-channel.json');
    if (fs.existsSync(activeChannelPath)) {
      fs.unlinkSync(activeChannelPath);
      console.log('✅ Removed active-channel.json');
    }

    // 4. 通过 WebSocket 推送代理状态更新
    const { broadcastProxyState } = require('../websocket-server');
    const updatedStatus = getProxyStatus();
    const channels = getAllChannels();
    broadcastProxyState('claude', updatedStatus, null, channels);

    if (restoredChannel) {
      res.json({
        success: true,
        message: `代理已停止，配置已恢复到渠道: ${restoredChannel.name}`,
        port: proxyResult.port,
        restoredChannel: restoredChannel.name
      });
    } else {
      res.json({
        success: true,
        message: '代理已停止（无配置可恢复）',
        port: proxyResult.port
      });
    }
  } catch (error) {
    console.error('Error stopping proxy:', error);
    res.status(500).json({ error: error.message });
  }
});

// 清空日志
router.post('/logs/clear', (req, res) => {
  try {
    clearAllLogs();
    res.json({ success: true, message: '日志已清空' });
  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
