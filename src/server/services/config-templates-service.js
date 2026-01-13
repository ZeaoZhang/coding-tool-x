/**
 * 配置模板服务
 *
 * 管理工作区/项目的配置模板组合
 * 支持 CLAUDE.md, skills, rules, commands, agents, MCP 等的预设组合
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { PATHS } = require('../../config/paths');
const { AgentsService } = require('./agents-service');
const { CommandsService } = require('./commands-service');
const { RulesService } = require('./rules-service');
const { SkillService } = require('./skill-service');
const mcpService = require('./mcp-service');
const skillService = new SkillService();

// 配置模板文件路径
const TEMPLATES_FILE = path.join(PATHS.config, 'config-templates.json');

// 内置配置模板
const BUILTIN_TEMPLATES = [
  {
    id: 'default',
    name: '默认配置',
    description: '标准的开发环境配置',
    claudeMd: {
      enabled: true,
      content: `# 项目配置

这是一个标准的开发项目。

## 代码规范
- 保持代码简洁
- 遵循项目现有风格
- 添加必要的注释
`
    },
    skills: [],
    rules: [],
    commands: [],
    agents: [],
    mcpServers: [],
    isBuiltin: true
  },
  {
    id: 'full-stack',
    name: '全栈开发',
    description: '前后端全栈开发配置，包含常用的开发工具和规则',
    claudeMd: {
      enabled: true,
      content: `# 全栈开发项目

你是一个经验丰富的全栈开发工程师。

## 技术栈关注
- **前端**: React/Vue, TypeScript, 组件化开发
- **后端**: Node.js/Python, RESTful API, 数据库设计
- **DevOps**: Git, CI/CD, Docker

## 开发原则
- KISS: Keep It Simple, Stupid
- DRY: Don't Repeat Yourself
- YAGNI: You Aren't Gonna Need It
- 安全优先：防止 XSS、SQL 注入等常见漏洞

## 代码风格
- 使用 TypeScript 时启用严格模式
- 函数保持单一职责
- 添加适当的错误处理
`
    },
    skills: [],
    rules: [],
    commands: [],
    agents: [],
    mcpServers: ['github', 'fetch'],
    isBuiltin: true
  },
  {
    id: 'data-science',
    name: '数据科学',
    description: '数据分析和机器学习项目配置',
    claudeMd: {
      enabled: true,
      content: `# 数据科学项目

你是一个数据科学专家，擅长数据分析和机器学习。

## 工作流程
1. **数据探索**: 理解数据结构、分布、缺失值
2. **数据清洗**: 处理异常值、填充缺失、特征工程
3. **建模**: 选择合适的算法，调优参数
4. **评估**: 使用适当的指标评估模型性能
5. **可视化**: 清晰展示分析结果

## 常用库
- pandas, numpy: 数据处理
- scikit-learn: 机器学习
- matplotlib, seaborn: 可视化
- jupyter: 交互式开发

## 最佳实践
- 始终验证数据质量
- 避免数据泄露
- 记录实验过程和参数
- 可复现的分析流程
`
    },
    skills: [],
    rules: [],
    commands: [],
    agents: [],
    mcpServers: ['fetch'],
    isBuiltin: true
  },
  {
    id: 'code-review',
    name: '代码审查',
    description: '专注于代码审查和质量改进',
    claudeMd: {
      enabled: true,
      content: `# 代码审查专家

你是一个专业的代码审查专家。

## 审查维度
- **可读性**: 命名、注释、代码组织
- **性能**: 算法复杂度、资源使用
- **安全**: 常见漏洞、输入验证
- **可维护性**: 模块化、耦合度
- **测试**: 测试覆盖、边界情况

## 审查流程
1. 理解代码意图和上下文
2. 检查代码逻辑和实现
3. 识别潜在问题
4. 提供具体改进建议
5. 给出示例代码（如需要）
`
    },
    skills: [],
    rules: [],
    commands: [],
    agents: [],
    mcpServers: ['github'],
    isBuiltin: true
  },
  {
    id: 'minimal',
    name: '最小配置',
    description: '不使用任何额外配置的纯净环境',
    claudeMd: {
      enabled: false,
      content: ''
    },
    skills: [],
    rules: [],
    commands: [],
    agents: [],
    mcpServers: [],
    isBuiltin: true
  }
];

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 加载配置模板
 */
