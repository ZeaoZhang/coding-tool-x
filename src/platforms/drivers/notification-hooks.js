'use strict';

const fs = require('fs');
const path = require('path');
const { PATHS, NATIVE_PATHS } = require('../../config/paths');
const codexSettingsManager = require('./codex/native-config-implementation');
const geminiSettingsManager = require('./gemini/native-config-implementation');

const MANAGED_HOOK_NAME = 'coding-tool-notify';
const MANAGED_OPENCODE_PLUGIN_FILE = 'coding-tool-notify.js';
const MANAGED_OMP_EXTENSION_FILE = 'coding-tool-notify.ts';
const HOOK_TYPES = Object.freeze(['notification', 'browser', 'dialog']);

const HOOK_DEFINITIONS = Object.freeze({
  claude: Object.freeze({
    key: 'claude',
    label: 'Claude Code',
    description: '当 Claude Code 任务完成或等待交互时发送系统通知',
    implementation: '通过 Claude Code 的 Stop Hook 在任务完成时发送通知',
    externalMessage: '检测到已有非 Coding Tool 的 Stop Hook。本界面只管理 Coding Tool 写入的通知配置。',
    hints: Object.freeze(['仅管理 Coding Tool 写入的通知配置。'])
  }),
  codex: Object.freeze({
    key: 'codex',
    label: 'Codex CLI',
    description: '当 Codex CLI 当前回合完成并等待下一步交互时发送系统通知',
    implementation: '通过 Codex CLI 的 notify 命令在回合完成后发送通知',
    externalMessage: '检测到现有 notify 配置。启用 Coding Tool 托管通知会替换当前 notify 命令；关闭时只会移除 Coding Tool 写入的 notify。',
    hints: Object.freeze(['启用时会写入 Codex 的 notify 配置。'])
  }),
  gemini: Object.freeze({
    key: 'gemini',
    label: 'Gemini CLI',
    description: '当 Gemini CLI 回合完成或等待下一步交互时发送系统通知',
    implementation: '通过 Gemini CLI 的 AfterAgent Hook 在任务完成时发送通知',
    externalMessage: '检测到已有非 Coding Tool 的 Gemini Hook。本界面只管理 Coding Tool 写入的通知配置。',
    hints: Object.freeze(['仅移除 Coding Tool 标记的 AfterAgent Hook。'])
  }),
  opencode: Object.freeze({
    key: 'opencode',
    label: 'OpenCode',
    description: '当 OpenCode 会话空闲或发生错误时发送系统通知',
    implementation: '通过 OpenCode 插件事件（session.idle / session.error）发送通知',
    externalMessage: '检测到其他 OpenCode 通知配置时，本界面只管理 Coding Tool 生成的插件文件。',
    hints: Object.freeze(['通知插件由 Coding Tool 写入 OpenCode 配置目录。'])
  }),
  omp: Object.freeze({
    key: 'omp',
    label: 'OMP',
    description: '当 OMP 回合完成或等待下一步交互时发送系统通知',
    implementation: '通过 OMP 托管 Extension 事件发送通知',
    externalMessage: '检测到其他 OMP 通知扩展时，本界面只管理 Coding Tool 生成的扩展文件。',
    hints: Object.freeze(['通知扩展由 Coding Tool 写入 OMP extensions 目录。'])
  })
});

function normalizeType(type) {
  return type === 'dialog' || type === 'browser' ? type : 'notification';
}

