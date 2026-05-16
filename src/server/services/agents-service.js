/**
 * Agents 服务
 *
 * 管理 Claude/Codex/Gemini/OpenCode 自定义代理的 CRUD 操作
 * 支持从 GitHub 仓库扫描和安装代理
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;
const { RepoScannerBase } = require('./repo-scanner-base');
const { NATIVE_PATHS } = require('../../config/paths');
const { resolvePreferredHomeDir } = require('../../utils/home-dir');

// 默认仓库源
const DEFAULT_REPOS = [];
const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode'];
const OPENCODE_CONFIG_DIR = NATIVE_PATHS.opencode.config;
const CODEX_CONFIG_PATH = NATIVE_PATHS.codex.config;
const HOME_DIR = resolvePreferredHomeDir(process.platform, process.env, os.homedir());
const CODEX_AGENTS_DIR = path.join(path.dirname(CODEX_CONFIG_PATH), 'agents');
const CLAUDE_AGENTS_DIR = path.join(path.dirname(NATIVE_PATHS.claude.settings), 'agents');
const GEMINI_AGENTS_DIR = path.join(NATIVE_PATHS.gemini.dir, 'agents');
const CODEX_CONFIG_MODES = new Set(['none', 'managed', 'custom']);

const PLATFORM_CONFIG = {
  claude: {
    userAgentsDir: CLAUDE_AGENTS_DIR,
    projectAgentsDir: (projectPath) => path.join(projectPath, '.claude', 'agents'),
    repoType: 'agents'
  },
  opencode: {
    userAgentsDir: path.join(OPENCODE_CONFIG_DIR, 'agents'),
    legacyUserAgentsDir: path.join(OPENCODE_CONFIG_DIR, 'agent'),
    projectAgentsDir: (projectPath) => {
      const modern = path.join(projectPath, '.opencode', 'agents');
      const legacy = path.join(projectPath, '.opencode', 'agent');
      if (fs.existsSync(legacy) && !fs.existsSync(modern)) {
        return legacy;
      }
      return modern;
    },
    repoType: 'opencode-agents'
  },
  codex: {
    userAgentsDir: CODEX_AGENTS_DIR,
    projectAgentsDir: () => null,
    repoType: 'agents'
  },
  gemini: {
    userAgentsDir: GEMINI_AGENTS_DIR,
    projectAgentsDir: (projectPath) => path.join(projectPath, '.gemini', 'agents'),
    repoType: 'gemini-agents'
  }
};

function normalizePlatform(platform) {
  const normalized = typeof platform === 'string' && platform.trim() ? platform.trim() : 'claude';
  if (!SUPPORTED_PLATFORMS.includes(normalized)) {
    throw new Error(`不支持的平台: ${platform}`);
  }
  return normalized;
}

function assertSafeAgentFileName(fileName) {
  if (typeof fileName !== 'string') {
    throw new Error('代理文件名必须是字符串');
  }

  const normalized = fileName.trim();
  if (!normalized) {
    throw new Error('代理文件名不能为空');
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized) || normalized.includes('..')) {
    throw new Error('代理文件名只能包含字母、数字、点号、横杠和下划线，且不能包含连续点');
  }
}

function assertSafeRepoPath(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath.trim()) {
    throw new Error('代理仓库路径不能为空');
  }

  const raw = repoPath.replace(/\\/g, '/').trim();
  const normalized = path.posix.normalize(raw).replace(/^(\.\/)+/, '');
  if (!normalized ||
      normalized === '.' ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.includes('/../') ||
      path.posix.isAbsolute(normalized)) {
    throw new Error('代理仓库路径不合法');
  }

  if (!normalized.endsWith('.md')) {
    throw new Error('代理仓库路径必须是 .md 文件');
  }
}

function assertSafeProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw new Error('projectPath 必须是非空字符串');
  }

  if (projectPath.includes('\0')) {
    throw new Error('projectPath 不合法');
  }

  const normalized = path.resolve(projectPath.trim());
  if (!path.isAbsolute(normalized)) {
    throw new Error('projectPath 必须是绝对路径');
  }

  if (!fs.existsSync(normalized)) {
    throw new Error('projectPath 不存在');
  }

  const stat = fs.statSync(normalized);
  if (!stat.isDirectory()) {
    throw new Error('projectPath 必须是目录');
  }

  return fs.realpathSync(normalized);
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeFileAtomic(filePath, content) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, filePath);
}

function readCodexTomlConfig() {
  if (!fs.existsSync(CODEX_CONFIG_PATH)) {
    return {};
  }

  try {
    const content = fs.readFileSync(CODEX_CONFIG_PATH, 'utf-8');
    return toml.parse(content);
  } catch (err) {
    throw new Error(`读取 Codex config.toml 失败: ${err.message}`);
  }
}

function writeCodexTomlConfig(config) {
  ensureDir(path.dirname(CODEX_CONFIG_PATH));
  writeFileAtomic(CODEX_CONFIG_PATH, tomlStringify(config));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getCodexManagedAgentConfigPath(fileName) {
  return path.join(CODEX_AGENTS_DIR, `${fileName}.toml`);
}

function normalizeCodexConfigPath(configPath) {
  return typeof configPath === 'string' ? configPath.trim() : '';
}

function assertSafeCodexConfigPath(configPath) {
  const normalized = normalizeCodexConfigPath(configPath);
  if (!normalized) {
    throw new Error('Codex 自定义 config_file 不能为空');
  }

  if (normalized.includes('\0')) {
    throw new Error('Codex 自定义 config_file 不合法');
  }

  if (normalized.startsWith('~/')) {
    const relative = path.posix.normalize(normalized.slice(2).replace(/\\/g, '/'));
    if (!relative ||
        relative === '.' ||
        relative === '..' ||
        relative.startsWith('../') ||
        relative.includes('/../')) {
      throw new Error('Codex 自定义 config_file 不合法');
    }
    return `~/${relative}`;
  }

  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  const relative = path.posix.normalize(normalized.replace(/\\/g, '/')).replace(/^(\.\/)+/, '');
  if (!relative ||
      relative === '.' ||
      relative === '..' ||
      relative.startsWith('../') ||
      relative.includes('/../') ||
      path.posix.isAbsolute(relative)) {
    throw new Error('Codex 自定义 config_file 不合法');
  }

  return relative;
}

function resolveCodexConfigPath(configPath) {
  const normalized = normalizeCodexConfigPath(configPath);
  if (!normalized) return '';

  if (normalized.startsWith('~/')) {
    return path.join(HOME_DIR, normalized.slice(2));
  }

  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  return path.resolve(path.dirname(CODEX_CONFIG_PATH), normalized);
}

function isManagedCodexConfigPath(configPath) {
  const resolved = resolveCodexConfigPath(configPath);
  if (!resolved) return false;
  const managedRoot = path.resolve(CODEX_AGENTS_DIR) + path.sep;
  return resolved.startsWith(managedRoot) || resolved === path.resolve(CODEX_AGENTS_DIR);
}

function getManagedCodexConfigResolvedPath(configPath) {
  const normalized = normalizeCodexConfigPath(configPath);
  if (!normalized || !isManagedCodexConfigPath(normalized)) {
    return '';
  }
  return resolveCodexConfigPath(normalized);
}

function normalizeCodexConfigMode(mode) {
  const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  if (!normalized) {
    return '';
  }
  if (!CODEX_CONFIG_MODES.has(normalized)) {
    throw new Error(`不支持的 Codex configMode: ${mode}`);
  }
  return normalized;
}

function inferCodexConfigMode(configFile) {
  const normalized = normalizeCodexConfigPath(configFile);
  if (!normalized) return 'none';
  return isManagedCodexConfigPath(normalized) ? 'managed' : 'custom';
}

function resolveCodexConfigContent({ configContent, model, fallbackContent = '' }) {
  if (typeof configContent === 'string') {
    return configContent;
  }
  const trimmedModel = typeof model === 'string' ? model.trim() : '';
  if (trimmedModel) {
    return tomlStringify({ model: trimmedModel });
  }
  return typeof fallbackContent === 'string' ? fallbackContent : '';
}

function readCodexAgentConfigFile(configFilePath) {
  if (!configFilePath) {
    return {
      content: '',
      data: null,
      updatedAt: null,
      error: null
    };
  }

  if (!fs.existsSync(configFilePath)) {
    return {
      content: '',
      data: null,
      updatedAt: null,
      error: `配置文件不存在: ${configFilePath}`
    };
  }

  try {
    const content = fs.readFileSync(configFilePath, 'utf-8');
    const updatedAt = fs.statSync(configFilePath).mtime.getTime();
    try {
      const data = toml.parse(content);
      return {
        content,
        data,
        updatedAt,
        error: null
      };
    } catch (parseErr) {
      return {
        content,
        data: null,
        updatedAt,
        error: `配置文件 TOML 解析失败: ${parseErr.message}`
      };
    }
  } catch (err) {
    return {
      content: '',
      data: null,
      updatedAt: null,
      error: `读取配置文件失败: ${err.message}`
    };
  }
}

/**
 * 解析 YAML frontmatter
 */
