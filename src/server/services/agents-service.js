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
const { LocalResourceIndex } = require('./local-resource-index');
const { NATIVE_PATHS } = require('../../config/paths');
const { resolvePreferredHomeDir } = require('../../utils/home-dir');
const {
  normalizeSafeFileStem,
  normalizeSafeRelativePath,
  resolveInsideRoot
} = require('./config-artifact-paths');

function readAgentMetadata(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(8192);
  const chunks = [];
  let total = 0;
  try {
    while (total < 1024 * 1024) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      total += bytesRead;
      let text = Buffer.concat(chunks).toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      if (total === bytesRead && !/^\s*---\s*(?:\n|$)/.test(text)) return {};
      if (/^\s*---\s*\n[\s\S]*?\n\s*---\s*(?:\n|$)/.test(text)) return parseFrontmatter(text).frontmatter;
    }
    return {};
  } finally {
    fs.closeSync(fd);
  }
}

// 默认仓库源
const DEFAULT_REPOS = [];
const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode'];
const OPENCODE_CONFIG_DIR = NATIVE_PATHS.opencode.config;
const CODEX_CONFIG_PATH = NATIVE_PATHS.codex.config;
const HOME_DIR = resolvePreferredHomeDir(process.platform, process.env, os.homedir());
const CODEX_AGENTS_DIR = path.join(path.dirname(CODEX_CONFIG_PATH), 'agents');
const CLAUDE_AGENTS_DIR = NATIVE_PATHS.claude.agents
  || path.join(NATIVE_PATHS.claude.dir || path.dirname(NATIVE_PATHS.claude.settings), 'agents');
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
  try {
    return normalizeSafeFileStem(fileName, 'agent file name', {
      allowDots: true,
      pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
    });
  } catch {
    throw new Error('代理文件名只能包含字母、数字、点号、横杠和下划线，且不能包含连续点');
  }
}

