/**
 * 配置导出/导入服务
 * 支持配置模板、频道配置的导出与导入
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const configTemplatesService = require('./config-templates-service');
const channelsService = require('./channels');
const codexChannelsService = require('./codex-channels');
const geminiChannelsService = require('./gemini-channels');
const opencodeChannelsService = require('./opencode-channels');
const { AgentsService } = require('./agents-service');
const { CommandsService } = require('./commands-service');
const { SkillService } = require('./skill-service');
const { PATHS, NATIVE_PATHS } = require('../../config/paths');

const CONFIG_VERSION = '1.4.0';
const SKILL_FILE_ENCODING = 'base64';
const SKILL_IGNORE_DIRS = new Set(['.git']);
const SKILL_IGNORE_FILES = new Set(['.DS_Store']);
const CC_TOOL_DIR = PATHS.base;
const LEGACY_CC_TOOL_DIR = PATHS.base;
const CLAUDE_SETTINGS_PATH = NATIVE_PATHS.claude.settings;
const LEGACY_PLUGINS_DIR = path.join(LEGACY_CC_TOOL_DIR, 'plugins', 'installed');
const LEGACY_PLUGINS_REGISTRY = path.join(LEGACY_CC_TOOL_DIR, 'plugins', 'registry.json');
const CLAUDE_PLUGINS_DIR = path.join(path.dirname(NATIVE_PATHS.claude.settings), 'plugins');
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
const CC_UI_CONFIG_PATH = path.join(CC_TOOL_DIR, 'ui-config.json');
const CC_PROMPTS_PATH = path.join(CC_TOOL_DIR, 'prompts.json');
const CC_SECURITY_PATH = path.join(CC_TOOL_DIR, 'security.json');
const LEGACY_UI_CONFIG_PATH = path.join(LEGACY_CC_TOOL_DIR, 'ui-config.json');
const LEGACY_NOTIFY_HOOK_PATH = path.join(LEGACY_CC_TOOL_DIR, 'notify-hook.js');
const GEMINI_SETTINGS_PATH = path.join(path.dirname(NATIVE_PATHS.gemini.env), 'settings.json');
const AGENT_PLATFORMS = ['claude', 'codex', 'opencode'];
const COMMAND_PLATFORMS = ['claude', 'opencode'];
const SKILL_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode'];

function getOpenCodeConfigPaths() {
  try {
    const { CONFIG_PATHS } = require('./opencode-settings-manager');
    return CONFIG_PATHS || {};
  } catch (err) {
    return {};
  }
}

function getNativeConfigSpecs() {
  const openCodeConfigPaths = getOpenCodeConfigPaths();
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
      configJson: { path: openCodeConfigPaths.config, format: 'text' }
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

    return {
      format: spec.format || 'text',
      fileName: path.basename(spec.path),
      content: rawContent
    };
  } catch (err) {
    return null;
  }
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
    return 'failed';
  }

  const format = entry.format || spec.format || 'text';
  if (format === 'json' && entry.content && typeof entry.content === 'object') {
    return writeJsonFileAbsolute(spec.path, entry.content, overwrite, { mode: spec.mode });
  }

  return writeTextFileAbsolute(spec.path, String(entry.content), overwrite, { mode: spec.mode });
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

## 📦 包含内容
- 配置模板、频道配置、工作区、收藏
- Agents / Skills / Commands
- 插件 (Plugins)
- MCP 服务器配置
- OAuth 凭证管理池
- 各平台原生配置（Claude / Codex / Gemini / OpenCode）
- UI 配置（主题、面板显示、排序等）
- Prompts 预设
- 安全配置
- 高级配置（端口、日志、性能等）
- Claude Hooks 配置（如通知脚本）

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

function resolveCommandRelativePath(command) {
  if (typeof command?.path === 'string' && command.path.trim()) {
    return command.path.trim();
  }
  if (command?.namespace) {
    return path.join(command.namespace, `${command.name}.md`);
  }
  return command?.name ? `${command.name}.md` : null;
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
    if (!hasNativeConfigFor('codex')) {
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
    if (!hasNativeConfigFor('opencode')) {
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
  return { claude, codex, gemini, opencode };
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
      opencode: hasTypedChannels && Array.isArray(channelsByType.opencode) ? channelsByType.opencode : []
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

    // 导入 Plugins
    if (importData.data.plugins && importData.data.plugins.length > 0) {
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
            const relativePath = resolveCommandRelativePath(command);
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
