const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');
const { PATHS, NATIVE_PATHS } = require('../../config/paths');
const { loadUIConfig, saveUIConfig } = require('./ui-config');
const codexSettingsManager = require('./codex-settings-manager');
const geminiSettingsManager = require('./gemini-settings-manager');

const MANAGED_HOOK_NAME = 'coding-tool-notify';
const MANAGED_OPENCODE_PLUGIN_FILE = 'coding-tool-notify.js';

function normalizeType(type) {
  return type === 'dialog' ? 'dialog' : 'notification';
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim() ? JSON.parse(content) : {};
  } catch (error) {
    return {};
  }
}

function writeJsonFile(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readClaudeSettings() {
  return readJsonFile(NATIVE_PATHS.claude.settings);
}

function writeClaudeSettings(settings) {
  writeJsonFile(NATIVE_PATHS.claude.settings, settings);
}

function getFeishuConfig() {
  const uiConfig = loadUIConfig();
  return {
    enabled: uiConfig.feishuNotification?.enabled === true,
    webhookUrl: uiConfig.feishuNotification?.webhookUrl || ''
  };
}

function applyClaudeDisablePreference(uiConfig = {}, claudeEnabled) {
  const nextConfig = (uiConfig && typeof uiConfig === 'object') ? { ...uiConfig } : {};
  if (claudeEnabled) {
    delete nextConfig.claudeNotificationDisabledByUser;
  } else {
    nextConfig.claudeNotificationDisabledByUser = true;
  }
  return nextConfig;
}

function saveNotificationUiConfig(feishu = {}, claudeEnabled) {
  let uiConfig = loadUIConfig();
  if (typeof claudeEnabled === 'boolean') {
    uiConfig = applyClaudeDisablePreference(uiConfig, claudeEnabled);
  }
  uiConfig.feishuNotification = {
    enabled: feishu.enabled === true,
    webhookUrl: feishu.webhookUrl || ''
  };
  saveUIConfig(uiConfig);
}

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateFeishuWebhookUrl(webhookUrl) {
  const value = String(webhookUrl || '').trim();
  if (!value) {
    return null;
  }

  let urlObj;
  try {
    urlObj = new URL(value);
  } catch (error) {
    throw createValidationError('飞书 Webhook URL 格式不正确');
  }

  if (urlObj.protocol !== 'https:') {
    throw createValidationError('飞书 Webhook 必须使用 HTTPS');
  }

  if (urlObj.hostname !== 'open.feishu.cn') {
    throw createValidationError('仅支持 open.feishu.cn 的飞书 Webhook');
  }

  return urlObj;
}

function removeNotifyScript() {
  if (fs.existsSync(PATHS.notifyHook)) {
    fs.unlinkSync(PATHS.notifyHook);
  }
}

function parseManagedType(input) {
  const value = String(input || '');
  const matches = [
    value.match(/--cc-notify-type=(dialog|notification)/i),
    value.match(/--mode=(dialog|notification)/i),
    value.match(/MODE\s*=\s*["'](dialog|notification)["']/i)
  ];

  for (const match of matches) {
    if (match?.[1]) {
      return normalizeType(match[1].toLowerCase());
    }
  }

  return null;
}

function getManagedCommandType(input) {
  return parseManagedType(input);
}

function isManagedNotifyPath(input) {
  const normalizedInput = String(input || '').replace(/\\/g, '/');
  const normalizedPath = String(PATHS.notifyHook || '').replace(/\\/g, '/');
  return normalizedInput.includes('notify-hook.js') || (normalizedPath && normalizedInput.includes(normalizedPath));
}

function buildManagedArgs(source, type, extra = []) {
  const mode = normalizeType(type);
  return [
    `--source=${source}`,
    `--mode=${mode}`,
    `--cc-notify-type=${mode}`,
    ...extra
  ];
}

function quoteShellArg(value) {
  const stringValue = String(value || '');
  if (/^[A-Za-z0-9_./:=+-]+$/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/"/g, '\\"')}"`;
}

function buildClaudeCommand(type) {
  const mode = normalizeType(type);
  const args = ['node', PATHS.notifyHook, `--source=claude`, `--mode=${mode}`, `--cc-notify-type=${mode}`];
  return `${quoteShellArg(args[0])} ${quoteShellArg(args[1])} ${args.slice(2).map(quoteShellArg).join(' ')}`;
}

function buildCodexNotifyCommand(type) {
  const mode = normalizeType(type);
  return ['node', PATHS.notifyHook, `--source=codex`, `--mode=${mode}`, `--cc-notify-type=${mode}`];
}

function buildGeminiCommand(type) {
  const mode = normalizeType(type);
  const args = ['node', PATHS.notifyHook, `--source=gemini`, `--mode=${mode}`, `--cc-notify-type=${mode}`];
  return `${quoteShellArg(args[0])} ${quoteShellArg(args[1])} ${args.slice(2).map(quoteShellArg).join(' ')}`;
}

function getOpenCodeManagedPluginPath() {
  return path.join(NATIVE_PATHS.opencode.config, 'plugins', MANAGED_OPENCODE_PLUGIN_FILE);
}

function buildOpenCodePluginContent(type) {
  const mode = normalizeType(type);
  return `// Managed by Coding Tool. Do not edit manually.
// mode:${mode}
import { spawn } from 'node:child_process'

const SCRIPT_PATH = ${JSON.stringify(PATHS.notifyHook)}
const MODE = ${JSON.stringify(mode)}

function fire(eventType) {
  try {
    const child = spawn('node', [
      SCRIPT_PATH,
      '--source=opencode',
      \`--mode=\${MODE}\`,
      \`--cc-notify-type=\${MODE}\`,
      \`--event-type=\${eventType}\`
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  } catch (error) {
    // Ignore notification failures.
  }
}

export const CodingToolNotifyPlugin = async () => ({
  event: async ({ event }) => {
    const eventType = event?.type
    if (eventType === 'session.idle' || eventType === 'session.error') {
      fire(eventType)
    }
  }
})
`;
}

function escapeForAppleScript(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeForPowerShellSingleQuote(value) {
  return String(value || '').replace(/'/g, "''");
}

function escapeForXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildWindowsPopupCommand(title, message) {
  return `powershell -NoProfile -Command "$wshell = New-Object -ComObject Wscript.Shell; $wshell.Popup('${escapeForPowerShellSingleQuote(message)}', 5, '${escapeForPowerShellSingleQuote(title)}', 0x40)"`;
}

function generateNotifyScript(feishu = {}) {
  const feishuEnabled = feishu.enabled === true && !!feishu.webhookUrl;

  return `#!/usr/bin/env node
// Coding Tool 通知脚本 - 自动生成，请勿手动修改
const fs = require('fs')
const os = require('os')
const http = require('http')
const https = require('https')
const { execSync } = require('child_process')

const FEISHU_ENABLED = ${feishuEnabled ? 'true' : 'false'}
const FEISHU_WEBHOOK_URL = ${JSON.stringify(feishuEnabled ? feishu.webhookUrl : '')}

function readArg(name) {
  const prefix = \`\${name}=\`
  const matched = process.argv.slice(2).find((arg) => String(arg || '').startsWith(prefix))
  return matched ? matched.slice(prefix.length) : ''
}

function readOptionalPayload() {
  const payloadCandidates = []

  if (!process.stdin.isTTY) {
    try {
      const raw = fs.readFileSync(0, 'utf8').trim()
      if (raw) payloadCandidates.push(raw)
    } catch (error) {
      // ignore stdin read errors
    }
  }

  for (const arg of process.argv.slice(2)) {
    const trimmed = String(arg || '').trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      payloadCandidates.push(trimmed)
    }
  }

  for (const raw of payloadCandidates) {
    try {
      return JSON.parse(raw)
    } catch (error) {
      // ignore malformed payloads
    }
  }

  return null
}

function resolveMessage(source, eventType, payload) {
  const effectiveEventType = eventType || payload?.type || payload?.hook_event?.event_type || ''

  if (source === 'codex') {
    if (effectiveEventType === 'agent-turn-complete') {
      return 'Codex CLI 回合已完成 | 等待交互'
    }
    return 'Codex CLI 已返回结果 | 等待交互'
  }

  if (source === 'gemini') {
    return 'Gemini CLI 回合已完成 | 等待交互'
  }

  if (source === 'opencode') {
    if (effectiveEventType === 'session.error') {
      return 'OpenCode 会话异常，请检查日志'
    }
    return 'OpenCode 响应已完成 | 等待交互'
  }

  return 'Claude Code 任务已完成 | 等待交互'
}

function notify(mode, message) {
  const title = 'Coding Tool'
  const platform = os.platform()

  try {
    if (platform === 'darwin') {
      if (mode === 'dialog') {
        const appleScript = 'display dialog "' + escapeForAppleScript(message) +
          '" with title "' + escapeForAppleScript(title) +
          '" buttons {"好的"} default button 1 with icon note'
        execSync('osascript -e ' + JSON.stringify(appleScript), { stdio: 'ignore', windowsHide: true })
      } else {
        const fallbackScript = 'display notification "' + escapeForAppleScript(message) +
          '" with title "' + escapeForAppleScript(title) + '" sound name "Glass"'
        const command = 'if command -v terminal-notifier >/dev/null 2>&1; then ' +
          'terminal-notifier -title ' + JSON.stringify(title) +
          ' -message ' + JSON.stringify(message) +
          ' -sound Glass -activate com.apple.Terminal; ' +
          'else osascript -e ' + JSON.stringify(fallbackScript) + '; fi'
        execSync(command, { stdio: 'ignore', windowsHide: true })
      }
      return
    }

    if (platform === 'win32') {
      const popupCommand = buildWindowsPopupCommand(title, message)
      if (mode === 'dialog') {
        const ps = "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('" +
          escapeForPowerShellSingleQuote(message) + "', '" +
          escapeForPowerShellSingleQuote(title) + "', 'OK', 'Information')"
        const command = 'powershell -NoProfile -Command ' + JSON.stringify(ps) + ' || ' + popupCommand
        execSync(command, { stdio: 'ignore', windowsHide: true })
      } else {
        const toastXml = '<toast><visual><binding template="ToastGeneric"><text>' +
          escapeForXml(title) + '</text><text>' + escapeForXml(message) +
          '</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>'
        const ps = 'try { ' +
          '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; ' +
          '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null; ' +
          '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument; ' +
          '$xml.LoadXml(\\'' + toastXml.replace(/'/g, "''") + '\\'); ' +
          '$toast = [Windows.UI.Notifications.ToastNotification]::new($xml); ' +
          "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Coding Tool').Show($toast) " +
          "} catch { $wshell = New-Object -ComObject Wscript.Shell; $wshell.Popup('" +
          escapeForPowerShellSingleQuote(message) + "', 5, '" + escapeForPowerShellSingleQuote(title) + "', 0x40) }"
        const command = 'powershell -NoProfile -Command ' + JSON.stringify(ps) + ' || ' + popupCommand
        execSync(command, { stdio: 'ignore', windowsHide: true })
      }
      return
    }

    const escapedTitle = String(title || '').replace(/"/g, '\\"')
    const escapedMessage = String(message || '').replace(/"/g, '\\"')
    if (mode === 'dialog') {
      execSync(
        'zenity --info --title="' + escapedTitle + '" --text="' + escapedMessage +
        '" 2>/dev/null || notify-send "' + escapedTitle + '" "' + escapedMessage + '"',
        { stdio: 'ignore', windowsHide: true }
      )
    } else {
      execSync('notify-send "' + escapedTitle + '" "' + escapedMessage + '"', { stdio: 'ignore', windowsHide: true })
    }
  } catch (error) {
    // ignore system notification failures
  }
}

function sendFeishu(message, source) {
  if (!FEISHU_ENABLED || !FEISHU_WEBHOOK_URL) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    try {
      const urlObj = new URL(FEISHU_WEBHOOK_URL)
      const timestamp = new Date().toLocaleString('zh-CN')
      const data = JSON.stringify({
        msg_type: 'interactive',
        card: {
          header: {
            title: { tag: 'plain_text', content: 'Coding Tool - 通知' },
            template: 'green'
          },
          elements: [
            {
              tag: 'div',
              text: { tag: 'lark_md', content: '**来源**: ' + source }
            },
            {
              tag: 'div',
              text: { tag: 'lark_md', content: '**状态**: ' + message }
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
      })

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
      }

      const requestModule = urlObj.protocol === 'https:' ? https : http
      const request = requestModule.request(options, () => resolve())
      request.on('error', () => resolve())
      request.on('timeout', () => {
        request.destroy()
        resolve()
      })
      request.write(data)
      request.end()
    } catch (error) {
      resolve()
    }
  })
}

(async () => {
  const source = readArg('--source') || 'claude'
  const mode = readArg('--mode') || readArg('--cc-notify-type') || 'notification'
  const eventType = readArg('--event-type') || ''
  const payload = readOptionalPayload()
  const message = resolveMessage(source, eventType, payload)

  notify(mode === 'dialog' ? 'dialog' : 'notification', message)
  await sendFeishu(message, source)
})().catch(() => {
  process.exit(0)
})

function escapeForAppleScript(value) {
  return String(value || '').replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"')
}

function escapeForPowerShellSingleQuote(value) {
  return String(value || '').replace(/'/g, "''")
}

function escapeForXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildWindowsPopupCommand(title, message) {
  return \`powershell -NoProfile -Command "$wshell = New-Object -ComObject Wscript.Shell; $wshell.Popup('\${escapeForPowerShellSingleQuote(message)}', 5, '\${escapeForPowerShellSingleQuote(title)}', 0x40)"\`
}
`;
}

function writeNotifyScript(feishu = {}) {
  ensureParentDir(PATHS.notifyHook);
  fs.writeFileSync(PATHS.notifyHook, generateNotifyScript(feishu), { mode: 0o755 });
}

function getClaudeHookStatus() {
  const settings = readClaudeSettings();
  const stopHooks = Array.isArray(settings?.hooks?.Stop) ? settings.hooks.Stop : [];
  let enabled = false;
  let external = false;
  let type = 'notification';

  stopHooks.forEach((group) => {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    hooks.forEach((hook) => {
      const command = String(hook?.command || '');
      if (!command) return;

      const isManaged = isManagedNotifyPath(command);
      if (isManaged) {
        enabled = true;
        type = parseManagedType(command) || type;
      } else {
        external = true;
      }
    });
  });

  return {
    enabled,
    external,
    type,
    method: 'Stop Hook'
  };
}

function saveClaudeHook(enabled, type) {
  const settings = readClaudeSettings();
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? { ...settings.hooks } : {};
  const currentGroups = Array.isArray(hooks.Stop) ? hooks.Stop : [];

  const filteredGroups = currentGroups.map((group) => {
    const groupHooks = Array.isArray(group?.hooks) ? group.hooks : [];
    const nextHooks = groupHooks.filter((hook) => !isManagedNotifyPath(hook?.command));
    if (nextHooks.length === 0) {
      return null;
    }
    return { ...group, hooks: nextHooks };
  }).filter(Boolean);

  if (enabled) {
    filteredGroups.push({
      hooks: [
        {
          name: MANAGED_HOOK_NAME,
          type: 'command',
          command: buildClaudeCommand(type)
        }
      ]
    });
  }

  if (filteredGroups.length > 0) {
    hooks.Stop = filteredGroups;
  } else {
    delete hooks.Stop;
  }

  if (Object.keys(hooks).length > 0) {
    settings.hooks = hooks;
  } else {
    delete settings.hooks;
  }

  writeClaudeSettings(settings);
}

function safeReadCodexConfig() {
  try {
    if (typeof codexSettingsManager.configExists === 'function' && !codexSettingsManager.configExists()) {
      return {};
    }
    return codexSettingsManager.readConfig();
  } catch (error) {
    return {};
  }
}

function isManagedCodexNotify(notify) {
  return Array.isArray(notify) && notify.some((part) => isManagedNotifyPath(part));
}

function parseCodexNotificationStatus(config = {}) {
  const notify = Array.isArray(config?.notify) ? config.notify : [];

  if (notify.length === 0) {
    return {
      enabled: false,
      external: false,
      type: 'notification',
      method: 'notify'
    };
  }

  const joined = notify.join(' ');
  const managed = isManagedCodexNotify(notify);

  return {
    enabled: managed,
    external: !managed,
    type: parseManagedType(joined) || 'notification',
    method: 'notify'
  };
}

function getCodexHookStatus() {
  return parseCodexNotificationStatus(safeReadCodexConfig());
}

function saveCodexHook(enabled, type) {
  const config = safeReadCodexConfig();
  const nextConfig = (config && typeof config === 'object') ? { ...config } : {};
  const managed = isManagedCodexNotify(nextConfig.notify);

  if (enabled) {
    nextConfig.notify = buildCodexNotifyCommand(type);
  } else if (managed) {
    delete nextConfig.notify;
  }

  ensureParentDir(NATIVE_PATHS.codex.config);
  codexSettingsManager.writeConfig(nextConfig);
}

function safeReadGeminiSettings() {
  try {
    if (typeof geminiSettingsManager.settingsExists === 'function' && !geminiSettingsManager.settingsExists()) {
      return {};
    }
    return geminiSettingsManager.readSettings();
  } catch (error) {
    return {};
  }
}

function isManagedGeminiHook(hook) {
  const command = String(hook?.command || '');
  const name = String(hook?.name || '');
  return name === MANAGED_HOOK_NAME || isManagedNotifyPath(command);
}

function parseGeminiNotificationStatus(settings = {}) {
  const afterAgentGroups = Array.isArray(settings?.hooks?.AfterAgent) ? settings.hooks.AfterAgent : [];
  let enabled = false;
  let external = false;
  let type = 'notification';

  afterAgentGroups.forEach((group) => {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    hooks.forEach((hook) => {
      if (isManagedGeminiHook(hook)) {
        enabled = true;
        type = parseManagedType(hook.command) || type;
      } else {
        external = true;
      }
    });
  });

  return {
    enabled,
    external,
    type,
    method: 'AfterAgent Hook'
  };
}

function getGeminiHookStatus() {
  return parseGeminiNotificationStatus(safeReadGeminiSettings());
}

function saveGeminiHook(enabled, type) {
  const settings = safeReadGeminiSettings();
  const nextSettings = (settings && typeof settings === 'object') ? { ...settings } : {};
  const hooks = nextSettings.hooks && typeof nextSettings.hooks === 'object' ? { ...nextSettings.hooks } : {};
  const currentGroups = Array.isArray(hooks.AfterAgent) ? hooks.AfterAgent : [];

  const filteredGroups = currentGroups.map((group) => {
    const groupHooks = Array.isArray(group?.hooks) ? group.hooks : [];
    const nextHooks = groupHooks.filter((hook) => !isManagedGeminiHook(hook));
    if (nextHooks.length === 0) {
      return null;
    }
    return { ...group, hooks: nextHooks };
  }).filter(Boolean);

  if (enabled) {
    filteredGroups.push({
      matcher: '*',
      hooks: [
        {
          name: MANAGED_HOOK_NAME,
          type: 'command',
          command: buildGeminiCommand(type)
        }
      ]
    });
  }

  if (filteredGroups.length > 0) {
    hooks.AfterAgent = filteredGroups;
  } else {
    delete hooks.AfterAgent;
  }

  if (Object.keys(hooks).length > 0) {
    nextSettings.hooks = hooks;
  } else {
    delete nextSettings.hooks;
  }

  ensureParentDir(geminiSettingsManager.getSettingsPath());
  geminiSettingsManager.writeSettings(nextSettings);
}

function parseOpenCodeNotificationStatus(content = '') {
  if (!content) {
    return {
      enabled: false,
      external: false,
      type: 'notification',
      method: 'Plugin Events'
    };
  }

  return {
    enabled: true,
    external: false,
    type: parseManagedType(content) || 'notification',
    method: 'Plugin Events'
  };
}

function getOpenCodeHookStatus() {
  const pluginPath = getOpenCodeManagedPluginPath();
  if (!fs.existsSync(pluginPath)) {
    return parseOpenCodeNotificationStatus('');
  }

  return parseOpenCodeNotificationStatus(fs.readFileSync(pluginPath, 'utf8'));
}

function saveOpenCodeHook(enabled, type) {
  const pluginPath = getOpenCodeManagedPluginPath();
  const opencodeSettingsManager = require('./opencode-settings-manager');
  const configPath = opencodeSettingsManager.selectConfigPath();

  if (!enabled) {
    // Remove plugin file
    if (fs.existsSync(pluginPath)) {
      fs.unlinkSync(pluginPath);
    }

    // Remove from opencode.json plugins array
    if (fs.existsSync(configPath)) {
      try {
        const config = opencodeSettingsManager.readConfig(configPath);
        if (Array.isArray(config.plugins)) {
          config.plugins = config.plugins.filter(p => p !== './plugins/coding-tool-notify.js');
          if (config.plugins.length === 0) {
            delete config.plugins;
          }
          opencodeSettingsManager.writeConfig(configPath, config);
        }
      } catch (error) {
        console.error('Failed to update opencode.json:', error);
      }
    }
    return;
  }

  // Create plugin file
  ensureParentDir(pluginPath);
  fs.writeFileSync(pluginPath, buildOpenCodePluginContent(type), 'utf8');

  // Add to opencode.json plugins array
  try {
    const config = fs.existsSync(configPath)
      ? opencodeSettingsManager.readConfig(configPath)
      : {};

    if (!Array.isArray(config.plugins)) {
      config.plugins = [];
    }

    const pluginRef = './plugins/coding-tool-notify.js';
    if (!config.plugins.includes(pluginRef)) {
      config.plugins.push(pluginRef);
    }

    opencodeSettingsManager.writeConfig(configPath, config);
  } catch (error) {
    console.error('Failed to update opencode.json:', error);
  }
}

function getNotificationSettings() {
  return {
    success: true,
    platform: os.platform(),
    feishu: getFeishuConfig(),
    platforms: {
      claude: getClaudeHookStatus(),
      codex: getCodexHookStatus(),
      gemini: getGeminiHookStatus(),
      opencode: getOpenCodeHookStatus()
    }
  };
}

function normalizePlatformInput(platform = {}) {
  return {
    enabled: platform.enabled === true,
    type: normalizeType(platform.type)
  };
}

function saveNotificationSettings(input = {}) {
  const existingFeishu = getFeishuConfig();
  const requestedWebhookUrl = String(input?.feishu?.webhookUrl || '').trim();
  const feishu = {
    enabled: input?.feishu?.enabled === true,
    webhookUrl: requestedWebhookUrl || (input?.feishu?.enabled === true ? existingFeishu.webhookUrl || '' : '')
  };
  if (feishu.enabled && feishu.webhookUrl) {
    validateFeishuWebhookUrl(feishu.webhookUrl);
  }
  const platforms = {
    claude: normalizePlatformInput(input?.platforms?.claude),
    codex: normalizePlatformInput(input?.platforms?.codex),
    gemini: normalizePlatformInput(input?.platforms?.gemini),
    opencode: normalizePlatformInput(input?.platforms?.opencode)
  };

  saveNotificationUiConfig(feishu, platforms.claude.enabled);

  const hasManagedPlatform = Object.values(platforms).some((platform) => platform.enabled);
  if (hasManagedPlatform) {
    writeNotifyScript(feishu);
  }

  saveClaudeHook(platforms.claude.enabled, platforms.claude.type);
  saveCodexHook(platforms.codex.enabled, platforms.codex.type);
  saveGeminiHook(platforms.gemini.enabled, platforms.gemini.type);
  saveOpenCodeHook(platforms.opencode.enabled, platforms.opencode.type);

  if (!hasManagedPlatform) {
    removeNotifyScript();
  }

  return getNotificationSettings();
}

function sendFeishuTest(webhookUrl) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = validateFeishuWebhookUrl(webhookUrl);
      const data = JSON.stringify({
        msg_type: 'interactive',
        card: {
          header: {
            title: { tag: 'plain_text', content: 'Coding Tool - 测试通知' },
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

      const requestModule = urlObj.protocol === 'https:' ? https : http;
      const request = requestModule.request(options, () => resolve());
      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy(new Error('飞书测试通知超时'));
      });
      request.write(data);
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

function generateSystemNotificationCommand(type, message, platformOverride = os.platform()) {
  const normalizedType = normalizeType(type);
  const title = 'Coding Tool';
  const platform = platformOverride;

  if (platform === 'darwin') {
    if (normalizedType === 'dialog') {
      return `osascript -e 'display dialog "${escapeForAppleScript(message)}" with title "${escapeForAppleScript(title)}" buttons {"好的"} default button 1 with icon note'`;
    }
    return `if command -v terminal-notifier &>/dev/null; then terminal-notifier -title "${escapeForAppleScript(title)}" -message "${escapeForAppleScript(message)}" -sound Glass -activate com.apple.Terminal; else osascript -e 'display notification "${escapeForAppleScript(message)}" with title "${escapeForAppleScript(title)}" sound name "Glass"'; fi`;
  }

  if (platform === 'win32') {
    const popupCommand = buildWindowsPopupCommand(title, message);
    if (normalizedType === 'dialog') {
      return `powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${escapeForPowerShellSingleQuote(message)}', '${escapeForPowerShellSingleQuote(title)}', 'OK', 'Information')" || ${popupCommand}`;
    }

    const toastXml = `<toast><visual><binding template="ToastGeneric"><text>${escapeForXml(title)}</text><text>${escapeForXml(message)}</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>`;
    return `powershell -NoProfile -Command "try { [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null; $xml = New-Object Windows.Data.Xml.Dom.XmlDocument; $xml.LoadXml('${toastXml.replace(/'/g, "''")}'); $toast = [Windows.UI.Notifications.ToastNotification]::new($xml); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Coding Tool').Show($toast) } catch { $wshell = New-Object -ComObject Wscript.Shell; $wshell.Popup('${escapeForPowerShellSingleQuote(message)}', 5, '${escapeForPowerShellSingleQuote(title)}', 0x40) }" || ${popupCommand}`;
  }

  if (normalizedType === 'dialog') {
    return `zenity --info --title="Coding Tool" --text="${String(message || '').replace(/"/g, '\\"')}" 2>/dev/null || notify-send "Coding Tool" "${String(message || '').replace(/"/g, '\\"')}"`;
  }

  return `notify-send "Coding Tool" "${String(message || '').replace(/"/g, '\\"')}"`;
}

function testNotification({ type, testFeishu, webhookUrl } = {}) {
  if (testFeishu && webhookUrl) {
    return sendFeishuTest(webhookUrl);
  }

  execSync(generateSystemNotificationCommand(type || 'notification', '这是一条测试通知'), { stdio: 'ignore', windowsHide: true });
}

module.exports = {
  MANAGED_HOOK_NAME,
  getNotificationSettings,
  saveNotificationSettings,
  testNotification,
  getOpenCodeManagedPluginPath,
  buildOpenCodePluginContent,
  buildCodexNotifyCommand,
  writeNotifyScript,
  generateNotifyScript,
  _test: {
    applyClaudeDisablePreference,
    getManagedCommandType,
    parseManagedType,
    getClaudeHookStatus,
    getCodexHookStatus,
    getGeminiHookStatus,
    getOpenCodeHookStatus,
    parseCodexNotificationStatus,
    parseGeminiNotificationStatus,
    parseOpenCodeNotificationStatus,
    validateFeishuWebhookUrl,
    buildCodexNotifyCommand,
    buildGeminiCommand,
    buildClaudeCommand,
    buildOpenCodePluginContent,
    getOpenCodeManagedPluginPath,
    generateNotifyScript,
    generateSystemNotificationCommand
  }
};
