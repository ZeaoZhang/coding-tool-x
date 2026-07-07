/**
 * Commands 服务
 *
 * 管理 Claude/Codex/Gemini/OpenCode 自定义命令的 CRUD 操作
 * 支持从 GitHub 仓库扫描和安装命令
 */

const fs = require('fs');
const path = require('path');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;
const { RepoScannerBase } = require('./repo-scanner-base');
const { NATIVE_PATHS } = require('../../config/paths');
const {
  parseFrontmatter
} = require('./format-converter');
const {
  normalizeSafeFileStem,
  normalizeSafeRelativePath,
  resolveInsideRoot
} = require('./config-artifact-paths');

// 默认仓库源
const DEFAULT_REPOS = [];
const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode', 'pi'];
const OPENCODE_CONFIG_DIR = NATIVE_PATHS.opencode.config;
const CLAUDE_COMMANDS_DIR = NATIVE_PATHS.claude.commands
  || path.join(NATIVE_PATHS.claude.dir || path.dirname(NATIVE_PATHS.claude.settings), 'commands');
const CODEX_COMMANDS_DIR = path.join(path.dirname(NATIVE_PATHS.codex.config), 'commands');
const GEMINI_COMMANDS_DIR = path.join(NATIVE_PATHS.gemini.dir, 'commands');

const PLATFORM_CONFIG = {
  claude: {
    userCommandsDir: CLAUDE_COMMANDS_DIR,
    projectCommandsDir: (projectPath) => path.join(projectPath, '.claude', 'commands'),
    repoType: 'commands'
  },
  codex: {
    userCommandsDir: CODEX_COMMANDS_DIR,
    projectCommandsDir: (projectPath) => path.join(projectPath, '.codex', 'commands'),
    repoType: 'codex-commands'
  },
  opencode: {
    userCommandsDir: path.join(OPENCODE_CONFIG_DIR, 'commands'),
    legacyUserCommandsDir: path.join(OPENCODE_CONFIG_DIR, 'command'),
    projectCommandsDir: (projectPath) => {
      const modern = path.join(projectPath, '.opencode', 'commands');
      const legacy = path.join(projectPath, '.opencode', 'command');
      if (fs.existsSync(legacy) && !fs.existsSync(modern)) {
        return legacy;
      }
      return modern;
    },
    repoType: 'opencode-commands'
  },
  gemini: {
    userCommandsDir: GEMINI_COMMANDS_DIR,
    projectCommandsDir: (projectPath) => path.join(projectPath, '.gemini', 'commands'),
    repoType: 'gemini-commands',
    fileExtension: '.toml'
  },
  pi: {
    userCommandsDir: NATIVE_PATHS.pi.commands || path.join(NATIVE_PATHS.pi.dir, 'commands'),
    projectCommandsDir: (projectPath) => path.join(projectPath, '.omp', 'commands'),
    repoType: 'pi-commands'
  }
};

