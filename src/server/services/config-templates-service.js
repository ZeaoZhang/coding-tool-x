/**
 * 配置模板服务
 *
 * 管理工作区/项目的配置模板组合
 * 支持 CLAUDE.md, skills, commands, agents, MCP 等的预设组合
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { PATHS } = require('../../config/paths');
const { AgentsService } = require('./agents-service');
const { CommandsService } = require('./commands-service');
const { SkillService } = require('./skill-service');
const { PluginsService } = require('./plugins-service');
const { convertCommandToCodex, convertCommandToGemini } = require('./format-converter');
const mcpService = require('./mcp-service');
const promptsService = require('./prompts-service');
const pluginsService = new PluginsService();

// 配置模板文件路径
const TEMPLATES_FILE = path.join(PATHS.config, 'config-templates.json');
const AI_CONFIG_MAP = {
  claude: { fileName: 'CLAUDE.md', name: 'Claude' },
  codex: { fileName: 'AGENTS.md', name: 'Codex' },
  gemini: { fileName: 'GEMINI.md', name: 'Gemini' },
  opencode: { fileName: '.opencode/AGENTS.md', name: 'OpenCode' },
  pi: { fileName: null, name: 'OMP command templates' }
};

const CLI_DEFAULT_AI_TYPE = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode',
  pi: 'pi'
};

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function pushSkipped(list, type, item, reason) {
  list.push({ type, item, reason });
}

function getTemplateDefaultAiType(template) {
  if (template?.cliType && CLI_DEFAULT_AI_TYPE[template.cliType]) {
    return CLI_DEFAULT_AI_TYPE[template.cliType];
  }
  return 'claude';
}

function normalizeRequestedAiConfigTypes(options = {}, template = null, skipped = []) {
  let aiConfigTypes = options.aiConfigTypes;
  if (!aiConfigTypes) {
    aiConfigTypes = options.aiConfigType ? [options.aiConfigType] : [getTemplateDefaultAiType(template)];
  }
  if (!Array.isArray(aiConfigTypes)) {
    aiConfigTypes = [aiConfigTypes];
  }

  const normalized = [];
  const seen = new Set();
  for (const rawType of aiConfigTypes) {
    if (typeof rawType !== 'string') {
      pushSkipped(skipped, 'aiConfigType', String(rawType), 'AI 配置类型无效，已忽略');
      continue;
    }
    const aiType = rawType.trim().toLowerCase();
    if (!aiType) continue;
    if (!AI_CONFIG_MAP[aiType]) {
      pushSkipped(skipped, 'aiConfigType', aiType, `不支持的 AI 配置类型: ${aiType}`);
      continue;
    }
    if (!seen.has(aiType)) {
      seen.add(aiType);
      normalized.push(aiType);
    }
  }

  if (normalized.length === 0) {
    const fallbackType = getTemplateDefaultAiType(template);
    normalized.push(fallbackType);
    pushSkipped(skipped, 'aiConfigType', fallbackType, `未提供有效 AI 配置类型，已回退到默认类型: ${fallbackType}`);
  }

  return normalized;
}

function resolveAiConfig(template, aiConfigType) {
  if (template?.aiConfigs?.[aiConfigType]) {
    return template.aiConfigs[aiConfigType];
  }
  if (aiConfigType === 'claude' && template?.claudeMd) {
    return template.claudeMd;
  }
  return null;
}

function resolveItemName(primary, fallback, defaultPrefix) {
  const raw = (primary || fallback || '').toString().trim();
  if (raw) return raw;
  return `${defaultPrefix}-${Date.now()}`;
}

function normalizeAiConfigs(aiConfigs = {}, claudeMd = null) {
  const normalized = {
    claude: { enabled: false, content: '' },
    codex: { enabled: false, content: '' },
    gemini: { enabled: false, content: '' },
    opencode: { enabled: false, content: '' },
    pi: { enabled: false, content: '' }
  };

  for (const key of Object.keys(normalized)) {
    const cfg = aiConfigs?.[key];
    if (cfg && typeof cfg === 'object') {
      normalized[key] = {
        enabled: !!cfg.enabled,
        content: cfg.content || ''
      };
    }
  }

  if (claudeMd?.enabled && claudeMd?.content && !normalized.claude.content) {
    normalized.claude = {
      enabled: true,
      content: claudeMd.content
    };
  }

  // OpenCode defaults to Codex profile if not explicitly configured.
  if (!normalized.opencode.content) {
    const fallback = normalized.codex.content ? normalized.codex : normalized.claude;
    normalized.opencode = {
      enabled: !!fallback.enabled,
      content: fallback.content || ''
    };
  }

  return normalized;
}

function normalizeTemplate(template) {
  if (!template || typeof template !== 'object') {
    return template;
  }

  const normalized = { ...template };
  normalized.aiConfigs = normalizeAiConfigs(template.aiConfigs, template.claudeMd);
  if (!normalized.claudeMd) {
    normalized.claudeMd = { enabled: false, content: '' };
  }
  delete normalized.rules;

  return normalized;
}

/**
 * 加载配置模板
 */
