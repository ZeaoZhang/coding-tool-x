/**
 * 配置模板服务
 *
 * 管理工作区/项目的配置模板组合
 * 支持 CLAUDE.md, skills, commands, agents, MCP 等的预设组合
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const yaml = require('js-yaml');
const { PATHS } = require('../../config/paths');
const { getPlatformContext } = require('../platform-context');
const TEMPLATES_FILE = path.join(PATHS.config, 'config-templates.json');
const { AgentsService } = require('../../platforms/agents-service');
const { CommandsService } = require('../../platforms/commands-service');
const { SkillService } = require('./skill-service');
const { PluginsService } = require('./plugins-service');
const { convertCommandToCodex, convertCommandToGemini } = require('./format-converter');
const { assertNoSymlinkComponents, resolveProjectTarget } = require('../../shared/project-config');
const mcpService = require('./mcp-service');
const promptsService = require('./prompts-service');
const pluginsService = new PluginsService();

function getAiConfigMap(registry = getPlatformContext().registry) {
  if (!registry || typeof registry.list !== 'function') return {};
  return Object.fromEntries(
    registry.list({ enabledOnly: true })
      .filter(platform => platform && platform.key)
      .map(platform => [platform.key, {
        fileName: platform.promptFile || null,
        name: platform.promptLabel
          || (platform.promptFile
            ? (platform.label || platform.title || platform.key)
            : `${platform.label || platform.title || platform.key} command templates`)
      }])
  );
}

// Configuration file destinations are declared by platform manifests.
const AI_CONFIG_MAP = getAiConfigMap();
const CLI_DEFAULT_AI_TYPE = Object.fromEntries(Object.keys(AI_CONFIG_MAP).map(key => [key, key]));

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
    omp: { enabled: false, content: '' }
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

const projectConfigServiceCache = new Map();

function getProjectConfigService() {
  if (!projectConfigServiceCache.has('default')) {
    const { ProjectConfigService } = require('./project-config-service');
    projectConfigServiceCache.set('default', new ProjectConfigService());
  }
  return projectConfigServiceCache.get('default');
}

/**
 * 应用模板到指定目录
 * @param {string} targetDir - 目标目录
 * @param {string} templateId - 模板 ID
 */
