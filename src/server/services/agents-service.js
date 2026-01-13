/**
 * Agents 服务
 *
 * 管理 Claude Code 自定义代理的 CRUD 操作
 * 代理目录:
 * - 用户级: ~/.claude/agents/
 * - 项目级: .claude/agents/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 代理目录路径
const USER_AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');

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

  // 必需字段
  if (data.name) {
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
 * 递归扫描目录获取代理文件
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

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        // 递归扫描子目录
        const subAgents = scanAgentsDir(fullPath, basePath, scope);
        agents.push(...subAgents);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
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
 * Agents 服务类
 */
class AgentsService {
  constructor() {
    this.userAgentsDir = USER_AGENTS_DIR;
    ensureDir(this.userAgentsDir);
  }

  /**
   * 获取所有代理列表
   * @param {string} projectPath - 项目路径（可选，用于获取项目级代理）
   */
  listAgents(projectPath = null) {
    const agents = [];

    // 获取用户级代理
    const userAgents = scanAgentsDir(this.userAgentsDir, this.userAgentsDir, 'user');
    agents.push(...userAgents);

    // 获取项目级代理（如果提供了项目路径）
    if (projectPath) {
      const projectAgentsDir = path.join(projectPath, '.claude', 'agents');
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
   * 获取单个代理详情
   */
  getAgent(fileName, scope, projectPath = null) {
    const baseDir = scope === 'user'
      ? this.userAgentsDir
      : path.join(projectPath, '.claude', 'agents');

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
  createAgent({ fileName, scope, projectPath, name, description, tools, model, permissionMode, skills, systemPrompt }) {
    if (!fileName || !fileName.trim()) {
      throw new Error('代理文件名不能为空');
    }

    // 验证文件名：只允许字母、数字、横杠、下划线
    if (!/^[a-zA-Z0-9_-]+$/.test(fileName)) {
      throw new Error('代理文件名只能包含字母、数字、横杠和下划线');
    }

    if (!name || !name.trim()) {
      throw new Error('代理名称不能为空');
    }

    if (!description || !description.trim()) {
      throw new Error('代理描述不能为空');
    }

    const baseDir = scope === 'user'
      ? this.userAgentsDir
      : path.join(projectPath, '.claude', 'agents');

    ensureDir(baseDir);

    const filePath = path.join(baseDir, `${fileName}.md`);

    // 检查是否已存在
    if (fs.existsSync(filePath)) {
      throw new Error(`代理 "${fileName}" 已存在`);
    }

    // 生成文件内容
    const frontmatterData = { name, description };
    if (tools) frontmatterData.tools = tools;
    if (model) frontmatterData.model = model;
    if (permissionMode) frontmatterData.permissionMode = permissionMode;
    if (skills) frontmatterData.skills = skills;

    const content = generateFrontmatter(frontmatterData) + '\n\n' + (systemPrompt || '');

    fs.writeFileSync(filePath, content, 'utf-8');

    return this.getAgent(fileName, scope, projectPath);
  }

  /**
   * 更新代理
   */
  updateAgent({ fileName, scope, projectPath, name, description, tools, model, permissionMode, skills, systemPrompt }) {
    const baseDir = scope === 'user'
      ? this.userAgentsDir
      : path.join(projectPath, '.claude', 'agents');

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

    const content = generateFrontmatter(frontmatterData) + '\n\n' + (systemPrompt || '');

    fs.writeFileSync(filePath, content, 'utf-8');

    return this.getAgent(fileName, scope, projectPath);
  }

  /**
   * 删除代理
   */
  deleteAgent(fileName, scope, projectPath = null) {
    const baseDir = scope === 'user'
      ? this.userAgentsDir
      : path.join(projectPath, '.claude', 'agents');

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
}

module.exports = {
  AgentsService
};