function loadTemplates() {
  try {
    if (fs.existsSync(TEMPLATES_FILE)) {
      const content = fs.readFileSync(TEMPLATES_FILE, 'utf8');
      const data = JSON.parse(content);
      return {
        custom: (data.custom || []).map(normalizeTemplate)
      };
    }
  } catch (error) {
    console.error('加载配置模板失败:', error.message);
  }

  return {
    custom: []
  };
}

/**
 * 保存用户自定义模板
 */
function saveCustomTemplates(customTemplates) {
  try {
    ensureDir(path.dirname(TEMPLATES_FILE));
    const data = {
      custom: customTemplates,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('保存配置模板失败:', error.message);
    return false;
  }
}

/**
 * 获取所有模板
 */
function getAllTemplates() {
  const { custom } = loadTemplates();
  return custom;
}

/**
 * 根据 ID 获取模板
 */
function getTemplateById(id) {
  const templates = getAllTemplates();
  return templates.find(t => t.id === id);
}

/**
 * 创建自定义模板
 */
function createCustomTemplate(template) {
  const { custom } = loadTemplates();

  // 验证必填字段
  if (!template.name || !template.name.trim()) {
    throw new Error('模板名称不能为空');
  }

  // 生成唯一 ID
  const id = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const newTemplate = {
    id,
    name: template.name,
    description: template.description || '',
    cliType: template.cliType || 'claude',
    claudeMd: template.claudeMd || { enabled: false, content: '' },
    aiConfigs: normalizeAiConfigs(template.aiConfigs, template.claudeMd),
    skills: template.skills || [],
    commands: template.commands || [],
    agents: template.agents || [],
    plugins: template.plugins || [],
    mcpServers: template.mcpServers || [],
    createdAt: new Date().toISOString()
  };

  custom.push(normalizeTemplate(newTemplate));
  saveCustomTemplates(custom);

  return normalizeTemplate(newTemplate);
}

/**
 * 更新自定义模板
 */
function updateCustomTemplate(id, updates) {
  const { custom } = loadTemplates();
  const index = custom.findIndex(t => t.id === id);

  if (index === -1) {
    throw new Error('模板不存在或不可修改');
  }

  custom[index] = {
    ...custom[index],
    ...updates,
    cliType: updates.cliType !== undefined ? updates.cliType : (custom[index].cliType || 'claude'),
    aiConfigs: normalizeAiConfigs(updates.aiConfigs || custom[index].aiConfigs, updates.claudeMd || custom[index].claudeMd),
    id: custom[index].id, // 保持 ID 不变
    updatedAt: new Date().toISOString()
  };
  delete custom[index].rules;

  saveCustomTemplates(custom);
  return custom[index];
}

/**
 * 删除自定义模板
 */
function deleteCustomTemplate(id) {
  const { custom } = loadTemplates();
  const customIndex = custom.findIndex(t => t.id === id);

  if (customIndex !== -1) {
    const filtered = custom.filter(t => t.id !== id);
    saveCustomTemplates(filtered);
    return true;
  }

  throw new Error('模板不存在或不可删除');
}

/**
 * 应用模板到指定目录
 * @param {string} targetDir - 目标目录
 * @param {string} templateId - 模板 ID
 */
function applyTemplate(targetDir, templateId) {
  const template = getTemplateById(templateId);

  if (!template) {
    throw new Error('模板不存在');
  }

  // 确保目标目录存在
  ensureDir(targetDir);

  const results = {
    claudeMd: false,
    skills: 0,
    commands: 0,
    agents: 0,
    plugins: 0,
    mcpServers: 0
  };

  // 1. 应用 CLAUDE.md
  if (template.claudeMd && template.claudeMd.enabled && template.claudeMd.content) {
    const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, template.claudeMd.content, 'utf8');
    results.claudeMd = true;
  }

  // 2. 创建配置记录文件（记录应用了哪个模板）
  const configRecord = {
    templateId: template.id,
    templateName: template.name,
    appliedAt: new Date().toISOString(),
    skills: template.skills,
    commands: template.commands,
    agents: template.agents,
    plugins: template.plugins,
    mcpServers: template.mcpServers
  };

  const recordPath = path.join(targetDir, '.ctx-config.json');
  fs.writeFileSync(recordPath, JSON.stringify(configRecord, null, 2), 'utf8');

  return {
    success: true,
    results,
    template: template.name
  };
}

