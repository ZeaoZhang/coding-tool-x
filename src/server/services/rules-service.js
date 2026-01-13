/**
 * Rules 服务
 *
 * 管理 Claude Code 规则文件的 CRUD 操作
 * 规则目录:
 * - 用户级: ~/.claude/rules/
 * - 项目级: .claude/rules/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 规则目录路径
const USER_RULES_DIR = path.join(os.homedir(), '.claude', 'rules');

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

  if (data.paths) {
    lines.push(`paths: ${data.paths}`);
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * 递归扫描目录获取规则文件
 */
function scanRulesDir(dir, basePath, scope) {
  const rules = [];

  if (!fs.existsSync(dir)) {
    return rules;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        // 递归扫描子目录
        const subRules = scanRulesDir(fullPath, basePath, scope);
        rules.push(...subRules);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // 解析规则文件
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(content);

          // 计算相对路径
          const relativePath = path.relative(basePath, fullPath);
          const fileName = entry.name.replace(/\.md$/, '');
          const directory = path.dirname(relativePath);

          rules.push({
            name: fileName,
            fileName,
            directory: directory === '.' ? null : directory,
            scope,
            path: relativePath,
            fullPath,
            paths: frontmatter.paths || '', // 条件规则的路径模式
            body,
            fullContent: content,
            updatedAt: fs.statSync(fullPath).mtime.getTime()
          });
        } catch (err) {
          console.warn(`[RulesService] Failed to parse ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error(`[RulesService] Failed to scan ${dir}:`, err.message);
  }

  return rules;
}

/**
 * Rules 服务类
 */
class RulesService {
  constructor() {
    this.userRulesDir = USER_RULES_DIR;
    ensureDir(this.userRulesDir);
  }

  /**
   * 获取所有规则列表
   * @param {string} projectPath - 项目路径（可选，用于获取项目级规则）
   */
  listRules(projectPath = null) {
    const rules = [];

    // 获取用户级规则
    const userRules = scanRulesDir(this.userRulesDir, this.userRulesDir, 'user');
    rules.push(...userRules);

    // 获取项目级规则（如果提供了项目路径）
    if (projectPath) {
      const projectRulesDir = path.join(projectPath, '.claude', 'rules');
      const projectRules = scanRulesDir(projectRulesDir, projectRulesDir, 'project');
      rules.push(...projectRules);
    }

    // 按路径排序
    rules.sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));

    return {
      rules,
      total: rules.length,
      userCount: userRules.length,
      projectCount: rules.length - userRules.length
    };
  }

  /**
   * 获取单个规则详情
   */
  getRule(relativePath, scope, projectPath = null) {
    const baseDir = scope === 'user'
      ? this.userRulesDir
      : path.join(projectPath, '.claude', 'rules');

    // 确保路径以 .md 结尾
    const filePath = relativePath.endsWith('.md')
      ? path.join(baseDir, relativePath)
      : path.join(baseDir, `${relativePath}.md`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);

    const actualRelativePath = path.relative(baseDir, filePath);
    const fileName = path.basename(filePath, '.md');
    const directory = path.dirname(actualRelativePath);

    return {
      name: fileName,
      fileName,
      directory: directory === '.' ? null : directory,
      scope,
      path: actualRelativePath,
      fullPath: filePath,
      paths: frontmatter.paths || '',
      body,
      fullContent: content,
      updatedAt: fs.statSync(filePath).mtime.getTime()
    };
  }

  /**
   * 创建规则
   */
  createRule({ fileName, scope, projectPath, directory, paths, body }) {
    if (!fileName || !fileName.trim()) {
      throw new Error('规则文件名不能为空');
    }

    // 验证文件名：只允许字母、数字、横杠、下划线
    if (!/^[a-zA-Z0-9_-]+$/.test(fileName)) {
      throw new Error('规则文件名只能包含字母、数字、横杠和下划线');
    }

    const baseDir = scope === 'user'
      ? this.userRulesDir
      : path.join(projectPath, '.claude', 'rules');

    const targetDir = directory ? path.join(baseDir, directory) : baseDir;
    ensureDir(targetDir);

    const filePath = path.join(targetDir, `${fileName}.md`);

    // 检查是否已存在
    if (fs.existsSync(filePath)) {
      throw new Error(`规则 "${fileName}" 已存在`);
    }

    // 生成文件内容
    let content = '';
    if (paths) {
      content = generateFrontmatter({ paths }) + '\n\n';
    }
    content += body || '';

    fs.writeFileSync(filePath, content, 'utf-8');

    const relativePath = directory
      ? path.join(directory, `${fileName}.md`)
      : `${fileName}.md`;

    return this.getRule(relativePath, scope, projectPath);
  }

  /**
   * 更新规则
   */
  updateRule({ relativePath, scope, projectPath, paths, body }) {
    const baseDir = scope === 'user'
      ? this.userRulesDir
      : path.join(projectPath, '.claude', 'rules');

    const filePath = path.join(baseDir, relativePath);

    if (!fs.existsSync(filePath)) {
      throw new Error(`规则 "${relativePath}" 不存在`);
    }

    // 生成文件内容
    let content = '';
    if (paths) {
      content = generateFrontmatter({ paths }) + '\n\n';
    }
    content += body || '';

    fs.writeFileSync(filePath, content, 'utf-8');

    return this.getRule(relativePath, scope, projectPath);
  }

  /**
   * 删除规则
   */
  deleteRule(relativePath, scope, projectPath = null) {
    const baseDir = scope === 'user'
      ? this.userRulesDir
      : path.join(projectPath, '.claude', 'rules');

    const filePath = path.join(baseDir, relativePath);

    if (!fs.existsSync(filePath)) {
      return { success: false, message: '规则不存在' };
    }

    fs.unlinkSync(filePath);

    // 如果目录为空，删除目录
    const directory = path.dirname(relativePath);
    if (directory && directory !== '.') {
      const dirPath = path.join(baseDir, directory);
      try {
        const remaining = fs.readdirSync(dirPath);
        if (remaining.length === 0) {
          fs.rmdirSync(dirPath);
        }
      } catch (err) {
        // 忽略删除目录错误
      }
    }

    return { success: true, message: '规则已删除' };
  }

  /**
   * 获取目录结构（树形）
   */
  getDirectoryTree(projectPath = null) {
    const tree = {
      user: this.buildTree(this.userRulesDir),
      project: null
    };

    if (projectPath) {
      const projectRulesDir = path.join(projectPath, '.claude', 'rules');
      tree.project = this.buildTree(projectRulesDir);
    }

    return tree;
  }

  /**
   * 构建目录树
   */
  buildTree(dir) {
    if (!fs.existsSync(dir)) {
      return { directories: [], files: [] };
    }

    const result = {
      directories: [],
      files: []
    };

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          result.directories.push({
            name: entry.name,
            children: this.buildTree(path.join(dir, entry.name))
          });
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          result.files.push(entry.name.replace(/\.md$/, ''));
        }
      }
    } catch (err) {
      console.error(`[RulesService] Failed to build tree for ${dir}:`, err.message);
    }

    return result;
  }

  /**
   * 获取统计信息
   */
  getStats(projectPath = null) {
    const { rules, userCount, projectCount } = this.listRules(projectPath);

    // 按目录分组
    const directories = {};
    let conditionalCount = 0;

    for (const rule of rules) {
      const dir = rule.directory || '(root)';
      if (!directories[dir]) {
        directories[dir] = 0;
      }
      directories[dir]++;

      if (rule.paths) {
        conditionalCount++;
      }
    }

    return {
      total: rules.length,
      userCount,
      projectCount,
      conditionalCount,
      directories
    };
  }
}

module.exports = {
  RulesService
};