function loadTemplates() {
  try {
    if (fs.existsSync(TEMPLATES_FILE)) {
      const content = fs.readFileSync(TEMPLATES_FILE, 'utf8');
      const data = JSON.parse(content);
      // 合并内置模板和用户模板
      return {
        builtin: BUILTIN_TEMPLATES,
        custom: data.custom || []
      };
    }
  } catch (error) {
    console.error('加载配置模板失败:', error.message);
  }

  return {
    builtin: BUILTIN_TEMPLATES,
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
 * 获取所有模板（内置+自定义）
 */
function getAllTemplates() {
  const { builtin, custom } = loadTemplates();
  return [...builtin, ...custom];
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
  const { builtin, custom } = loadTemplates();

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
    claudeMd: template.claudeMd || { enabled: false, content: '' },
    skills: template.skills || [],
    rules: template.rules || [],
    commands: template.commands || [],
    agents: template.agents || [],
    mcpServers: template.mcpServers || [],
    isBuiltin: false,
    createdAt: new Date().toISOString()
  };

  custom.push(newTemplate);
  saveCustomTemplates(custom);

  return newTemplate;
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
    id: custom[index].id, // 保持 ID 不变
    isBuiltin: false,
    updatedAt: new Date().toISOString()
  };

  saveCustomTemplates(custom);
  return custom[index];
}

/**
 * 删除自定义模板
 */