/**
 * 从目录读取当前配置
 */
function readCurrentConfig(targetDir) {
  const recordPath = path.join(targetDir, '.ctx-config.json');

  if (fs.existsSync(recordPath)) {
    try {
      const content = fs.readFileSync(recordPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error('读取配置记录失败:', error.message);
    }
  }

  return null;
}

// ============================================================================
// 新增方法：获取可用配置、应用模板到项目、预览应用效果
// ============================================================================

/**
 * 获取所有可用配置（用于模板编辑器选择）
 * 返回用户级的 agents, commands, plugins + MCP 服务器列表
 */
function getAvailableConfigs() {
  const agentPlatforms = ['claude', 'codex', 'gemini', 'opencode'];
  const commandPlatforms = ['claude', 'codex', 'gemini', 'opencode', 'pi'];
  const agentMap = new Map();
  const commandMap = new Map();
  const agentsByPlatform = {};
  const commandsByPlatform = {};

  for (const platform of agentPlatforms) {
    const service = new AgentsService(platform);
    const { agents } = service.listAgents();
    for (const agent of agents || []) {
      if (agent.scope !== 'user') continue;
      const normalizedAgent = {
        fileName: agent.fileName,
        name: agent.name,
        description: agent.description,
        tools: agent.tools,
        model: agent.model,
        permissionMode: agent.permissionMode,
        skills: agent.skills,
        systemPrompt: agent.systemPrompt
      };
      agentsByPlatform[platform] = agentsByPlatform[platform] || [];
      agentsByPlatform[platform].push(normalizedAgent);
      const key = `${agent.fileName || agent.name}|${agent.model || ''}|${agent.description || ''}`;
      if (!agentMap.has(key)) {
        agentMap.set(key, normalizedAgent);
      }
    }
  }

  for (const platform of commandPlatforms) {
    const service = new CommandsService(platform);
    const { commands } = service.listCommands();
    for (const command of commands || []) {
      if (command.scope !== 'user') continue;
      const normalizedCommand = {
        name: command.name,
        namespace: command.namespace,
        description: command.description,
        allowedTools: command.allowedTools,
        argumentHint: command.argumentHint,
        body: command.body
      };
      commandsByPlatform[platform] = commandsByPlatform[platform] || [];
      commandsByPlatform[platform].push(normalizedCommand);
      const key = command.namespace ? `${command.namespace}/${command.name}` : command.name;
      if (!commandMap.has(key)) {
        commandMap.set(key, normalizedCommand);
      }
    }
  }

  // 按平台分别获取 skills（每个平台有独立的安装目录）
  const skillsByPlatform = {};
  for (const platform of ['claude', 'codex', 'gemini', 'opencode', 'pi']) {
    const service = new SkillService(platform);
    skillsByPlatform[platform] = service.getInstalledSkills().map(skill => ({
      directory: skill.directory,
      name: skill.name || skill.directory,
      description: skill.description || '',
      repoOwner: skill.repoOwner || null,
      repoName: skill.repoName || null,
      repoBranch: skill.repoBranch || null
    }));
  }

  // 获取已安装的插件和市场插件
  const { plugins: installedPlugins } = pluginsService.listPlugins();

  // 获取 MCP 服务器
  const mcpServers = mcpService.getAllServers();
  const mcpServerList = Object.values(mcpServers).map(s => ({
    id: s.id,
    name: s.name || s.id,
    description: s.description || ''
  }));

  // 获取 MCP 预设
  const mcpPresets = mcpService.getPresets().map(p => ({
    id: p.id,
    name: p.name,
    description: p.description
  }));

  // 获取 Prompts 预设（用于 CLAUDE.md 内容选择）
  const { presets: promptPresets } = promptsService.getAllPresets();
  const promptsList = Object.values(promptPresets).map(p => ({
    id: p.id,
    name: p.name,
    description: p.description || '',
    content: p.content || '',
    isBuiltin: p.isBuiltin || false
  }));

  return {
    skillsByPlatform,
    agents: Array.from(agentMap.values()),
    agentsByPlatform,
    commands: Array.from(commandMap.values()),
    commandsByPlatform,
    plugins: installedPlugins.map(p => ({
      name: p.name,
      description: p.description || '',
      version: p.version || '1.0.0',
      marketplace: p.marketplace || null,
      source: p.source || null,
      repoUrl: p.repoUrl || null
    })),
    mcpServers: mcpServerList,
    mcpPresets,
    prompts: promptsList
  };
}

/**
 * 生成 Agent 文件内容
 */
function generateAgentContent(agent) {
  const lines = ['---'];
  if (agent.name) lines.push(`name: ${agent.name}`);
  if (agent.description) lines.push(`description: "${agent.description}"`);
  if (agent.tools) lines.push(`tools: ${agent.tools}`);
  if (agent.model) lines.push(`model: ${agent.model}`);
  if (agent.permissionMode) lines.push(`permissionMode: ${agent.permissionMode}`);
  if (agent.skills) lines.push(`skills: ${agent.skills}`);
  lines.push('---');
  return lines.join('\n') + '\n\n' + (agent.systemPrompt || '');
}

/**
 * 生成 Command 文件内容
 */
function generateCommandContent(command) {
  const lines = ['---'];
  if (command.description) lines.push(`description: "${command.description}"`);
  if (command.allowedTools) lines.push(`allowed-tools: ${command.allowedTools}`);
  if (command.argumentHint) lines.push(`argument-hint: ${command.argumentHint}`);
  lines.push('---');
  return lines.join('\n') + '\n\n' + (command.body || '');
}

function buildTemplateCommandFileName(commandName, format) {
  return `${commandName}.${format === 'gemini' ? 'toml' : 'md'}`;
}

function getCommandPreviewExtension(prefix) {
  return prefix === '.gemini/commands' ? 'toml' : 'md';
}

function writeJsonFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function writeYamlFile(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, yaml.dump(data || {}, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false
  }), 'utf-8');
}

