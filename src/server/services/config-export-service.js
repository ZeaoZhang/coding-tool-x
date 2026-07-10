/**
 * 配置导出/导入服务
 * 支持配置模板、频道配置的导出与导入
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;
const yaml = require('js-yaml');
const configTemplatesService = require('./config-templates-service');
const channelsService = require('./channels');
const codexChannelsService = require('./codex-channels');
const geminiChannelsService = require('./gemini-channels');
const opencodeChannelsService = require('./opencode-channels');
const ompChannelsService = require('./omp-channels');
const { AgentsService } = require('./agents-service');
const { CommandsService } = require('./commands-service');
const { SkillService } = require('./skill-service');
const { PluginsService } = require('./plugins-service');
const { PATHS, NATIVE_PATHS } = require('../../config/paths');

const CONFIG_VERSION = '1.4.0';
const SKILL_FILE_ENCODING = 'base64';
const SKILL_IGNORE_DIRS = new Set(['.git']);
const SKILL_IGNORE_FILES = new Set(['.DS_Store']);
const NATIVE_DIR_FILE_ENCODING = 'base64';
const NATIVE_DIR_IGNORE_DIRS = new Set(['.git']);
const NATIVE_DIR_IGNORE_FILES = new Set(['.DS_Store']);
const CC_TOOL_DIR = PATHS.base;
const LEGACY_CC_TOOL_DIR = PATHS.base;
const CLAUDE_SETTINGS_PATH = NATIVE_PATHS.claude.settings;
const LEGACY_PLUGINS_DIR = path.join(LEGACY_CC_TOOL_DIR, 'plugins', 'installed');
const LEGACY_PLUGINS_REGISTRY = path.join(LEGACY_CC_TOOL_DIR, 'plugins', 'registry.json');
const CLAUDE_PLUGINS_DIR = NATIVE_PATHS.claude.plugins
  || path.join(NATIVE_PATHS.claude.dir || path.dirname(NATIVE_PATHS.claude.settings), 'plugins');
const NATIVE_PLUGINS_REGISTRY = path.join(CLAUDE_PLUGINS_DIR, 'installed_plugins.json');
const PLUGIN_IGNORE_DIRS = new Set(['.git', 'node_modules', '.DS_Store']);
const PLUGIN_IGNORE_FILES = new Set(['.DS_Store']);
const PLUGIN_SENSITIVE_PATTERNS = [
  /\.env$/i,
  /\.env\./i,
  /credentials?\.json$/i,
  /secrets?\.json$/i,
  /\.key$/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i
];
const CC_UI_CONFIG_PATH = PATHS.uiConfig;
const CC_PROMPTS_PATH = PATHS.prompts;
const CC_SECURITY_PATH = PATHS.security;
const LEGACY_UI_CONFIG_PATH = PATHS.uiConfig;
const LEGACY_NOTIFY_HOOK_PATH = PATHS.notifyHook;
const GEMINI_SETTINGS_PATH = path.join(path.dirname(NATIVE_PATHS.gemini.env), 'settings.json');
const AGENT_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode'];
const COMMAND_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode', 'omp'];
const SKILL_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode', 'omp'];
const PLUGIN_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode', 'omp'];
const CLAUDE_MARKETPLACES_REGISTRY = path.join(CLAUDE_PLUGINS_DIR, 'known_marketplaces.json');
const CODEX_PLUGINS_DIR = path.join(path.dirname(NATIVE_PATHS.codex.config), 'plugins');
const CODEX_PLUGINS_CACHE_DIR = path.join(CODEX_PLUGINS_DIR, 'cache');
const OPENCODE_PLUGINS_DIR = path.join(NATIVE_PATHS.opencode.config, 'plugins');
const OPENCODE_LEGACY_PLUGINS_DIR = path.join(NATIVE_PATHS.opencode.config, 'plugin');
const OMP_SETTINGS_PATH = NATIVE_PATHS.omp?.settings || path.join(PATHS.base, 'omp-config.yml');
const OMP_EXTENSIONS_DIR = NATIVE_PATHS.omp?.extensions || path.join(PATHS.base, 'omp-extensions');

function normalizeOmpResourceType(value = '') {
  const key = String(value || '').trim().replace(/[\s_-]+/g, '').toLowerCase();
  const map = {
    extension: 'extension',
    extensions: 'extension',
    plugin: 'extension',
    plugins: 'extension',
    skill: 'skill',
    skills: 'skill',
    prompt: 'promptTemplate',
    prompts: 'promptTemplate',
    prompttemplate: 'promptTemplate',
    prompttemplates: 'promptTemplate',
    command: 'promptTemplate',
    commands: 'promptTemplate',
    theme: 'theme',
    themes: 'theme',
    mcp: 'mcp',
    subagent: 'subagent',
    subagents: 'subagent'
  };
  return map[key] || String(value || '').trim();
}

function normalizeOmpResourceTypes(input = []) {
  const result = [];
  const add = (value) => {
    const normalized = normalizeOmpResourceType(value);
    if (normalized && !result.includes(normalized)) result.push(normalized);
  };
  if (Array.isArray(input)) {
    input.forEach(add);
  } else if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) {
      if (value === false || value == null) continue;
      add(key);
    }
  } else if (input) {
    add(input);
  }
  return result;
}

function getOpenCodeConfigPaths() {
  try {
    const { CONFIG_PATHS } = require('./opencode-settings-manager');
    return CONFIG_PATHS || {};
  } catch (err) {
    return {};
  }
}

function getOpenCodeNotificationPluginPath() {
  try {
    const { getOpenCodeManagedPluginPath } = require('./notification-hooks');
    return typeof getOpenCodeManagedPluginPath === 'function' ? getOpenCodeManagedPluginPath() : '';
  } catch (err) {
    return '';
  }
}

function getNativeConfigSpecs() {
  const openCodeConfigPaths = getOpenCodeConfigPaths();
  const openCodeNotificationPluginPath = getOpenCodeNotificationPluginPath();
  const ompDir = NATIVE_PATHS.omp.dir || path.dirname(NATIVE_PATHS.omp.settings);
  return {
    claude: {
      settings: { path: NATIVE_PATHS.claude.settings, format: 'json' }
    },
    codex: {
      config: { path: NATIVE_PATHS.codex.config, format: 'text' },
      auth: { path: NATIVE_PATHS.codex.auth, format: 'json', mode: 0o600 }
    },
    gemini: {
      env: { path: NATIVE_PATHS.gemini.env, format: 'text', mode: 0o600 },
      settings: { path: GEMINI_SETTINGS_PATH, format: 'json' }
    },
    opencode: {
      opencodeJsonc: { path: openCodeConfigPaths.opencodec, format: 'text' },
      opencodeJson: { path: openCodeConfigPaths.opencode, format: 'text' },
      configJson: { path: openCodeConfigPaths.config, format: 'text' },
      ...(openCodeNotificationPluginPath
        ? { codingToolNotifyPlugin: { path: openCodeNotificationPluginPath, format: 'text' } }
        : {})
    },
    omp: {
      settings: { path: NATIVE_PATHS.omp.settings, format: 'yaml' },
      auth: { path: NATIVE_PATHS.omp.auth, format: 'json', mode: 0o600 },
      models: { path: NATIVE_PATHS.omp.models, format: 'yaml' },
      commands: { path: NATIVE_PATHS.omp.commands || path.join(ompDir, 'commands'), format: 'directory' },
      prompts: { path: NATIVE_PATHS.omp.prompts, format: 'directory' },
      skills: { path: NATIVE_PATHS.omp.skills, format: 'directory' },
      extensions: { path: NATIVE_PATHS.omp.extensions, format: 'directory' },
      themes: { path: NATIVE_PATHS.omp.themes || path.join(ompDir, 'themes'), format: 'directory' },
      packages: { path: NATIVE_PATHS.omp.packages || path.join(ompDir, 'packages'), format: 'directory' },
      npmPackages: { path: path.join(ompDir, 'npm'), format: 'directory' },
      gitPackages: { path: path.join(ompDir, 'git'), format: 'directory' }
    }
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFileSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

function readYamlFileSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml.load(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return null;
  }
}

function readTextFileSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return null;
  }
}

function readNativeConfigSnapshot(spec) {
  if (!spec?.path || !fs.existsSync(spec.path)) {
    return null;
  }

  try {
    if (spec.format === 'directory') {
      return readNativeDirectorySnapshot(spec.path);
    }

    const rawContent = fs.readFileSync(spec.path, 'utf8');
    if (spec.format === 'json') {
      try {
        return {
          format: 'json',
          fileName: path.basename(spec.path),
          content: JSON.parse(rawContent)
        };
      } catch (err) {
        return {
          format: 'text',
          fileName: path.basename(spec.path),
          content: rawContent
        };
      }
    }

    if (spec.format === 'yaml') {
      try {
        return {
          format: 'yaml',
          fileName: path.basename(spec.path),
          content: yaml.load(rawContent) || {}
        };
      } catch (err) {
        return {
          format: 'text',
          fileName: path.basename(spec.path),
          content: rawContent
        };
      }
    }

    return {
      format: spec.format || 'text',
      fileName: path.basename(spec.path),
      content: rawContent
    };
  } catch (err) {
    return null;
  }
}

function collectNativeDirectoryFiles(baseDir) {
  const files = [];
  const stack = [baseDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (NATIVE_DIR_IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        stack.push(path.join(currentDir, entry.name));
      } else if (entry.isFile()) {
        if (NATIVE_DIR_IGNORE_FILES.has(entry.name)) {
          continue;
        }
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(baseDir, fullPath);
        try {
          const content = fs.readFileSync(fullPath);
          files.push({
            path: relativePath,
            encoding: NATIVE_DIR_FILE_ENCODING,
            content: content.toString(NATIVE_DIR_FILE_ENCODING)
          });
        } catch (err) {
          continue;
        }
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function readNativeDirectorySnapshot(dirPath) {
  const files = collectNativeDirectoryFiles(dirPath);
  if (files.length === 0) {
    return null;
  }
  return {
    format: 'directory',
    fileName: path.basename(dirPath),
    files
  };
}

function writeJsonFileAbsolute(filePath, data, overwrite, options = {}) {
  if (data === undefined) {
    return 'failed';
  }
  if (fs.existsSync(filePath) && !overwrite) return 'skipped';
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  if (options.mode) {
    try {
      fs.chmodSync(filePath, options.mode);
    } catch (err) {
      // ignore chmod errors
    }
  }
  return 'success';
}

function writeYamlFileAbsolute(filePath, data, overwrite, options = {}) {
  if (data === undefined) {
    return 'failed';
  }
  return writeTextFileAbsolute(
    filePath,
    yaml.dump(data || {}, { lineWidth: 120, noRefs: true, sortKeys: false }),
    overwrite,
    options
  );
}

function writeTextFileAbsolute(filePath, content, overwrite, options = {}) {
  if (content === undefined || content === null) {
    return 'failed';
  }
  if (fs.existsSync(filePath) && !overwrite) return 'skipped';
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  if (options.mode) {
    try {
      fs.chmodSync(filePath, options.mode);
    } catch (err) {
      // ignore chmod errors
    }
  }
  return 'success';
}

function writeNativeConfigAbsolute(spec, entry, overwrite) {
  if (!spec?.path || !entry || entry.content === undefined) {
    if (spec?.format === 'directory' && entry?.files !== undefined) {
      return writeNativeDirectoryAbsolute(spec.path, entry.files, overwrite);
    }
    return 'failed';
  }

  const format = entry.format || spec.format || 'text';
  if (format === 'json' && entry.content && typeof entry.content === 'object') {
    return writeJsonFileAbsolute(spec.path, entry.content, overwrite, { mode: spec.mode });
  }
  if (format === 'yaml' && entry.content && typeof entry.content === 'object') {
    return writeTextFileAbsolute(
      spec.path,
      yaml.dump(entry.content, { lineWidth: 120, noRefs: true, sortKeys: false }),
      overwrite,
      { mode: spec.mode }
    );
  }

  return writeTextFileAbsolute(spec.path, String(entry.content), overwrite, { mode: spec.mode });
}

function writeNativeDirectoryAbsolute(dirPath, files = [], overwrite) {
  if (!dirPath || !Array.isArray(files)) {
    return 'failed';
  }
  if (files.length === 0) {
    return 'skipped';
  }
  if (fs.existsSync(dirPath) && !overwrite) {
    return 'skipped';
  }
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  ensureDir(dirPath);

  let failed = false;
  for (const file of files) {
    const filePath = resolveSafePath(dirPath, file.path);
    if (!filePath) {
      failed = true;
      break;
    }
    try {
      ensureDir(path.dirname(filePath));
      if (file.encoding === NATIVE_DIR_FILE_ENCODING || file.encoding === SKILL_FILE_ENCODING) {
        fs.writeFileSync(filePath, Buffer.from(file.content || '', file.encoding));
      } else {
        fs.writeFileSync(filePath, file.content || '', file.encoding || 'utf8');
      }
    } catch (err) {
      failed = true;
      break;
    }
  }

  return failed ? 'failed' : 'success';
}

function getConfigFilePath() {
  try {
    const { getConfigFilePath: resolveConfigPath } = require('../../config/loader');
    return typeof resolveConfigPath === 'function' ? resolveConfigPath() : null;
  } catch (err) {
    return null;
  }
}

function buildExportReadme(exportData) {
  const exportedAt = exportData.exportedAt ? new Date(exportData.exportedAt).toLocaleString('zh-CN') : '';
  return `# Coding Tool 配置导出包

导出时间: ${exportedAt}
版本: ${exportData.version || CONFIG_VERSION}

## [PKG] 包含内容
- 配置模板、频道配置、工作区、收藏
- Agents / Skills / Commands
- 插件 (Plugins)
- MCP 服务器配置
- OAuth 凭证管理池
- 各平台原生配置（Claude / Codex / Gemini / OpenCode / OMP）
- UI 配置（主题、面板显示、排序等）
- Prompts 预设
- 安全配置
- 高级配置（端口、日志、性能等）
- 通知 Hook / 插件脚本（如 notify-hook.js）

> 注意：配置包可能包含 API Key、Webhook 等敏感信息，请妥善保管。
`;
}

function resolveSafePath(baseDir, relativePath) {
  if (!relativePath || typeof relativePath !== 'string') return null;
  const normalized = path.normalize(relativePath);
  if (path.isAbsolute(normalized)) return null;
  const resolved = path.resolve(baseDir, normalized);
  const relative = path.relative(baseDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function buildAgentContent(agent) {
  const lines = ['---'];
  if (agent.name) lines.push(`name: ${agent.name}`);
  if (agent.description) lines.push(`description: "${agent.description}"`);
  if (agent.tools) lines.push(`tools: ${agent.tools}`);
  if (agent.model) lines.push(`model: ${agent.model}`);
  if (agent.permissionMode) lines.push(`permissionMode: ${agent.permissionMode}`);
  if (agent.skills) lines.push(`skills: ${agent.skills}`);
  lines.push('---');
  const body = agent.systemPrompt || '';
  return `${lines.join('\n')}\n\n${body}`;
}

function buildCommandContent(command) {
  const frontmatter = {};
  if (command.description) frontmatter.description = command.description;
  if (command.allowedTools) frontmatter['allowed-tools'] = command.allowedTools;
  if (command.argumentHint) frontmatter['argument-hint'] = command.argumentHint;

  const lines = [];
  if (Object.keys(frontmatter).length > 0) {
    lines.push('---');
    if (frontmatter.description) {
      lines.push(`description: "${frontmatter.description}"`);
    }
    if (frontmatter['allowed-tools']) {
      lines.push(`allowed-tools: ${frontmatter['allowed-tools']}`);
    }
    if (frontmatter['argument-hint']) {
      lines.push(`argument-hint: ${frontmatter['argument-hint']}`);
    }
    lines.push('---');
    lines.push('');
  }

  const body = command.body || '';
  return `${lines.join('\n')}${body}`;
}

function buildAgentExportItem(agent, platform) {
  return {
    platform,
    fileName: agent.fileName,
    name: agent.name,
    description: agent.description,
    tools: agent.tools,
    model: agent.model,
    permissionMode: agent.permissionMode,
    skills: agent.skills,
    path: agent.path,
    systemPrompt: agent.systemPrompt,
    fullContent: agent.fullContent
  };
}

function buildCommandExportItem(command, platform) {
  return {
    platform,
    name: command.name,
    namespace: command.namespace,
    description: command.description,
    allowedTools: command.allowedTools,
    argumentHint: command.argumentHint,
    path: command.path,
    body: command.body,
    fullContent: command.fullContent
  };
}

function exportAgentsSnapshotByPlatform() {
  return AGENT_PLATFORMS.reduce((result, platform) => {
    try {
      const agentsService = new AgentsService(platform);
      const { agents: rawAgents = [] } = agentsService.listAgents();
      result[platform] = rawAgents.map(agent => buildAgentExportItem(agent, platform));
    } catch (err) {
      console.warn(`[ConfigExport] Failed to export agents for ${platform}:`, err.message);
      result[platform] = [];
    }
    return result;
  }, {});
}

function exportCommandsSnapshotByPlatform() {
  return COMMAND_PLATFORMS.reduce((result, platform) => {
    try {
      const commandsService = new CommandsService(platform);
      const { commands: rawCommands = [] } = commandsService.listCommands();
      result[platform] = rawCommands.map(command => buildCommandExportItem(command, platform));
    } catch (err) {
      console.warn(`[ConfigExport] Failed to export commands for ${platform}:`, err.message);
      result[platform] = [];
    }
    return result;
  }, {});
}

function normalizePlatformItems(legacyItems = [], byPlatform = {}, supportedPlatforms = [], defaultPlatform = 'claude') {
  const result = Object.fromEntries(supportedPlatforms.map(platform => [platform, []]));
  const structuredPlatforms = new Set();

  for (const platform of supportedPlatforms) {
    if (Array.isArray(byPlatform?.[platform])) {
      result[platform] = byPlatform[platform].map(item => ({
        ...item,
        platform: supportedPlatforms.includes(item?.platform) ? item.platform : platform
      }));
      structuredPlatforms.add(platform);
    }
  }

  if (!Array.isArray(legacyItems)) {
    return result;
  }

  for (const item of legacyItems) {
    const platform = supportedPlatforms.includes(item?.platform) ? item.platform : defaultPlatform;
    if (structuredPlatforms.has(platform)) {
      continue;
    }
    result[platform].push({ ...item, platform });
  }

  return result;
}

function resolveAgentRelativePath(agent, platform) {
  const pathCandidates = [agent?.path, agent?.fileName]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim());

  for (const candidate of pathCandidates) {
    if (path.extname(candidate)) {
      return candidate;
    }
  }

  const baseName = agent?.fileName || agent?.name;
  if (!baseName) {
    return null;
  }

  return platform === 'codex' ? `${baseName}.toml` : `${baseName}.md`;
}

function resolveCommandRelativePath(command, platform = 'claude') {
  if (typeof command?.path === 'string' && command.path.trim()) {
    return command.path.trim();
  }
  const extension = platform === 'gemini' ? '.toml' : '.md';
  if (command?.namespace) {
    return path.join(command.namespace, `${command.name}${extension}`);
  }
  return command?.name ? `${command.name}${extension}` : null;
}

function pickPrimaryChannel(channels = []) {
  if (!Array.isArray(channels) || channels.length === 0) {
    return null;
  }
  return channels.find(channel => channel.enabled !== false) || channels[0] || null;
}

function findMatchingPersistedChannel(existingChannels = [], importedChannel = {}, extraMatchers = []) {
  if (!Array.isArray(existingChannels) || existingChannels.length === 0 || !importedChannel) {
    return null;
  }

  if (importedChannel.id) {
    const exactMatch = existingChannels.find(channel => channel.id === importedChannel.id);
    if (exactMatch) {
      return exactMatch;
    }
  }

  for (const matcher of extraMatchers) {
    const matchedChannel = existingChannels.find(channel => matcher(channel, importedChannel));
    if (matchedChannel) {
      return matchedChannel;
    }
  }

  return null;
}

function sanitizeOpenCodeProviderId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'channel';
}

function buildOpenCodeNativeConfig(channels = []) {
  const config = { provider: {} };
  const usedProviderIds = new Set();
  let defaultModelRef = '';

  channels.forEach((channel) => {
    const baseProviderId = sanitizeOpenCodeProviderId(channel.providerKey || channel.name);
    let providerId = baseProviderId;
    let suffix = 2;
    while (usedProviderIds.has(providerId)) {
      providerId = `${baseProviderId}-${suffix}`;
      suffix += 1;
    }
    usedProviderIds.add(providerId);

    const provider = {
      npm: '@ai-sdk/openai-compatible',
      name: channel.name || providerId,
      options: {
        baseURL: channel.baseUrl || '',
        apiKey: channel.apiKey || ''
      }
    };

    const models = {};
    const allowedModels = Array.isArray(channel.allowedModels) ? channel.allowedModels : [];
    const allModels = allowedModels.length > 0
      ? allowedModels
      : [channel.model].filter(Boolean);

    allModels.forEach((modelId) => {
      const normalizedModel = String(modelId || '').trim();
      if (!normalizedModel) return;
      models[normalizedModel] = { name: normalizedModel };
      if (!defaultModelRef && (channel.enabled !== false || !pickPrimaryChannel(channels))) {
        defaultModelRef = `${providerId}/${normalizedModel}`;
      }
    });

    if (Object.keys(models).length > 0) {
      provider.models = models;
    }

    config.provider[providerId] = provider;
  });

  const preferredChannel = pickPrimaryChannel(channels);
  if (!defaultModelRef && preferredChannel?.model) {
    const providerId = sanitizeOpenCodeProviderId(preferredChannel.providerKey || preferredChannel.name);
    defaultModelRef = `${providerId}/${preferredChannel.model}`;
  }

  if (defaultModelRef) {
    config.model = defaultModelRef;
  }

  return config;
}

function syncImportedChannelsToNativeConfigs(importChannelsByType, nativeConfigs, overwrite) {
  const hasNativeConfigFor = (platform) => !!nativeConfigs?.[platform] && Object.keys(nativeConfigs[platform]).length > 0;

  try {
    if (!hasNativeConfigFor('claude')) {
      const primaryClaudeChannel = pickPrimaryChannel(importChannelsByType.claude);
      const persistedClaudeChannel = findMatchingPersistedChannel(
        channelsService.getAllChannels?.() || [],
        primaryClaudeChannel,
        [
          (channel, imported) => channel.name === imported.name && channel.baseUrl === imported.baseUrl
        ]
      );
      if (persistedClaudeChannel?.id) {
        ensureDir(path.dirname(NATIVE_PATHS.claude.settings));
        channelsService.applyChannelToSettings(persistedClaudeChannel.id);
      }
    }
  } catch (err) {
    console.warn('[ConfigImport] Claude native sync fallback failed:', err.message);
  }

  try {
    if (!hasNativeConfigFor('codex') && (importChannelsByType.codex || []).length > 0) {
      codexChannelsService.writeCodexConfigForMultiChannel(importChannelsByType.codex || []);
    }
  } catch (err) {
    console.warn('[ConfigImport] Codex native sync fallback failed:', err.message);
  }

  try {
    if (!hasNativeConfigFor('gemini')) {
      const primaryGeminiChannel = pickPrimaryChannel(importChannelsByType.gemini);
      const persistedGeminiChannel = findMatchingPersistedChannel(
        geminiChannelsService.getChannels?.().channels || [],
        primaryGeminiChannel,
        [
          (channel, imported) => channel.name === imported.name && channel.baseUrl === imported.baseUrl
        ]
      );
      if (persistedGeminiChannel?.id) {
        geminiChannelsService.applyChannelToSettings(persistedGeminiChannel.id);
      }
    }
  } catch (err) {
    console.warn('[ConfigImport] Gemini native sync fallback failed:', err.message);
  }

  try {
    if (!hasNativeConfigFor('opencode') && (importChannelsByType.opencode || []).length > 0) {
      const openCodeSpecs = getNativeConfigSpecs().opencode || {};
      const preferredSpec = [
        openCodeSpecs.opencodeJsonc,
        openCodeSpecs.opencodeJson,
        openCodeSpecs.configJson
      ].find(spec => spec?.path && fs.existsSync(spec.path))
        || openCodeSpecs.opencodeJson
        || openCodeSpecs.configJson;

      if (preferredSpec?.path) {
        const payload = buildOpenCodeNativeConfig(importChannelsByType.opencode || []);
        writeTextFileAbsolute(preferredSpec.path, JSON.stringify(payload, null, 2), overwrite);
      }
    }
  } catch (err) {
    console.warn('[ConfigImport] OpenCode native sync fallback failed:', err.message);
  }
}

function collectSkillFiles(baseDir) {
  const files = [];
  const stack = [baseDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKILL_IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        stack.push(path.join(currentDir, entry.name));
      } else if (entry.isFile()) {
        if (SKILL_IGNORE_FILES.has(entry.name)) {
          continue;
        }
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(baseDir, fullPath);
        try {
          const content = fs.readFileSync(fullPath);
          files.push({
            path: relativePath,
            encoding: SKILL_FILE_ENCODING,
            content: content.toString(SKILL_FILE_ENCODING)
          });
        } catch (err) {
          continue;
        }
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function collectPluginFiles(pluginDir, basePath = '') {
  const files = [];
  const stack = [pluginDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (PLUGIN_IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        stack.push(path.join(currentDir, entry.name));
      } else if (entry.isFile()) {
        if (PLUGIN_IGNORE_FILES.has(entry.name)) {
          continue;
        }
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(pluginDir, fullPath);

        // Skip sensitive files
        const isSensitive = PLUGIN_SENSITIVE_PATTERNS.some(pattern => pattern.test(entry.name));
        if (isSensitive) {
          continue;
        }

        try {
          const content = fs.readFileSync(fullPath);
          files.push({
            path: relativePath,
            encoding: SKILL_FILE_ENCODING,
            content: content.toString(SKILL_FILE_ENCODING)
          });
        } catch (err) {
          continue;
        }
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function getOpenCodePluginsDir() {
  if (fs.existsSync(OPENCODE_LEGACY_PLUGINS_DIR) && !fs.existsSync(OPENCODE_PLUGINS_DIR)) {
    return OPENCODE_LEGACY_PLUGINS_DIR;
  }
  return OPENCODE_PLUGINS_DIR;
}

function detectPluginManifest(pluginDir, candidates = []) {
  for (const candidate of candidates) {
    const manifestPath = path.join(pluginDir, candidate);
    const manifest = readJsonFileSafe(manifestPath);
    if (manifest) {
      return {
        manifest,
        manifestPath: candidate
      };
    }
  }
  return {
    manifest: {},
    manifestPath: ''
  };
}

function buildManagedPluginExportItem(plugin, platform, baseDir, options = {}) {
  const directory = plugin.directory || plugin.name;
  const installPath = plugin.installPath || (directory ? path.join(baseDir, directory) : '');
  if (!installPath || !fs.existsSync(installPath)) {
    return null;
  }

  const pluginDir = assertPathInside(baseDir, installPath);
  if (!pluginDir) {
    return null;
  }

  const { manifest, manifestPath } = detectPluginManifest(pluginDir, options.manifestCandidates || []);
  const files = collectPluginFiles(pluginDir);
  if (files.length === 0) {
    return null;
  }

  return {
    platform,
    type: options.type || 'managed',
    pluginType: plugin.pluginType || options.pluginType || 'local',
    pluginKind: plugin.pluginKind || options.pluginKind || 'plugin',
    name: manifest.name || plugin.name || path.basename(pluginDir),
    version: manifest.version || plugin.version || '1.0.0',
    description: manifest.description || plugin.description || '',
    author: manifest.author || plugin.author || '',
    directory: path.relative(baseDir, pluginDir),
    marketplace: plugin.marketplace || '',
    enabled: plugin.enabled !== false,
    installed: plugin.installed !== false,
    source: plugin.source || '',
    installSource: plugin.installSource || '',
    repoId: plugin.repoId || '',
    repoProvider: plugin.repoProvider || '',
    repoOwner: plugin.repoOwner || '',
    repoName: plugin.repoName || '',
    repoBranch: plugin.repoBranch || '',
    repoDirectory: plugin.repoDirectory || '',
    repoHost: plugin.repoHost || '',
    repoProjectPath: plugin.repoProjectPath || '',
    repoLocalPath: plugin.repoLocalPath || '',
    repoUrl: plugin.repoUrl || '',
    manifest,
    manifestPath,
    files
  };
}

function assertPathInside(baseDir, targetPath) {
  if (!baseDir || !targetPath) return null;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return resolvedTarget;
}

function readJsonConfigSnapshot(filePath) {
  const content = readJsonFileSafe(filePath);
  return content ? { path: filePath, content } : null;
}

function exportPluginControlSnapshot(platform, service) {
  const snapshot = {};
  const reposPath = PATHS.pluginRepos?.[platform];
  const marketCachePath = PATHS.pluginMarketCache?.[platform];
  const repos = readJsonConfigSnapshot(reposPath);
  const marketCache = readJsonConfigSnapshot(marketCachePath);

  if (repos) {
    snapshot.repos = repos;
  }
  if (marketCache) {
    snapshot.marketCache = marketCache;
  }

  try {
    const serviceRepos = service.getRepos?.() || [];
    if (serviceRepos.length > 0) {
      snapshot.resolvedRepos = serviceRepos;
    }
  } catch (err) {
    // repo metadata is supplemental; file snapshots remain the source of truth
  }

  return snapshot;
}

function exportClaudePluginsByPlatform(service) {
  const installedPlugins = service.listPlugins().plugins || [];
  const plugins = [];

  for (const plugin of installedPlugins) {
    if (plugin.installPath && fs.existsSync(plugin.installPath)) {
      const pluginDir = assertPathInside(CLAUDE_PLUGINS_DIR, plugin.installPath)
        || assertPathInside(LEGACY_PLUGINS_DIR, plugin.installPath);
      if (pluginDir) {
        const { manifest, manifestPath } = detectPluginManifest(pluginDir, [
          '.claude-plugin/plugin.json',
          'plugin.json',
          'package.json'
        ]);
        const files = collectPluginFiles(pluginDir);
        if (files.length > 0) {
          plugins.push({
            platform: 'claude',
            type: 'native',
            pluginType: plugin.pluginType || 'native',
            pluginKind: plugin.pluginKind || 'plugin',
            name: manifest.name || plugin.name || path.basename(pluginDir),
            marketplace: plugin.marketplace || '',
            version: manifest.version || plugin.version || '1.0.0',
            description: manifest.description || plugin.description || '',
            author: manifest.author || plugin.author || '',
            directory: path.relative(CLAUDE_PLUGINS_DIR, pluginDir),
            enabled: plugin.enabled !== false,
            installedAt: plugin.installedAt,
            scope: plugin.scope,
            source: plugin.source || '',
            repoId: plugin.repoId || '',
            repoProvider: plugin.repoProvider || '',
            repoOwner: plugin.repoOwner || '',
            repoName: plugin.repoName || '',
            repoBranch: plugin.repoBranch || '',
            repoDirectory: plugin.repoDirectory || '',
            repoHost: plugin.repoHost || '',
            repoProjectPath: plugin.repoProjectPath || '',
            repoLocalPath: plugin.repoLocalPath || '',
            repoUrl: plugin.repoUrl || '',
            manifest,
            manifestPath,
            files
          });
        }
      }
    }
  }

  const legacyPluginNames = new Set(plugins.map(plugin => plugin.name));
  for (const plugin of exportLegacyPlugins()) {
    if (!legacyPluginNames.has(plugin.name)) {
      plugins.push({ ...plugin, platform: 'claude' });
    }
  }

  const control = exportPluginControlSnapshot('claude', service);
  const installedRegistry = readJsonConfigSnapshot(NATIVE_PLUGINS_REGISTRY);
  const knownMarketplaces = readJsonConfigSnapshot(CLAUDE_MARKETPLACES_REGISTRY);
  const legacyRegistry = readJsonConfigSnapshot(LEGACY_PLUGINS_REGISTRY);
  if (installedRegistry) control.installedRegistry = installedRegistry;
  if (knownMarketplaces) control.knownMarketplaces = knownMarketplaces;
  if (legacyRegistry) control.legacyRegistry = legacyRegistry;

  return { plugins, control };
}

function exportCodexPluginsByPlatform(service) {
  const plugins = (service.listPlugins().plugins || [])
    .map(plugin => buildManagedPluginExportItem(plugin, 'codex', CODEX_PLUGINS_CACHE_DIR, {
      type: 'codex-cache',
      pluginType: 'cache',
      manifestCandidates: ['.codex-plugin/plugin.json', 'plugin.json', 'package.json']
    }))
    .filter(Boolean);
  const control = exportPluginControlSnapshot('codex', service);
  const codexConfig = readNativeConfigSnapshot({ path: NATIVE_PATHS.codex.config, format: 'text' });
  if (codexConfig) {
    control.nativeConfig = codexConfig;
  }
  return { plugins, control };
}

function exportOpenCodePluginsByPlatform(service) {
  const pluginsDir = getOpenCodePluginsDir();
  const plugins = (service.listPlugins().plugins || [])
    .map((plugin) => {
      if (plugin.pluginType === 'npm' || plugin.source === 'opencode-config') {
        return {
          platform: 'opencode',
          type: 'opencode-package',
          pluginType: 'npm',
          pluginKind: plugin.pluginKind || 'plugin',
          name: plugin.name,
          directory: plugin.directory || plugin.name,
          installSource: plugin.installSource || plugin.source || plugin.name,
          resourceTypes: normalizeOmpResourceTypes(plugin.resourceTypes || plugin.resources),
          version: plugin.version || 'latest',
          description: plugin.description || '',
          enabled: plugin.enabled !== false,
          installed: plugin.installed !== false,
          source: plugin.source || 'opencode-config'
        };
      }
      return buildManagedPluginExportItem(plugin, 'opencode', pluginsDir, {
        type: 'opencode-local',
        pluginType: plugin.pluginType || 'local',
        manifestCandidates: ['package.json', 'plugin.json']
      });
    })
    .filter(Boolean);
  const control = exportPluginControlSnapshot('opencode', service);
  return { plugins, control };
}

function exportOmpPluginsByPlatform(service) {
  const plugins = (service.listPlugins().plugins || [])
    .map((plugin) => {
      if (plugin.pluginType === 'package' || plugin.source === 'omp-settings') {
        return {
          platform: 'omp',
          type: 'omp-package',
          pluginType: 'package',
          pluginKind: plugin.pluginKind || 'package',
          name: plugin.name,
          directory: plugin.directory || plugin.name,
          version: plugin.version || 'latest',
          description: plugin.description || '',
          enabled: plugin.enabled !== false,
          installed: plugin.installed !== false,
          source: plugin.source || 'omp-settings'
        };
      }
      return buildManagedPluginExportItem(plugin, 'omp', OMP_EXTENSIONS_DIR, {
        type: 'omp-extension',
        pluginType: plugin.pluginType || 'extension',
        pluginKind: plugin.pluginKind || 'extension',
        manifestCandidates: ['omp.json', 'extension.json', 'plugin.json', 'package.json']
      });
    })
    .filter(Boolean);
  const control = exportPluginControlSnapshot('omp', service);
  return { plugins, control };
}

function exportPluginsSnapshotByPlatform() {
  return PLUGIN_PLATFORMS.reduce((result, platform) => {
    try {
      const service = new PluginsService(platform);
      if (platform === 'claude') {
        result[platform] = exportClaudePluginsByPlatform(service);
      } else if (platform === 'codex') {
        result[platform] = exportCodexPluginsByPlatform(service);
      } else if (platform === 'opencode') {
        result[platform] = exportOpenCodePluginsByPlatform(service);
      } else if (platform === 'omp') {
        result[platform] = exportOmpPluginsByPlatform(service);
      } else {
        result[platform] = {
          plugins: service.listPlugins().plugins || [],
          control: exportPluginControlSnapshot(platform, service)
        };
      }
    } catch (err) {
      console.warn(`[ConfigExport] Failed to export plugins for ${platform}:`, err.message);
      result[platform] = { plugins: [], control: {} };
    }
    return result;
  }, {});
}

function exportSkillsSnapshot(platform = 'claude') {
  const skillService = new SkillService(platform);
  const installedSkills = skillService.getInstalledSkills();
  const baseDir = skillService.installDir;

  return installedSkills.map((skill) => {
    const directory = skill.directory;
    const skillDir = resolveSafePath(baseDir, directory);
    if (!skillDir || !fs.existsSync(skillDir)) {
      return null;
    }
    return {
      platform,
      directory,
      name: skill.name || directory,
      description: skill.description || '',
      files: collectSkillFiles(skillDir)
    };
  }).filter(Boolean);
}

function exportSkillsSnapshotByPlatform() {
  return SKILL_PLATFORMS.reduce((result, platform) => {
    try {
      result[platform] = exportSkillsSnapshot(platform);
    } catch (err) {
      console.warn(`[ConfigExport] Failed to export skills for ${platform}:`, err.message);
      result[platform] = [];
    }
    return result;
  }, {});
}

function exportNativeConfigs() {
  const specs = getNativeConfigSpecs();
  return Object.entries(specs).reduce((result, [platform, platformSpecs]) => {
    const exportedEntries = Object.entries(platformSpecs).reduce((entries, [key, spec]) => {
      const snapshot = readNativeConfigSnapshot(spec);
      if (snapshot) {
        entries[key] = snapshot;
      }
      return entries;
    }, {});

    if (Object.keys(exportedEntries).length > 0) {
      result[platform] = exportedEntries;
    }
    return result;
  }, {});
}

function exportLegacyPlugins() {
  const plugins = [];

  // Check if legacy plugins directory exists
  if (!fs.existsSync(LEGACY_PLUGINS_DIR)) {
    return plugins;
  }

  // Read registry.json if it exists
  const registry = readJsonFileSafe(LEGACY_PLUGINS_REGISTRY) || {};

  try {
    const pluginDirs = fs.readdirSync(LEGACY_PLUGINS_DIR, { withFileTypes: true });

    for (const entry of pluginDirs) {
      if (!entry.isDirectory()) {
        continue;
      }

      const pluginName = entry.name;
      const pluginDir = path.join(LEGACY_PLUGINS_DIR, pluginName);
      const manifestPath = path.join(pluginDir, 'plugin.json');

      // Read plugin.json manifest
      const manifest = readJsonFileSafe(manifestPath);
      if (!manifest) {
        continue;
      }

      // Collect all files in the plugin directory
      const files = collectPluginFiles(pluginDir);

      plugins.push({
        type: 'legacy',
        name: manifest.name || pluginName,
        version: manifest.version || '1.0.0',
        description: manifest.description || '',
        author: manifest.author || '',
        directory: pluginName,
        manifest: manifest,
        files: files,
        registryEntry: registry[pluginName] || null
      });
    }
  } catch (err) {
    console.warn('[ConfigExport] Failed to export legacy plugins:', err.message);
  }

  return plugins;
}

function exportNativePlugins() {
  const plugins = [];

  // Read installed_plugins.json
  const installedPlugins = readJsonFileSafe(NATIVE_PLUGINS_REGISTRY);
  if (!installedPlugins || typeof installedPlugins !== 'object') {
    return plugins;
  }

  try {
    for (const [pluginId, pluginInfo] of Object.entries(installedPlugins)) {
      if (!pluginInfo || !pluginInfo.installPath) {
        continue;
      }

      const pluginDir = pluginInfo.installPath;
      if (!fs.existsSync(pluginDir)) {
        continue;
      }

      // Read package.json manifest
      const manifestPath = path.join(pluginDir, 'package.json');
      const manifest = readJsonFileSafe(manifestPath);
      if (!manifest) {
        continue;
      }

      // Collect all files in the plugin directory
      const files = collectPluginFiles(pluginDir);

      plugins.push({
        type: 'native',
        id: pluginId,
        name: manifest.name || pluginId,
        version: manifest.version || '1.0.0',
        description: manifest.description || '',
        author: manifest.author || '',
        installPath: pluginDir,
        manifest: manifest,
        files: files,
        registryEntry: pluginInfo
      });
    }
  } catch (err) {
    console.warn('[ConfigExport] Failed to export native plugins:', err.message);
  }

  return plugins;
}

function exportPluginsSnapshot() {
  const legacyPlugins = exportLegacyPlugins();
  const nativePlugins = exportNativePlugins();
  return [...legacyPlugins, ...nativePlugins];
}

function getPluginsByPlatformItems(plugins = [], pluginsByPlatform = {}) {
  const result = Object.fromEntries(PLUGIN_PLATFORMS.map(platform => [platform, []]));
  const hasStructuredPlugins = pluginsByPlatform
    && typeof pluginsByPlatform === 'object'
    && Object.keys(pluginsByPlatform).length > 0;

  if (hasStructuredPlugins) {
    for (const platform of PLUGIN_PLATFORMS) {
      const platformSnapshot = pluginsByPlatform[platform];
      const platformPlugins = Array.isArray(platformSnapshot?.plugins)
        ? platformSnapshot.plugins
        : (Array.isArray(platformSnapshot) ? platformSnapshot : []);
      result[platform] = platformPlugins.map(plugin => ({
        ...plugin,
        platform
      }));
    }
  }

  if (!hasStructuredPlugins && Array.isArray(plugins)) {
    for (const plugin of plugins) {
      const platform = PLUGIN_PLATFORMS.includes(plugin?.platform) ? plugin.platform : 'claude';
      result[platform].push({ ...plugin, platform });
    }
  }

  return result;
}

function writePluginFiles(pluginDir, files = []) {
  let failed = false;

  for (const file of files) {
    const filePath = resolveSafePath(pluginDir, file.path);
    if (!filePath) {
      failed = true;
      break;
    }

    ensureDir(path.dirname(filePath));

    try {
      if (file.encoding === SKILL_FILE_ENCODING) {
        fs.writeFileSync(filePath, Buffer.from(file.content || '', SKILL_FILE_ENCODING));
      } else {
        fs.writeFileSync(filePath, file.content || '', file.encoding || 'utf8');
      }
    } catch (err) {
      console.error(`[ConfigImport] Failed to write plugin file ${file.path}:`, err);
      failed = true;
      break;
    }
  }

  return !failed && files.length > 0;
}

function pluginNameForPath(plugin = {}) {
  return plugin.name || plugin.id || plugin.directory || 'plugin';
}

function sanitizePackageName(value = '') {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/[^a-zA-Z0-9._@+-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin';
}

function resolvePluginImportDir(baseDir, plugin = {}) {
  const directory = plugin.directory && !String(plugin.directory).includes('..')
    ? plugin.directory
    : sanitizePackageName(pluginNameForPath(plugin));
  return resolveSafePath(baseDir, directory);
}

function readTomlFileSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim() ? toml.parse(content) : {};
  } catch (err) {
    return {};
  }
}

function mergeTomlFile(filePath, updates = {}, overwrite = true) {
  if (!filePath || !updates || typeof updates !== 'object') {
    return 'failed';
  }
  if (fs.existsSync(filePath) && !overwrite) {
    return 'skipped';
  }
  const existing = readTomlFileSafe(filePath);
  const nextValue = {
    ...existing,
    ...updates,
    plugins: {
      ...((existing.plugins && typeof existing.plugins === 'object') ? existing.plugins : {}),
      ...((updates.plugins && typeof updates.plugins === 'object') ? updates.plugins : {})
    },
    marketplaces: {
      ...((existing.marketplaces && typeof existing.marketplaces === 'object') ? existing.marketplaces : {}),
      ...((updates.marketplaces && typeof updates.marketplaces === 'object') ? updates.marketplaces : {})
    }
  };
  if (Object.keys(nextValue.plugins).length === 0) delete nextValue.plugins;
  if (Object.keys(nextValue.marketplaces).length === 0) delete nextValue.marketplaces;

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, tomlStringify(JSON.parse(JSON.stringify(nextValue))), 'utf8');
  return 'success';
}

function mergePluginRepoConfig(platform, snapshot = {}, overwrite = true) {
  const reposPath = PATHS.pluginRepos?.[platform];
  const marketCachePath = PATHS.pluginMarketCache?.[platform];
  let changed = 0;
  let skipped = 0;
  let failed = 0;

  const reposContent = snapshot.control?.repos?.content;
  if (reposPath && reposContent && typeof reposContent === 'object') {
    const status = writeJsonFileAbsolute(reposPath, reposContent, overwrite);
    if (status === 'success') changed++;
    else if (status === 'skipped') skipped++;
    else failed++;
  }

  const marketCacheContent = snapshot.control?.marketCache?.content;
  if (marketCachePath && marketCacheContent && typeof marketCacheContent === 'object') {
    const status = writeJsonFileAbsolute(marketCachePath, marketCacheContent, overwrite);
    if (status === 'success') changed++;
    else if (status === 'skipped') skipped++;
    else failed++;
  }

  return { changed, skipped, failed };
}

function mergeCodexPluginConfig(snapshot = {}, plugins = [], overwrite = true) {
  const nativeConfig = snapshot.control?.nativeConfig;
  if (nativeConfig?.content !== undefined) {
    return writeNativeConfigAbsolute({ path: NATIVE_PATHS.codex.config, format: 'text' }, nativeConfig, overwrite);
  }

  const pluginEntries = {};
  const marketplaces = {};
  for (const plugin of plugins) {
    if (!plugin?.name) continue;
    const pluginKey = plugin.marketplace ? `${plugin.name}@${plugin.marketplace}` : plugin.name;
    pluginEntries[pluginKey] = { enabled: plugin.enabled !== false };
    if (plugin.marketplace && plugin.repoUrl) {
      marketplaces[plugin.marketplace] = {
        source_type: plugin.repoLocalPath ? 'local' : 'git',
        source: plugin.repoUrl,
        last_updated: new Date().toISOString()
      };
    }
  }

  if (Object.keys(pluginEntries).length === 0 && Object.keys(marketplaces).length === 0) {
    return 'skipped';
  }

  return mergeTomlFile(NATIVE_PATHS.codex.config, {
    ...(Object.keys(pluginEntries).length > 0 ? { plugins: pluginEntries } : {}),
    ...(Object.keys(marketplaces).length > 0 ? { marketplaces } : {})
  }, overwrite);
}

function writeOpenCodePluginConfig(packages = [], overwrite = true) {
  if (packages.length === 0) return 'skipped';
  const openCodePaths = getOpenCodeConfigPaths();
  const configPath = [
    openCodePaths.opencodec,
    openCodePaths.opencode,
    openCodePaths.config
  ].find(filePath => filePath && fs.existsSync(filePath))
    || openCodePaths.opencode
    || path.join(NATIVE_PATHS.opencode.config, 'opencode.json');
  const existing = readJsonFileSafe(configPath) || {};
  if (fs.existsSync(configPath) && !overwrite) {
    return 'skipped';
  }
  const existingPlugins = Array.isArray(existing.plugin) ? existing.plugin : [];
  const mergedPlugins = Array.from(new Set([...existingPlugins, ...packages]));
  return writeJsonFileAbsolute(configPath, { ...existing, plugin: mergedPlugins }, true);
}

function writeOmpPluginSettings(plugins = [], snapshot = {}, overwrite = true) {
  const nativeSettings = snapshot.control?.nativeSettings;
  if (nativeSettings?.content !== undefined) {
    return writeNativeConfigAbsolute({ path: OMP_SETTINGS_PATH, format: 'yaml' }, {
      ...nativeSettings,
      format: 'yaml'
    }, overwrite);
  }

  const settings = readYamlFileSafe(OMP_SETTINGS_PATH) || {};
  if (fs.existsSync(OMP_SETTINGS_PATH) && !overwrite) {
    return 'skipped';
  }
  const existingPackages = Array.isArray(settings.packages) ? settings.packages : [];
  const existingDisabled = Array.isArray(settings.disabledPackages) ? settings.disabledPackages : [];
  const packagePlugins = plugins.filter(plugin => plugin.type === 'omp-package' || plugin.pluginType === 'package');
  const packageIdentity = (item) => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    return item.name || item.installSource || item.source || '';
  };
  const buildPackageEntry = (plugin) => {
    const name = plugin.name || plugin.directory || plugin.installSource || '';
    if (!name) return null;
    const installSource = plugin.installSource || plugin.packageSource || '';
    const resourceTypes = normalizeOmpResourceTypes(plugin.resourceTypes || plugin.resources);
    if (!installSource || installSource === name) {
      if (resourceTypes.length === 0 && !plugin.version && !plugin.description) return name;
    }
    return {
      name,
      ...(installSource ? { source: installSource, installSource } : {}),
      ...(plugin.version ? { version: plugin.version } : {}),
      ...(plugin.description ? { description: plugin.description } : {}),
      ...(resourceTypes.length > 0 ? { resourceTypes } : {})
    };
  };
  const mergePackageEntries = (current, additions) => {
    const result = [];
    const seen = new Set();
    for (const item of [...current, ...additions]) {
      const identity = packageIdentity(item);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      result.push(item);
    }
    return result;
  };
  const packages = packagePlugins.map(buildPackageEntry).filter(Boolean);
  const disabledPackages = packagePlugins
    .filter(plugin => plugin.enabled === false)
    .map(buildPackageEntry)
    .filter(Boolean);

  if (packages.length === 0 && disabledPackages.length === 0) {
    return 'skipped';
  }

  return writeYamlFileAbsolute(OMP_SETTINGS_PATH, {
    ...settings,
    packages: mergePackageEntries(existingPackages, packages),
    disabledPackages: mergePackageEntries(existingDisabled, disabledPackages)
  }, true);
}

function importPluginToDirectory(platform, plugin, baseDir, overwrite) {
  const files = Array.isArray(plugin.files) ? plugin.files : [];
  if (files.length === 0) {
    return 'skipped';
  }

  const pluginDir = resolvePluginImportDir(baseDir, plugin);
  if (!pluginDir) {
    return 'failed';
  }

  if (fs.existsSync(pluginDir)) {
    if (!overwrite) {
      return 'skipped';
    }
    fs.rmSync(pluginDir, { recursive: true, force: true });
  }

  ensureDir(pluginDir);
  const wroteFiles = writePluginFiles(pluginDir, files);
  if (!wroteFiles) {
    return 'failed';
  }

  const sourceMeta = {
    repoId: plugin.repoId || '',
    repoProvider: plugin.repoProvider || '',
    repoOwner: plugin.repoOwner || '',
    repoName: plugin.repoName || '',
    repoBranch: plugin.repoBranch || '',
    repoDirectory: plugin.repoDirectory || '',
    repoHost: plugin.repoHost || '',
    repoProjectPath: plugin.repoProjectPath || '',
    repoLocalPath: plugin.repoLocalPath || '',
    repoUrl: plugin.repoUrl || '',
    marketplace: plugin.marketplace || '',
    source: plugin.source || ''
  };
  if (Object.values(sourceMeta).some(Boolean)) {
    writeJsonFileAbsolute(path.join(pluginDir, '.cc-tool-plugin-source.json'), sourceMeta, true);
  }

  if (platform === 'claude') {
    updateClaudePluginRegistry(plugin, pluginDir);
  }

  return 'success';
}

function applyImportStatus(results, status) {
  if (status === 'success') {
    results.plugins.success++;
  } else if (status === 'skipped') {
    results.plugins.skipped++;
  } else {
    results.plugins.failed++;
  }
}

function importPluginsByPlatformSnapshot(snapshotByPlatform = {}, legacyPlugins = [], overwrite = true, results) {
  const pluginsByPlatform = getPluginsByPlatformItems(legacyPlugins, snapshotByPlatform);

  for (const platform of PLUGIN_PLATFORMS) {
    const snapshot = snapshotByPlatform?.[platform] && typeof snapshotByPlatform[platform] === 'object'
      ? snapshotByPlatform[platform]
      : {};
    const repoStatus = mergePluginRepoConfig(platform, snapshot, overwrite);
    results.plugins.success += repoStatus.changed;
    results.plugins.skipped += repoStatus.skipped;
    results.plugins.failed += repoStatus.failed;

    const plugins = pluginsByPlatform[platform] || [];
    const hasControl = snapshot?.control && Object.keys(snapshot.control).length > 0;

    if (platform === 'codex' && (hasControl || plugins.length > 0)) {
      applyImportStatus(results, mergeCodexPluginConfig(snapshot, plugins, overwrite));
    } else if (platform === 'opencode' && (hasControl || plugins.length > 0)) {
      const packages = plugins
        .filter(plugin => plugin.type === 'opencode-package' || plugin.pluginType === 'npm')
        .map(plugin => plugin.name || plugin.directory)
        .filter(Boolean);
      applyImportStatus(results, writeOpenCodePluginConfig(packages, overwrite));
    } else if (platform === 'omp' && (hasControl || plugins.length > 0)) {
      applyImportStatus(results, writeOmpPluginSettings(plugins, snapshot, overwrite));
    }

    for (const plugin of plugins) {
      try {
        if (platform === 'codex') {
          applyImportStatus(results, importPluginToDirectory(platform, plugin, CODEX_PLUGINS_CACHE_DIR, overwrite));
        } else if (platform === 'opencode') {
          if (plugin.type === 'opencode-package' || plugin.pluginType === 'npm') {
            continue;
          }
          applyImportStatus(results, importPluginToDirectory(platform, plugin, getOpenCodePluginsDir(), overwrite));
        } else if (platform === 'omp') {
          if (plugin.type === 'omp-package' || plugin.pluginType === 'package') {
            continue;
          }
          applyImportStatus(results, importPluginToDirectory(platform, plugin, OMP_EXTENSIONS_DIR, overwrite));
        } else if (platform === 'claude') {
          const isLegacy = plugin.type === 'legacy';
          applyImportStatus(results, importPluginToDirectory(
            platform,
            plugin,
            isLegacy ? LEGACY_PLUGINS_DIR : CLAUDE_PLUGINS_DIR,
            overwrite
          ));
        }
      } catch (err) {
        console.error(`[ConfigImport] Failed to import ${platform} plugin ${plugin?.name}:`, err);
        results.plugins.failed++;
      }
    }
  }
}

function updateClaudePluginRegistry(plugin, pluginDir) {
  const pluginName = plugin.name || path.basename(pluginDir);
  const marketplace = plugin.marketplace || '';
  const nativeKey = marketplace ? `${pluginName}@${marketplace}` : pluginName;
  const installed = readJsonFileSafe(NATIVE_PLUGINS_REGISTRY) || { version: 2, plugins: {} };
  installed.version = installed.version || 2;
  installed.plugins = installed.plugins && typeof installed.plugins === 'object' ? installed.plugins : {};
  installed.plugins[nativeKey] = [{
    scope: plugin.scope || 'user',
    installPath: pluginDir,
    version: plugin.version || '1.0.0',
    installedAt: plugin.installedAt || new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    ...(plugin.source ? { source: plugin.source } : {}),
    ...(plugin.repoUrl ? { repoUrl: plugin.repoUrl } : {}),
    ...(plugin.repoProvider ? { repoProvider: plugin.repoProvider } : {}),
    ...(plugin.repoOwner ? { repoOwner: plugin.repoOwner } : {}),
    ...(plugin.repoName ? { repoName: plugin.repoName } : {}),
    ...(plugin.repoBranch ? { repoBranch: plugin.repoBranch } : {}),
    ...(plugin.repoDirectory ? { repoDirectory: plugin.repoDirectory } : {}),
    ...(plugin.repoHost ? { repoHost: plugin.repoHost } : {}),
    ...(plugin.repoProjectPath ? { repoProjectPath: plugin.repoProjectPath } : {}),
    ...(plugin.repoLocalPath ? { repoLocalPath: plugin.repoLocalPath } : {}),
    ...(plugin.repoId ? { repoId: plugin.repoId } : {})
  }];
  writeJsonFileAbsolute(NATIVE_PLUGINS_REGISTRY, installed, true);

  const settings = readJsonFileSafe(CLAUDE_SETTINGS_PATH) || {};
  settings.enabledPlugins = settings.enabledPlugins && typeof settings.enabledPlugins === 'object'
    ? settings.enabledPlugins
    : {};
  settings.enabledPlugins[nativeKey] = plugin.enabled !== false;
  writeJsonFileAbsolute(CLAUDE_SETTINGS_PATH, settings, true);
}

function writeTextFile(baseDir, relativePath, content, overwrite) {
  if (!content && content !== '') {
    return 'failed';
  }
  const targetPath = resolveSafePath(baseDir, relativePath);
  if (!targetPath) return 'failed';
  if (fs.existsSync(targetPath) && !overwrite) return 'skipped';

  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, 'utf8');
  return 'success';
}

function getAllChannelsByType() {
  const claude = channelsService.getAllChannels() || [];
  const codex = codexChannelsService.getChannels()?.channels || [];
  const gemini = geminiChannelsService.getChannels()?.channels || [];
  const opencode = opencodeChannelsService.getChannels()?.channels || [];
  const omp = ompChannelsService.getChannels()?.channels || [];
  return { claude, codex, gemini, opencode, omp };
}

/**
 * 导出所有配置为JSON
 * @returns {Object} 配置导出对象
 */