function parseFrontmatter(content) {
  const result = {
    frontmatter: {},
    body: content
  };

  // 移除 BOM
  content = content.trim().replace(/^\uFEFF/, '');

  // 解析 YAML frontmatter
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    return result;
  }

  const frontmatterText = match[1];
  result.body = match[2].trim();

  // 简单解析 YAML（支持基本字段）
  const lines = frontmatterText.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // 去除引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result.frontmatter[key] = value;
  }

  return result;
}

/**
 * 生成 frontmatter 字符串
 */
function generateFrontmatter(data, platform = 'claude') {
  const lines = ['---'];

  // Claude 下写入 name，OpenCode 以文件名作为 agent id
  if (platform !== 'opencode' && data.name) {
    lines.push(`name: ${data.name}`);
  }
  if (data.description) {
    lines.push(`description: "${data.description}"`);
  }

  // 可选字段
  if (data.tools) {
    lines.push(`tools: ${data.tools}`);
  }
  if (data.model) {
    lines.push(`model: ${data.model}`);
  }
  if (data.permissionMode) {
    lines.push(`permissionMode: ${data.permissionMode}`);
  }
  if (data.skills) {
    lines.push(`skills: ${data.skills}`);
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * 扫描目录获取代理文件（agents 约定为扁平目录）
 */
function scanAgentsDir(dir, basePath, scope) {
  const agents = [];

  if (!fs.existsSync(dir)) {
    return agents;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isFile() && entry.name.endsWith('.md')) {
        // 解析代理文件
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(content);

          // 计算相对路径
          const relativePath = path.relative(basePath, fullPath);
          const fileName = entry.name.replace(/\.md$/, '');

          agents.push({
            name: frontmatter.name || fileName,
            fileName,
            scope,
            path: relativePath,
            fullPath,
            description: frontmatter.description || '',
            tools: frontmatter.tools || '',
            model: frontmatter.model || '',
            permissionMode: frontmatter.permissionMode || '',
            skills: frontmatter.skills || '',
            systemPrompt: body,
            fullContent: content,
            updatedAt: fs.statSync(fullPath).mtime.getTime()
          });
        } catch (err) {
          console.warn(`[AgentsService] Failed to parse ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error(`[AgentsService] Failed to scan ${dir}:`, err.message);
  }

  return agents;
}

/**
 * Agents 仓库扫描器
 */
class AgentsRepoScanner extends RepoScannerBase {
  constructor(platform, installDir) {
    super({
      type: PLATFORM_CONFIG[platform]?.repoType || 'agents',
      installDir,
      markerFile: null, // 直接扫描 .md 文件
      fileExtension: '.md',
      defaultRepos: DEFAULT_REPOS
    });
  }

  /**
   * 获取并解析单个代理文件
   */
  async fetchAndParseItem(file, repo, baseDir) {
    try {
      // 计算相对路径
      const relativePath = baseDir ? file.path.slice(baseDir.length + 1) : file.path;
      const fileName = path.basename(file.path, '.md');

      // 获取文件内容
      const content = await this.fetchRawContent(repo, file.path);
      const { frontmatter, body } = this.parseFrontmatter(content);

      return {
        key: `${repo.owner}/${repo.name}:${relativePath}`,
        name: frontmatter.name || fileName,
        fileName,
        scope: 'remote',
        path: relativePath,
        repoPath: file.path,
        description: frontmatter.description || '',
        tools: frontmatter.tools || '',
        model: frontmatter.model || '',
        permissionMode: frontmatter.permissionMode || '',
        skills: frontmatter.skills || '',
        systemPrompt: body,
        fullContent: content,
        installed: this.isInstalled(fileName),
        readmeUrl: `https://github.com/${repo.owner}/${repo.name}/blob/${repo.branch}/${file.path}`,
        repoOwner: repo.owner,
        repoName: repo.name,
        repoBranch: repo.branch,
        repoDirectory: repo.directory || ''
      };
    } catch (err) {
      console.warn(`[AgentsRepoScanner] Parse agent ${file.path} error:`, err.message);
      return null;
    }
  }

  /**
   * 检查代理是否已安装
   */
  isInstalled(fileName) {
    const fullPath = path.join(this.installDir, `${fileName}.md`);
    return fs.existsSync(fullPath);
  }

  /**
   * 获取去重 key
   */
  getDedupeKey(item) {
    return item.fileName.toLowerCase();
  }

  /**
   * 安装代理
   */
  async installAgent(item) {
    assertSafeAgentFileName(item?.fileName);
    assertSafeRepoPath(item?.repoPath);

    const repo = {
      owner: item.repoOwner,
      name: item.repoName,
      branch: item.repoBranch
    };

    // 代理安装到根目录，使用文件名
    return this.installFromRepo(item.repoPath, repo, `${item.fileName}.md`);
  }
}

/**
 * Agents 服务类
 */
class AgentsService {
  constructor(platform = 'claude') {
    this.platform = normalizePlatform(platform);
    const config = PLATFORM_CONFIG[this.platform];

    this.userAgentsDir = config.userAgentsDir;
    if (this.platform === 'opencode') {
      const legacyUserDir = config.legacyUserAgentsDir;
      if (legacyUserDir && fs.existsSync(legacyUserDir) && !fs.existsSync(this.userAgentsDir)) {
        this.userAgentsDir = legacyUserDir;
      }
    }

    this.projectAgentsDir = config.projectAgentsDir;
    this.repoScanner = new AgentsRepoScanner(this.platform, this.userAgentsDir);
    ensureDir(this.userAgentsDir);
  }

  getProjectAgentsDir(projectPath) {
    if (!projectPath) return null;
    const safeProjectPath = assertSafeProjectPath(projectPath);
    return this.projectAgentsDir(safeProjectPath);
  }

  /**
   * 获取所有代理列表
   * @param {string} projectPath - 项目路径（可选，用于获取项目级代理）
   */
  listAgents(projectPath = null) {
    if (this.platform === 'codex') {
      return this.listCodexAgents();
    }

    const agents = [];

    // 获取用户级代理
    const userAgents = scanAgentsDir(this.userAgentsDir, this.userAgentsDir, 'user');
    agents.push(...userAgents);

    // 获取项目级代理（如果提供了项目路径）
    if (projectPath) {
      const projectAgentsDir = this.getProjectAgentsDir(projectPath);
      const projectAgents = scanAgentsDir(projectAgentsDir, projectAgentsDir, 'project');
      agents.push(...projectAgents);
    }

    // 按名称排序
    agents.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    return {
      agents,
      total: agents.length,
      userCount: userAgents.length,
      projectCount: agents.length - userAgents.length
    };
  }

  /**
   * 获取所有代理（包括远程仓库）
   */
  async listAllAgents(projectPath = null, forceRefresh = false) {
    if (this.platform === 'codex') {
      const { agents, userCount, projectCount } = this.listCodexAgents();
      return {
        agents,
        total: agents.length,
        userCount,
        projectCount,
        remoteCount: 0
      };
    }

    // 获取本地代理
    const { agents: localAgents, userCount, projectCount } = this.listAgents(projectPath);

    // 获取远程代理
    let remoteAgents = [];
    try {
      remoteAgents = await this.repoScanner.listRemoteItems(forceRefresh);

      // 更新安装状态
      for (const agent of remoteAgents) {
        agent.installed = this.repoScanner.isInstalled(agent.fileName);
      }
    } catch (err) {
      console.warn('[AgentsService] Failed to fetch remote agents:', err.message);
    }

    // 合并列表（本地优先）
    const allAgents = [...localAgents];
    const localKeys = new Set(localAgents.map(a => a.fileName.toLowerCase()));

    for (const remote of remoteAgents) {
      if (!localKeys.has(remote.fileName.toLowerCase())) {
        allAgents.push(remote);
      }
    }

    // 排序
    allAgents.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    return {
      agents: allAgents,
      total: allAgents.length,
      userCount,
      projectCount,
      remoteCount: remoteAgents.length
    };
  }

  /**
   * 获取单个代理详情
   */
  getAgent(fileName, scope, projectPath = null) {
    assertSafeAgentFileName(fileName);

    if (this.platform === 'codex') {
      return this.getCodexAgent(fileName, scope);
    }

    const baseDir = scope === 'user'
      ? this.userAgentsDir
      : this.getProjectAgentsDir(projectPath);

    const filePath = path.join(baseDir, `${fileName}.md`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);

    return {
      name: frontmatter.name || fileName,
      fileName,
      scope,
      path: `${fileName}.md`,
      fullPath: filePath,
      description: frontmatter.description || '',
      tools: frontmatter.tools || '',
      model: frontmatter.model || '',
      permissionMode: frontmatter.permissionMode || '',
      skills: frontmatter.skills || '',
      systemPrompt: body,
      fullContent: content,
      updatedAt: fs.statSync(filePath).mtime.getTime()
    };
  }

  /**
   * 创建代理
   */
  createAgent({ fileName, scope, projectPath, name, description, tools, model, permissionMode, skills, systemPrompt, configMode, configFile, configContent }) {
    assertSafeAgentFileName(fileName);

    if (this.platform === 'codex') {
      return this.createCodexAgent({ fileName, scope, description, model, configMode, configFile, configContent });
    }

    if (this.platform === 'claude' && (!name || !name.trim())) {
      throw new Error('代理名称不能为空');
    }

    if (!description || !description.trim()) {
      throw new Error('代理描述不能为空');
    }

    const baseDir = scope === 'user'
      ? this.userAgentsDir
      : this.getProjectAgentsDir(projectPath);

    ensureDir(baseDir);

    const filePath = path.join(baseDir, `${fileName}.md`);

    // 检查是否已存在
    if (fs.existsSync(filePath)) {
      throw new Error(`代理 "${fileName}" 已存在`);
    }

    // 生成文件内容
    const frontmatterData = { name: (name || fileName), description };
    if (tools) frontmatterData.tools = tools;
    if (model) frontmatterData.model = model;
    if (permissionMode) frontmatterData.permissionMode = permissionMode;
    if (skills) frontmatterData.skills = skills;

    const content = generateFrontmatter(frontmatterData, this.platform) + '\n\n' + (systemPrompt || '');

    fs.writeFileSync(filePath, content, 'utf-8');

    return this.getAgent(fileName, scope, projectPath);
  }

  /**
   * 更新代理
   */
  updateAgent({ fileName, scope, projectPath, name, description, tools, model, permissionMode, skills, systemPrompt, configMode, configFile, configContent }) {
    assertSafeAgentFileName(fileName);

    if (this.platform === 'codex') {
      return this.updateCodexAgent({ fileName, scope, description, model, configMode, configFile, configContent });
    }

    const baseDir = scope === 'user'
      ? this.userAgentsDir
      : this.getProjectAgentsDir(projectPath);

    const filePath = path.join(baseDir, `${fileName}.md`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`代理 "${fileName}" 不存在`);
    }

    // 生成文件内容
    const frontmatterData = {
      name: name || fileName,
      description: description || ''
    };
    if (tools) frontmatterData.tools = tools;
    if (model) frontmatterData.model = model;
    if (permissionMode) frontmatterData.permissionMode = permissionMode;
    if (skills) frontmatterData.skills = skills;

    const content = generateFrontmatter(frontmatterData, this.platform) + '\n\n' + (systemPrompt || '');

    fs.writeFileSync(filePath, content, 'utf-8');

    return this.getAgent(fileName, scope, projectPath);
  }

  /**
   * 删除代理
   */
  deleteAgent(fileName, scope, projectPath = null) {
    assertSafeAgentFileName(fileName);

    if (this.platform === 'codex') {
      return this.deleteCodexAgent(fileName, scope);
    }

    const baseDir = scope === 'user'
      ? this.userAgentsDir
      : this.getProjectAgentsDir(projectPath);

    const filePath = path.join(baseDir, `${fileName}.md`);

    if (!fs.existsSync(filePath)) {
      return { success: false, message: '代理不存在' };
    }

    fs.unlinkSync(filePath);

    return { success: true, message: '代理已删除' };
  }

  /**
   * 获取统计信息
   */
  getStats(projectPath = null) {
    if (this.platform === 'codex') {
      const { agents, userCount, projectCount } = this.listCodexAgents();
      return {
        total: agents.length,
        userCount,
        projectCount,
        models: { default: agents.length }
      };
    }

    const { agents, userCount, projectCount } = this.listAgents(projectPath);

    // 按模型分组
    const models = {};
    for (const agent of agents) {
      const m = agent.model || 'default';
      if (!models[m]) {
        models[m] = 0;
      }
      models[m]++;
    }

    return {
      total: agents.length,
      userCount,
      projectCount,
      models
    };
  }

  // ==================== 仓库管理 ====================

  /**
   * 获取仓库列表
   */
  getRepos() {
    return this.repoScanner.loadRepos();
  }

  /**
   * 添加仓库
   */
  addRepo(repo) {
    return this.repoScanner.addRepo(repo);
  }

  /**
   * 删除仓库
   */
  removeRepo(owner, name, directory = '') {
    return this.repoScanner.removeRepo(owner, name, directory);
  }

  /**
   * 切换仓库启用状态
   */
  toggleRepo(owner, name, directory = '', enabled) {
    return this.repoScanner.toggleRepo(owner, name, directory, enabled);
  }

  /**
   * 从远程仓库安装代理
   */
  async installFromRemote(agent) {
    if (!agent || typeof agent !== 'object') {
      throw new Error('无效的代理安装参数');
    }
    assertSafeAgentFileName(agent.fileName);
    assertSafeRepoPath(agent.repoPath);
    return this.repoScanner.installAgent(agent);
  }

  /**
   * 卸载代理
   */
  uninstallAgent(fileName) {
    assertSafeAgentFileName(fileName);
    return this.repoScanner.uninstall(`${fileName}.md`);
  }

  listCodexAgents() {
    const config = readCodexTomlConfig();
    const agentsTable = isPlainObject(config.agents) ? config.agents : {};
    const agents = [];

    for (const [key, value] of Object.entries(agentsTable)) {
      if (!isPlainObject(value)) {
        continue;
      }

      const configFile = normalizeCodexConfigPath(value.config_file);
      const resolvedConfigFile = resolveCodexConfigPath(configFile);
      const configMode = inferCodexConfigMode(configFile);
      const fullPath = configFile || `${key}.toml`;
      let model = '';
      let fullContent = '';
      let configReadError = '';
      let updatedAt = fs.existsSync(CODEX_CONFIG_PATH) ? fs.statSync(CODEX_CONFIG_PATH).mtime.getTime() : Date.now();

      if (configFile) {
        const parsedConfigFile = readCodexAgentConfigFile(resolvedConfigFile);
        fullContent = parsedConfigFile.content;
        if (isPlainObject(parsedConfigFile.data) && typeof parsedConfigFile.data.model === 'string') {
          model = parsedConfigFile.data.model;
        }
        if (parsedConfigFile.updatedAt) {
          updatedAt = Math.max(updatedAt, parsedConfigFile.updatedAt);
        }
        if (parsedConfigFile.error) {
          configReadError = parsedConfigFile.error;
        }
      }

      agents.push({
        name: key,
        fileName: key,
        scope: 'user',
        path: fullPath,
        fullPath,
        description: value.description || '',
        tools: '',
        model,
        permissionMode: '',
        skills: '',
        systemPrompt: '',
        fullContent,
        configFile,
        configMode,
        configReadError,
        resolvedConfigFile,
        updatedAt
      });
    }

    agents.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    return {
      agents,
      total: agents.length,
      userCount: agents.length,
      projectCount: 0
    };
  }

  getCodexAgent(fileName, scope) {
    assertSafeAgentFileName(fileName);

    if (scope !== 'user') {
      return null;
    }

    const { agents } = this.listCodexAgents();
    return agents.find(agent => agent.fileName === fileName) || null;
  }

  createCodexAgent({ fileName, scope, description, model, configMode, configFile, configContent }) {
    assertSafeAgentFileName(fileName);

    if (scope !== 'user') {
      throw new Error('Codex 仅支持用户级代理');
    }

    if (!description || !description.trim()) {
      throw new Error('代理描述不能为空');
    }

    const config = readCodexTomlConfig();
    config.features = isPlainObject(config.features) ? config.features : {};
    config.features.multi_agent = true;
    config.agents = isPlainObject(config.agents) ? config.agents : {};

    if (Object.prototype.hasOwnProperty.call(config.agents, fileName)) {
      if (isPlainObject(config.agents[fileName])) {
        throw new Error(`代理 "${fileName}" 已存在`);
      }
      throw new Error(`代理文件名 "${fileName}" 与 Codex 全局 agents 配置冲突`);
    }

    const agentConfig = { description: description.trim() };
    const normalizedMode = normalizeCodexConfigMode(configMode);

    if (!normalizedMode) {
      const trimmedModel = (model || '').trim();
      if (trimmedModel) {
        ensureDir(CODEX_AGENTS_DIR);
        const configFilePath = getCodexManagedAgentConfigPath(fileName);
        writeFileAtomic(configFilePath, tomlStringify({ model: trimmedModel }));
        agentConfig.config_file = configFilePath;
      }
    } else if (normalizedMode === 'managed') {
      ensureDir(CODEX_AGENTS_DIR);
      const configFilePath = getCodexManagedAgentConfigPath(fileName);
      const content = resolveCodexConfigContent({ configContent, model });
      writeFileAtomic(configFilePath, content);
      agentConfig.config_file = configFilePath;
    } else if (normalizedMode === 'custom') {
      const safeConfigFile = assertSafeCodexConfigPath(configFile);
      const resolvedPath = resolveCodexConfigPath(safeConfigFile);
      ensureDir(path.dirname(resolvedPath));
      const content = resolveCodexConfigContent({ configContent, model });
      writeFileAtomic(resolvedPath, content);
      agentConfig.config_file = safeConfigFile;
    }

    config.agents[fileName] = agentConfig;
    writeCodexTomlConfig(config);

    return this.getCodexAgent(fileName, scope);
  }

  updateCodexAgent({ fileName, scope, description, model, configMode, configFile, configContent }) {
    assertSafeAgentFileName(fileName);

    if (scope !== 'user') {
      throw new Error('Codex 仅支持用户级代理');
    }

    const config = readCodexTomlConfig();
    config.features = isPlainObject(config.features) ? config.features : {};
    config.features.multi_agent = true;
    config.agents = isPlainObject(config.agents) ? config.agents : {};

    const existingAgent = config.agents[fileName];
    if (!isPlainObject(existingAgent)) {
      throw new Error(`代理 "${fileName}" 不存在`);
    }

    const agentConfig = { ...existingAgent };
    agentConfig.description = (description || '').trim();

    const existingConfigFile = normalizeCodexConfigPath(agentConfig.config_file);
    const isExistingManagedConfig = isManagedCodexConfigPath(existingConfigFile);
    const resolvedExistingConfigFile = isExistingManagedConfig ? resolveCodexConfigPath(existingConfigFile) : '';
    const normalizedMode = normalizeCodexConfigMode(configMode);

    if (!normalizedMode) {
      const trimmedModel = (model || '').trim();
      if (trimmedModel) {
        ensureDir(CODEX_AGENTS_DIR);
        const configFilePath = isExistingManagedConfig ? existingConfigFile : getCodexManagedAgentConfigPath(fileName);
        const resolvedConfigFilePath = resolveCodexConfigPath(configFilePath);
        const parsedConfigFile = readCodexAgentConfigFile(resolvedConfigFilePath);
        const configFileData = isPlainObject(parsedConfigFile?.data) ? parsedConfigFile.data : {};
        configFileData.model = trimmedModel;
        ensureDir(path.dirname(resolvedConfigFilePath));
        writeFileAtomic(resolvedConfigFilePath, tomlStringify(configFileData));
        agentConfig.config_file = configFilePath;
      } else if (isExistingManagedConfig) {
        delete agentConfig.config_file;
        if (resolvedExistingConfigFile && fs.existsSync(resolvedExistingConfigFile)) {
          fs.unlinkSync(resolvedExistingConfigFile);
        }
      }
    } else if (normalizedMode === 'none') {
      delete agentConfig.config_file;
      if (resolvedExistingConfigFile && fs.existsSync(resolvedExistingConfigFile)) {
        fs.unlinkSync(resolvedExistingConfigFile);
      }
    } else if (normalizedMode === 'managed') {
      ensureDir(CODEX_AGENTS_DIR);
      const configFilePath = getCodexManagedAgentConfigPath(fileName);
      const resolvedConfigFilePath = resolveCodexConfigPath(configFilePath);
      const existingManagedContent = fs.existsSync(resolvedConfigFilePath)
        ? fs.readFileSync(resolvedConfigFilePath, 'utf-8')
        : '';
      const content = resolveCodexConfigContent({
        configContent,
        model,
        fallbackContent: existingManagedContent
      });
      ensureDir(path.dirname(resolvedConfigFilePath));
      writeFileAtomic(resolvedConfigFilePath, content);
      agentConfig.config_file = configFilePath;
      if (resolvedExistingConfigFile &&
          resolvedExistingConfigFile !== resolvedConfigFilePath &&
          fs.existsSync(resolvedExistingConfigFile)) {
        fs.unlinkSync(resolvedExistingConfigFile);
      }
    } else if (normalizedMode === 'custom') {
      let targetConfigPath = normalizeCodexConfigPath(configFile);
      if (!targetConfigPath) {
        if (existingConfigFile && !isExistingManagedConfig) {
          targetConfigPath = existingConfigFile;
        } else {
          throw new Error('custom 模式需要提供 configFile');
        }
      } else {
        targetConfigPath = assertSafeCodexConfigPath(targetConfigPath);
      }

      const resolvedTargetConfigPath = resolveCodexConfigPath(targetConfigPath);
      const existingContent = fs.existsSync(resolvedTargetConfigPath)
        ? fs.readFileSync(resolvedTargetConfigPath, 'utf-8')
        : '';
      const content = resolveCodexConfigContent({
        configContent,
        model,
        fallbackContent: existingContent
      });
      ensureDir(path.dirname(resolvedTargetConfigPath));
      writeFileAtomic(resolvedTargetConfigPath, content);
      agentConfig.config_file = targetConfigPath;
      if (resolvedExistingConfigFile &&
          resolvedExistingConfigFile !== resolvedTargetConfigPath &&
          fs.existsSync(resolvedExistingConfigFile)) {
        fs.unlinkSync(resolvedExistingConfigFile);
      }
    }

    config.agents[fileName] = agentConfig;
    writeCodexTomlConfig(config);

    return this.getCodexAgent(fileName, scope);
  }

  deleteCodexAgent(fileName, scope) {
    assertSafeAgentFileName(fileName);

    if (scope !== 'user') {
      throw new Error('Codex 仅支持用户级代理');
    }

    const config = readCodexTomlConfig();
    config.agents = isPlainObject(config.agents) ? config.agents : {};

    const existingAgent = config.agents[fileName];
    if (!isPlainObject(existingAgent)) {
      return { success: false, message: '代理不存在' };
    }

    const existingConfigFile = normalizeCodexConfigPath(existingAgent.config_file);
    const resolvedExistingConfigFile = resolveCodexConfigPath(existingConfigFile);
    if (existingConfigFile &&
        isManagedCodexConfigPath(existingConfigFile) &&
        resolvedExistingConfigFile &&
        fs.existsSync(resolvedExistingConfigFile)) {
      fs.unlinkSync(resolvedExistingConfigFile);
    }

    delete config.agents[fileName];
    writeCodexTomlConfig(config);

    return { success: true, message: '代理已删除' };
  }
}

module.exports = {
  AgentsService,
  DEFAULT_REPOS
};