function mergePiProjectPackages(targetDir, plugins = []) {
  const packages = plugins.map(plugin => plugin.name).filter(Boolean);
  if (packages.length === 0) {
    return false;
  }

  const piDir = path.join(targetDir, '.omp');
  const settingsPath = path.join(piDir, 'config.yml');
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const parsed = yaml.load(fs.readFileSync(settingsPath, 'utf-8'));
      settings = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      settings = {};
    }
  }

  const existingPackages = Array.isArray(settings.packages) ? settings.packages : [];
  settings.packages = Array.from(new Set([...existingPackages, ...packages]));
  writeYamlFile(settingsPath, settings);
  return true;
}

/**
 * 转换为 OpenCode MCP 结构（local/remote）
 */
function convertToOpenCodeMcpSpec(spec = {}) {
  const type = spec.type || 'stdio';

  if (type === 'local' || type === 'remote') {
    return { ...spec };
  }

  if (type === 'stdio') {
    const command = [];
    if (spec.command) command.push(spec.command);
    if (Array.isArray(spec.args)) command.push(...spec.args);

    const result = {
      type: 'local',
      command
    };

    if (spec.env && typeof spec.env === 'object') {
      result.environment = spec.env;
    }
    if (spec.cwd) {
      result.cwd = spec.cwd;
    }
    return result;
  }

  const result = {
    type: 'remote',
    url: spec.url || ''
  };
  if (spec.headers && typeof spec.headers === 'object') {
    result.headers = spec.headers;
  }
  return result;
}

/**
 * 应用模板到项目目录（完整应用，写入实际文件）
 * @param {string} targetDir - 目标项目目录
 * @param {string} templateId - 模板 ID
 * @param {object} options - 可选配置
 * @param {string|string[]} options.aiConfigTypes - 选择的 AI 配置类型数组: ['claude', 'codex', 'gemini', 'opencode', 'pi']
 * @param {string} options.aiConfigType - (兼容旧版) 单个 AI 配置类型
 */