async function applyTemplate(targetDir, templateId) {
  const result = await applyTemplateToProject(targetDir, templateId);
  return {
    success: result.success,
    results: {
      claudeMd: result.results.aiConfigs.some(config => config.key === 'claude'),
      skills: result.results.skills.applied,
      commands: result.results.commands.applied,
      agents: result.results.agents.applied,
      plugins: result.results.plugins.applied,
      mcpServers: result.results.mcpServers.applied
    },
    template: result.template
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
  const commandPlatforms = ['claude', 'codex', 'gemini', 'opencode', 'omp'];
  const agentMap = new Map();
  const commandMap = new Map();
  const agentsByPlatform = {};
  const commandsByPlatform = {};

  for (const platform of agentPlatforms) {
    let service;
    try {
      service = new AgentsService(platform);
      const { agents } = service.listAgents();
      for (const agent of agents || []) {
        if (agent.scope !== 'user') continue;
        const detail = typeof service.getAgent === 'function' ? (service.getAgent(agent.fileName, 'user') || agent) : agent;
        const normalizedAgent = { fileName: agent.fileName, name: agent.name, description: agent.description, tools: agent.tools, model: agent.model, permissionMode: agent.permissionMode, skills: agent.skills, systemPrompt: detail.systemPrompt };
        agentsByPlatform[platform] = agentsByPlatform[platform] || [];
        agentsByPlatform[platform].push(normalizedAgent);
        const key = `${agent.fileName || agent.name}|${agent.model || ''}|${agent.description || ''}`;
        if (!agentMap.has(key)) agentMap.set(key, normalizedAgent);
      }
    } finally {
      service?.dispose?.();
    }
  }

  for (const platform of commandPlatforms) {
    let service;
    try {
      service = new CommandsService(platform);
      const { commands } = service.listCommands();
      for (const command of commands || []) {
        if (command.scope !== 'user') continue;
        const detail = typeof service.getCommand === 'function' ? (service.getCommand(command.name, 'user', null, command.namespace) || command) : command;
        const normalizedCommand = { name: command.name, namespace: command.namespace, description: command.description, allowedTools: command.allowedTools, argumentHint: command.argumentHint, body: detail.body };
        commandsByPlatform[platform] = commandsByPlatform[platform] || [];
        commandsByPlatform[platform].push(normalizedCommand);
        const key = command.namespace ? `${command.namespace}/${command.name}` : command.name;
        if (!commandMap.has(key)) commandMap.set(key, normalizedCommand);
      }
    } finally {
      service?.dispose?.();
    }
  }
  // 按平台分别获取 skills（每个平台有独立的安装目录）
  const skillsByPlatform = {};
  for (const platform of ['claude', 'codex', 'gemini', 'opencode', 'omp']) {
    const service = new SkillService(platform);
    skillsByPlatform[platform] = service.getInstalledSkills().map(skill => {
      const normalized = {
        directory: skill.directory,
        name: skill.name || skill.directory,
        description: skill.description || '',
        repoOwner: skill.repoOwner || null,
        repoName: skill.repoName || null,
        repoBranch: skill.repoBranch || null
      };
      for (const key of ['fullDirectory', 'repoProvider', 'repoHost', 'repoId', 'repoDirectory', 'repoProjectPath', 'repoLocalPath', 'repoUrl']) {
        if (skill[key] !== undefined && skill[key] !== null && skill[key] !== '') {
          normalized[key] = skill[key];
        }
      }
      return normalized;
    });
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

function writeAtomicFile(filePath, content, rootDir = null) {
  if (rootDir) {
    assertNoSymlinkComponents(path.resolve(rootDir), path.dirname(filePath), fs);
  }
  ensureDir(path.dirname(filePath));
  if (rootDir) {
    assertNoSymlinkComponents(path.resolve(rootDir), path.dirname(filePath), fs);
  }
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  let fileDescriptor;
  try {
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
    fileDescriptor = fs.openSync(tempPath, flags, 0o600);
    if (rootDir) {
      const tempRealPath = fs.realpathSync(tempPath);
      const rootRealPath = fs.realpathSync(path.resolve(rootDir));
      const relative = path.relative(rootRealPath, tempRealPath);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Template atomic write escaped project root');
      }
    }
    fs.writeFileSync(fileDescriptor, content, 'utf-8');
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    if (rootDir) {
      assertNoSymlinkComponents(path.resolve(rootDir), path.dirname(filePath), fs);
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (fileDescriptor !== undefined) {
      try {
        fs.closeSync(fileDescriptor);
      } catch (_) {}
    }
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {}
    throw error;
  }
}

function writeJsonFile(filePath, data, rootDir = null) {
  writeAtomicFile(filePath, JSON.stringify(data, null, 2), rootDir);
}

function writeYamlFile(filePath, data, rootDir = null) {
  writeAtomicFile(filePath, yaml.dump(data || {}, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false
  }), rootDir);
}

function mergeOmpProjectPackages(targetDir, plugins = []) {
  const packages = plugins.map(plugin => plugin.name).filter(Boolean);
  if (packages.length === 0) {
    return false;
  }

  const settingsPath = resolveProjectTarget(targetDir, '.omp/config.yml', 'template OMP config');
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    let parsed;
    try {
      parsed = yaml.load(fs.readFileSync(settingsPath, 'utf-8'));
    } catch (error) {
      throw new Error(`无法解析 OMP 项目配置: ${error.message}`);
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      settings = parsed;
    } else {
      throw new Error('无法解析 OMP 项目配置: 配置必须是对象');
    }
  }

  const existingPackages = Array.isArray(settings.packages) ? settings.packages : [];
  settings.packages = Array.from(new Set([...existingPackages, ...packages]));
  writeYamlFile(settingsPath, settings, targetDir);
  return true;
}


/**
 * 应用模板到项目目录（完整应用，写入实际文件）
 * @param {string} targetDir - 目标项目目录
 * @param {string} templateId - 模板 ID
 * @param {object} options - 可选配置
 * @param {string|string[]} options.aiConfigTypes - 选择的 AI 配置类型数组: ['claude', 'codex', 'gemini', 'opencode', 'omp']
 * @param {string} options.aiConfigType - (兼容旧版) 单个 AI 配置类型
 */
async function applyTemplateToProject(targetDir, templateId, options = {}) {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error('模板不存在');
  }

  const projectConfigService = getProjectConfigService();
  const results = {
    aiConfigs: [],
    skills: { applied: 0, items: [] },
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
      const reason = aiConfigType === 'omp'
        ? 'OMP 项目级命令模板通过 .omp/commands 写入，未生成单独 AI 配置文件'
        : `平台 ${configInfo?.name || aiConfigType} 未声明项目级配置文件，已跳过`;
      pushSkipped(results.skipped, 'aiConfig', configInfo?.name || aiConfigType, reason);
    } else if (aiConfig?.enabled && aiConfig?.content) {
      try {
        const written = await projectConfigService.writeInstruction(targetDir, aiConfigType, aiConfig.content);
        if (written?.supported === false) {
          pushSkipped(results.skipped, 'aiConfig', configInfo.fileName, `平台 ${configInfo.name} 不支持项目级指令文件，已跳过`);
        } else {
          results.aiConfigs.push({
            applied: true,
            path: written?.path || configInfo.fileName,
            type: configInfo.name,
            key: aiConfigType
          });
        }
      } catch (error) {
        pushSkipped(results.skipped, 'aiConfig', configInfo.fileName, `写入项目级指令失败: ${error.message}`);
      }
    } else {
      const fileName = AI_CONFIG_MAP[aiConfigType]?.fileName || aiConfigType;
      pushSkipped(results.skipped, 'aiConfig', fileName, `模板未启用 ${fileName}，已跳过`);
    }
  }

  for (const skill of template.skills || []) {
    const skillPlatform = skill?.platform || template.cliType || aiConfigTypes[0];
    const skillName = typeof skill === 'string' ? skill : (skill?.directory || skill?.name);
    if (!skillName) continue;
    if (!skillPlatform || !aiConfigTypes.includes(skillPlatform)) {
      pushSkipped(results.skipped, 'skill', skillName, `未选择 ${skillPlatform || '目标平台'}，已跳过`);
      continue;
    }

    const skillInput = typeof skill === 'string'
      ? { directory: skill, name: skill }
      : {
        directory: skill.directory || skill.name,
        name: skill.name || skill.directory,
        ...(skill.fullDirectory ? { fullDirectory: skill.fullDirectory } : {}),
        ...(Array.isArray(skill.files) ? { files: skill.files } : {}),
        ...(skill.repo
          ? { repo: skill.repo }
          : ((skill.repoProvider || skill.repoId || skill.repoLocalPath || skill.repoProjectPath)
            ? {
              repo: {
                provider: skill.repoProvider,
                owner: skill.repoOwner || null,
                name: skill.repoName || null,
                branch: skill.repoBranch || null,
                directory: skill.repoDirectory || '',
                host: skill.repoHost || null,
                projectPath: skill.repoProjectPath || null,
                localPath: skill.repoLocalPath || null,
                id: skill.repoId || null,
                repoUrl: skill.repoUrl || null
              }
            }
            : {}))
      };

    try {
      const skillService = new SkillService(skillPlatform);
      const registration = skillService.registerTemplateSkill({
        ...skillInput,
        scope: 'project',
        cwd: targetDir
      });
      if (registration?.status === 'pending_refresh') {
        results.skills.pending = (results.skills.pending || 0) + 1;
        results.skills.pendingItems = [...(results.skills.pendingItems || []), skillName];
      } else if (registration?.status === 'failed') {
        pushSkipped(results.skipped, 'skill', skillName, '项目级 Skill 注册失败，已跳过');
      } else {
        results.skills.applied++;
      }
      results.skills.items.push(skillName);
    } catch (error) {
      pushSkipped(results.skipped, 'skill', skillName, `注册项目级 Skill 失败: ${error.message}`);
    }
  }

  if (template.agents?.length > 0) {
    const agentTargets = [];
    if (aiConfigTypes.includes('claude')) {
      agentTargets.push({ prefix: '.claude/agents' });
    }
    if (aiConfigTypes.includes('opencode')) {
      agentTargets.push({ prefix: '.opencode/agents' });
    }
    if (aiConfigTypes.includes('gemini')) {
      agentTargets.push({ prefix: '.gemini/agents' });
    }

    for (const agent of template.agents) {
      const fileName = resolveItemName(agent.fileName, agent.name, 'agent').toLowerCase().replace(/\s+/g, '-');
      const content = generateAgentContent(agent);
      let written = false;
      for (const target of agentTargets) {
        const relativePath = `${target.prefix}/${fileName}.md`;
        const filePath = resolveProjectTarget(targetDir, relativePath, 'template agent file');
        writeAtomicFile(filePath, content, targetDir);
        results.agents.files.push(relativePath);
        written = true;
      }
      if (aiConfigTypes.includes('codex')) {
        pushSkipped(results.skipped, 'agent', fileName, 'Codex agents 仅支持用户级配置，项目目录应用时已跳过');
      }
      if (aiConfigTypes.includes('omp')) {
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
      commandTargets.push({ prefix: '.claude/commands', format: 'claude' });
    }
    if (aiConfigTypes.includes('codex')) {
      commandTargets.push({ prefix: '.codex/prompts', format: 'codex' });
    }
    if (aiConfigTypes.includes('opencode')) {
      commandTargets.push({ prefix: '.opencode/commands', format: 'claude' });
    }
    if (aiConfigTypes.includes('gemini')) {
      commandTargets.push({ prefix: '.gemini/commands', format: 'gemini' });
    }
    if (aiConfigTypes.includes('omp')) {
      commandTargets.push({ prefix: '.omp/commands', format: 'omp' });
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
        const commandFile = buildTemplateCommandFileName(commandName, target.format);
        const relativePath = command.namespace
          ? `${target.prefix}/${command.namespace}/${commandFile}`
          : `${target.prefix}/${commandFile}`;
        const filePath = resolveProjectTarget(targetDir, relativePath, 'template command file');
        writeAtomicFile(filePath, content, targetDir);
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
    if (aiConfigTypes.includes('opencode') || aiConfigTypes.includes('omp')) {
      results.plugins.applied = template.plugins.length;
    } else {
      for (const plugin of template.plugins) {
        pushSkipped(results.skipped, 'plugin', plugin.name, '当前未选择 OpenCode，已跳过插件写入');
      }
    }
  }

  const hasMcp = template.mcpServers?.length > 0;
  const hasPluginsForOpenCode = aiConfigTypes.includes('opencode') && template.plugins?.length > 0;
  const hasPluginsForOmp = aiConfigTypes.includes('omp') && template.plugins?.length > 0;
  if (hasMcp) {
    const allServers = mcpService.getAllServers();
    const presets = mcpService.getPresets();

    for (const serverId of template.mcpServers || []) {
      let serverSpec = allServers[serverId]?.server;
      if (!serverSpec) {
        const preset = presets.find(p => p.id === serverId);
        if (preset) serverSpec = preset.server;
      }

      if (!serverSpec) {
        pushSkipped(results.skipped, 'mcpServer', serverId, '未找到对应 MCP 服务配置，已跳过');
        continue;
      }

      let applied = false;
      for (const aiConfigType of aiConfigTypes) {
        try {
          const written = await projectConfigService.upsertProjectMcp(
            targetDir,
            aiConfigType,
            serverId,
            serverSpec
          );
          if (written?.success !== false) applied = true;
        } catch (error) {
          pushSkipped(
            results.skipped,
            'mcpServer',
            `${serverId} (${aiConfigType})`,
            `写入项目级 MCP 失败: ${error.message}`
          );
        }
      }
      if (applied) results.mcpServers.applied++;
    }
  }

  if (hasPluginsForOpenCode) {
    const opencodePath = resolveProjectTarget(targetDir, '.opencode/opencode.json', 'template OpenCode config');
    let opencodeConfig = {};
    if (fs.existsSync(opencodePath)) {
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(opencodePath, 'utf-8'));
      } catch (error) {
        throw new Error(`无法解析 OpenCode 项目配置: ${error.message}`);
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        opencodeConfig = parsed;
      } else {
        throw new Error('无法解析 OpenCode 项目配置: 配置必须是对象');
      }
    }
    opencodeConfig.plugin = (template.plugins || []).map(p => p.name).filter(Boolean);
    writeJsonFile(opencodePath, opencodeConfig, targetDir);
  }

  if (hasPluginsForOmp) {
    mergeOmpProjectPackages(targetDir, template.plugins || []);
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
  const recordPath = resolveProjectTarget(targetDir, '.ctx-config.json', 'template provenance file');
  writeAtomicFile(recordPath, JSON.stringify(configRecord, null, 2), targetDir);

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
 * @param {string|string[]} options.aiConfigTypes - 选择的 AI 配置类型数组: ['claude', 'codex', 'gemini', 'opencode', 'omp']
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
      const reason = aiConfigType === 'omp'
        ? 'OMP 项目级命令模板通过 .omp/commands 写入，预览不生成单独 AI 配置文件'
        : `平台 ${configInfo?.name || aiConfigType} 未声明项目级配置文件，预览已跳过`;
      pushSkipped(preview.skipped, 'aiConfig', configInfo?.name || aiConfigType, reason);
    } else if (aiConfig?.enabled && aiConfig?.content) {
      const configPath = resolveProjectTarget(targetDir, configInfo.fileName, 'template instruction file');
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
        const fullPath = resolveProjectTarget(targetDir, relativePath, 'template agent file');
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
      if (aiConfigTypes.includes('omp')) {
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
    if (aiConfigTypes.includes('omp')) commandPrefixes.push('.omp/commands');

    for (const command of template.commands) {
      const commandName = resolveItemName(command.name, null, 'command');
      let applicable = false;
      for (const prefix of commandPrefixes) {
        const extension = getCommandPreviewExtension(prefix);
        const relativePath = command.namespace
          ? `${prefix}/${command.namespace}/${commandName}.${extension}`
          : `${prefix}/${commandName}.${extension}`;
        const fullPath = resolveProjectTarget(targetDir, relativePath, 'template command file');
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

  const writesGenericMcpConfig = template.mcpServers?.length > 0 && aiConfigTypes.some(type => type !== 'omp');
  const writesOmpMcpConfig = template.mcpServers?.length > 0 && aiConfigTypes.includes('omp');
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
      if (writesGenericMcpConfig || writesOmpMcpConfig) {
        resolvableMcpCount++;
      }
    } else {
      pushSkipped(preview.skipped, 'mcpServer', serverId, '未找到对应 MCP 服务配置，预览已跳过');
    }
  }

  if (writesGenericMcpConfig && resolvableMcpCount > 0) {
    const mcpPath = resolveProjectTarget(targetDir, '.mcp.json', 'template MCP file');
    if (fs.existsSync(mcpPath)) {
      preview.willOverwrite.push('.mcp.json');
    } else {
      preview.willCreate.push('.mcp.json');
    }
    preview.summary.mcpServers = resolvableMcpCount;
  }

  if (writesOmpMcpConfig && resolvableMcpCount > 0) {
    const ompMcpPath = resolveProjectTarget(targetDir, '.omp/mcp.json', 'template OMP MCP file');
    if (fs.existsSync(ompMcpPath)) {
      preview.willOverwrite.push('.omp/mcp.json');
    } else {
      preview.willCreate.push('.omp/mcp.json');
    }
    preview.summary.mcpServers = resolvableMcpCount;
  }

  if (aiConfigTypes.includes('opencode') && (resolvableMcpCount > 0 || template.plugins?.length > 0)) {
    const opencodeConfigPath = resolveProjectTarget(targetDir, '.opencode/opencode.json', 'template OpenCode config');
    if (fs.existsSync(opencodeConfigPath)) {
      preview.willOverwrite.push('.opencode/opencode.json');
    } else {
      preview.willCreate.push('.opencode/opencode.json');
    }
  }

  if (template.plugins?.length > 0) {
    if (aiConfigTypes.includes('opencode') || aiConfigTypes.includes('omp')) {
      preview.summary.plugins = template.plugins.length;
      if (aiConfigTypes.includes('omp')) {
        const ompSettingsPath = path.join(targetDir, '.omp/config.yml');
        if (fs.existsSync(ompSettingsPath)) {
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
  previewTemplateApplication,
  getAiConfigMap
};