function parseManagedType(input) {
  const value = String(input || '');
  const matches = [
    value.match(/--cc-notify-type=(dialog|notification|browser)/i),
    value.match(/--mode=(dialog|notification|browser)/i),
    value.match(/MODE\s*=\s*["'](dialog|notification|browser)["']/i)
  ];

  for (const match of matches) {
    if (match?.[1]) return normalizeType(match[1].toLowerCase());
  }
  return null;
}

function isManagedNotifyPath(input) {
  const normalizedInput = String(input || '').replace(/\\/g, '/');
  const normalizedPath = String(PATHS.notifyHook || '').replace(/\\/g, '/');
  return normalizedInput.includes('notify-hook.js')
    || (normalizedPath && normalizedInput.includes(normalizedPath));
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  return content.trim() ? JSON.parse(content) : {};
}

function writeJsonFile(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function quoteShellArg(value) {
  const stringValue = String(value || '');
  if (/^[A-Za-z0-9_./:=+-]+$/.test(stringValue)) return stringValue;
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

function getOmpManagedExtensionPath() {
  const ompPaths = NATIVE_PATHS.omp || {};
  const extensionsDir = ompPaths.extensions
    || path.join(ompPaths.dir || path.dirname(ompPaths.settings || PATHS.notifyHook), 'extensions');
  return path.join(extensionsDir, MANAGED_OMP_EXTENSION_FILE);
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

function buildOmpExtensionContent(type) {
  const mode = normalizeType(type);
  return `// Managed by Coding Tool. Do not edit manually.
// mode:${mode}
import { spawn } from 'node:child_process'

const SCRIPT_PATH = ${JSON.stringify(PATHS.notifyHook)}
const MODE = ${JSON.stringify(mode)}
let lastFireAt = 0

function shouldFire() {
  const now = Date.now()
  if (now - lastFireAt < 1000) {
    return false
  }
  lastFireAt = now
  return true
}

function fire(eventType) {
  if (!shouldFire()) {
    return
  }

  try {
    const child = spawn('node', [
      SCRIPT_PATH,
      '--source=omp',
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

export default async function CodingToolNotifyExtension(omp) {
  const register = (eventName) => {
    if (typeof omp?.on !== 'function') {
      return
    }
    omp.on(eventName, async () => {
      fire(eventName)
    })
  }

  register('agent_settled')
  register('turn_end')
}
`;
}

function getClaudeHookStatus() {
  const settings = readJsonFile(NATIVE_PATHS.claude.settings);
  const stopHooks = Array.isArray(settings?.hooks?.Stop) ? settings.hooks.Stop : [];
  let enabled = false;
  let external = false;
  let type = 'notification';

  for (const group of stopHooks) {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    for (const hook of hooks) {
      const command = String(hook?.command || '');
      if (!command) continue;
      if (isManagedNotifyPath(command)) {
        enabled = true;
        type = parseManagedType(command) || type;
      } else {
        external = true;
      }
    }
  }

  return { enabled, external, type, method: 'Stop Hook' };
}

function saveClaudeHook({ enabled, type } = {}) {
  const settings = readJsonFile(NATIVE_PATHS.claude.settings);
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? { ...settings.hooks } : {};
  const currentGroups = Array.isArray(hooks.Stop) ? hooks.Stop : [];
  const filteredGroups = currentGroups.map((group) => {
    const groupHooks = Array.isArray(group?.hooks) ? group.hooks : [];
    const nextHooks = groupHooks.filter(hook => !isManagedNotifyPath(hook?.command));
    if (nextHooks.length === 0) return null;
    return { ...group, hooks: nextHooks };
  }).filter(Boolean);

  if (enabled === true) {
    filteredGroups.push({
      hooks: [{
        name: MANAGED_HOOK_NAME,
        type: 'command',
        command: buildClaudeCommand(type)
      }]
    });
  }

  if (filteredGroups.length > 0) hooks.Stop = filteredGroups;
  else delete hooks.Stop;
  if (Object.keys(hooks).length > 0) settings.hooks = hooks;
  else delete settings.hooks;

  writeJsonFile(NATIVE_PATHS.claude.settings, settings);
  return getClaudeHookStatus();
}

function readCodexConfig() {
  if (typeof codexSettingsManager.configExists === 'function' && !codexSettingsManager.configExists()) {
    return {};
  }
  return codexSettingsManager.readConfig();
}

function isManagedCodexNotify(notify) {
  return Array.isArray(notify) && notify.some(part => isManagedNotifyPath(part));
}

function parseCodexNotificationStatus(config = {}) {
  const notify = Array.isArray(config?.notify) ? config.notify : [];
  if (notify.length === 0) {
    return { enabled: false, external: false, type: 'notification', method: 'notify' };
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
  return parseCodexNotificationStatus(readCodexConfig());
}

function saveCodexHook({ enabled, type } = {}) {
  const config = readCodexConfig();
  const nextConfig = config && typeof config === 'object' ? { ...config } : {};
  if (enabled === true) {
    nextConfig.notify = buildCodexNotifyCommand(type);
  } else if (isManagedCodexNotify(nextConfig.notify)) {
    delete nextConfig.notify;
  }
  ensureParentDir(NATIVE_PATHS.codex.config);
  codexSettingsManager.writeConfig(nextConfig);
  return getCodexHookStatus();
}

function readGeminiSettings() {
  if (typeof geminiSettingsManager.settingsExists === 'function' && !geminiSettingsManager.settingsExists()) {
    return {};
  }
  return geminiSettingsManager.readSettings();
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

  for (const group of afterAgentGroups) {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    for (const hook of hooks) {
      if (isManagedGeminiHook(hook)) {
        enabled = true;
        type = parseManagedType(hook.command) || type;
      } else {
        external = true;
      }
    }
  }

  return { enabled, external, type, method: 'AfterAgent Hook' };
}

function getGeminiHookStatus() {
  return parseGeminiNotificationStatus(readGeminiSettings());
}

function saveGeminiHook({ enabled, type } = {}) {
  const settings = readGeminiSettings();
  const nextSettings = settings && typeof settings === 'object' ? { ...settings } : {};
  const hooks = nextSettings.hooks && typeof nextSettings.hooks === 'object' ? { ...nextSettings.hooks } : {};
  const currentGroups = Array.isArray(hooks.AfterAgent) ? hooks.AfterAgent : [];
  const filteredGroups = currentGroups.map((group) => {
    const groupHooks = Array.isArray(group?.hooks) ? group.hooks : [];
    const nextHooks = groupHooks.filter(hook => !isManagedGeminiHook(hook));
    if (nextHooks.length === 0) return null;
    return { ...group, hooks: nextHooks };
  }).filter(Boolean);

  if (enabled === true) {
    filteredGroups.push({
      matcher: '*',
      hooks: [{
        name: MANAGED_HOOK_NAME,
        type: 'command',
        command: buildGeminiCommand(type)
      }]
    });
  }

  if (filteredGroups.length > 0) hooks.AfterAgent = filteredGroups;
  else delete hooks.AfterAgent;
  if (Object.keys(hooks).length > 0) nextSettings.hooks = hooks;
  else delete nextSettings.hooks;

  ensureParentDir(geminiSettingsManager.getSettingsPath());
  geminiSettingsManager.writeSettings(nextSettings);
  return getGeminiHookStatus();
}

function parseOpenCodeNotificationStatus(content = '') {
  if (!content) {
    return { enabled: false, external: false, type: 'notification', method: 'Plugin Events' };
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
  return parseOpenCodeNotificationStatus(fs.existsSync(pluginPath) ? fs.readFileSync(pluginPath, 'utf8') : '');
}

function saveOpenCodeHook({ enabled, type } = {}) {
  const pluginPath = getOpenCodeManagedPluginPath();
  const opencodeSettingsManager = require('./opencode/native-config-implementation');
  const configPath = opencodeSettingsManager.selectConfigPath();

  if (enabled !== true) {
    if (fs.existsSync(pluginPath)) fs.unlinkSync(pluginPath);
    if (fs.existsSync(configPath)) {
      const config = opencodeSettingsManager.readConfig(configPath);
      if (Array.isArray(config.plugins)) {
        config.plugins = config.plugins.filter(item => item !== './plugins/coding-tool-notify.js');
        if (config.plugins.length === 0) delete config.plugins;
        opencodeSettingsManager.writeConfig(configPath, config);
      }
    }
    return getOpenCodeHookStatus();
  }

  ensureParentDir(pluginPath);
  fs.writeFileSync(pluginPath, buildOpenCodePluginContent(type), 'utf8');
  const config = fs.existsSync(configPath) ? opencodeSettingsManager.readConfig(configPath) : {};
  if (!Array.isArray(config.plugins)) config.plugins = [];
  const pluginRef = './plugins/coding-tool-notify.js';
  if (!config.plugins.includes(pluginRef)) config.plugins.push(pluginRef);
  opencodeSettingsManager.writeConfig(configPath, config);
  return getOpenCodeHookStatus();
}

function parseOmpNotificationStatus(content = '') {
  if (!content) {
    return { enabled: false, external: false, type: 'notification', method: 'Extension Events' };
  }
  return {
    enabled: true,
    external: false,
    type: parseManagedType(content) || 'notification',
    method: 'Extension Events'
  };
}

function getOmpHookStatus() {
  const extensionPath = getOmpManagedExtensionPath();
  return parseOmpNotificationStatus(fs.existsSync(extensionPath) ? fs.readFileSync(extensionPath, 'utf8') : '');
}

function saveOmpHook({ enabled, type } = {}) {
  const extensionPath = getOmpManagedExtensionPath();
  if (enabled !== true) {
    if (fs.existsSync(extensionPath)) fs.unlinkSync(extensionPath);
    return getOmpHookStatus();
  }
  ensureParentDir(extensionPath);
  fs.writeFileSync(extensionPath, buildOmpExtensionContent(type), 'utf8');
  return getOmpHookStatus();
}

const IMPLEMENTATIONS = Object.freeze({
  claude: Object.freeze({ getHooks: getClaudeHookStatus, saveHooks: saveClaudeHook }),
  codex: Object.freeze({ getHooks: getCodexHookStatus, saveHooks: saveCodexHook }),
  gemini: Object.freeze({ getHooks: getGeminiHookStatus, saveHooks: saveGeminiHook }),
  opencode: Object.freeze({ getHooks: getOpenCodeHookStatus, saveHooks: saveOpenCodeHook }),
  omp: Object.freeze({ getHooks: getOmpHookStatus, saveHooks: saveOmpHook })
});

function cloneDefinition(definition) {
  return {
    ...definition,
    hints: Array.isArray(definition.hints) ? [...definition.hints] : []
  };
}

function defaultTestHooks({ type, platform }) {
  const notificationHooks = require('../notification-hooks');
  return notificationHooks.testNotification({ type, source: platform });
}

function createNotificationHooksDriver({ platform, capability = 'hooks', testNotification } = {}) {
  const implementation = IMPLEMENTATIONS[platform];
  const definition = HOOK_DEFINITIONS[platform];
  if (!implementation || !definition) {
    return { status: 'unsupported', platform, capability };
  }

  const runTest = typeof testNotification === 'function' ? testNotification : defaultTestHooks;
  return {
    platform,
    capability,
    getHooks: () => implementation.getHooks(),
    saveHooks: (input = {}) => implementation.saveHooks({
      enabled: input.enabled === true,
      type: normalizeType(input.type)
    }),
    testHooks: (input = {}) => runTest({
      type: normalizeType(input.type),
      platform
    }),
    getDefinition: () => cloneDefinition(definition)
  };
}

module.exports = {
  HOOK_TYPES,
  HOOK_DEFINITIONS,
  MANAGED_HOOK_NAME,
  createNotificationHooksDriver,
  normalizeType,
  parseManagedType,
  isManagedNotifyPath,
  getClaudeHookStatus,
  getCodexHookStatus,
  getGeminiHookStatus,
  getOpenCodeHookStatus,
  getOmpHookStatus,
  parseCodexNotificationStatus,
  parseGeminiNotificationStatus,
  parseOpenCodeNotificationStatus,
  parseOmpNotificationStatus,
  buildClaudeCommand,
  buildCodexNotifyCommand,
  buildGeminiCommand,
  buildOpenCodePluginContent,
  buildOmpExtensionContent,
  getOpenCodeManagedPluginPath,
  getOmpManagedExtensionPath,
  saveClaudeHook,
  saveCodexHook,
  saveGeminiHook,
  saveOpenCodeHook,
  saveOmpHook
};