function normalizePlatform(platform) {
  return SUPPORTED_PLATFORMS.includes(platform) ? platform : 'claude';
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 生成 frontmatter 字符串（用于命令创建/更新）
 */
function generateCommandFrontmatter(data) {
  const lines = ['---'];

  if (data.description) {
    lines.push(`description: "${data.description}"`);
  }
  if (data['allowed-tools']) {
    lines.push(`allowed-tools: ${data['allowed-tools']}`);
  }
  if (data['argument-hint']) {
    lines.push(`argument-hint: ${data['argument-hint']}`);
  }
  if (data.model) {
    lines.push(`model: ${data.model}`);
  }
  if (data.context) {
    lines.push(`context: ${data.context}`);
  }
  if (data.agent) {
    lines.push(`agent: ${data.agent}`);
  }
  if (typeof data.subtask === 'boolean') {
    lines.push(`subtask: ${data.subtask}`);
  }

  lines.push('---');
  return lines.join('\n');
}

function getCommandFileExtension(platform) {
  return PLATFORM_CONFIG[platform]?.fileExtension || '.md';
}

function getCommandTargetName(name, platform) {
  return `${name}${getCommandFileExtension(platform)}`;
}

function normalizeCommandName(name) {
  if (!name || !String(name).trim()) {
    throw new Error('命令名称不能为空');
  }

  try {
    return normalizeSafeFileStem(name, 'command name', {
      allowDots: false,
      pattern: /^[a-zA-Z0-9_-]+$/
    });
  } catch {
    throw new Error('命令名只能包含字母、数字、横杠和下划线');
  }
}

function normalizeCommandNamespace(namespace) {
  return normalizeSafeRelativePath(namespace || '', 'command namespace', {
    allowEmpty: true,
    allowHiddenSegments: false
  });
}

function buildCommandRelativePath(name, namespace, platform) {
  const safeName = normalizeCommandName(name);
  const safeNamespace = normalizeCommandNamespace(namespace);
  const fileName = getCommandTargetName(safeName, platform);
  return safeNamespace ? path.posix.join(safeNamespace, fileName) : fileName;
}

function parseGeminiCommandToml(content) {
  try {
    const parsed = toml.parse(content);
    return {
      description: parsed.description || '',
      body: parsed.prompt || ''
    };
  } catch (err) {
    return {
      description: '',
      body: content,
      parseError: err.message
    };
  }
}

function generateGeminiCommandToml({ description, body }) {
  const data = {
    prompt: body || ''
  };
  if (description) {
    data.description = description;
  }
  return tomlStringify(data);
}

/**
 * 递归扫描目录获取命令文件
 */
function scanCommandsDir(dir, basePath, scope, platform = 'claude') {
  const commands = [];
  const fileExtension = getCommandFileExtension(platform);

  if (!fs.existsSync(dir)) {
    return commands;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        // 递归扫描子目录
        const subCommands = scanCommandsDir(fullPath, basePath, scope, platform);
        commands.push(...subCommands);
      } else if (entry.isFile() && entry.name.endsWith(fileExtension)) {
        // 解析命令文件
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const parsed = platform === 'gemini'
            ? { frontmatter: {}, body: '', gemini: parseGeminiCommandToml(content) }
            : { ...parseFrontmatter(content), gemini: null };

          // 计算相对路径和命令名
          const relativePath = path.relative(basePath, fullPath);
          const commandName = entry.name.slice(0, -fileExtension.length);
          const namespace = path.dirname(relativePath);

          commands.push({
            name: commandName,
            namespace: namespace === '.' ? null : namespace,
            scope,
            path: relativePath,
            fullPath,
            description: parsed.gemini?.description || parsed.frontmatter.description || '',
            allowedTools: parsed.frontmatter['allowed-tools'] || '',
            argumentHint: parsed.frontmatter['argument-hint'] || '',
            agent: parsed.frontmatter.agent || '',
            model: parsed.frontmatter.model || '',
            subtask: parsed.frontmatter.subtask || '',
            body: parsed.gemini?.body ?? parsed.body,
            parseError: parsed.gemini?.parseError || '',
            fullContent: content,
            updatedAt: fs.statSync(fullPath).mtime.getTime()
          });
        } catch (err) {
          console.warn(`[CommandsService] Failed to parse ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error(`[CommandsService] Failed to scan ${dir}:`, err.message);
  }

  return commands;
}

/**
 * Commands 仓库扫描器
 */
class CommandsRepoScanner extends RepoScannerBase {
  constructor(platform, installDir) {
    const normalizedPlatform = normalizePlatform(platform);
    super({
      type: PLATFORM_CONFIG[normalizedPlatform]?.repoType || 'commands',
      installDir,
      markerFile: null, // 直接扫描 .md 文件
      fileExtension: getCommandFileExtension(normalizedPlatform),
      defaultRepos: DEFAULT_REPOS
    });
    this.platform = normalizedPlatform;
  }

  /**
   * 获取并解析单个命令文件
   */
  async fetchAndParseItem(file, repo, baseDir) {
    try {
      // 计算相对路径
      const relativePath = baseDir ? file.path.slice(baseDir.length + 1) : file.path;
      const fileExtension = getCommandFileExtension(this.platform);
      const fileName = path.basename(file.path, fileExtension);
      const namespace = path.dirname(relativePath);

      // 获取文件内容
      const content = await this.fetchRawContent(repo, file.path);
      const parsed = this.platform === 'gemini'
        ? { frontmatter: {}, body: '', gemini: parseGeminiCommandToml(content) }
        : { ...this.parseFrontmatter(content), gemini: null };

      return {
        key: `${repo.owner}/${repo.name}:${relativePath}`,
        name: fileName,
        namespace: namespace === '.' ? null : namespace,
        scope: 'remote',
        path: relativePath,
        repoPath: file.path,
        description: parsed.gemini?.description || parsed.frontmatter.description || '',
        allowedTools: parsed.frontmatter['allowed-tools'] || '',
        argumentHint: parsed.frontmatter['argument-hint'] || '',
        agent: parsed.frontmatter.agent || '',
        model: parsed.frontmatter.model || '',
        subtask: parsed.frontmatter.subtask || '',
        body: parsed.gemini?.body ?? parsed.body,
        parseError: parsed.gemini?.parseError || '',
        fullContent: content,
        installed: this.isInstalled(relativePath),
        readmeUrl: `https://github.com/${repo.owner}/${repo.name}/blob/${repo.branch}/${file.path}`,
        repoOwner: repo.owner,
        repoName: repo.name,
        repoBranch: repo.branch,
        repoDirectory: repo.directory || ''
      };
    } catch (err) {
      console.warn(`[CommandsRepoScanner] Parse command ${file.path} error:`, err.message);
      return null;
    }
  }

  /**
   * 检查命令是否已安装
   */
  isInstalled(relativePath) {
    try {
      const safeRelativePath = normalizeSafeRelativePath(relativePath, 'command path');
      const fullPath = resolveInsideRoot(this.installDir, safeRelativePath, 'Command path');
      return fs.existsSync(fullPath);
    } catch {
      return false;
    }
  }

  /**
   * 获取去重 key
   */
  getDedupeKey(item) {
    // 使用 namespace/name 作为去重 key
    return item.namespace ? `${item.namespace}/${item.name}`.toLowerCase() : item.name.toLowerCase();
  }

  /**
   * 安装命令
   */
  async installCommand(item) {
    const repo = {
      owner: item.repoOwner,
      name: item.repoName,
      branch: item.repoBranch
    };

    return this.installFromRepo(item.repoPath, repo, item.path);
  }
}

