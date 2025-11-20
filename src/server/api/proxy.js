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
    const apiKey = settings?.env?.ANTHROPIC_API_KEY || '';

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
    const configStatus = {
      isProxyConfig: isProxyConfig(),
      settingsExists: settingsExists(),
      hasBackup: hasBackup(),
      currentProxyPort: getCurrentProxyPort()
    };

    res.json({
      proxy: proxyStatus,
      config: configStatus
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
    const configResult = setProxyConfig(proxyResult.port);

    res.json({
      success: true,
      port: proxyResult.port,
      activeChannel: currentChannel.name,
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
    // 1. 读取当前激活的渠道（从 active-channel.json）
    const channels = getAllChannels();
    const activeChannel = channels.find(ch => ch.isActive);

    // 2. 停止代理服务器
    const proxyResult = await stopProxyServer();

    // 3. 将当前激活渠道写入 settings.json
    if (activeChannel) {
      const { updateClaudeSettings } = require('../services/channels');
      updateClaudeSettings(activeChannel.baseUrl, activeChannel.apiKey);
      console.log(`✅ Restored settings to channel: ${activeChannel.name}`);

      // 删除备份文件
      if (hasBackup()) {
        const backupPath = path.join(os.homedir(), '.claude', 'settings.json.cc-tool-backup');
        fs.unlinkSync(backupPath);
        console.log('✅ Removed backup file');
      }

      // 删除 active-channel.json
      const activeChannelPath = path.join(os.homedir(), '.claude', 'cc-tool', 'active-channel.json');
      if (fs.existsSync(activeChannelPath)) {
        fs.unlinkSync(activeChannelPath);
        console.log('✅ Removed active-channel.json');
      }

      res.json({
        success: true,
        message: `代理已停止，配置已恢复到渠道: ${activeChannel.name}`,
        port: proxyResult.port,
        restoredChannel: activeChannel.name
      });
    } else {
      // 没有激活渠道，恢复备份
      if (hasBackup()) {
        restoreSettings();
        res.json({
          success: true,
          message: '代理已停止，配置已从备份恢复',
          port: proxyResult.port
        });
      } else {
        res.json({
          success: true,
          message: '代理已停止（无备份可恢复）',
          port: proxyResult.port
        });
      }
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