function applyTemplateToProject(targetDir, templateId, options = {}) {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error('模板不存在');
  }

  ensureDir(targetDir);

  const results = {
    aiConfigs: [],
    skills: { applied: template.skills?.length || 0, items: template.skills?.map(s => s.directory || s.name) || [] },
    agents: { applied: 0, files: [] },
    commands: { applied: 0, files: [] },
    plugins: { applied: 0, items: [] },
    mcpServers: { applied: 0 },
    skipped: []
  };

  const aiConfigTypes = normalizeRequestedAiConfigTypes(options, template, results.skipped);

  for (const aiConfigType of aiConfigTypes) {
    const aiConfig = resolveAiConfig(template, aiConfigType);
    const configInfo = AI_CONFIG_MAP[aiConfigType];
    if (!configInfo?.fileName) {
      pushSkipped(results.skipped, 'aiConfig', configInfo?.name || aiConfigType, 'OMP 项目级命令模板通过 .omp/commands 写入，未生成单独 AI 配置文件');
    } else if (aiConfig?.enabled && aiConfig?.content) {
      const configPath = path.join(targetDir, configInfo.fileName);
      ensureDir(path.dirname(configPath));
      fs.writeFileSync(configPath, aiConfig.content, 'utf-8');
      results.aiConfigs.push({ applied: true, path: configInfo.fileName, type: configInfo.name, key: aiConfigType });
    } else {
      const fileName = AI_CONFIG_MAP[aiConfigType]?.fileName || aiConfigType;
      pushSkipped(results.skipped, 'aiConfig', fileName, `模板未启用 ${fileName}，已跳过`);
    }
  }

  if (template.agents?.length > 0) {
    const agentTargets = [];
    if (aiConfigTypes.includes('claude')) {
      agentTargets.push({ baseDir: path.join(targetDir, '.claude', 'agents'), prefix: '.claude/agents' });
    }
    if (aiConfigTypes.includes('opencode')) {
      agentTargets.push({ baseDir: path.join(targetDir, '.opencode', 'agents'), prefix: '.opencode/agents' });
    }
    if (aiConfigTypes.includes('gemini')) {
      agentTargets.push({ baseDir: path.join(targetDir, '.gemini', 'agents'), prefix: '.gemini/agents' });
    }

    for (const target of agentTargets) {
      ensureDir(target.baseDir);
    }

    for (const agent of template.agents) {
      const fileName = resolveItemName(agent.fileName, agent.name, 'agent').toLowerCase().replace(/\s+/g, '-');
      const content = generateAgentContent(agent);
      let written = false;
      for (const target of agentTargets) {
        const filePath = path.join(target.baseDir, `${fileName}.md`);
        fs.writeFileSync(filePath, content, 'utf-8');
        results.agents.files.push(`${target.prefix}/${fileName}.md`);
        written = true;
      }
      if (aiConfigTypes.includes('codex')) {
        pushSkipped(results.skipped, 'agent', fileName, 'Codex agents 仅支持用户级配置，项目目录应用时已跳过');
      }
      if (aiConfigTypes.includes('pi')) {
        pushSkipped(results.skipped, 'agent', fileName, 'OMP agents 需通过扩展或包提供，项目目录应用时已跳过');
      }
      if (written) {
        results.agents.applied++;
      }
    }
  }

  if (template.commands?.length > 0) {
    const commandTargets = [];
    if (aiConfigTypes.includes('claude')) {
      commandTargets.push({ baseDir: path.join(targetDir, '.claude', 'commands'), prefix: '.claude/commands', format: 'claude' });
    }
    if (aiConfigTypes.includes('codex')) {
      commandTargets.push({ baseDir: path.join(targetDir, '.codex', 'prompts'), prefix: '.codex/prompts', format: 'codex' });
    }
    if (aiConfigTypes.includes('opencode')) {
      commandTargets.push({ baseDir: path.join(targetDir, '.opencode', 'commands'), prefix: '.opencode/commands', format: 'claude' });
    }
    if (aiConfigTypes.includes('gemini')) {
      commandTargets.push({ baseDir: path.join(targetDir, '.gemini', 'commands'), prefix: '.gemini/commands', format: 'gemini' });
    }
    if (aiConfigTypes.includes('pi')) {
      commandTargets.push({ baseDir: path.join(targetDir, '.omp', 'commands'), prefix: '.omp/commands', format: 'pi' });
    }

    for (const target of commandTargets) {
      ensureDir(target.baseDir);
    }

    for (const command of template.commands) {
      const commandName = resolveItemName(command.name, null, 'command');
      let written = false;
      for (const target of commandTargets) {
        let content = generateCommandContent(command);
        if (target.format === 'codex') {
          content = convertCommandToCodex(content).content;
        } else if (target.format === 'gemini') {
          content = convertCommandToGemini(content).content;
        }
        const targetCmdDir = command.namespace
          ? path.join(target.baseDir, command.namespace)
          : target.baseDir;
        ensureDir(targetCmdDir);
        const filePath = path.join(targetCmdDir, buildTemplateCommandFileName(commandName, target.format));
        fs.writeFileSync(filePath, content, 'utf-8');
        const relativePath = command.namespace
          ? `${target.prefix}/${command.namespace}/${buildTemplateCommandFileName(commandName, target.format)}`
          : `${target.prefix}/${buildTemplateCommandFileName(commandName, target.format)}`;
        results.commands.files.push(relativePath);
        written = true;
      }
      if (written) {
        results.commands.applied++;
      }
    }
  }

  if (template.plugins?.length > 0) {
    results.plugins.items = template.plugins.map(p => p.name);
    if (aiConfigTypes.includes('opencode') || aiConfigTypes.includes('pi')) {
      results.plugins.applied = template.plugins.length;
    } else {
      for (const plugin of template.plugins) {
        pushSkipped(results.skipped, 'plugin', plugin.name, '当前未选择 OpenCode，已跳过插件写入');
      }
    }
  }

  const hasMcp = template.mcpServers?.length > 0;
  const writesGenericMcpConfig = hasMcp && aiConfigTypes.some(type => type !== 'pi');
  const hasPluginsForOpenCode = aiConfigTypes.includes('opencode') && template.plugins?.length > 0;
  const hasPluginsForPi = aiConfigTypes.includes('pi') && template.plugins?.length > 0;
  if (hasMcp || hasPluginsForOpenCode || hasPluginsForPi) {
    const mcpConfig = { mcpServers: {} };
    const opencodeConfig = { mcp: {}, plugin: [] };
    const allServers = mcpService.getAllServers();
    const presets = mcpService.getPresets();

    for (const serverId of template.mcpServers || []) {
      // 先从已配置的服务器中查找
      let serverSpec = allServers[serverId]?.server;
      // 如果没有，从预设中查找
      if (!serverSpec) {
        const preset = presets.find(p => p.id === serverId);
        if (preset) {
          serverSpec = preset.server;
        }
      }
      if (serverSpec) {
        if (writesGenericMcpConfig) {
          mcpConfig.mcpServers[serverId] = serverSpec;
        }
        opencodeConfig.mcp[serverId] = convertToOpenCodeMcpSpec(serverSpec);
        if (writesGenericMcpConfig) {
          results.mcpServers.applied++;
        } else if (aiConfigTypes.includes('pi')) {
          pushSkipped(results.skipped, 'mcpServer', serverId, 'OMP MCP 由 packages/extensions 提供，未写入项目 MCP 配置');
        }
      } else {
        pushSkipped(results.skipped, 'mcpServer', serverId, '未找到对应 MCP 服务配置，已跳过');
      }
    }

    if (writesGenericMcpConfig && Object.keys(mcpConfig.mcpServers).length > 0) {
      const mcpPath = path.join(targetDir, '.mcp.json');
      writeJsonFile(mcpPath, mcpConfig);
    }

    if (hasPluginsForOpenCode) {
      opencodeConfig.plugin = (template.plugins || []).map(p => p.name).filter(Boolean);
    }
    if (aiConfigTypes.includes('opencode') && (Object.keys(opencodeConfig.mcp).length > 0 || opencodeConfig.plugin.length > 0)) {
      const opencodeDir = path.join(targetDir, '.opencode');
      ensureDir(opencodeDir);
      const opencodePath = path.join(opencodeDir, 'opencode.json');
      writeJsonFile(opencodePath, opencodeConfig);
    }

    if (hasPluginsForPi) {
      mergePiProjectPackages(targetDir, template.plugins || []);
    }
  }

  const configRecord = {
    templateId: template.id,
    templateName: template.name,
    appliedAt: new Date().toISOString(),
    aiConfigTypes: aiConfigTypes,
    aiConfigPaths: results.aiConfigs.map(c => c.path),
    skills: template.skills?.map(s => s.directory || s.name) || [],
    agents: template.agents?.map(a => a.fileName || a.name) || [],
    commands: template.commands?.map(c => c.name) || [],
    plugins: template.plugins?.map(p => p.name) || [],
    mcpServers: template.mcpServers || [],
    skipped: results.skipped
  };
  const recordPath = path.join(targetDir, '.ctx-config.json');
  fs.writeFileSync(recordPath, JSON.stringify(configRecord, null, 2), 'utf-8');

  return {
    success: true,
    results,
    template: template.name
  };
}