/**
 * Commands 服务类
 */
class CommandsService {
  constructor(platform = 'claude') {
    this.platform = normalizePlatform(platform);
    const config = PLATFORM_CONFIG[this.platform];

    this.userCommandsDir = config.userCommandsDir;
    if (this.platform === 'opencode') {
      const legacyUserDir = config.legacyUserCommandsDir;
      if (legacyUserDir && fs.existsSync(legacyUserDir) && !fs.existsSync(this.userCommandsDir)) {
        this.userCommandsDir = legacyUserDir;
      }
    }

    this.projectCommandsDir = config.projectCommandsDir;
    this.repoScanner = new CommandsRepoScanner(this.platform, this.userCommandsDir);
    ensureDir(this.userCommandsDir);
  }

  getProjectCommandsDir(projectPath) {
    if (!projectPath) return null;
    return this.projectCommandsDir(projectPath);
  }

  _getBaseDir(scope, projectPath = null) {
    return scope === 'user'
      ? this.userCommandsDir
      : this.getProjectCommandsDir(projectPath);
  }

  _resolveCommandPath(baseDir, name, namespace = null) {
    if (!baseDir) {
      throw new Error('项目路径不能为空');
    }
    const relativePath = buildCommandRelativePath(name, namespace, this.platform);
    const fullPath = resolveInsideRoot(baseDir, relativePath, 'Command path');
    return { relativePath, fullPath };
  }