function assertSafeRepoPath(repoPath) {
  let normalized = '';
  try {
    normalized = normalizeSafeRelativePath(repoPath, 'agent repo path');
  } catch {
    throw new Error('代理仓库路径不合法');
  }

  if (!normalized.endsWith('.md')) {
    throw new Error('代理仓库路径必须是 .md 文件');
  }

  return normalized;
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
  const safeFileName = assertSafeAgentFileName(fileName);
  return resolveInsideRoot(CODEX_AGENTS_DIR, `${safeFileName}.toml`, 'Codex agent config path');
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
function readCodexTomlMetadata(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(8192);
  const chunks = [];
  let total = 0;
  let updatedAt = 0;
  try {
    updatedAt = fs.fstatSync(fd).mtimeMs;
    while (total < 1024 * 1024) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      total += bytesRead;
      let content = Buffer.concat(chunks).toString('utf8');
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      if (/^\s*model\s*=.*(?:\n|$)/m.test(content)) return { data: toml.parse(content), content, updatedAt };
    }
    let content = Buffer.concat(chunks).toString('utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    return { data: toml.parse(content), content, updatedAt };
  } catch (error) {
    return { data: {}, content: '', updatedAt, error };
  } finally {
    fs.closeSync(fd);
  }
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
    try {
      const safeFileName = assertSafeAgentFileName(fileName);
      const fullPath = resolveInsideRoot(this.installDir, `${safeFileName}.md`, 'Agent path');
      return fs.existsSync(fullPath);
    } catch {
      return false;
    }
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
    const safeFileName = assertSafeAgentFileName(item?.fileName);
    const safeRepoPath = assertSafeRepoPath(item?.repoPath);

    const repo = {
      owner: item.repoOwner,
      name: item.repoName,
      branch: item.repoBranch
    };

    // 代理安装到根目录，使用文件名
    return this.installFromRepo(safeRepoPath, repo, `${safeFileName}.md`);
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
      if (legacyUserDir && fs.existsSync(legacyUserDir) && !fs.existsSync(this.userAgentsDir)) this.userAgentsDir = legacyUserDir;
    }
    this.projectAgentsDir = config.projectAgentsDir;
    this.repoScanner = new AgentsRepoScanner(this.platform, this.userAgentsDir);
    ensureDir(this.userAgentsDir);
    this._localIndexes = new Map();
    this._localIndexLimit = 32;
  }
  _getLocalIndex(scope, projectPath = null) {
    const root = scope === 'user' ? this.userAgentsDir : this.getProjectAgentsDir(projectPath);
    if (!root) return null;
    const key = `${this.platform}:${scope}:${path.resolve(root)}`;
    if (!this._localIndexes.has(key)) {
      if (this._localIndexes.size >= this._localIndexLimit) {
        const [oldKey, oldIndex] = this._localIndexes.entries().next().value;
        oldIndex.dispose();
        this._localIndexes.delete(oldKey);
      }
      this._localIndexes.set(key, new LocalResourceIndex({ key, roots: [root],
        scanFile: (descriptor) => {
          if (!descriptor.fullPath.endsWith('.md') || descriptor.relativePath.includes(path.sep)) return null;
          const frontmatter = readAgentMetadata(descriptor.fullPath);
          const fileName = path.basename(descriptor.relativePath, '.md');
          return { name: frontmatter.name || fileName, fileName, scope, path: descriptor.relativePath, fullPath: descriptor.fullPath, description: frontmatter.description || '', tools: frontmatter.tools || '', model: frontmatter.model || '', permissionMode: frontmatter.permissionMode || '', skills: frontmatter.skills || '', updatedAt: descriptor.stat.mtime.getTime() };
        },
        detailFile: (summary) => {
          const content = fs.readFileSync(summary.fullPath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(content);
          return { systemPrompt: body, fullContent: content, updatedAt: fs.statSync(summary.fullPath).mtime.getTime(), name: frontmatter.name || summary.fileName, description: frontmatter.description || '', tools: frontmatter.tools || '', model: frontmatter.model || '', permissionMode: frontmatter.permissionMode || '', skills: frontmatter.skills || '' };
        }
      }));
    }
    const index = this._localIndexes.get(key);
    this._localIndexes.delete(key);
    this._localIndexes.set(key, index);
    return index;
  }

  dispose() {
    for (const index of this._localIndexes.values()) index.dispose();
    this._localIndexes.clear();
    this._codexIndex?.dispose();
    this._codexIndex = null;
  }

  _invalidateLocal(scope, projectPath = null) {
    this._getLocalIndex(scope, projectPath)?.invalidate();
  }

  getProjectAgentsDir(projectPath) {
    if (!projectPath) return null;
    const safeProjectPath = assertSafeProjectPath(projectPath);
    return this.projectAgentsDir(safeProjectPath);
  }

  _getBaseDir(scope, projectPath = null) {
    return scope === 'user'
      ? this.userAgentsDir
      : this.getProjectAgentsDir(projectPath);
  }

  _resolveAgentFilePath(baseDir, fileName) {
    if (!baseDir) {
      throw new Error('项目路径不能为空');
    }
    const safeFileName = assertSafeAgentFileName(fileName);
    const relativePath = `${safeFileName}.md`;
    const fullPath = resolveInsideRoot(baseDir, relativePath, 'Agent path');
    return { safeFileName, relativePath, fullPath };
  }

  listAgents(projectPath = null) {
    if (this.platform === 'codex') return this.listCodexAgents(false);
    const userAgents = this._getLocalIndex('user').listSync();
    const projectAgents = projectPath ? this._getLocalIndex('project', projectPath).listSync() : [];
    const agents = [...userAgents, ...projectAgents];
    agents.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return { agents, total: agents.length, userCount: userAgents.length, projectCount: projectAgents.length };
  }

  /** 获取所有代理（包括远程仓库） */
  async listAllAgents(projectPath = null, forceRefresh = false) {
    if (this.platform === 'codex') {
      const { agents, userCount, projectCount } = this.listCodexAgents(false);
      return { agents, total: agents.length, userCount, projectCount, remoteCount: 0 };
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
    const safeFileName = assertSafeAgentFileName(fileName);
    if (this.platform === 'codex') return this.getCodexAgent(safeFileName, scope);
    const baseDir = this._getBaseDir(scope, projectPath);
    const { relativePath } = this._resolveAgentFilePath(baseDir, safeFileName);
    const detail = this._getLocalIndex(scope, projectPath)?.getSync(relativePath);
    if (!detail) return null;
    return { ...detail, fileName: safeFileName, scope, path: relativePath };
  }

  /**
   * 创建代理
   */
  createAgent({ fileName, scope, projectPath, name, description, tools, model, permissionMode, skills, systemPrompt, configMode, configFile, configContent }) {
    const safeFileName = assertSafeAgentFileName(fileName);

    if (this.platform === 'codex') {
      return this.createCodexAgent({ fileName: safeFileName, scope, description, model, configMode, configFile, configContent });
    }

    if (this.platform === 'claude' && (!name || !name.trim())) {
      throw new Error('代理名称不能为空');
    }

    if (!description || !description.trim()) {
      throw new Error('代理描述不能为空');
    }

    const baseDir = this._getBaseDir(scope, projectPath);
    const { fullPath: filePath } = this._resolveAgentFilePath(baseDir, safeFileName);

    ensureDir(baseDir);

    // 检查是否已存在
    if (fs.existsSync(filePath)) {
      throw new Error(`代理 "${safeFileName}" 已存在`);
    }

    // 生成文件内容
    const frontmatterData = { name: (name || safeFileName), description };
    if (tools) frontmatterData.tools = tools;
    if (model) frontmatterData.model = model;
    if (permissionMode) frontmatterData.permissionMode = permissionMode;
    if (skills) frontmatterData.skills = skills;

    const content = generateFrontmatter(frontmatterData, this.platform) + '\n\n' + (systemPrompt || '');
    fs.writeFileSync(filePath, content, 'utf-8');
    this._invalidateLocal(scope, projectPath);
    return this.getAgent(safeFileName, scope, projectPath);
  }

  /**
   * 更新代理
   */
  updateAgent({ fileName, scope, projectPath, name, description, tools, model, permissionMode, skills, systemPrompt, configMode, configFile, configContent }) {
    const safeFileName = assertSafeAgentFileName(fileName);

    if (this.platform === 'codex') {
      return this.updateCodexAgent({ fileName: safeFileName, scope, description, model, configMode, configFile, configContent });
    }

    const baseDir = this._getBaseDir(scope, projectPath);
    const { fullPath: filePath } = this._resolveAgentFilePath(baseDir, safeFileName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`代理 "${safeFileName}" 不存在`);
    }

    // 生成文件内容
    const frontmatterData = {
      name: name || safeFileName,
      description: description || ''
    };
    if (tools) frontmatterData.tools = tools;
    if (model) frontmatterData.model = model;
    if (permissionMode) frontmatterData.permissionMode = permissionMode;
    if (skills) frontmatterData.skills = skills;

    const content = generateFrontmatter(frontmatterData, this.platform) + '\n\n' + (systemPrompt || '');
    fs.writeFileSync(filePath, content, 'utf-8');
    this._invalidateLocal(scope, projectPath);
    return this.getAgent(safeFileName, scope, projectPath);
  }

  /**
   * 删除代理
   */
  deleteAgent(fileName, scope, projectPath = null) {
    const safeFileName = assertSafeAgentFileName(fileName);

    if (this.platform === 'codex') {
      return this.deleteCodexAgent(safeFileName, scope);
    }

    const baseDir = this._getBaseDir(scope, projectPath);
    const { fullPath: filePath } = this._resolveAgentFilePath(baseDir, safeFileName);

    if (!fs.existsSync(filePath)) {
      return { success: false, message: '代理不存在' };
    }

    fs.unlinkSync(filePath);
    this._invalidateLocal(scope, projectPath);
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
    if (!agent || typeof agent !== 'object') throw new Error('无效的代理安装参数');
    const safeFileName = assertSafeAgentFileName(agent.fileName);
    const safeRepoPath = assertSafeRepoPath(agent.repoPath);
    const result = await this.repoScanner.installAgent({ ...agent, fileName: safeFileName, repoPath: safeRepoPath });
    if (result && result.success !== false) this._invalidateLocal('user');
    return result;
  }

  /** 卸载代理 */
  uninstallAgent(fileName) {
    const safeFileName = assertSafeAgentFileName(fileName);
    const result = this.repoScanner.uninstall(`${safeFileName}.md`);
    if (result && result.success !== false) this._invalidateLocal('user');
    return result;
  }

  _readCodexAgents(includeDetails = true) {
    const config = readCodexTomlConfig();
    const agentsTable = isPlainObject(config.agents) ? config.agents : {};
    const agentsByName = new Map();

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
      if (includeDetails && configFile) {
        const parsedConfigFile = readCodexAgentConfigFile(resolvedConfigFile);
        fullContent = parsedConfigFile.content;
        if (isPlainObject(parsedConfigFile.data) && typeof parsedConfigFile.data.model === 'string') model = parsedConfigFile.data.model;
        if (parsedConfigFile.updatedAt) updatedAt = Math.max(updatedAt, parsedConfigFile.updatedAt);
        if (parsedConfigFile.error) configReadError = parsedConfigFile.error;
      }

      agentsByName.set(key, {
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
        updatedAt,
        source: 'codex-config'
      });
    }

    if (fs.existsSync(CODEX_AGENTS_DIR)) {
      try {
        const entries = fs.readdirSync(CODEX_AGENTS_DIR, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.toml')) {
            continue;
          }

          const fileName = entry.name.slice(0, -'.toml'.length);
          try {
            assertSafeAgentFileName(fileName);
          } catch {
            continue;
          }

          const configFilePath = path.join(CODEX_AGENTS_DIR, entry.name);
          const parsedConfigFile = includeDetails ? readCodexAgentConfigFile(configFilePath) : { content: '', data: null, updatedAt: fs.statSync(configFilePath).mtime.getTime(), error: null };
          const existing = agentsByName.get(fileName);
          const model = isPlainObject(parsedConfigFile.data) && typeof parsedConfigFile.data.model === 'string' ? parsedConfigFile.data.model : '';
          const updatedAt = parsedConfigFile.updatedAt || fs.statSync(configFilePath).mtime.getTime();

          if (existing) {
            if (!existing.configFile) {
              existing.configFile = configFilePath;
              existing.configMode = inferCodexConfigMode(configFilePath);
              existing.path = configFilePath;
              existing.fullPath = configFilePath;
              existing.resolvedConfigFile = configFilePath;
            }
            if (includeDetails && !existing.fullContent && parsedConfigFile.content) existing.fullContent = parsedConfigFile.content;
            if (!existing.model && model) existing.model = model;
            if (parsedConfigFile.error && !existing.configReadError) existing.configReadError = parsedConfigFile.error;
            existing.updatedAt = Math.max(existing.updatedAt || 0, updatedAt);
            existing.source = existing.source === 'codex-config' ? 'codex-config+native-file' : existing.source;
            continue;
          }

          agentsByName.set(fileName, {
            name: fileName,
            fileName,
            scope: 'user',
            path: configFilePath,
            fullPath: configFilePath,
            description: '',
            tools: '',
            model,
            permissionMode: '',
            skills: '',
            systemPrompt: '',
            fullContent: parsedConfigFile.content,
            configFile: configFilePath,
            configMode: inferCodexConfigMode(configFilePath),
            configReadError: parsedConfigFile.error || '',
            resolvedConfigFile: configFilePath,
            updatedAt,
            source: 'native-file'
          });
        }
      } catch (err) {
        console.warn('[AgentsService] Failed to scan Codex agents dir:', err.message);
      }
    }


    const agents = Array.from(agentsByName.values());
    agents.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return { agents, total: agents.length, userCount: agents.length, projectCount: 0 };
  }
  _getCodexIndex() {
    if (!this._codexIndex) {
      this._codexIndex = new LocalResourceIndex({
        key: `${this.platform}:codex`, roots: [CODEX_AGENTS_DIR], ttlMs: 1000,
        scanFile: ({ fullPath, relativePath, stat }) => {
          if (!fullPath.endsWith('.toml') || relativePath.includes(path.sep)) return null;
          const fileName = path.basename(fullPath, '.toml');
          const metadata = readCodexTomlMetadata(fullPath);
          const data = metadata.data || {};
          return { name: fileName, fileName, scope: 'user', path: fullPath, fullPath, description: '', tools: '', model: typeof data.model === 'string' ? data.model : '', permissionMode: '', skills: '', configFile: fullPath, configMode: 'managed', resolvedConfigFile: fullPath, configReadError: metadata.error?.message || '', updatedAt: stat.mtime.getTime(), source: 'native-file' };
        },
        detailFile: (summary) => this._hydrateCodexAgent(summary)
      });
    }
    return this._codexIndex;
  }

  _hydrateCodexAgent(summary) {
    const configPath = summary.resolvedConfigFile || resolveCodexConfigPath(summary.configFile) || (summary.source === 'native-file' ? summary.fullPath : '');
    if (!configPath) return { ...summary, fullContent: '', systemPrompt: '', configReadError: '' };
    const parsed = readCodexAgentConfigFile(configPath);
    const data = parsed.data || {};
    return {
      ...summary,
      model: typeof data.model === 'string' ? data.model : summary.model || '',
      fullContent: parsed.content,
      systemPrompt: '',
      configReadError: parsed.error || summary.configReadError || '',
      updatedAt: parsed.updatedAt || summary.updatedAt
    };
  }

  listCodexAgents(includeDetails = true) {
    const indexed = this._getCodexIndex().listSync();
    const config = readCodexTomlConfig();
    const table = isPlainObject(config.agents) ? config.agents : {};
    const merged = new Map(indexed.map((agent) => [agent.fileName, { ...agent }]));
    for (const [fileName, entry] of Object.entries(table)) {
      if (!isPlainObject(entry)) continue;
      const configFile = normalizeCodexConfigPath(entry.config_file);
      const resolvedConfigFile = resolveCodexConfigPath(configFile);
      const existing = merged.get(fileName);
      const externalMetadata = configFile && !isManagedCodexConfigPath(configFile) && fs.existsSync(resolvedConfigFile)
        ? readCodexTomlMetadata(resolvedConfigFile)
        : { data: {}, error: null };
      const summary = {
        ...(existing || {
          name: fileName, fileName, scope: 'user', path: configFile || `${fileName}.toml`,
          fullPath: resolvedConfigFile || `${fileName}.toml`, tools: '', model: '',
          permissionMode: '', skills: '', updatedAt: fs.existsSync(CODEX_CONFIG_PATH) ? fs.statSync(CODEX_CONFIG_PATH).mtime.getTime() : 0, source: 'codex-config'
        }),
        description: entry.description || existing?.description || '',
        model: existing?.model || (typeof externalMetadata.data?.model === 'string' ? externalMetadata.data.model : ''),
        configReadError: externalMetadata.error?.message || existing?.configReadError || '',
        updatedAt: externalMetadata.updatedAt || existing?.updatedAt || (fs.existsSync(CODEX_CONFIG_PATH) ? fs.statSync(CODEX_CONFIG_PATH).mtime.getTime() : 0),
        configFile: configFile || existing?.configFile || '',
        configMode: inferCodexConfigMode(configFile || existing?.configFile || ''),
        resolvedConfigFile: resolvedConfigFile || existing?.resolvedConfigFile || existing?.fullPath || '',
        source: existing ? 'codex-config+native-file' : 'codex-config'
      };
      merged.set(fileName, summary);
    }
    const agents = Array.from(merged.values()).map((summary) => includeDetails ? this._hydrateCodexAgent(summary) : summary);
    agents.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return { agents, total: agents.length, userCount: agents.length, projectCount: 0 };
  }

  getCodexAgent(fileName, scope) {
    const safeFileName = assertSafeAgentFileName(fileName);
    if (scope !== 'user') return null;
    const config = readCodexTomlConfig();
    const entry = isPlainObject(config.agents) && isPlainObject(config.agents[safeFileName]) ? config.agents[safeFileName] : null;
    const managedPath = path.join(CODEX_AGENTS_DIR, `${safeFileName}.toml`);
    const configFile = normalizeCodexConfigPath(entry?.config_file);
    const resolvedConfigFile = resolveCodexConfigPath(configFile);
    const nativePath = !configFile && fs.existsSync(managedPath) ? managedPath : '';
    const exists = Boolean(entry || nativePath || (resolvedConfigFile && fs.existsSync(resolvedConfigFile)));
    if (!exists) return null;
    const targetPath = resolvedConfigFile || nativePath;
    const summary = {
      name: safeFileName, fileName: safeFileName, scope: 'user',
      path: targetPath || `${safeFileName}.toml`, fullPath: targetPath || `${safeFileName}.toml`,
      description: entry?.description || '', tools: '', model: '', permissionMode: '', skills: '',
      configFile: configFile || nativePath,
      configMode: inferCodexConfigMode(configFile || nativePath),
      resolvedConfigFile: targetPath,
      updatedAt: fs.existsSync(CODEX_CONFIG_PATH) ? fs.statSync(CODEX_CONFIG_PATH).mtime.getTime() : 0,
      source: entry ? 'codex-config' : 'native-file'
    };
    return this._hydrateCodexAgent(summary);
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
    this._codexIndex?.invalidate();
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
    this._codexIndex?.invalidate();
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
    this._codexIndex?.invalidate();
    return { success: true, message: '代理已删除' };
  }
}

module.exports = {
  AgentsService,
  DEFAULT_REPOS
};
