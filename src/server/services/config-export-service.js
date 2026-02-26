/**
 * 配置导出/导入服务
 * 支持权限模板、配置模板、频道配置的导出与导入
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const permissionTemplatesService = require('./permission-templates-service');
const configTemplatesService = require('./config-templates-service');
const channelsService = require('./channels');
const { AgentsService } = require('./agents-service');
const { CommandsService } = require('./commands-service');
const { RulesService } = require('./rules-service');
const { SkillService } = require('./skill-service');

const CONFIG_VERSION = '1.2.0';
const SKILL_FILE_ENCODING = 'base64';
const SKILL_IGNORE_DIRS = new Set(['.git']);
const SKILL_IGNORE_FILES = new Set(['.DS_Store']);
const CC_TOOL_DIR = path.join(os.homedir(), '.cc-tool');
const LEGACY_CC_TOOL_DIR = path.join(os.homedir(), '.cc-tool');
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const LEGACY_PLUGINS_DIR = path.join(LEGACY_CC_TOOL_DIR, 'plugins', 'installed');
const LEGACY_PLUGINS_REGISTRY = path.join(LEGACY_CC_TOOL_DIR, 'plugins', 'registry.json');
const NATIVE_PLUGINS_REGISTRY = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
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
const CC_TERMINAL_CONFIG_PATH = path.join(CC_TOOL_DIR, 'terminal-config.json');
const CC_TERMINAL_COMMANDS_PATH = path.join(CC_TOOL_DIR, 'terminal-commands.json');
const CC_PROMPTS_PATH = path.join(CC_TOOL_DIR, 'prompts.json');
const CC_SECURITY_PATH = path.join(CC_TOOL_DIR, 'security.json');
const LEGACY_UI_CONFIG_PATH = path.join(LEGACY_CC_TOOL_DIR, 'ui-config.json');
const LEGACY_NOTIFY_HOOK_PATH = path.join(LEGACY_CC_TOOL_DIR, 'notify-hook.js');

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
- 权限模板、配置模板、频道配置、工作区、收藏
- Agents / Skills / Commands / Rules
- 插件 (Plugins)
- MCP 服务器配置
- UI 配置（主题、面板显示、排序等）
- 终端配置与 CLI 命令配置
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

function buildRuleContent(rule) {
  const lines = [];
  if (rule.paths) {
    lines.push('---');
    lines.push(`paths: ${rule.paths}`);
    lines.push('---');
    lines.push('');
  }
  const body = rule.body || '';
  return `${lines.join('\n')}${body}`;
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

function exportSkillsSnapshot() {
  const skillService = new SkillService();
  const installedSkills = skillService.getInstalledSkills();
  const baseDir = skillService.installDir;

  return installedSkills.map((skill) => {
    const directory = skill.directory;
    const skillDir = resolveSafePath(baseDir, directory);
    if (!skillDir || !fs.existsSync(skillDir)) {
      return null;
    }
    return {
      directory,
      name: skill.name || directory,
      description: skill.description || '',
      files: collectSkillFiles(skillDir)
    };
  }).filter(Boolean);
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

/**
 * 导出所有配置为JSON
 * @returns {Object} 配置导出对象
 */