  _generateCommandContent({ description, allowedTools, argumentHint, agent, model, subtask, body }) {
    if (this.platform === 'gemini') {
      return generateGeminiCommandToml({ description, body });
    }
    if (this.platform === 'pi') {
      return body || '';
    }

    const frontmatterData = {};
    if (description) frontmatterData.description = description;
    if (this.platform !== 'opencode') {
      if (allowedTools) frontmatterData['allowed-tools'] = allowedTools;
      if (argumentHint) frontmatterData['argument-hint'] = argumentHint;
    }
    if (agent) frontmatterData.agent = agent;
    if (model) frontmatterData.model = model;
    if (typeof subtask === 'boolean') frontmatterData.subtask = subtask;

    let content = '';
    if (Object.keys(frontmatterData).length > 0) {
      content = generateCommandFrontmatter(frontmatterData) + '\n\n';
    }
    content += body || '';
    return content;
  }

  /**
   * 获取所有命令列表
   * @param {string} projectPath - 项目路径（可选，用于获取项目级命令）
   */
  listCommands(projectPath = null) {
    const commands = [];

    // 获取用户级命令
    const userCommands = scanCommandsDir(this.userCommandsDir, this.userCommandsDir, 'user', this.platform);
    commands.push(...userCommands);

    // 获取项目级命令（如果提供了项目路径）
    if (projectPath) {
      const projectCommandsDir = this.getProjectCommandsDir(projectPath);
      const projectCommands = scanCommandsDir(projectCommandsDir, projectCommandsDir, 'project', this.platform);
      commands.push(...projectCommands);
    }

    // 按名称排序
    commands.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    return {
      commands,
      total: commands.length,
      userCount: userCommands.length,
      projectCount: commands.length - userCommands.length
    };
  }

  /**
   * 获取所有命令（包括远程仓库）
   * @param {boolean} forceRefresh - 强制刷新远程缓存
   */
  async listAllCommands(projectPath = null, forceRefresh = false) {
    // 获取本地命令
    const { commands: localCommands, userCount, projectCount } = this.listCommands(projectPath);

    // 获取远程命令
    let remoteCommands = [];
    try {
      remoteCommands = await this.repoScanner.listRemoteItems(forceRefresh);

      // 更新安装状态
      for (const cmd of remoteCommands) {
        cmd.installed = this.repoScanner.isInstalled(cmd.path);
      }
    } catch (err) {
      console.warn('[CommandsService] Failed to fetch remote commands:', err.message);
    }

    // 合并列表（本地优先）
    const allCommands = [...localCommands];
    const localKeys = new Set(localCommands.map(c =>
      c.namespace ? `${c.namespace}/${c.name}`.toLowerCase() : c.name.toLowerCase()
    ));

    for (const remote of remoteCommands) {
      const key = remote.namespace ? `${remote.namespace}/${remote.name}`.toLowerCase() : remote.name.toLowerCase();
      if (!localKeys.has(key)) {
        allCommands.push(remote);
      }
    }

    // 排序
    allCommands.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    return {
      commands: allCommands,
      total: allCommands.length,
      userCount,
      projectCount,
      remoteCount: remoteCommands.length
    };
  }

  /**
   * 获取单个命令详情
   */
  getCommand(name, scope, projectPath = null, namespace = null) {
    const safeName = normalizeCommandName(name);
    const safeNamespace = normalizeCommandNamespace(namespace);
    const baseDir = this._getBaseDir(scope, projectPath);
    const { relativePath, fullPath } = this._resolveCommandPath(baseDir, safeName, safeNamespace);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const parsed = this.platform === 'gemini'
      ? { frontmatter: {}, body: '', gemini: parseGeminiCommandToml(content) }
      : { ...parseFrontmatter(content), gemini: null };

    return {
      name: safeName,
      namespace: safeNamespace || null,
      scope,
      path: relativePath,
      fullPath,
      description: parsed.gemini?.description || parsed.frontmatter.description || '',
      allowedTools: parsed.frontmatter['allowed-tools'] || '',
      argumentHint: parsed.frontmatter['argument-hint'] || '',
      agent: parsed.frontmatter.agent || '',
      model: parsed.frontmatter.model || '',
      subtask: parsed.frontmatter.subtask || '',
      body: parsed.gemini?.body ?? parsed.body,
      parseError: parsed.gemini?.parseError || '',
      fullContent: content,
      updatedAt: fs.statSync(fullPath).mtime.getTime()
    };
  }

