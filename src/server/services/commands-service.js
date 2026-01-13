/**
 * Commands 服务
 *
 * 管理 Claude Code 自定义命令的 CRUD 操作
 * 命令目录:
 * - 用户级: ~/.claude/commands/
 * - 项目级: .claude/commands/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 命令目录路径
const USER_COMMANDS_DIR = path.join(os.homedir(), '.claude', 'commands');

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
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
function generateFrontmatter(data) {
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
 * Commands 服务类
 */
class CommandsService {
  constructor() {
    this.userCommandsDir = USER_COMMANDS_DIR;
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
      content = generateFrontmatter(frontmatterData) + '\n\n';
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
      content = generateFrontmatter(frontmatterData) + '\n\n';
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
}

module.exports = {
  CommandsService
};