function deleteCustomTemplate(id) {
  const { custom } = loadTemplates();
  const filtered = custom.filter(t => t.id !== id);

  if (filtered.length === custom.length) {
    throw new Error('模板不存在或不可删除');
  }

  saveCustomTemplates(filtered);
  return true;
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
    rules: 0,
    commands: 0,
    agents: 0,
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
    rules: template.rules,
    commands: template.commands,
    agents: template.agents,
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
 * 返回用户级的 agents, commands, rules + MCP 服务器列表
 */
function getAvailableConfigs() {
  const agentsService = new AgentsService();
  const commandsService = new CommandsService();
  const rulesService = new RulesService();

  // 只获取用户级配置
  const { agents } = agentsService.listAgents();
  const { commands } = commandsService.listCommands();
  const { rules } = rulesService.listRules();
  const installedSkills = skillService.getInstalledSkills();

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

  return {
    skills: installedSkills.map(skill => ({
      directory: skill.directory,
      name: skill.name || skill.directory,
      description: skill.description || '',
      repoOwner: skill.repoOwner || null,
      repoName: skill.repoName || null,
      repoBranch: skill.repoBranch || null
    })),
    agents: agents.filter(a => a.scope === 'user').map(a => ({
      fileName: a.fileName,
      name: a.name,
      description: a.description,
      tools: a.tools,
      model: a.model,
      permissionMode: a.permissionMode,
      skills: a.skills,
      systemPrompt: a.systemPrompt
    })),
    commands: commands.filter(c => c.scope === 'user').map(c => ({
      name: c.name,
      namespace: c.namespace,
      description: c.description,
      allowedTools: c.allowedTools,
      argumentHint: c.argumentHint,
      body: c.body
    })),
    rules: rules.filter(r => r.scope === 'user').map(r => ({
      fileName: r.fileName,
      directory: r.directory,
      paths: r.paths,
      body: r.body
    })),
    mcpServers: mcpServerList,
    mcpPresets
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

/**
 * 生成 Rule 文件内容
 */
function generateRuleContent(rule) {
  let content = '';
  if (rule.paths) {
    content = `---\npaths: ${rule.paths}\n---\n\n`;
  }
  return content + (rule.body || '');
}

/**
 * 应用模板到项目目录（完整应用，写入实际文件）
 * @param {string} targetDir - 目标项目目录
 * @param {string} templateId - 模板 ID
 */
function applyTemplateToProject(targetDir, templateId) {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error('模板不存在');
  }

  ensureDir(targetDir);

  const results = {
    claudeMd: { applied: false, path: null },
    skills: { applied: template.skills?.length || 0, items: template.skills?.map(s => s.directory || s.name) || [] },
    agents: { applied: 0, files: [] },
    commands: { applied: 0, files: [] },
    rules: { applied: 0, files: [] },
    mcpServers: { applied: 0 }
  };

  // 1. 写入 CLAUDE.md
  if (template.claudeMd?.enabled && template.claudeMd?.content) {
    const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, template.claudeMd.content, 'utf-8');
    results.claudeMd = { applied: true, path: 'CLAUDE.md' };
  }

  // 2. 写入 Agents
  if (template.agents?.length > 0) {
    const agentsDir = path.join(targetDir, '.claude', 'agents');
    ensureDir(agentsDir);
    for (const agent of template.agents) {
      const content = generateAgentContent(agent);
      const fileName = agent.fileName || agent.name.toLowerCase().replace(/\s+/g, '-');
      const filePath = path.join(agentsDir, `${fileName}.md`);
      fs.writeFileSync(filePath, content, 'utf-8');
      results.agents.files.push(`.claude/agents/${fileName}.md`);
      results.agents.applied++;
    }
  }

  // 3. 写入 Commands
  if (template.commands?.length > 0) {
    const commandsDir = path.join(targetDir, '.claude', 'commands');
    ensureDir(commandsDir);
    for (const command of template.commands) {
      const content = generateCommandContent(command);
      const targetCmdDir = command.namespace
        ? path.join(commandsDir, command.namespace)
        : commandsDir;
      ensureDir(targetCmdDir);
      const filePath = path.join(targetCmdDir, `${command.name}.md`);
      fs.writeFileSync(filePath, content, 'utf-8');
      const relativePath = command.namespace
        ? `.claude/commands/${command.namespace}/${command.name}.md`
        : `.claude/commands/${command.name}.md`;
      results.commands.files.push(relativePath);
      results.commands.applied++;
    }
  }

  // 4. 写入 Rules
  if (template.rules?.length > 0) {
    const rulesDir = path.join(targetDir, '.claude', 'rules');
    ensureDir(rulesDir);
    for (const rule of template.rules) {
      const content = generateRuleContent(rule);
      const targetRuleDir = rule.directory
        ? path.join(rulesDir, rule.directory)
        : rulesDir;
      ensureDir(targetRuleDir);
      const filePath = path.join(targetRuleDir, `${rule.fileName}.md`);
      fs.writeFileSync(filePath, content, 'utf-8');
      const relativePath = rule.directory
        ? `.claude/rules/${rule.directory}/${rule.fileName}.md`
        : `.claude/rules/${rule.fileName}.md`;
      results.rules.files.push(relativePath);
      results.rules.applied++;
    }
  }

  // 5. 写入 MCP 配置到 .mcp.json
  if (template.mcpServers?.length > 0) {
    const mcpConfig = { mcpServers: {} };
    const allServers = mcpService.getAllServers();
    const presets = mcpService.getPresets();

    for (const serverId of template.mcpServers) {
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
        mcpConfig.mcpServers[serverId] = serverSpec;
        results.mcpServers.applied++;
      }
    }

    if (Object.keys(mcpConfig.mcpServers).length > 0) {
      const mcpPath = path.join(targetDir, '.mcp.json');
      fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
    }
  }

  // 6. 创建配置记录文件
  const configRecord = {
    templateId: template.id,
    templateName: template.name,
    appliedAt: new Date().toISOString(),
    skills: template.skills?.map(s => s.directory || s.name) || [],
    agents: template.agents?.map(a => a.fileName || a.name) || [],
    commands: template.commands?.map(c => c.name) || [],
    rules: template.rules?.map(r => r.fileName) || [],
    mcpServers: template.mcpServers || []
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
 */
function previewTemplateApplication(targetDir, templateId) {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error('模板不存在');
  }

  const preview = {
    willCreate: [],
    willOverwrite: [],
    summary: {
      claudeMd: false,
      skills: 0,
      agents: 0,
      commands: 0,
      rules: 0,
      mcpServers: 0
    }
  };

  // 检查 CLAUDE.md
  if (template.claudeMd?.enabled && template.claudeMd?.content) {
    const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) {
      preview.willOverwrite.push('CLAUDE.md');
    } else {
      preview.willCreate.push('CLAUDE.md');
    }
    preview.summary.claudeMd = true;
  }

  // Skills 摘要
  if (template.skills?.length > 0) {
    preview.summary.skills = template.skills.length;
  }

  // 检查 Agents
  if (template.agents?.length > 0) {
    for (const agent of template.agents) {
      const fileName = agent.fileName || agent.name.toLowerCase().replace(/\s+/g, '-');
      const relativePath = `.claude/agents/${fileName}.md`;
      const fullPath = path.join(targetDir, relativePath);
      if (fs.existsSync(fullPath)) {
        preview.willOverwrite.push(relativePath);
      } else {
        preview.willCreate.push(relativePath);
      }
      preview.summary.agents++;
    }
  }

  // 检查 Commands
  if (template.commands?.length > 0) {
    for (const command of template.commands) {
      const relativePath = command.namespace
        ? `.claude/commands/${command.namespace}/${command.name}.md`
        : `.claude/commands/${command.name}.md`;
      const fullPath = path.join(targetDir, relativePath);
      if (fs.existsSync(fullPath)) {
        preview.willOverwrite.push(relativePath);
      } else {
        preview.willCreate.push(relativePath);
      }
      preview.summary.commands++;
    }
  }

  // 检查 Rules
  if (template.rules?.length > 0) {
    for (const rule of template.rules) {
      const relativePath = rule.directory
        ? `.claude/rules/${rule.directory}/${rule.fileName}.md`
        : `.claude/rules/${rule.fileName}.md`;
      const fullPath = path.join(targetDir, relativePath);
      if (fs.existsSync(fullPath)) {
        preview.willOverwrite.push(relativePath);
      } else {
        preview.willCreate.push(relativePath);
      }
      preview.summary.rules++;
    }
  }

  // 检查 MCP
  if (template.mcpServers?.length > 0) {
    const mcpPath = path.join(targetDir, '.mcp.json');
    if (fs.existsSync(mcpPath)) {
      preview.willOverwrite.push('.mcp.json');
    } else {
      preview.willCreate.push('.mcp.json');
    }
    preview.summary.mcpServers = template.mcpServers.length;
  }

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
  BUILTIN_TEMPLATES
};