  /**
   * 创建命令
   */
  createCommand({ name, scope, projectPath, namespace, description, allowedTools, argumentHint, agent, model, subtask, body }) {
    const safeName = normalizeCommandName(name);
    const safeNamespace = normalizeCommandNamespace(namespace);
    const baseDir = this._getBaseDir(scope, projectPath);
    const { fullPath: filePath } = this._resolveCommandPath(baseDir, safeName, safeNamespace);
    const targetDir = path.dirname(filePath);
    ensureDir(targetDir);

    // 检查是否已存在
    if (fs.existsSync(filePath)) {
      throw new Error(`命令 "${safeName}" 已存在`);
    }

    const content = this._generateCommandContent({ description, allowedTools, argumentHint, agent, model, subtask, body });

    fs.writeFileSync(filePath, content, 'utf-8');

    return this.getCommand(safeName, scope, projectPath, safeNamespace);
  }

  /**
   * 更新命令
   */
  updateCommand({ name, scope, projectPath, namespace, description, allowedTools, argumentHint, agent, model, subtask, body }) {
    const safeName = normalizeCommandName(name);
    const safeNamespace = normalizeCommandNamespace(namespace);
    const baseDir = this._getBaseDir(scope, projectPath);
    const { fullPath: filePath } = this._resolveCommandPath(baseDir, safeName, safeNamespace);

    if (!fs.existsSync(filePath)) {
      throw new Error(`命令 "${safeName}" 不存在`);
    }

    const content = this._generateCommandContent({ description, allowedTools, argumentHint, agent, model, subtask, body });

    fs.writeFileSync(filePath, content, 'utf-8');

    return this.getCommand(safeName, scope, projectPath, safeNamespace);
  }

  /**
   * 删除命令
   */
  deleteCommand(name, scope, projectPath = null, namespace = null) {
    const safeName = normalizeCommandName(name);
    const safeNamespace = normalizeCommandNamespace(namespace);
    const baseDir = this._getBaseDir(scope, projectPath);
    const { fullPath: filePath } = this._resolveCommandPath(baseDir, safeName, safeNamespace);

    if (!fs.existsSync(filePath)) {
      return { success: false, message: '命令不存在' };
    }

    fs.unlinkSync(filePath);

    // 如果目录为空，删除目录
    if (safeNamespace) {
      const namespaceDir = resolveInsideRoot(baseDir, safeNamespace, 'Command namespace');
      try {
        const remaining = fs.readdirSync(namespaceDir);
        if (remaining.length === 0) {
          fs.rmdirSync(namespaceDir);
        }
      } catch (err) {
        // 忽略删除目录错误
      }
    }

    return { success: true, message: '命令已删除' };
  }

  /**
   * 获取统计信息
   */
  getStats(projectPath = null) {
    const { commands, userCount, projectCount } = this.listCommands(projectPath);

    // 按命名空间分组
    const namespaces = {};
    for (const cmd of commands) {
      const ns = cmd.namespace || '(root)';
      if (!namespaces[ns]) {
        namespaces[ns] = 0;
      }
      namespaces[ns]++;
    }

    return {
      total: commands.length,
      userCount,
      projectCount,
      namespaces
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
   * 从远程仓库安装命令
   */
  async installFromRemote(command) {
    return this.repoScanner.installCommand(command);
  }

  /**
   * 卸载命令
   */
  uninstallCommand(relativePath) {
    return this.repoScanner.uninstall(relativePath);
  }

  // ==================== 格式转换 ====================

}

module.exports = {
  CommandsService,
  DEFAULT_REPOS
};
