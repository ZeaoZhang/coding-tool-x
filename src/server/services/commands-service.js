/**
 * Commands 服务
 *
 * 管理 Claude Code 自定义命令的 CRUD 操作
 * 命令目录:
 * - 用户级: ~/.claude/commands/
 * - 项目级: .claude/commands/
 *
 * 支持从 GitHub 仓库扫描和安装命令
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { RepoScannerBase } = require('./repo-scanner-base');
const {
  parseCommandContent,
  detectCommandFormat,
  convertCommandToCodex,
  convertCommandToClaude,
  parseFrontmatter
} = require('./format-converter');

// 命令目录路径
const USER_COMMANDS_DIR = path.join(os.homedir(), '.claude', 'commands');

// 默认仓库源
const DEFAULT_REPOS = [];

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

  lines.push('---');
  return lines.join('\n');
}

/**
 * 递归扫描目录获取命令文件
 */
function scanCommandsDir(dir, basePath, scope) {
  const commands = [];

  if (!fs.existsSync(dir)) {
    return commands;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        // 递归扫描子目录
        const subCommands = scanCommandsDir(fullPath, basePath, scope);
        commands.push(...subCommands);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // 解析命令文件
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(content);

          // 计算相对路径和命令名
          const relativePath = path.relative(basePath, fullPath);
          const commandName = entry.name.replace(/\.md$/, '');
          const namespace = path.dirname(relativePath);

          commands.push({
            name: commandName,
            namespace: namespace === '.' ? null : namespace,
            scope,
            path: relativePath,
            fullPath,
            description: frontmatter.description || '',
            allowedTools: frontmatter['allowed-tools'] || '',
            argumentHint: frontmatter['argument-hint'] || '',
            body,
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
  constructor() {
    super({
      type: 'commands',
      installDir: USER_COMMANDS_DIR,
      markerFile: null, // 直接扫描 .md 文件
      fileExtension: '.md',
      defaultRepos: DEFAULT_REPOS
    });
  }

  /**
   * 获取并解析单个命令文件
   */
  async fetchAndParseItem(file, repo, baseDir) {
    try {
      // 计算相对路径
      const relativePath = baseDir ? file.path.slice(baseDir.length + 1) : file.path;
      const fileName = path.basename(file.path, '.md');
      const namespace = path.dirname(relativePath);

      // 获取文件内容
      const content = await this.fetchRawContent(repo, file.path);
      const { frontmatter, body } = this.parseFrontmatter(content);

      return {
        key: `${repo.owner}/${repo.name}:${relativePath}`,
        name: fileName,
        namespace: namespace === '.' ? null : namespace,
        scope: 'remote',
        path: relativePath,
        repoPath: file.path,
        description: frontmatter.description || '',
        allowedTools: frontmatter['allowed-tools'] || '',
        argumentHint: frontmatter['argument-hint'] || '',
        body,
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
    const fullPath = path.join(this.installDir, relativePath);
    return fs.existsSync(fullPath);
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
  constructor() {
    this.userCommandsDir = USER_COMMANDS_DIR;
    this.repoScanner = new CommandsRepoScanner();
    ensureDir(this.userCommandsDir);
  }

  /**
   * 获取所有命令列表
   * @param {string} projectPath - 项目路径（可选，用于获取项目级命令）
   */
  listCommands(projectPath = null) {
    const commands = [];

    // 获取用户级命令
    const userCommands = scanCommandsDir(this.userCommandsDir, this.userCommandsDir, 'user');
    commands.push(...userCommands);

    // 获取项目级命令（如果提供了项目路径）
    if (projectPath) {
      const projectCommandsDir = path.join(projectPath, '.claude', 'commands');
      const projectCommands = scanCommandsDir(projectCommandsDir, projectCommandsDir, 'project');
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
    const baseDir = scope === 'user'
      ? this.userCommandsDir
      : path.join(projectPath, '.claude', 'commands');

    const relativePath = namespace
      ? path.join(namespace, `${name}.md`)
      : `${name}.md`;

    const fullPath = path.join(baseDir, relativePath);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);

    return {
      name,
      namespace,
      scope,
      path: relativePath,
      fullPath,
      description: frontmatter.description || '',
      allowedTools: frontmatter['allowed-tools'] || '',
      argumentHint: frontmatter['argument-hint'] || '',
      body,
      fullContent: content,
      updatedAt: fs.statSync(fullPath).mtime.getTime()
    };
  }

  /**
   * 创建命令
   */
  createCommand({ name, scope, projectPath, namespace, description, allowedTools, argumentHint, body }) {
    if (!name || !name.trim()) {
      throw new Error('命令名称不能为空');
    }

    // 验证命令名：只允许字母、数字、横杠、下划线
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error('命令名只能包含字母、数字、横杠和下划线');
    }

    const baseDir = scope === 'user'
      ? this.userCommandsDir
      : path.join(projectPath, '.claude', 'commands');

    const targetDir = namespace ? path.join(baseDir, namespace) : baseDir;
    ensureDir(targetDir);

    const filePath = path.join(targetDir, `${name}.md`);

    // 检查是否已存在
    if (fs.existsSync(filePath)) {
      throw new Error(`命令 "${name}" 已存在`);
    }

    // 生成文件内容
    const frontmatterData = {};
    if (description) frontmatterData.description = description;
    if (allowedTools) frontmatterData['allowed-tools'] = allowedTools;
    if (argumentHint) frontmatterData['argument-hint'] = argumentHint;

    let content = '';
    if (Object.keys(frontmatterData).length > 0) {
      content = generateCommandFrontmatter(frontmatterData) + '\n\n';
    }
    content += body || '';

    fs.writeFileSync(filePath, content, 'utf-8');

    return this.getCommand(name, scope, projectPath, namespace);
  }

  /**
   * 更新命令
   */
  updateCommand({ name, scope, projectPath, namespace, description, allowedTools, argumentHint, body }) {
    const baseDir = scope === 'user'
      ? this.userCommandsDir
      : path.join(projectPath, '.claude', 'commands');

    const relativePath = namespace
      ? path.join(namespace, `${name}.md`)
      : `${name}.md`;

    const filePath = path.join(baseDir, relativePath);

    if (!fs.existsSync(filePath)) {
      throw new Error(`命令 "${name}" 不存在`);
    }

    // 生成文件内容
    const frontmatterData = {};
    if (description) frontmatterData.description = description;
    if (allowedTools) frontmatterData['allowed-tools'] = allowedTools;
    if (argumentHint) frontmatterData['argument-hint'] = argumentHint;

    let content = '';
    if (Object.keys(frontmatterData).length > 0) {
      content = generateCommandFrontmatter(frontmatterData) + '\n\n';
    }
    content += body || '';

    fs.writeFileSync(filePath, content, 'utf-8');

    return this.getCommand(name, scope, projectPath, namespace);
  }

  /**
   * 删除命令
   */
  deleteCommand(name, scope, projectPath = null, namespace = null) {
    const baseDir = scope === 'user'
      ? this.userCommandsDir
      : path.join(projectPath, '.claude', 'commands');

    const relativePath = namespace
      ? path.join(namespace, `${name}.md`)
      : `${name}.md`;

    const filePath = path.join(baseDir, relativePath);

    if (!fs.existsSync(filePath)) {
      return { success: false, message: '命令不存在' };
    }

    fs.unlinkSync(filePath);

    // 如果目录为空，删除目录
    if (namespace) {
      const namespaceDir = path.join(baseDir, namespace);
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

  /**
   * 转换命令格式
   * @param {string} content - 命令内容
   * @param {string} targetFormat - 目标格式 ('claude' | 'codex')
   */
  convertCommandFormat(content, targetFormat) {
    const sourceFormat = detectCommandFormat(content);

    if (sourceFormat === targetFormat) {
      return { content, warnings: [], format: targetFormat };
    }

    if (targetFormat === 'codex') {
      return convertCommandToCodex(content);
    } else {
      return convertCommandToClaude(content);
    }
  }

  /**
   * 检测命令格式
   * @param {string} content - 命令内容
   */
  detectFormat(content) {
    return detectCommandFormat(content);
  }
}

module.exports = {
  CommandsService,
  DEFAULT_REPOS
};
