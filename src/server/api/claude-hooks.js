const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

// Claude settings.json 路径
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// UI 配置路径（记录用户是否主动关闭过、飞书配置等）
const UI_CONFIG_PATH = path.join(os.homedir(), '.cc-tool', 'ui-config.json');

// 通知脚本路径（用于飞书通知）
const NOTIFY_SCRIPT_PATH = path.join(os.homedir(), '.cc-tool', 'notify-hook.js');

// 检测操作系统
const platform = os.platform(); // 'darwin' | 'win32' | 'linux'

// 读取 Claude settings.json
function readClaudeSettings() {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      const content = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8');
      return JSON.parse(content);
    }
    return {};
  } catch (error) {
    console.error('Failed to read Claude settings:', error);
    return {};
  }
}

// 写入 Claude settings.json
function writeClaudeSettings(settings) {
  try {
    const dir = path.dirname(CLAUDE_SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to write Claude settings:', error);
    return false;
  }
}

// 读取 UI 配置
function readUIConfig() {
  try {
    if (fs.existsSync(UI_CONFIG_PATH)) {
      const content = fs.readFileSync(UI_CONFIG_PATH, 'utf8');
      return JSON.parse(content);
    }
    return {};
  } catch (error) {
    return {};
  }
}

// 写入 UI 配置
function writeUIConfig(config) {
  try {
    const dir = path.dirname(UI_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(UI_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to write UI config:', error);
    return false;
  }
}

// 生成系统通知命令（跨平台）
function generateSystemNotificationCommand(type) {
  if (platform === 'darwin') {
    // macOS
    if (type === 'dialog') {
      return `osascript -e 'display dialog "Claude Code 任务已完成 | 等待交互" with title "Coding Tool" buttons {"好的"} default button 1 with icon note'`;
    } else {
      // 优先使用 terminal-notifier（点击可打开终端），否则使用 osascript
      // terminal-notifier 需要 brew install terminal-notifier
      return `if command -v terminal-notifier &>/dev/null; then terminal-notifier -title "Coding Tool" -message "任务已完成 | 等待交互" -sound Glass -activate com.apple.Terminal; else osascript -e 'display notification "任务已完成 | 等待交互" with title "Coding Tool" sound name "Glass"'; fi`;
    }
  } else if (platform === 'win32') {
    // Windows
    if (type === 'dialog') {
      return `powershell -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Claude Code 任务已完成 | 等待交互', 'Coding Tool', 'OK', 'Information')"`;
    } else {
      return `powershell -Command "$wshell = New-Object -ComObject Wscript.Shell; $wshell.Popup('任务已完成 | 等待交互', 5, 'Coding Tool', 0x40)"`;
    }
  } else {
    // Linux
    if (type === 'dialog') {
      return `zenity --info --title="Coding Tool" --text="Claude Code 任务已完成 | 等待交互" 2>/dev/null || notify-send "Coding Tool" "任务已完成 | 等待交互"`;
    } else {
      return `notify-send "Coding Tool" "任务已完成 | 等待交互"`;
    }
  }
}

// 生成通知脚本内容（支持系统通知 + 飞书通知）
function generateNotifyScript(config) {
  const { systemNotification, feishu } = config;

  let script = `#!/usr/bin/env node
// CC-Tool 通知脚本 - 自动生成，请勿手动修改
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const os = require('os');

const platform = os.platform();
const timestamp = new Date().toLocaleString('zh-CN');

`;

  // 系统通知部分
  if (systemNotification && systemNotification.enabled) {
    const cmd = generateSystemNotificationCommand(systemNotification.type);
    script += `// 系统通知
try {
  execSync(${JSON.stringify(cmd)}, { stdio: 'ignore' });
} catch (e) {
  console.error('系统通知失败:', e.message);
}

`;
  }

  // 飞书通知部分
  if (feishu && feishu.enabled && feishu.webhookUrl) {
    script += `// 飞书通知
const feishuUrl = ${JSON.stringify(feishu.webhookUrl)};
const feishuData = JSON.stringify({
  msg_type: 'interactive',
  card: {
    header: {
      title: { tag: 'plain_text', content: '🎉 Coding Tool - 任务完成' },
      template: 'green'
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: '**状态**: Claude Code 任务已完成 | 等待交互' }
      },
      {
        tag: 'div',
        text: { tag: 'lark_md', content: '**时间**: ' + timestamp }
      },
      {
        tag: 'div',
        text: { tag: 'lark_md', content: '**设备**: ' + os.hostname() }
      }
    ]
  }
});

try {
  const urlObj = new URL(feishuUrl);
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(feishuData)
    },
    timeout: 10000
  };

  const reqModule = urlObj.protocol === 'https:' ? https : http;
  const req = reqModule.request(options, (res) => {
    // 忽略响应
  });
  req.on('error', (e) => {
    console.error('飞书通知失败:', e.message);
  });
  req.write(feishuData);
  req.end();
} catch (e) {
  console.error('飞书通知失败:', e.message);
}
`;
  }

  return script;
}

// 写入通知脚本
function writeNotifyScript(config) {
  try {
    const dir = path.dirname(NOTIFY_SCRIPT_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const script = generateNotifyScript(config);
    fs.writeFileSync(NOTIFY_SCRIPT_PATH, script, { mode: 0o755 });
    return true;
  } catch (error) {
    console.error('Failed to write notify script:', error);
    return false;
  }
}

// 从现有 hooks 配置中解析 Stop hook 状态
function parseStopHookStatus(settings) {
  const hooks = settings.hooks;
  if (!hooks || !hooks.Stop || !Array.isArray(hooks.Stop) || hooks.Stop.length === 0) {
    return { enabled: false, type: 'notification' };
  }

  const stopHook = hooks.Stop[0];
  if (!stopHook.hooks || !Array.isArray(stopHook.hooks) || stopHook.hooks.length === 0) {
    return { enabled: false, type: 'notification' };
  }

  const command = stopHook.hooks[0].command || '';

  // 判断通知类型（跨平台检测）
  const isDialog = command.includes('display dialog') ||
                   command.includes('MessageBox') ||
                   command.includes('zenity --info');
  const isNotification = command.includes('display notification') ||
                         command.includes('Popup') ||
                         command.includes('notify-send');

  // 检查是否是我们的通知脚本
  const isOurScript = command.includes('notify-hook.js');

  if (isDialog || isNotification || isOurScript) {
    return {
      enabled: true,
      type: isDialog ? 'dialog' : 'notification'
    };
  }

  return { enabled: false, type: 'notification' };
}

// 获取飞书配置
function getFeishuConfig() {
  const uiConfig = readUIConfig();
  return {
    enabled: uiConfig.feishuNotification?.enabled || false,
    webhookUrl: uiConfig.feishuNotification?.webhookUrl || ''
  };
}

// 保存飞书配置
function saveFeishuConfig(feishu) {
  const uiConfig = readUIConfig();
  uiConfig.feishuNotification = {
    enabled: feishu.enabled || false,
    webhookUrl: feishu.webhookUrl || ''
  };
  return writeUIConfig(uiConfig);
}

// 更新 Stop hook 配置
function updateStopHook(systemNotification, feishu) {
  const settings = readClaudeSettings();

  // 检查是否有任何通知需要启用
  const hasSystemNotification = systemNotification && systemNotification.enabled;
  const hasFeishu = feishu && feishu.enabled && feishu.webhookUrl;

  if (!hasSystemNotification && !hasFeishu) {
    // 都关闭了，移除 Stop hook
    if (settings.hooks && settings.hooks.Stop) {
      delete settings.hooks.Stop;
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }
    // 删除通知脚本
    if (fs.existsSync(NOTIFY_SCRIPT_PATH)) {
      fs.unlinkSync(NOTIFY_SCRIPT_PATH);
    }
  } else {
    // 生成并写入通知脚本
    writeNotifyScript({ systemNotification, feishu });

    // 更新 Stop hook 指向通知脚本
    settings.hooks = settings.hooks || {};
    settings.hooks.Stop = [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${NOTIFY_SCRIPT_PATH}"`
          }
        ]
      }
    ];
  }

  return writeClaudeSettings(settings);
}

// 初始化默认 hooks 配置（服务启动时调用）
function initDefaultHooks() {
  try {
    const uiConfig = readUIConfig();

    // 如果用户主动关闭过通知，不自动开启
    if (uiConfig.claudeNotificationDisabledByUser === true) {
      console.log('[Claude Hooks] 用户已主动关闭通知，跳过自动初始化');
      return;
    }

    const settings = readClaudeSettings();
    const currentStatus = parseStopHookStatus(settings);

    // 如果已经有 Stop hook 配置，不覆盖
    if (currentStatus.enabled) {
      console.log('[Claude Hooks] 已存在 Stop hook 配置，跳过初始化');
      return;
    }

    // 写入默认配置（右上角卡片通知）
    const systemNotification = { enabled: true, type: 'notification' };
    const feishu = getFeishuConfig();

    if (updateStopHook(systemNotification, feishu)) {
      console.log('[Claude Hooks] 已自动开启任务完成通知（右上角卡片）');
    }
  } catch (error) {
    console.error('[Claude Hooks] 初始化默认配置失败:', error);
  }
}

// GET /api/claude/hooks - 获取 hooks 配置状态
router.get('/', (req, res) => {
  try {
    const settings = readClaudeSettings();
    const stopHook = parseStopHookStatus(settings);
    const feishu = getFeishuConfig();

    res.json({
      success: true,
      stopHook,
      feishu,
      platform
    });
  } catch (error) {
    console.error('Error getting Claude hooks:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/claude/hooks - 保存 hooks 配置
router.post('/', (req, res) => {
  try {
    const { stopHook, feishu } = req.body;

    // 保存飞书配置到 UI 配置文件
    if (feishu !== undefined) {
      saveFeishuConfig(feishu);
    }

    // 更新 Stop hook
    const systemNotification = stopHook ? {
      enabled: stopHook.enabled,
      type: stopHook.type || 'notification'
    } : { enabled: false, type: 'notification' };

    const feishuConfig = feishu || getFeishuConfig();

    // 更新用户关闭标记
    const uiConfig = readUIConfig();
    if (systemNotification.enabled || feishuConfig.enabled) {
      // 用户开启了通知，清除关闭标记
      if (uiConfig.claudeNotificationDisabledByUser) {
        delete uiConfig.claudeNotificationDisabledByUser;
        writeUIConfig(uiConfig);
      }
    } else {
      // 用户关闭了所有通知
      uiConfig.claudeNotificationDisabledByUser = true;
      writeUIConfig(uiConfig);
    }

    if (updateStopHook(systemNotification, feishuConfig)) {
      res.json({
        success: true,
        message: '配置已保存',
        stopHook: systemNotification,
        feishu: feishuConfig
      });
    } else {
      res.status(500).json({ error: '保存配置失败' });
    }
  } catch (error) {
    console.error('Error saving Claude hooks:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/claude/hooks/test - 测试通知
router.post('/test', (req, res) => {
  try {
    const { type, testFeishu, webhookUrl } = req.body;

    if (testFeishu && webhookUrl) {
      // 测试飞书通知
      const urlObj = new URL(webhookUrl);
      const data = JSON.stringify({
        msg_type: 'interactive',
        card: {
          header: {
            title: { tag: 'plain_text', content: '🧪 Coding Tool - 测试通知' },
            template: 'blue'
          },
          elements: [
            {
              tag: 'div',
              text: { tag: 'lark_md', content: '**状态**: 这是一条测试通知' }
            },
            {
              tag: 'div',
              text: { tag: 'lark_md', content: '**时间**: ' + new Date().toLocaleString('zh-CN') }
            },
            {
              tag: 'div',
              text: { tag: 'lark_md', content: '**设备**: ' + os.hostname() }
            }
          ]
        }
      });

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 10000
      };

      const reqModule = urlObj.protocol === 'https:' ? https : http;
      const request = reqModule.request(options, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          res.json({ success: true, message: '飞书测试通知已发送' });
        });
      });

      request.on('error', (e) => {
        res.status(500).json({ error: '飞书通知发送失败: ' + e.message });
      });

      request.write(data);
      request.end();
    } else {
      // 测试系统通知
      const command = generateSystemNotificationCommand(type || 'notification');
      const { execSync } = require('child_process');
      execSync(command, { stdio: 'ignore' });
      res.json({ success: true, message: '系统测试通知已发送' });
    }
  } catch (error) {
    console.error('Error testing notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// 导出初始化函数供服务启动时调用
module.exports = router;
module.exports.initDefaultHooks = initDefaultHooks;