/**
 * 预览模板应用效果
 * @param {string} targetDir - 目标项目目录
 * @param {string} templateId - 模板 ID
 * @param {object} options - 可选配置
 * @param {string|string[]} options.aiConfigTypes - 选择的 AI 配置类型数组: ['claude', 'codex', 'gemini', 'opencode', 'pi']
 * @param {string} options.aiConfigType - (兼容旧版) 单个 AI 配置类型
 */
function previewTemplateApplication(targetDir, templateId, options = {}) {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error('模板不存在');
  }

  const preview = {
    willCreate: [],
    willOverwrite: [],
    skipped: [],
    summary: {
      aiConfigs: [],
      skills: 0,
      agents: 0,
      commands: 0,
      plugins: 0,
      mcpServers: 0,
      skipped: 0
    }
  };

  const aiConfigTypes = normalizeRequestedAiConfigTypes(options, template, preview.skipped);

  for (const aiConfigType of aiConfigTypes) {
    const aiConfig = resolveAiConfig(template, aiConfigType);
    const configInfo = AI_CONFIG_MAP[aiConfigType];
    if (!configInfo?.fileName) {
      pushSkipped(preview.skipped, 'aiConfig', configInfo?.name || aiConfigType, 'OMP 项目级命令模板通过 .omp/commands 写入，预览不生成单独 AI 配置文件');
    } else if (aiConfig?.enabled && aiConfig?.content) {
      const configPath = path.join(targetDir, configInfo.fileName);
      if (fs.existsSync(configPath)) {
        preview.willOverwrite.push(configInfo.fileName);
      } else {
        preview.willCreate.push(configInfo.fileName);
      }
      preview.summary.aiConfigs.push({ type: aiConfigType, fileName: configInfo.fileName, name: configInfo.name });
    } else {
      const fileName = AI_CONFIG_MAP[aiConfigType]?.fileName || aiConfigType;
      pushSkipped(preview.skipped, 'aiConfig', fileName, `模板未启用 ${fileName}，已跳过`);
    }
  }

  // Skills 摘要
  if (template.skills?.length > 0) {
    preview.summary.skills = template.skills.length;
  }

  if (template.agents?.length > 0) {
    const agentPrefixes = [];
    if (aiConfigTypes.includes('claude')) agentPrefixes.push('.claude/agents');
    if (aiConfigTypes.includes('opencode')) agentPrefixes.push('.opencode/agents');
    if (aiConfigTypes.includes('gemini')) agentPrefixes.push('.gemini/agents');

    for (const agent of template.agents) {
      const fileName = resolveItemName(agent.fileName, agent.name, 'agent').toLowerCase().replace(/\s+/g, '-');
      let applicable = false;
      for (const prefix of agentPrefixes) {
        const relativePath = `${prefix}/${fileName}.md`;
        const fullPath = path.join(targetDir, relativePath);
        if (fs.existsSync(fullPath)) {
          preview.willOverwrite.push(relativePath);
        } else {
          preview.willCreate.push(relativePath);
        }
        applicable = true;
      }
      if (aiConfigTypes.includes('codex')) {
        pushSkipped(preview.skipped, 'agent', fileName, 'Codex agents 仅支持用户级配置，项目目录预览时已跳过');
      }
      if (aiConfigTypes.includes('pi')) {
        pushSkipped(preview.skipped, 'agent', fileName, 'OMP agents 需通过扩展或包提供，项目目录预览时已跳过');
      }
      if (applicable) {
        preview.summary.agents++;
      }
    }
  }

  if (template.commands?.length > 0) {
    const commandPrefixes = [];
    if (aiConfigTypes.includes('claude')) commandPrefixes.push('.claude/commands');
    if (aiConfigTypes.includes('codex')) commandPrefixes.push('.codex/prompts');
    if (aiConfigTypes.includes('opencode')) commandPrefixes.push('.opencode/commands');
    if (aiConfigTypes.includes('gemini')) commandPrefixes.push('.gemini/commands');
    if (aiConfigTypes.includes('pi')) commandPrefixes.push('.omp/commands');

    for (const command of template.commands) {
      const commandName = resolveItemName(command.name, null, 'command');
      let applicable = false;
      for (const prefix of commandPrefixes) {
        const extension = getCommandPreviewExtension(prefix);
        const relativePath = command.namespace
          ? `${prefix}/${command.namespace}/${commandName}.${extension}`
          : `${prefix}/${commandName}.${extension}`;
        const fullPath = path.join(targetDir, relativePath);
        if (fs.existsSync(fullPath)) {
          preview.willOverwrite.push(relativePath);
        } else {
          preview.willCreate.push(relativePath);
        }
        applicable = true;
      }
      if (applicable) {
        preview.summary.commands++;
      }
    }
  }

  const writesGenericMcpConfig = template.mcpServers?.length > 0 && aiConfigTypes.some(type => type !== 'pi');
  const allServers = mcpService.getAllServers();
  const presets = mcpService.getPresets();
  let resolvableMcpCount = 0;
  for (const serverId of template.mcpServers || []) {
    let serverSpec = allServers[serverId]?.server;
    if (!serverSpec) {
      const preset = presets.find(p => p.id === serverId);
      if (preset) {
        serverSpec = preset.server;
      }
    }
    if (serverSpec) {
      if (writesGenericMcpConfig) {
        resolvableMcpCount++;
      } else if (aiConfigTypes.includes('pi')) {
        pushSkipped(preview.skipped, 'mcpServer', serverId, 'OMP MCP 由 packages/extensions 提供，预览不写入项目 MCP 配置');
      }
    } else {
      pushSkipped(preview.skipped, 'mcpServer', serverId, '未找到对应 MCP 服务配置，预览已跳过');
    }
  }

  if (resolvableMcpCount > 0) {
    const mcpPath = path.join(targetDir, '.mcp.json');
    if (fs.existsSync(mcpPath)) {
      preview.willOverwrite.push('.mcp.json');
    } else {
      preview.willCreate.push('.mcp.json');
    }
    preview.summary.mcpServers = resolvableMcpCount;
  }

  if (aiConfigTypes.includes('opencode') && (resolvableMcpCount > 0 || template.plugins?.length > 0)) {
    const opencodeConfigPath = path.join(targetDir, '.opencode/opencode.json');
    if (fs.existsSync(opencodeConfigPath)) {
      preview.willOverwrite.push('.opencode/opencode.json');
    } else {
      preview.willCreate.push('.opencode/opencode.json');
    }
  }

  if (template.plugins?.length > 0) {
    if (aiConfigTypes.includes('opencode') || aiConfigTypes.includes('pi')) {
      preview.summary.plugins = template.plugins.length;
      if (aiConfigTypes.includes('pi')) {
        const piSettingsPath = path.join(targetDir, '.omp/config.yml');
        if (fs.existsSync(piSettingsPath)) {
          preview.willOverwrite.push('.omp/config.yml');
        } else {
          preview.willCreate.push('.omp/config.yml');
        }
      }
    } else {
      for (const plugin of template.plugins) {
        pushSkipped(preview.skipped, 'plugin', plugin.name, '当前未选择 OpenCode，已跳过插件写入预览');
      }
    }
  }

  preview.willCreate = [...new Set(preview.willCreate)];
  preview.willOverwrite = [...new Set(preview.willOverwrite)];
  preview.summary.skipped = preview.skipped.length;

  return preview;
}

module.exports = {
  getAllTemplates,
  getTemplateById,
  createCustomTemplate,
  updateCustomTemplate,
  deleteCustomTemplate,
  applyTemplate,
  readCurrentConfig,
  getAvailableConfigs,
  applyTemplateToProject,
  previewTemplateApplication
};