function exportAllConfigs() {
  try {
    // 获取所有配置模板(只导出自定义模板)
    const allConfigTemplates = configTemplatesService.getAllTemplates();
    const customConfigTemplates = allConfigTemplates.filter(t => !t.isBuiltin);

    // 获取所有频道配置（向后兼容：channels 仍保留 Claude 渠道）
    const channelsByType = getAllChannelsByType();
    const channels = channelsByType.claude || [];

    // 获取工作区配置
    const workspaceService = require('./workspace-service');
    const workspaces = workspaceService.loadWorkspaces();

    // 获取收藏配置
    const favoritesService = require('./favorites');
    const favorites = favoritesService.loadFavorites();

    // 获取 Agents / Skills / Commands 配置（多平台）
    const agentsByPlatform = exportAgentsSnapshotByPlatform();
    const skillsByPlatform = exportSkillsSnapshotByPlatform();
    const commandsByPlatform = exportCommandsSnapshotByPlatform();
    const agents = agentsByPlatform.claude || [];
    const skills = skillsByPlatform.claude || [];
    const commands = commandsByPlatform.claude || [];

    // 获取 MCP 配置
    const mcpService = require('./mcp-service');
    const mcpServers = mcpService.getAllServers();

    // 获取 Plugins 配置
    const plugins = exportPluginsSnapshot();
    const pluginsByPlatform = exportPluginsSnapshotByPlatform();
    const nativeConfigs = exportNativeConfigs();
    const oauthCredentials = readJsonFileSafe(PATHS.oauthCredentials);

    // 读取 Markdown 配置文件
    const markdownFiles = {};
    const mdFileNames = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];

    for (const fileName of mdFileNames) {
      const filePath = path.join(PATHS.base, fileName);
      if (fs.existsSync(filePath)) {
        try {
          markdownFiles[fileName] = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
          console.warn(`无法读取 ${fileName}:`, err.message);
        }
      }
    }

    // 获取 UI / 前端配置
    const { loadUIConfig } = require('./ui-config');
    const { loadConfig } = require('../../config/loader');

    const uiConfigFile = readJsonFileSafe(CC_UI_CONFIG_PATH);
    const uiConfig = uiConfigFile || loadUIConfig();
    const prompts = readJsonFileSafe(CC_PROMPTS_PATH);
    const security = readJsonFileSafe(CC_SECURITY_PATH);
    const appConfig = loadConfig();

    const claudeSettings = readJsonFileSafe(CLAUDE_SETTINGS_PATH);
    const claudeHooks = {
      uiConfig: readJsonFileSafe(LEGACY_UI_CONFIG_PATH),
      notifyScript: readTextFileSafe(LEGACY_NOTIFY_HOOK_PATH),
      stopHook: claudeSettings?.hooks?.Stop || null
    };

    const exportData = {
      version: CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        configTemplates: customConfigTemplates,
        channels: channels || [],
        channelsByType,
        workspaces: workspaces || { workspaces: [] },
        favorites: favorites || { favorites: [] },
        agents: agents || [],
        agentsByPlatform,
        skills: skills || [],
        skillsByPlatform,
        commands: commands || [],
        commandsByPlatform,
        mcpServers: mcpServers || [],
        plugins: plugins || [],
        pluginsByPlatform,
        markdownFiles: markdownFiles,
        uiConfig: uiConfig,
        prompts: prompts,
        security: security,
        appConfig: appConfig,
        nativeConfigs,
        oauthCredentials,
        claudeHooks: claudeHooks
      }
    };

    return {
      success: true,
      data: exportData
    };
  } catch (error) {
    console.error('[ConfigExport] 导出配置失败:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * 导出所有配置为 ZIP
 * @returns {Object} { success, data: Buffer, filename }
 */
function exportAllConfigsZip() {
  const result = exportAllConfigs();
  if (!result.success) {
    return result;
  }

  const exportData = result.data;
  const zip = new AdmZip();
  const jsonContent = JSON.stringify(exportData, null, 2);

  zip.addFile('config.json', Buffer.from(jsonContent, 'utf8'));
  zip.addFile('README.md', Buffer.from(buildExportReadme(exportData), 'utf8'));

  return {
    success: true,
    data: zip.toBuffer(),
    filename: `ctx-config-${new Date().toISOString().split('T')[0]}.zip`
  };
}

/**
 * 导入配置
 * @param {Object} importData - 导入的配置对象
 * @param {Object} options - 导入选项 { overwrite: boolean }
 * @returns {Object} 导入结果
 */
async function importConfigs(importData, options = {}) {
  const { overwrite = true } = options; // 默认覆盖模式
  const results = {
    configTemplates: { success: 0, failed: 0, skipped: 0 },
    channels: { success: 0, failed: 0, skipped: 0 },
    workspaces: { success: 0, failed: 0, skipped: 0 },
    favorites: { success: 0, failed: 0, skipped: 0 },
    agents: { success: 0, failed: 0, skipped: 0 },
    skills: { success: 0, failed: 0, skipped: 0 },
    commands: { success: 0, failed: 0, skipped: 0 },
    mcpServers: { success: 0, failed: 0, skipped: 0 },
    plugins: { success: 0, failed: 0, skipped: 0 },
    markdownFiles: { success: 0, failed: 0, skipped: 0 },
    uiConfig: { success: 0, failed: 0, skipped: 0 },
    prompts: { success: 0, failed: 0, skipped: 0 },
    security: { success: 0, failed: 0, skipped: 0 },
    appConfig: { success: 0, failed: 0, skipped: 0 },
    nativeConfigs: { success: 0, failed: 0, skipped: 0 },
    oauthCredentials: { success: 0, failed: 0, skipped: 0 },
    claudeHooks: { success: 0, failed: 0, skipped: 0 }
  };

  try {
    // 验证导入数据格式
    if (!importData || !importData.data) {
      throw new Error('无效的导入数据格式');
    }

    const {
      configTemplates = [],
      channels = [],
      channelsByType = null,
      workspaces = null,
      favorites = null,
      agents = [],
      agentsByPlatform = {},
      skills = [],
      skillsByPlatform = {},
      commands = [],
      commandsByPlatform = {},
      plugins = [],
      pluginsByPlatform = {},
      mcpServers = [],
      markdownFiles = {},
      uiConfig = null,
      prompts = null,
      security = null,
      appConfig = null,
      nativeConfigs = {},
      oauthCredentials = null,
      claudeHooks = null
    } = importData.data;

    const importAgentsByPlatform = normalizePlatformItems(agents, agentsByPlatform, AGENT_PLATFORMS);
    const importSkillsByPlatform = normalizePlatformItems(skills, skillsByPlatform, SKILL_PLATFORMS);
    const importCommandsByPlatform = normalizePlatformItems(commands, commandsByPlatform, COMMAND_PLATFORMS);

    const hasTypedChannels = channelsByType && typeof channelsByType === 'object';
    const importChannelsByType = {
      claude: hasTypedChannels && Array.isArray(channelsByType.claude)
        ? channelsByType.claude
        : (Array.isArray(channels) ? channels : []),
      codex: hasTypedChannels && Array.isArray(channelsByType.codex) ? channelsByType.codex : [],
      gemini: hasTypedChannels && Array.isArray(channelsByType.gemini) ? channelsByType.gemini : [],
      opencode: hasTypedChannels && Array.isArray(channelsByType.opencode) ? channelsByType.opencode : [],
      omp: hasTypedChannels && Array.isArray(channelsByType.omp) ? channelsByType.omp: []
    };

    // 导入配置模板
    for (const template of configTemplates) {
      try {
        const existing = configTemplatesService.getTemplateById(template.id);

        if (existing && !overwrite) {
          results.configTemplates.skipped++;
          continue;
        }

        if (existing && overwrite) {
          configTemplatesService.updateCustomTemplate(template.id, template);
        } else {
          const newTemplate = {
            ...template,
            isBuiltin: false,
            importedAt: new Date().toISOString()
          };
          configTemplatesService.createCustomTemplate(newTemplate);
        }
        results.configTemplates.success++;
      } catch (err) {
        console.error(`[ConfigImport] 导入配置模板失败: ${template.name}`, err);
        results.configTemplates.failed++;
      }
    }

    // 导入频道配置（兼容旧结构 channels 和新结构 channelsByType）
    const importTypedChannels = (type, service, createChannel, findExisting = null) => {
      const sourceChannels = importChannelsByType[type];
      for (const channel of sourceChannels) {
        try {
          const existingChannels = service.getChannels
            ? (service.getChannels()?.channels || [])
            : (service.getAllChannels?.() || []);
          const existing = typeof findExisting === 'function'
            ? findExisting(existingChannels, channel)
            : existingChannels.find(c => c.id === channel.id);

          if (existing && !overwrite) {
            results.channels.skipped++;
            continue;
          }

          if (existing && overwrite) {
            service.updateChannel(existing.id, { ...channel, id: existing.id });
          } else {
            createChannel(channel);
          }
          results.channels.success++;
        } catch (err) {
          console.error(`[ConfigImport] 导入${type}频道失败: ${channel.name}`, err);
          results.channels.failed++;
        }
      }
    };

    importTypedChannels('claude', channelsService, channel => {
      const { name, baseUrl, apiKey, websiteUrl, ...extraConfig } = channel;
      channelsService.createChannel(name, baseUrl, apiKey, websiteUrl, extraConfig);
    }, (existingChannels, channel) => existingChannels.find(c => c.id === channel.id));

    importTypedChannels('codex', codexChannelsService, channel => {
      const {
        name,
        providerKey,
        baseUrl,
        apiKey,
        wireApi,
        ...extraConfig
      } = channel;
      codexChannelsService.createChannel(name, providerKey, baseUrl, apiKey, wireApi, extraConfig);
    }, (existingChannels, channel) => existingChannels.find(c =>
      (channel.id && c.id === channel.id) ||
      (channel.providerKey && c.providerKey === channel.providerKey)
    ));

    importTypedChannels('gemini', geminiChannelsService, channel => {
      const { name, baseUrl, apiKey, model, ...extraConfig } = channel;
      geminiChannelsService.createChannel(name, baseUrl, apiKey, model, extraConfig);
    }, (existingChannels, channel) => existingChannels.find(c =>
      (channel.id && c.id === channel.id) ||
      (channel.name && c.name === channel.name)
    ));

    importTypedChannels('opencode', opencodeChannelsService, channel => {
      const { name, baseUrl, apiKey, ...extraConfig } = channel;
      opencodeChannelsService.createChannel(name, baseUrl, apiKey, extraConfig);
    }, (existingChannels, channel) => existingChannels.find(c =>
      (channel.id && c.id === channel.id) ||
      (channel.providerKey && c.providerKey === channel.providerKey) ||
      (channel.name && channel.baseUrl && c.name === channel.name && c.baseUrl === channel.baseUrl)
    ));

    importTypedChannels('omp', ompChannelsService, channel => {
      const { name, baseUrl, apiKey, ...extraConfig } = channel;
      ompChannelsService.createChannel(name, baseUrl, apiKey, extraConfig);
    }, (existingChannels, channel) => existingChannels.find(c =>
      (channel.id && c.id === channel.id) ||
      (channel.providerKey && c.providerKey === channel.providerKey) ||
      (channel.name && channel.baseUrl && c.name === channel.name && c.baseUrl === channel.baseUrl)
    ));
    if ((importChannelsByType.omp || []).length > 0 && typeof ompChannelsService.syncManagedProviderExtension === 'function') {
      ompChannelsService.syncManagedProviderExtension();
    }

    // 导入工作区配置
    if (workspaces && overwrite) {
      try {
        const workspaceService = require('./workspace-service');
        workspaceService.saveWorkspaces(workspaces);
        results.workspaces.success = workspaces.workspaces?.length || 0;
      } catch (err) {
        console.error('[ConfigImport] 导入工作区失败:', err);
        results.workspaces.failed++;
      }
    }

    // 导入收藏配置
    if (favorites && overwrite) {
      try {
        const favoritesService = require('./favorites');
        favoritesService.saveFavorites(favorites);
        const count = Object.values(favorites).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
        results.favorites.success = count;
      } catch (err) {
        console.error('[ConfigImport] 导入收藏失败:', err);
        results.favorites.failed++;
      }
    }

    // 导入 Agents（多平台）
    if (AGENT_PLATFORMS.some(platform => importAgentsByPlatform[platform]?.length > 0)) {
      try {
        for (const platform of AGENT_PLATFORMS) {
          const platformAgents = importAgentsByPlatform[platform] || [];
          if (platformAgents.length === 0) continue;

          const agentsService = new AgentsService(platform);
          const baseDir = agentsService.userAgentsDir;

          for (const agent of platformAgents) {
            const filePath = resolveAgentRelativePath(agent, platform);
            const content = agent.fullContent || agent.content || buildAgentContent(agent);
            const status = filePath ? writeTextFile(baseDir, filePath, content, overwrite) : 'failed';

            if (status === 'success') {
              results.agents.success++;
            } else if (status === 'skipped') {
              results.agents.skipped++;
            } else {
              results.agents.failed++;
            }
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 Agents 失败:', err);
      }
    }

    // 导入 Skills（多平台）
    if (SKILL_PLATFORMS.some(platform => importSkillsByPlatform[platform]?.length > 0)) {
      try {
        for (const platform of SKILL_PLATFORMS) {
          const platformSkills = importSkillsByPlatform[platform] || [];
          if (platformSkills.length === 0) continue;

          const skillService = new SkillService(platform);
          const baseDir = skillService.installDir;
          ensureDir(baseDir);

          for (const skill of platformSkills) {
            const directory = skill.directory;
            const skillDir = resolveSafePath(baseDir, directory);
            if (!skillDir) {
              results.skills.failed++;
              continue;
            }

            if (fs.existsSync(skillDir)) {
              if (!overwrite) {
                results.skills.skipped++;
                continue;
              }
              fs.rmSync(skillDir, { recursive: true, force: true });
            }

            ensureDir(skillDir);
            const files = Array.isArray(skill.files) ? skill.files : [];
            let failed = false;

            for (const file of files) {
              const filePath = resolveSafePath(skillDir, file.path);
              if (!filePath) {
                failed = true;
                break;
              }
              ensureDir(path.dirname(filePath));
              try {
                if (file.encoding === SKILL_FILE_ENCODING) {
                  fs.writeFileSync(filePath, Buffer.from(file.content || '', SKILL_FILE_ENCODING));
                } else {
                  fs.writeFileSync(filePath, file.content || '', file.encoding || 'utf8');
                }
              } catch (err) {
                failed = true;
                break;
              }
            }

            if (failed || files.length === 0) {
              results.skills.failed++;
            } else {
              results.skills.success++;
            }
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 Skills 失败:', err);
      }
    }

    // 导入 Plugins（优先使用多平台结构，兼容旧结构 plugins）
    if (pluginsByPlatform && typeof pluginsByPlatform === 'object' && Object.keys(pluginsByPlatform).length > 0) {
      importPluginsByPlatformSnapshot(pluginsByPlatform, plugins, overwrite, results);
    }

    // 导入旧版 Plugins 结构。新包已经通过 pluginsByPlatform 处理过，避免重复写入。
    if (
      (!pluginsByPlatform || Object.keys(pluginsByPlatform).length === 0) &&
      importData.data.plugins &&
      importData.data.plugins.length > 0
    ) {
      const plugins = importData.data.plugins;

      try {
        for (const plugin of plugins) {
          try {
            const pluginType = plugin.type || 'legacy';

            // Determine target directory based on plugin type
            let targetDir;
            let registryPath;

            if (pluginType === 'legacy') {
              targetDir = path.join(LEGACY_PLUGINS_DIR, plugin.directory || plugin.name);
              registryPath = LEGACY_PLUGINS_REGISTRY;
            } else if (pluginType === 'native') {
              // SECURITY: Never trust installPath from import data - construct it safely
              const pluginId = plugin.id || plugin.name;
              if (!pluginId) {
                console.warn('[ConfigImport] Native plugin missing id/name, skipping');
                results.plugins.failed++;
                continue;
              }
              targetDir = path.join(CLAUDE_PLUGINS_DIR, pluginId);
              registryPath = NATIVE_PLUGINS_REGISTRY;
            } else {
              console.warn(`[ConfigImport] Unknown plugin type: ${pluginType}`);
              results.plugins.failed++;
              continue;
            }

            // Check if plugin exists
            if (fs.existsSync(targetDir)) {
              if (!overwrite) {
                results.plugins.skipped++;
                continue;
              }
              // Remove existing plugin directory
              fs.rmSync(targetDir, { recursive: true, force: true });
            }

            // Create plugin directory
            ensureDir(targetDir);

            // Write all plugin files from base64 content
            const files = Array.isArray(plugin.files) ? plugin.files : [];
            let failed = false;

            for (const file of files) {
              const filePath = resolveSafePath(targetDir, file.path);
              if (!filePath) {
                failed = true;
                break;
              }

              ensureDir(path.dirname(filePath));

              try {
                if (file.encoding === SKILL_FILE_ENCODING) {
                  fs.writeFileSync(filePath, Buffer.from(file.content || '', SKILL_FILE_ENCODING));
                } else {
                  fs.writeFileSync(filePath, file.content || '', file.encoding || 'utf8');
                }
              } catch (err) {
                console.error(`[ConfigImport] Failed to write plugin file ${file.path}:`, err);
                failed = true;
                break;
              }
            }

            if (failed || files.length === 0) {
              results.plugins.failed++;
              continue;
            }

            // Update appropriate registry
            try {
              ensureDir(path.dirname(registryPath));

              if (pluginType === 'legacy') {
                // Update legacy registry.json
                const registry = readJsonFileSafe(registryPath) || {};
                const pluginKey = plugin.directory || plugin.name;

                if (plugin.registryEntry) {
                  registry[pluginKey] = plugin.registryEntry;
                } else {
                  registry[pluginKey] = {
                    name: plugin.name,
                    version: plugin.version,
                    description: plugin.description,
                    author: plugin.author,
                    installedAt: new Date().toISOString()
                  };
                }

                fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
              } else if (pluginType === 'native') {
                // Update native installed_plugins.json
                const installedPlugins = readJsonFileSafe(registryPath) || {};
                const pluginId = plugin.id || plugin.name;

                if (plugin.registryEntry) {
                  installedPlugins[pluginId] = {
                    ...plugin.registryEntry,
                    installPath: targetDir
                  };
                } else {
                  installedPlugins[pluginId] = {
                    name: plugin.name,
                    version: plugin.version,
                    description: plugin.description,
                    author: plugin.author,
                    installPath: targetDir,
                    installedAt: new Date().toISOString()
                  };
                }

                fs.writeFileSync(registryPath, JSON.stringify(installedPlugins, null, 2), 'utf8');
              }

              results.plugins.success++;
            } catch (err) {
              console.error(`[ConfigImport] Failed to update plugin registry for ${plugin.name}:`, err);
              results.plugins.failed++;
            }
          } catch (err) {
            console.error(`[ConfigImport] Failed to import plugin ${plugin.name}:`, err);
            results.plugins.failed++;
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 Plugins 失败:', err);
      }
    }

    // 导入 Commands（多平台）
    if (COMMAND_PLATFORMS.some(platform => importCommandsByPlatform[platform]?.length > 0)) {
      try {
        for (const platform of COMMAND_PLATFORMS) {
          const platformCommands = importCommandsByPlatform[platform] || [];
          if (platformCommands.length === 0) continue;

          const commandsService = new CommandsService(platform);
          const baseDir = commandsService.userCommandsDir;

          for (const command of platformCommands) {
            const relativePath = resolveCommandRelativePath(command, platform);
            const content = command.fullContent || command.content || buildCommandContent(command);

            const status = relativePath ? writeTextFile(baseDir, relativePath, content, overwrite) : 'failed';
            if (status === 'success') {
              results.commands.success++;
            } else if (status === 'skipped') {
              results.commands.skipped++;
            } else {
              results.commands.failed++;
            }
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 Commands 失败:', err);
      }
    }

    // 导入 MCP Servers
    const mcpServerList = Array.isArray(mcpServers)
      ? mcpServers
      : Object.values(mcpServers || {});

    if (mcpServerList.length > 0 && overwrite) {
      try {
        const mcpService = require('./mcp-service');
        for (const server of mcpServerList) {
          try {
            await mcpService.saveServer(server, { syncPlatforms: false });
            results.mcpServers.success++;
          } catch (err) {
            console.error(`[ConfigImport] 导入 MCP Server 失败: ${server.name}`, err);
            results.mcpServers.failed++;
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 MCP Servers 失败:', err);
      }
    }

    // 导入 Markdown 文件
    if (markdownFiles && Object.keys(markdownFiles).length > 0 && overwrite) {
      const { PATHS } = require('../../config/paths');
      // SECURITY: Whitelist allowed markdown files to prevent path traversal
      const ALLOWED_MARKDOWN_FILES = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']);
      for (const [fileName, content] of Object.entries(markdownFiles)) {
        try {
          if (!ALLOWED_MARKDOWN_FILES.has(fileName)) {
            console.warn(`[ConfigImport] Skipping disallowed markdown file: ${fileName}`);
            results.markdownFiles.failed++;
            continue;
          }
          const filePath = path.join(PATHS.base, fileName);
          fs.writeFileSync(filePath, content, 'utf8');
          results.markdownFiles.success++;
        } catch (err) {
          console.error(`[ConfigImport] 导入 ${fileName} 失败:`, err);
          results.markdownFiles.failed++;
        }
      }
    }

    // 导入 UI 配置
    if (uiConfig && typeof uiConfig === 'object') {
      try {
        if (fs.existsSync(CC_UI_CONFIG_PATH) && !overwrite) {
          results.uiConfig.skipped++;
        } else {
          const { saveUIConfig } = require('./ui-config');
          saveUIConfig(uiConfig);
          results.uiConfig.success++;
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 UI 配置失败:', err);
        results.uiConfig.failed++;
      }
    }

    // 导入 Prompts 配置
    if (prompts && typeof prompts === 'object') {
      try {
        const status = writeJsonFileAbsolute(CC_PROMPTS_PATH, prompts, overwrite);
        if (status === 'success') {
          const promptsService = require('./prompts-service');
          if (prompts.activePresetId && prompts.presets?.[prompts.activePresetId]) {
            await promptsService.activatePreset(prompts.activePresetId);
          } else if (overwrite) {
            await promptsService.deactivatePrompt();
          }
          results.prompts.success++;
        } else if (status === 'skipped') {
          results.prompts.skipped++;
        } else {
          results.prompts.failed++;
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 Prompts 失败:', err);
        results.prompts.failed++;
      }
    }

    // 导入安全配置
    if (security && typeof security === 'object') {
      try {
        const status = writeJsonFileAbsolute(CC_SECURITY_PATH, security, overwrite, { mode: 0o600 });
        if (status === 'success') {
          results.security.success++;
        } else if (status === 'skipped') {
          results.security.skipped++;
        } else {
          results.security.failed++;
        }
      } catch (err) {
        console.error('[ConfigImport] 导入安全配置失败:', err);
        results.security.failed++;
      }
    }

    // 导入高级配置（config.json）
    if (appConfig && typeof appConfig === 'object') {
      try {
        const configFilePath = getConfigFilePath();
        if (configFilePath && fs.existsSync(configFilePath) && !overwrite) {
          results.appConfig.skipped++;
        } else {
          const { saveConfig } = require('../../config/loader');
          saveConfig(appConfig);
          results.appConfig.success++;
        }
      } catch (err) {
        console.error('[ConfigImport] 导入高级配置失败:', err);
        results.appConfig.failed++;
      }
    }

    // 导入各平台原生配置
    if (nativeConfigs && typeof nativeConfigs === 'object' && Object.keys(nativeConfigs).length > 0) {
      const nativeConfigSpecs = getNativeConfigSpecs();

      for (const [platform, platformEntries] of Object.entries(nativeConfigs)) {
        const platformSpecs = nativeConfigSpecs[platform];
        if (!platformSpecs || !platformEntries || typeof platformEntries !== 'object') {
          continue;
        }

        for (const [key, entry] of Object.entries(platformEntries)) {
          const spec = platformSpecs[key];
          if (!spec) {
            continue;
          }

          try {
            const status = writeNativeConfigAbsolute(spec, entry, overwrite);
            if (status === 'success') {
              results.nativeConfigs.success++;
            } else if (status === 'skipped') {
              results.nativeConfigs.skipped++;
            } else {
              results.nativeConfigs.failed++;
            }
          } catch (err) {
            console.error(`[ConfigImport] 导入 ${platform}.${key} 原生配置失败:`, err);
            results.nativeConfigs.failed++;
          }
        }
      }
    }

    if (oauthCredentials && typeof oauthCredentials === 'object') {
      try {
        const status = writeJsonFileAbsolute(PATHS.oauthCredentials, oauthCredentials, overwrite, { mode: 0o600 });
        if (status === 'success') {
          results.oauthCredentials.success++;
        } else if (status === 'skipped') {
          results.oauthCredentials.skipped++;
        } else {
          results.oauthCredentials.failed++;
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 OAuth 凭证失败:', err);
        results.oauthCredentials.failed++;
      }
    }

    // 导入 Claude Hooks 配置
    if (claudeHooks && typeof claudeHooks === 'object') {
      let didWrite = false;
      let didSkip = false;
      let didFail = false;

      try {
        if (claudeHooks.uiConfig && typeof claudeHooks.uiConfig === 'object') {
          const status = writeJsonFileAbsolute(LEGACY_UI_CONFIG_PATH, claudeHooks.uiConfig, overwrite);
          if (status === 'success') didWrite = true;
          else if (status === 'skipped') didSkip = true;
          else didFail = true;
        }

        if (claudeHooks.notifyScript !== undefined && claudeHooks.notifyScript !== null) {
          const status = writeTextFileAbsolute(LEGACY_NOTIFY_HOOK_PATH, claudeHooks.notifyScript, overwrite, { mode: 0o755 });
          if (status === 'success') didWrite = true;
          else if (status === 'skipped') didSkip = true;
          else didFail = true;
        }

        if (claudeHooks.stopHook !== undefined) {
          if (!overwrite && fs.existsSync(CLAUDE_SETTINGS_PATH)) {
            didSkip = true;
          } else {
            const settings = readJsonFileSafe(CLAUDE_SETTINGS_PATH) || {};
            settings.hooks = settings.hooks || {};
            if (claudeHooks.stopHook) {
              settings.hooks.Stop = claudeHooks.stopHook;
            } else if (settings.hooks.Stop) {
              delete settings.hooks.Stop;
              if (Object.keys(settings.hooks).length === 0) {
                delete settings.hooks;
              }
            }
            writeJsonFileAbsolute(CLAUDE_SETTINGS_PATH, settings, true);
            didWrite = true;
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 Claude Hooks 失败:', err);
        didFail = true;
      }

      if (didFail) {
        results.claudeHooks.failed++;
      } else if (didWrite) {
        results.claudeHooks.success++;
      } else if (didSkip) {
        results.claudeHooks.skipped++;
      }
    }

    syncImportedChannelsToNativeConfigs(importChannelsByType, nativeConfigs, overwrite);

    return {
      success: true,
      results,
      message: generateImportSummary(results)
    };
  } catch (error) {
    console.error('[ConfigImport] 导入配置失败:', error);
    return {
      success: false,
      message: error.message,
      results
    };
  }
}

/**
 * 生成导入摘要消息
 */
function generateImportSummary(results) {
  const parts = [];

  const types = [
    { key: 'configTemplates', label: '配置模板' },
    { key: 'channels', label: '频道' },
    { key: 'workspaces', label: '工作区' },
    { key: 'favorites', label: '收藏' },
    { key: 'agents', label: 'Agents' },
    { key: 'skills', label: 'Skills' },
    { key: 'commands', label: 'Commands' },
    { key: 'mcpServers', label: 'MCP服务器' },
    { key: 'plugins', label: '插件' },
    { key: 'markdownFiles', label: 'Markdown文件' },
    { key: 'uiConfig', label: 'UI配置' },
    { key: 'prompts', label: 'Prompts' },
    { key: 'security', label: '安全配置' },
    { key: 'appConfig', label: '高级配置' },
    { key: 'nativeConfigs', label: '原生配置' },
    { key: 'oauthCredentials', label: 'OAuth凭证' },
    { key: 'claudeHooks', label: 'Claude Hooks' }
  ];

  for (const { key, label } of types) {
    if (results[key] && results[key].success > 0) {
      parts.push(`${label}: ${results[key].success}成功`);
    }
  }

  const totalSkipped = Object.values(results).reduce((sum, r) => sum + (r.skipped || 0), 0);
  if (totalSkipped > 0) {
    parts.push(`${totalSkipped}项已跳过`);
  }

  const totalFailed = Object.values(results).reduce((sum, r) => sum + (r.failed || 0), 0);
  if (totalFailed > 0) {
    parts.push(`${totalFailed}项失败`);
  }

  return parts.join(', ') || '无数据导入';
}

module.exports = {
  exportAllConfigs,
  exportAllConfigsZip,
  importConfigs
};
