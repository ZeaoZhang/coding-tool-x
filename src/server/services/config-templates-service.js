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
// aiConfigs 结构: { claude: { enabled, content }, codex: { enabled, content }, gemini: { enabled, content } }
const BUILTIN_TEMPLATES = [
  {
    id: 'full-stack',
    name: '全栈开发',
    description: '前后端全栈开发配置，包含代码编辑、文档查询、版本控制等常用工具',
    // 兼容旧字段
    claudeMd: { enabled: false, content: '' },
    // 新的多 AI 配置
    aiConfigs: {
      claude: {
        enabled: true,
        content: `# 全栈开发项目配置

你是一位经验丰富的全栈开发工程师，专注于高质量代码交付。

## 核心原则

- **KISS**: 保持简单，避免过度设计
- **YAGNI**: 只实现当前需求，不做假设性扩展
- **向后兼容**: 修改 API 或数据结构时确保兼容性
- **安全优先**: 防范 XSS、SQL 注入、CSRF 等常见漏洞

## 代码规范

- 遵循项目既有风格和模式
- 函数保持单一职责，控制在 50 行以内
- 变量命名清晰准确，避免缩写
- 只在必要时添加注释，代码应自解释

## MCP 工具使用规范

### Serena（代码编辑 - 首选）
- **适用场景**: 所有代码修改、符号重命名、跨文件重构
- **使用方式**: 先用 \`find_symbol\` 定位，再用 \`replace_symbol_body\` 或 \`insert_*\` 修改
- **注意**: 优先符号级精确编辑，避免大段盲改

### Context7（文档查询 - 首选）
- **适用场景**: 查询框架/库的官方文档、API 用法、配置说明
- **使用方式**: 先 \`resolve-library-id\`，再 \`get-library-docs\`
- **注意**: 用明确的 topic 关键词收敛查询范围

### GitHub MCP
- **适用场景**: PR 操作、Issue 管理、代码搜索、仓库信息查询
- **使用方式**: 直接调用对应的 GitHub API
- **注意**: 不要用于本地文件操作

### Fetch MCP
- **适用场景**: 抓取网页内容、博客、技术文档
- **使用方式**: 控制 \`max_length\`，必要时用 \`start_index\` 分段
- **注意**: 只抓取必要内容，避免敏感信息

### Memory MCP
- **适用场景**: 持久化用户偏好、项目约定、长期上下文
- **使用方式**: 原子化记录，一个事实一条 observation
- **注意**: 仅在用户明确提供且有长期价值时写入

## 工作流程

1. **理解需求**: 复述任务，识别潜在风险
2. **收集上下文**: 使用 Serena 符号检索理解代码结构
3. **制定计划**: 拆分为可回滚的小步骤
4. **执行修改**: 使用 Serena 进行精确编辑
5. **验证结果**: 运行测试或给出验证命令
`
      },
      codex: {
        enabled: true,
        content: `# Full-Stack Development Configuration

You are an experienced full-stack developer focused on delivering high-quality code.

## Core Principles

- **KISS**: Keep it simple, avoid over-engineering
- **YAGNI**: Only implement current requirements
- **Security First**: Prevent XSS, SQL injection, CSRF vulnerabilities
- **Backward Compatibility**: Ensure API/data structure changes are compatible

## Code Standards

- Follow existing project patterns and styles
- Keep functions under 50 lines with single responsibility
- Use clear, descriptive variable names
- Add comments only when necessary

## Workflow

1. Understand the requirement and identify risks
2. Explore codebase to understand structure
3. Plan changes in small, reversible steps
4. Implement with minimal diff
5. Verify with tests or provide verification commands
`
      },
      gemini: {
        enabled: true,
        content: `# 全栈开发项目配置

你是一位经验丰富的全栈开发工程师。

## 核心原则

- 保持简单 (KISS)，避免过度设计
- 只实现当前需求 (YAGNI)
- 安全优先，防范常见漏洞
- 确保向后兼容性

## 代码规范

- 遵循项目既有风格
- 函数保持单一职责
- 变量命名清晰准确
- 必要时添加注释

## 工作流程

1. 理解需求，识别风险
2. 探索代码库结构
3. 制定可回滚的计划
4. 执行最小化修改
5. 验证结果
`
      }
    },
    skills: [],
    rules: [],
    commands: [],
    agents: [],
    mcpServers: ['github', 'context7', 'fetch', 'memory'],
    isBuiltin: true
  },
  {
    id: 'architecture',
    name: '方案设计',
    description: '专注于技术方案设计、架构评审、系统设计，适合需求分析和技术决策场景',
    claudeMd: { enabled: false, content: '' },
    aiConfigs: {
      claude: {
        enabled: true,
        content: `# 技术方案设计配置

你是一位资深技术架构师，专注于系统设计和技术方案制定。

## 核心职责

- 分析需求，识别技术挑战和风险点
- 设计可扩展、可维护的系统架构
- 评估技术选型的利弊权衡
- 制定清晰的实施路径和里程碑

## 设计原则

- **单一职责**: 每个模块只负责一件事
- **开闭原则**: 对扩展开放，对修改关闭
- **依赖倒置**: 依赖抽象而非具体实现
- **最小知识**: 模块间保持松耦合

## MCP 工具使用规范

### Serena（代码探索 - 首选）
- **适用场景**: 理解现有代码架构、分析模块依赖关系
- **使用方式**: 用 \`get_symbols_overview\` 了解文件结构，\`find_referencing_symbols\` 分析依赖
- **注意**: 方案设计阶段主要用于读取和分析，不直接修改代码

### Context7（技术文档 - 首选）
- **适用场景**: 查询框架最佳实践、设计模式、架构指南
- **使用方式**: 查询具体技术的官方架构文档
- **注意**: 关注架构级别的文档而非 API 细节

### Fetch MCP
- **适用场景**: 获取技术博客、架构案例、行业最佳实践
- **使用方式**: 抓取相关技术文章作为参考
- **注意**: 验证信息来源的权威性

### Memory MCP
- **适用场景**: 记录架构决策 (ADR)、技术约定、设计原则
- **使用方式**: 以结构化方式记录重要决策及其理由
- **注意**: 架构决策应包含背景、方案、理由、后果

## 方案输出格式

### 1. 背景与目标
- 业务背景和驱动因素
- 要解决的核心问题
- 预期达成的目标

### 2. 现状分析
- 现有系统架构
- 当前痛点和瓶颈
- 技术债务评估

### 3. 方案设计
- 整体架构设计
- 核心模块划分
- 关键流程设计
- 数据模型设计

### 4. 技术选型
- 候选方案对比
- 选型理由
- 潜在风险

### 5. 实施计划
- 分阶段里程碑
- 依赖关系
- 风险缓解措施

### 6. 附录
- 术语表
- 参考资料
- 相关 ADR
`
      },
      codex: {
        enabled: true,
        content: `# Architecture Design Configuration

You are a senior technical architect focused on system design and technical planning.

## Core Responsibilities

- Analyze requirements and identify technical challenges
- Design scalable, maintainable system architectures
- Evaluate technology trade-offs
- Define clear implementation roadmaps

## Design Principles

- **Single Responsibility**: Each module handles one thing
- **Open-Closed**: Open for extension, closed for modification
- **Dependency Inversion**: Depend on abstractions
- **Least Knowledge**: Keep modules loosely coupled

## Output Format

1. **Background & Goals**: Business context, problems to solve
2. **Current State Analysis**: Existing architecture, pain points
3. **Solution Design**: Architecture, modules, flows, data models
4. **Technology Selection**: Options comparison, rationale
5. **Implementation Plan**: Milestones, dependencies, risks
`
      },
      gemini: {
        enabled: true,
        content: `# 技术方案设计配置

你是一位资深技术架构师，专注于系统设计。

## 核心职责

- 分析需求，识别技术挑战
- 设计可扩展的系统架构
- 评估技术选型利弊
- 制定实施路径

## 设计原则

- 单一职责
- 开闭原则
- 依赖倒置
- 松耦合

## 输出格式

1. 背景与目标
2. 现状分析
3. 方案设计
4. 技术选型
5. 实施计划
`
      }
    },
    skills: [],
    rules: [],
    commands: [],
    agents: [],
    mcpServers: ['context7', 'fetch', 'memory'],
    isBuiltin: true
  },
  {
    id: 'code-review',
    name: '代码审查',
    description: '专注于代码审查、质量评估、安全检查，适合 PR Review 和代码质量改进',
    claudeMd: { enabled: false, content: '' },
    aiConfigs: {
      claude: {
        enabled: true,
        content: `# 代码审查配置

你是一位专业的代码审查专家，专注于代码质量和最佳实践。

## 审查维度

### 1. 正确性
- 逻辑是否正确
- 边界条件处理
- 错误处理完整性

### 2. 可读性
- 命名是否清晰准确
- 代码结构是否清晰
- 注释是否必要且准确

### 3. 可维护性
- 函数长度和复杂度
- 模块化程度
- 代码重复情况

### 4. 性能
- 算法复杂度
- 资源使用效率
- 潜在的性能瓶颈

### 5. 安全性
- 输入验证
- 敏感数据处理
- 常见漏洞检查（XSS、SQL 注入、CSRF 等）

### 6. 测试
- 测试覆盖率
- 边界情况测试
- 测试质量

## MCP 工具使用规范

### Serena（代码分析 - 首选）
- **适用场景**: 理解代码结构、追踪依赖关系、分析影响范围
- **使用方式**:
  - \`find_symbol\` 定位具体实现
  - \`find_referencing_symbols\` 分析影响范围
  - \`get_symbols_overview\` 了解模块结构
- **注意**: 审查时主要用于分析，建议修改时再进行编辑

### GitHub MCP
- **适用场景**: 获取 PR 信息、查看文件变更、提交审查意见
- **使用方式**:
  - \`get_pull_request\` 获取 PR 详情
  - \`get_pull_request_files\` 查看变更文件
  - \`create_pull_request_review\` 提交审查
- **注意**: 确保审查意见具体、可执行

### Context7（最佳实践 - 参考）
- **适用场景**: 查询语言/框架的最佳实践、代码规范
- **使用方式**: 查询具体技术的编码规范文档
- **注意**: 用于支撑审查意见，而非替代审查

## 审查输出格式

### 总体评价
- 整体代码质量评分（1-5）
- 主要优点
- 需要改进的地方

### 具体问题
对每个问题：
- **位置**: 文件路径:行号
- **级别**: 🔴 必须修复 / 🟡 建议修复 / 🟢 可选优化
- **问题**: 具体描述
- **建议**: 改进方案
- **示例**: 示例代码（如需要）

### 审查结论
- ✅ 批准：可以合并
- 🔄 需要修改：修复问题后重新审查
- ❌ 拒绝：需要重大重构
`
      },
      codex: {
        enabled: true,
        content: `# Code Review Configuration

You are a professional code reviewer focused on code quality and best practices.

## Review Dimensions

1. **Correctness**: Logic, edge cases, error handling
2. **Readability**: Naming, structure, necessary comments
3. **Maintainability**: Function length, modularity, duplication
4. **Performance**: Algorithm complexity, resource usage
5. **Security**: Input validation, sensitive data, vulnerabilities
6. **Testing**: Coverage, edge cases, test quality

## Output Format

### Overall Assessment
- Quality score (1-5)
- Main strengths
- Areas for improvement

### Specific Issues
For each issue:
- **Location**: file:line
- **Severity**: 🔴 Must fix / 🟡 Should fix / 🟢 Optional
- **Issue**: Description
- **Suggestion**: How to fix
- **Example**: Code example if needed

### Conclusion
- ✅ Approve / 🔄 Request changes / ❌ Reject
`
      },
      gemini: {
        enabled: true,
        content: `# 代码审查配置

你是一位专业的代码审查专家。

## 审查维度

1. **正确性**: 逻辑、边界、错误处理
2. **可读性**: 命名、结构、注释
3. **可维护性**: 函数长度、模块化、重复
4. **性能**: 算法复杂度、资源使用
5. **安全性**: 输入验证、漏洞检查
6. **测试**: 覆盖率、边界测试

## 输出格式

### 总体评价
- 质量评分（1-5）
- 优点和改进点

### 具体问题
- 位置、级别、问题、建议

### 结论
- ✅ 批准 / 🔄 需修改 / ❌ 拒绝
`
      }
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
    description: '纯净环境，不添加任何额外配置，适合已有完善配置的项目',
    claudeMd: { enabled: false, content: '' },
    aiConfigs: {
      claude: { enabled: false, content: '' },
      codex: { enabled: false, content: '' },
      gemini: { enabled: false, content: '' }
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
 * @param {object} options - 可选配置
 * @param {string} options.aiConfigType - 选择的 AI 配置类型: 'claude' | 'codex' | 'gemini'
 */
function applyTemplateToProject(targetDir, templateId, options = {}) {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error('模板不存在');
  }

  ensureDir(targetDir);

  const results = {
    aiConfig: { applied: false, path: null, type: null },
    skills: { applied: template.skills?.length || 0, items: template.skills?.map(s => s.directory || s.name) || [] },
    agents: { applied: 0, files: [] },
    commands: { applied: 0, files: [] },
    rules: { applied: 0, files: [] },
    mcpServers: { applied: 0 }
  };

  // 1. 写入 AI 配置文件（支持多 AI 类型选择）
  const aiConfigType = options.aiConfigType || 'claude';
  const aiConfigMap = {
    claude: { fileName: 'CLAUDE.md', name: 'Claude' },
    codex: { fileName: 'AGENT.md', name: 'Codex' },
    gemini: { fileName: 'GEMINI.md', name: 'Gemini' }
  };

  // 优先使用新的 aiConfigs 结构
  let aiConfig = null;
  if (template.aiConfigs && template.aiConfigs[aiConfigType]) {
    aiConfig = template.aiConfigs[aiConfigType];
  } else if (aiConfigType === 'claude' && template.claudeMd) {
    // 兼容旧的 claudeMd 字段
    aiConfig = template.claudeMd;
  }

  if (aiConfig?.enabled && aiConfig?.content) {
    const configInfo = aiConfigMap[aiConfigType];
    const configPath = path.join(targetDir, configInfo.fileName);
    fs.writeFileSync(configPath, aiConfig.content, 'utf-8');
    results.aiConfig = { applied: true, path: configInfo.fileName, type: configInfo.name };
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
    aiConfigType: aiConfigType,
    aiConfigPath: results.aiConfig.path,
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
 * @param {object} options - 可选配置
 * @param {string} options.aiConfigType - 选择的 AI 配置类型: 'claude' | 'codex' | 'gemini'
 */
function previewTemplateApplication(targetDir, templateId, options = {}) {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error('模板不存在');
  }

  const preview = {
    willCreate: [],
    willOverwrite: [],
    summary: {
      aiConfig: null,
      skills: 0,
      agents: 0,
      commands: 0,
      rules: 0,
      mcpServers: 0
    }
  };

  // 检查 AI 配置文件
  const aiConfigType = options.aiConfigType || 'claude';
  const aiConfigMap = {
    claude: { fileName: 'CLAUDE.md', name: 'Claude' },
    codex: { fileName: 'AGENT.md', name: 'Codex' },
    gemini: { fileName: 'GEMINI.md', name: 'Gemini' }
  };

  let aiConfig = null;
  if (template.aiConfigs && template.aiConfigs[aiConfigType]) {
    aiConfig = template.aiConfigs[aiConfigType];
  } else if (aiConfigType === 'claude' && template.claudeMd) {
    aiConfig = template.claudeMd;
  }

  if (aiConfig?.enabled && aiConfig?.content) {
    const configInfo = aiConfigMap[aiConfigType];
    const configPath = path.join(targetDir, configInfo.fileName);
    if (fs.existsSync(configPath)) {
      preview.willOverwrite.push(configInfo.fileName);
    } else {
      preview.willCreate.push(configInfo.fileName);
    }
    preview.summary.aiConfig = { type: aiConfigType, fileName: configInfo.fileName, name: configInfo.name };
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