function exportAllConfigs() {
  try {
    // 获取所有权限模板(只导出自定义模板)
    const allPermissionTemplates = permissionTemplatesService.getAllTemplates();
    const customPermissionTemplates = allPermissionTemplates.filter(t => !t.isBuiltin);

    // 获取所有配置模板(只导出自定义模板)
    const allConfigTemplates = configTemplatesService.getAllTemplates();
    const customConfigTemplates = allConfigTemplates.filter(t => !t.isBuiltin);

    // 获取所有频道配置
    const channels = channelsService.getAllChannels() || [];

    // 获取工作区配置
    const workspaceService = require('./workspace-service');
    const workspaces = workspaceService.loadWorkspaces();

    // 获取收藏配置
    const favoritesService = require('./favorites');
    const favorites = favoritesService.loadFavorites();

    // 获取 Agents 配置
    const agentsService = new AgentsService();
    const { agents: rawAgents } = agentsService.listAgents();
    const agents = rawAgents.map(agent => ({
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
    }));

    // 获取 Skills 配置
    const skills = exportSkillsSnapshot();

    // 获取 Commands 配置
    const commandsService = new CommandsService();
    const { commands: rawCommands } = commandsService.listCommands();
    const commands = rawCommands.map(command => ({
      name: command.name,
      namespace: command.namespace,
      description: command.description,
      allowedTools: command.allowedTools,
      argumentHint: command.argumentHint,
      path: command.path,
      body: command.body,
      fullContent: command.fullContent
    }));

    // 获取 Rules 配置
    const rulesService = new RulesService();
    const { rules: rawRules } = rulesService.listRules();
    const rules = rawRules.map(rule => ({
      fileName: rule.fileName,
      directory: rule.directory,
      paths: rule.paths,
      path: rule.path,
      body: rule.body,
      fullContent: rule.fullContent
    }));

    // 获取 MCP 配置
    const mcpService = require('./mcp-service');
    const mcpServers = mcpService.getAllServers();

    // 获取 Plugins 配置
    const plugins = exportPluginsSnapshot();

    // 读取 Markdown 配置文件
    const { PATHS } = require('../../config/paths');
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
    const { loadTerminalConfig } = require('./terminal-config');
    const { loadTerminalCommands } = require('./terminal-commands');
    const { loadConfig } = require('../../config/loader');

    const uiConfigFile = readJsonFileSafe(CC_UI_CONFIG_PATH);
    const uiConfig = uiConfigFile || loadUIConfig();
    const terminalConfig = loadTerminalConfig();
    const terminalCommands = loadTerminalCommands();
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
        permissionTemplates: customPermissionTemplates,
        configTemplates: customConfigTemplates,
        channels: channels || [],
        workspaces: workspaces || { workspaces: [] },
        favorites: favorites || { favorites: [] },
        agents: agents || [],
        skills: skills || [],
        commands: commands || [],
        rules: rules || [],
        mcpServers: mcpServers || [],
        plugins: plugins || [],
        markdownFiles: markdownFiles,
        uiConfig: uiConfig,
        terminalConfig: terminalConfig,
        terminalCommands: terminalCommands,
        prompts: prompts,
        security: security,
        appConfig: appConfig,
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
function importConfigs(importData, options = {}) {
  const { overwrite = true } = options; // 默认覆盖模式
  const results = {
    permissionTemplates: { success: 0, failed: 0, skipped: 0 },
    configTemplates: { success: 0, failed: 0, skipped: 0 },
    channels: { success: 0, failed: 0, skipped: 0 },
    workspaces: { success: 0, failed: 0, skipped: 0 },
    favorites: { success: 0, failed: 0, skipped: 0 },
    agents: { success: 0, failed: 0, skipped: 0 },
    skills: { success: 0, failed: 0, skipped: 0 },
    commands: { success: 0, failed: 0, skipped: 0 },
    rules: { success: 0, failed: 0, skipped: 0 },
    mcpServers: { success: 0, failed: 0, skipped: 0 },
    plugins: { success: 0, failed: 0, skipped: 0 },
    markdownFiles: { success: 0, failed: 0, skipped: 0 },
    uiConfig: { success: 0, failed: 0, skipped: 0 },
    terminalConfig: { success: 0, failed: 0, skipped: 0 },
    terminalCommands: { success: 0, failed: 0, skipped: 0 },
    prompts: { success: 0, failed: 0, skipped: 0 },
    security: { success: 0, failed: 0, skipped: 0 },
    appConfig: { success: 0, failed: 0, skipped: 0 },
    claudeHooks: { success: 0, failed: 0, skipped: 0 }
  };

  try {
    // 验证导入数据格式
    if (!importData || !importData.data) {
      throw new Error('无效的导入数据格式');
    }

    const {
      permissionTemplates = [],
      configTemplates = [],
      channels = [],
      workspaces = null,
      favorites = null,
      agents = [],
      skills = [],
      commands = [],
      rules = [],
      mcpServers = [],
      markdownFiles = {},
      uiConfig = null,
      terminalConfig = null,
      terminalCommands = null,
      prompts = null,
      security = null,
      appConfig = null,
      claudeHooks = null
    } = importData.data;

    // 导入权限模板
    for (const template of permissionTemplates) {
      try {
        const existing = permissionTemplatesService.getTemplateById(template.id);

        if (existing && !overwrite) {
          results.permissionTemplates.skipped++;
          continue;
        }

        if (existing && overwrite) {
          permissionTemplatesService.updateTemplate(template.id, template);
        } else {
          const newTemplate = {
            ...template,
            isBuiltin: false,
            importedAt: new Date().toISOString()
          };
          permissionTemplatesService.createTemplate(newTemplate);
        }
        results.permissionTemplates.success++;
      } catch (err) {
        console.error(`[ConfigImport] 导入权限模板失败: ${template.name}`, err);
        results.permissionTemplates.failed++;
      }
    }

    // 导入配置模板
    for (const template of configTemplates) {
      try {
        const existing = configTemplatesService.getTemplateById(template.id);

        if (existing && !overwrite) {
          results.configTemplates.skipped++;
          continue;
        }

        if (existing && overwrite) {
          configTemplatesService.updateTemplate(template.id, template);
        } else {
          const newTemplate = {
            ...template,
            isBuiltin: false,
            importedAt: new Date().toISOString()
          };
          configTemplatesService.createTemplate(newTemplate);
        }
        results.configTemplates.success++;
      } catch (err) {
        console.error(`[ConfigImport] 导入配置模板失败: ${template.name}`, err);
        results.configTemplates.failed++;
      }
    }

    // 导入频道配置
    for (const channel of channels) {
      try {
        const existingChannels = channelsService.getAllChannels() || [];
        const existing = existingChannels.find(c => c.id === channel.id);

        if (existing && !overwrite) {
          results.channels.skipped++;
          continue;
        }

        if (existing && overwrite) {
          channelsService.updateChannel(channel.id, channel);
        } else {
          const { name, baseUrl, apiKey, websiteUrl, ...extraConfig } = channel;
          channelsService.createChannel(name, baseUrl, apiKey, websiteUrl, extraConfig);
        }
        results.channels.success++;
      } catch (err) {
        console.error(`[ConfigImport] 导入频道失败: ${channel.name}`, err);
        results.channels.failed++;
      }
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

    // 导入 Agents
    if (agents && agents.length > 0) {
      try {
        const agentsService = new AgentsService();
        const baseDir = agentsService.userAgentsDir;

        for (const agent of agents) {
          const relativePath = agent.path || agent.fileName || agent.name;
          const filePath = relativePath && relativePath.endsWith('.md')
            ? relativePath
            : (relativePath ? `${relativePath}.md` : null);
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
      } catch (err) {
        console.error('[ConfigImport] 导入 Agents 失败:', err);
      }
    }

    // 导入 Skills
    if (skills && skills.length > 0) {
      try {
        const skillService = new SkillService();
        const baseDir = skillService.installDir;
        ensureDir(baseDir);

        for (const skill of skills) {
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
              targetDir = path.join(os.homedir(), '.claude', 'plugins', pluginId);
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

    // 导入 Commands
    if (commands && commands.length > 0) {
      try {
        const commandsService = new CommandsService();
        const baseDir = commandsService.userCommandsDir;

        for (const command of commands) {
          const relativePath = command.path || (
            command.namespace
              ? path.join(command.namespace, `${command.name}.md`)
              : `${command.name}.md`
          );
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
      } catch (err) {
        console.error('[ConfigImport] 导入 Commands 失败:', err);
      }
    }

    // 导入 Rules
    if (rules && rules.length > 0) {
      try {
        const rulesService = new RulesService();
        const baseDir = rulesService.userRulesDir;

        for (const rule of rules) {
          const relativePath = rule.path || (
            rule.directory
              ? path.join(rule.directory, `${rule.fileName || rule.name}.md`)
              : `${rule.fileName || rule.name}.md`
          );
          const content = rule.fullContent || rule.content || buildRuleContent(rule);

          const status = relativePath ? writeTextFile(baseDir, relativePath, content, overwrite) : 'failed';
          if (status === 'success') {
            results.rules.success++;
          } else if (status === 'skipped') {
            results.rules.skipped++;
          } else {
            results.rules.failed++;
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 Rules 失败:', err);
      }
    }

    // 导入 MCP Servers
    if (mcpServers && mcpServers.length > 0 && overwrite) {
      try {
        const mcpService = require('./mcp-service');
        for (const server of mcpServers) {
          try {
            mcpService.saveServer(server);
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

    // 导入终端配置
    if (terminalConfig && typeof terminalConfig === 'object') {
      try {
        if (fs.existsSync(CC_TERMINAL_CONFIG_PATH) && !overwrite) {
          results.terminalConfig.skipped++;
        } else {
          const { saveTerminalConfig } = require('./terminal-config');
          saveTerminalConfig(terminalConfig);
          results.terminalConfig.success++;
        }
      } catch (err) {
        console.error('[ConfigImport] 导入终端配置失败:', err);
        results.terminalConfig.failed++;
      }
    }

    // 导入终端命令配置
    if (terminalCommands && typeof terminalCommands === 'object') {
      try {
        if (fs.existsSync(CC_TERMINAL_COMMANDS_PATH) && !overwrite) {
          results.terminalCommands.skipped++;
        } else {
          const { saveTerminalCommands } = require('./terminal-commands');
          const ok = saveTerminalCommands(terminalCommands);
          if (ok) {
            results.terminalCommands.success++;
          } else {
            results.terminalCommands.failed++;
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入终端命令配置失败:', err);
        results.terminalCommands.failed++;
      }
    }

    // 导入 Prompts 配置
    if (prompts && typeof prompts === 'object') {
      try {
        const status = writeJsonFileAbsolute(CC_PROMPTS_PATH, prompts, overwrite);
        if (status === 'success') {
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
    { key: 'permissionTemplates', label: '权限模板' },
    { key: 'configTemplates', label: '配置模板' },
    { key: 'channels', label: '频道' },
    { key: 'workspaces', label: '工作区' },
    { key: 'favorites', label: '收藏' },
    { key: 'agents', label: 'Agents' },
    { key: 'skills', label: 'Skills' },
    { key: 'commands', label: 'Commands' },
    { key: 'rules', label: 'Rules' },
    { key: 'mcpServers', label: 'MCP服务器' },
    { key: 'plugins', label: '插件' },
    { key: 'markdownFiles', label: 'Markdown文件' },
    { key: 'uiConfig', label: 'UI配置' },
    { key: 'terminalConfig', label: '终端配置' },
    { key: 'terminalCommands', label: '终端命令' },
    { key: 'prompts', label: 'Prompts' },
    { key: 'security', label: '安全配置' },
    { key: 'appConfig', label: '高级配置' },
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
