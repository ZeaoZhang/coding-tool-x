# Codex CLI 集成技术文档

> **文档目的：** 详细说明如何为 coding-tool 项目添加 Codex CLI 支持
> **目标读者：** 后端/全栈开发工程师
> **预计阅读时间：** 30 分钟

---

## 📚 目录

1. [Codex CLI 基础知识](#1-codex-cli-基础知识)
2. [配置文件详解](#2-配置文件详解)
3. [数据存储结构](#3-数据存储结构)
4. [JSONL 文件格式详解](#4-jsonl-文件格式详解)
5. [与 Claude Code 的对比](#5-与-claude-code-的对比)
6. [技术实现方案](#6-技术实现方案)
7. [核心代码示例](#7-核心代码示例)
8. [常见问题与注意事项](#8-常见问题与注意事项)

---

## 1. Codex CLI 基础知识

### 1.1 什么是 Codex CLI？

Codex CLI 是一个命令行工具，类似于 Claude Code CLI，用于在终端中与 AI 模型交互进行编程任务。

**核心特点：**
- 使用 OpenAI API 格式（不是 Anthropic 格式）
- 支持工具调用（shell、update_plan、view_image）
- 支持 Reasoning（推理模式，类似 o1）
- 与 Git 深度集成
- 所有数据本地存储

### 1.2 安装位置

- **Windows:** `C:\Users\{用户名}\.codex\`
- **macOS/Linux:** `~/.codex/`

### 1.3 主要命令

```bash
# 启动新会话（在当前目录）
codex

# 恢复指定会话
codex -r <session-id>

# 查看版本
codex --version
```

---

## 2. 配置文件详解

### 2.1 目录结构

```
~/.codex/
├── config.toml          # 主配置文件（TOML 格式）
├── auth.json            # API 密钥（JSON 格式）
├── version.json         # 版本信息
├── history.jsonl        # 历史命令索引（JSONL 格式）
├── log/                 # 日志目录
└── sessions/            # 会话存储（按日期分层）
    └── YYYY/
        └── MM/
            └── DD/
                └── rollout-{timestamp}-{uuid}.jsonl
```

### 2.2 config.toml 详解

**路径：** `~/.codex/config.toml`

**格式：** TOML

**示例内容：**

```toml
# 当前使用的模型提供商
model_provider = "88code"

# 使用的模型
model = "gpt-5-codex"

# 推理强度 (low/medium/high)
model_reasoning_effort = "high"

# 推理摘要格式
model_reasoning_summary_format = "experimental"

# 网络访问 (enabled/restricted)
network_access = "enabled"

# 是否禁用响应存储
disable_response_storage = true

# 显示原始推理过程
show_raw_agent_reasoning = true

# 模型提供商配置
[model_providers.88code]
name = "88code"
base_url = "https://www.88code.org/openai/v1"
wire_api = "responses"              # API 格式：responses 或 chat/completions
env_key = "key88"                   # 在 auth.json 中的 key 名称
requires_openai_auth = true
```

**关键字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `model_provider` | string | 当前使用的提供商 ID |
| `model` | string | 模型名称（如 gpt-5-codex, claude-sonnet-4-5） |
| `model_reasoning_effort` | string | 推理强度：low/medium/high |
| `disable_response_storage` | boolean | 是否禁用响应存储（影响缓存） |
| `wire_api` | string | API 格式：`responses` 或 `chat/completions` |

**如何读取：**

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');
const toml = require('toml'); // 需要安装 toml 库

function loadCodexConfig() {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');

  if (!fs.existsSync(configPath)) {
    throw new Error('Codex config not found');
  }

  const content = fs.readFileSync(configPath, 'utf8');
  const config = toml.parse(content);

  return config;
}
```

### 2.3 auth.json 详解

**路径：** `~/.codex/auth.json`

**格式：** JSON

**示例内容：**

```json
{
  "OPENAI_API_KEY": "sk-xxx...",
  "key88": "88_xxx..."
}
```

**说明：**
- 存储不同提供商的 API Key
- key 名称对应 `config.toml` 中的 `env_key`

**如何读取：**

```javascript
function loadCodexAuth() {
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');

  if (!fs.existsSync(authPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(authPath, 'utf8'));
}
```

### 2.4 history.jsonl 详解

**路径：** `~/.codex/history.jsonl`

**格式：** JSONL（每行一个 JSON 对象）

**示例内容：**

```jsonl
{"session_id":"019aaaa5-a6e5-7450-b9f7-4330a509f0f8","ts":1763799578,"text":"用户输入的问题"}
{"session_id":"019aaaa6-5e00-7363-9dcd-16844e4608be","ts":1763799630,"text":"另一个问题"}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | string | 会话 UUID |
| `ts` | number | Unix 时间戳（秒） |
| `text` | string | 用户输入的问题（第一条用户消息） |

**用途：**
- 快速索引：无需读取完整会话文件，快速查找历史对话
- 搜索优化：先在 history.jsonl 中搜索，再定位到具体会话

**如何读取：**

```javascript
function loadCodexHistory() {
  const historyPath = path.join(os.homedir(), '.codex', 'history.jsonl');

  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const content = fs.readFileSync(historyPath, 'utf8');
  const lines = content.trim().split('\n').filter(line => line);

  return lines.map(line => {
    try {
      return JSON.parse(line);
    } catch (err) {
      console.error('Failed to parse history line:', line);
      return null;
    }
  }).filter(Boolean);
}
```

---

## 3. 数据存储结构

### 3.1 会话目录结构

**特点：按日期分层存储**

```
~/.codex/sessions/
└── 2025/                           # 年份
    └── 11/                         # 月份
        └── 22/                     # 日期
            ├── rollout-2025-11-22T16-19-26-019aaaa5-89df-7aa3-b7d0-cd242d5acbbe.jsonl
            ├── rollout-2025-11-22T16-19-34-019aaaa5-a6e5-7450-b9f7-4330a509f0f8.jsonl
            └── rollout-2025-11-22T16-20-21-019aaaa6-5e00-7363-9dcd-16844e4608be.jsonl
```

### 3.2 会话文件命名规则

**格式：** `rollout-{ISO8601时间戳}-{UUID}.jsonl`

**示例：** `rollout-2025-11-22T16-19-34-019aaaa5-a6e5-7450-b9f7-4330a509f0f8.jsonl`

**解析：**
- `rollout-` 固定前缀
- `2025-11-22T16-19-34` ISO 8601 时间格式
- `019aaaa5-a6e5-7450-b9f7-4330a509f0f8` UUID v7 格式

**如何扫描会话文件：**

```javascript
const glob = require('glob'); // 或者使用 fs + 递归

function scanCodexSessions() {
  const sessionsDir = path.join(os.homedir(), '.codex', 'sessions');

  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  // 递归查找所有 .jsonl 文件
  const pattern = path.join(sessionsDir, '**', 'rollout-*.jsonl');
  const files = glob.sync(pattern);

  return files.map(filePath => {
    const filename = path.basename(filePath);
    const match = filename.match(/rollout-([\d-T]+)-([\w-]+)\.jsonl/);

    if (!match) return null;

    return {
      filePath,
      timestamp: match[1],
      sessionId: match[2],
      date: match[1].split('T')[0] // 2025-11-22
    };
  }).filter(Boolean);
}
```

### 3.3 项目概念

**重要：** Codex CLI 没有独立的"项目"概念！

**项目信息来源：**
1. 会话的工作目录（`cwd`）
2. Git 仓库 URL（`git.repository_url`）

**项目聚合策略：**

```javascript
function aggregateProjects(sessions) {
  const projectMap = new Map();

  sessions.forEach(session => {
    const meta = session.sessionMeta;

    // 方案1：使用 cwd 的最后一级目录作为项目名
    const projectName = path.basename(meta.cwd);

    // 方案2：使用 Git 仓库名
    // const repoUrl = meta.git?.repository_url || '';
    // const projectName = repoUrl.split('/').pop().replace('.git', '');

    if (!projectMap.has(projectName)) {
      projectMap.set(projectName, {
        name: projectName,
        path: meta.cwd,
        gitRepo: meta.git?.repository_url,
        sessions: []
      });
    }

    projectMap.get(projectName).sessions.push(session);
  });

  return Array.from(projectMap.values());
}
```

---

## 4. JSONL 文件格式详解

### 4.1 JSONL 基础

**JSONL = JSON Lines**

- 每行是一个独立的 JSON 对象
- 使用换行符 `\n` 分隔
- 适合流式追加写入
- 不能直接 `JSON.parse` 整个文件！

**如何读取：**

```javascript
function readJSONL(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n').filter(line => line);

  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      console.error(`Failed to parse line ${index + 1}:`, line);
      return null;
    }
  }).filter(Boolean);
}
```

### 4.2 事件类型（type）

每个 JSONL 对象都有一个 `type` 字段，标识事件类型：

| Type | 说明 | 重要性 |
|------|------|--------|
| `session_meta` | 会话元数据 | ⭐⭐⭐⭐⭐ 必读 |
| `response_item` | 响应项（消息、工具调用等） | ⭐⭐⭐⭐⭐ 核心 |
| `event_msg` | 事件消息（Token统计、推理等） | ⭐⭐⭐⭐ 重要 |
| `turn_context` | 回合上下文 | ⭐⭐⭐ 有用 |
| `ghost_snapshot` | Git快照 | ⭐⭐ 可选 |

### 4.3 session_meta（会话元数据）

**位置：** JSONL 文件的第一行

**示例：**

```json
{
  "timestamp": "2025-11-22T08:19:34.299Z",
  "type": "session_meta",
  "payload": {
    "id": "019aaaa5-a6e5-7450-b9f7-4330a509f0f8",
    "timestamp": "2025-11-22T08:19:34.248Z",
    "cwd": "C:\\Users\\admin\\Desktop\\cooperJiang\\coding-tool",
    "originator": "codex_cli_rs",
    "cli_version": "0.63.0",
    "instructions": null,
    "source": "cli",
    "model_provider": "88code",
    "git": {
      "commit_hash": "98bb6a0634b2f4fa5c2a4514f675200d05742b5f",
      "branch": "main",
      "repository_url": "git@github.com:CooperJiang/coding-tool.git"
    }
  }
}
```

**关键字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `payload.id` | string | 会话 UUID（重要！） |
| `payload.cwd` | string | 工作目录（项目路径） |
| `payload.cli_version` | string | Codex CLI 版本 |
| `payload.model_provider` | string | 模型提供商 |
| `payload.git.branch` | string | Git 分支名 |
| `payload.git.commit_hash` | string | Git 提交哈希 |
| `payload.git.repository_url` | string | Git 仓库 URL |

**如何提取：**

```javascript
function extractSessionMeta(jsonlFile) {
  const lines = readJSONL(jsonlFile);
  const metaLine = lines.find(line => line.type === 'session_meta');

  if (!metaLine) {
    throw new Error('No session_meta found');
  }

  return {
    sessionId: metaLine.payload.id,
    cwd: metaLine.payload.cwd,
    branch: metaLine.payload.git?.branch,
    repository: metaLine.payload.git?.repository_url,
    timestamp: metaLine.payload.timestamp,
    provider: metaLine.payload.model_provider
  };
}
```

### 4.4 response_item（对话内容）

**核心：** 所有对话消息、工具调用、AI 响应都是 `response_item`

**用户消息示例：**

```json
{
  "timestamp": "2025-11-22T08:19:38.936Z",
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "user",
    "content": [
      {
        "type": "input_text",
        "text": "快速分析下项目 告诉我这个项目是干嘛的"
      }
    ]
  }
}
```

**助手消息示例：**

```json
{
  "timestamp": "2025-11-22T08:20:05.123Z",
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "这个项目是一个 Node.js CLI 工具..."
      }
    ]
  }
}
```

**工具调用示例：**

```json
{
  "timestamp": "2025-11-22T08:19:43.818Z",
  "type": "response_item",
  "payload": {
    "type": "function_call",
    "name": "shell_command",
    "arguments": "{\"command\":\"pwd\"}",
    "call_id": "call_8vWImfzZU5ufaCd2PIH7Zgq9"
  }
}
```

**工具输出示例：**

```json
{
  "timestamp": "2025-11-22T08:19:43.818Z",
  "type": "response_item",
  "payload": {
    "type": "function_call_output",
    "call_id": "call_8vWImfzZU5ufaCd2PIH7Zgq9",
    "output": "Exit code: 0\nOutput:\nC:\\Users\\admin\\Desktop\\cooperJiang\\coding-tool"
  }
}
```

**推理内容示例：**

```json
{
  "timestamp": "2025-11-22T08:19:43.818Z",
  "type": "response_item",
  "payload": {
    "type": "reasoning",
    "summary": [
      {
        "type": "summary_text",
        "text": "**Assessing write permissions and escalation**"
      }
    ],
    "content": null,
    "encrypted_content": "gAAAAABpIXIfCvf00QewA19q..." // 加密的推理内容
  }
}
```

**如何提取对话内容：**

```javascript
function extractMessages(jsonlFile) {
  const lines = readJSONL(jsonlFile);
  const messages = [];

  lines.forEach(line => {
    if (line.type !== 'response_item') return;

    const payload = line.payload;

    // 用户/助手消息
    if (payload.type === 'message') {
      messages.push({
        role: payload.role,
        content: payload.content.map(c => c.text || c.input_text).join('\n'),
        timestamp: line.timestamp
      });
    }

    // 工具调用
    if (payload.type === 'function_call') {
      messages.push({
        role: 'tool_call',
        name: payload.name,
        arguments: payload.arguments,
        timestamp: line.timestamp
      });
    }

    // 工具输出
    if (payload.type === 'function_call_output') {
      messages.push({
        role: 'tool_output',
        output: payload.output,
        timestamp: line.timestamp
      });
    }
  });

  return messages;
}
```

### 4.5 event_msg（Token 统计）

**示例：**

```json
{
  "timestamp": "2025-11-22T08:19:43.771Z",
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": {
      "total_token_usage": {
        "input_tokens": 3737,
        "cached_input_tokens": 2944,
        "output_tokens": 148,
        "reasoning_output_tokens": 128,
        "total_tokens": 3885
      },
      "last_token_usage": {
        "input_tokens": 3737,
        "cached_input_tokens": 2944,
        "output_tokens": 148,
        "reasoning_output_tokens": 128,
        "total_tokens": 3885
      },
      "model_context_window": 258400
    },
    "rate_limits": {
      "primary": null,
      "secondary": null,
      "credits": null
    }
  }
}
```

**Token 字段说明：**

| 字段 | 说明 | 对应 Claude Code |
|------|------|------------------|
| `input_tokens` | 输入 token | `input_tokens` |
| `cached_input_tokens` | 缓存命中的输入 token | `cache_read_input_tokens` |
| `output_tokens` | 输出 token | `output_tokens` |
| `reasoning_output_tokens` | 推理过程的输出 token | 无 |
| `total_tokens` | 总 token | 计算得出 |

**如何提取 Token 统计：**

```javascript
function extractTokenUsage(jsonlFile) {
  const lines = readJSONL(jsonlFile);

  // 找到最后一个 token_count 事件（累计值）
  const tokenEvents = lines.filter(line =>
    line.type === 'event_msg' &&
    line.payload.type === 'token_count'
  );

  if (tokenEvents.length === 0) {
    return null;
  }

  const lastEvent = tokenEvents[tokenEvents.length - 1];
  const usage = lastEvent.payload.info.total_token_usage;

  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheRead: usage.cached_input_tokens || 0,
    reasoning: usage.reasoning_output_tokens || 0,
    total: usage.total_tokens || 0
  };
}
```

### 4.6 turn_context（回合上下文）

**示例：**

```json
{
  "timestamp": "2025-11-22T08:19:38.938Z",
  "type": "turn_context",
  "payload": {
    "cwd": "C:\\Users\\admin\\Desktop\\cooperJiang\\coding-tool",
    "approval_policy": "on-request",
    "sandbox_policy": {"type": "read-only"},
    "model": "gpt-5-codex",
    "effort": "high",
    "summary": "auto"
  }
}
```

**说明：**
- 记录每个对话回合的上下文信息
- 包含沙箱策略、审批策略等
- 可用于展示会话配置信息

---

## 5. 与 Claude Code 的对比

### 5.1 配置文件对比

| 项目 | Claude Code | Codex CLI |
|------|-------------|-----------|
| **主配置** | `~/.claude/settings.json` | `~/.codex/config.toml` |
| **API Key** | 在 settings.json 中 | 独立的 `auth.json` |
| **格式** | JSON | TOML + JSON |
| **字段名** | `ANTHROPIC_API_KEY` | `OPENAI_API_KEY` |

### 5.2 会话存储对比

| 项目 | Claude Code | Codex CLI |
|------|-------------|-----------|
| **目录结构** | 平铺：`sessions/项目名/` | 分层：`sessions/YYYY/MM/DD/` |
| **文件命名** | `{timestamp}-{uuid}.jsonl` | `rollout-{timestamp}-{uuid}.jsonl` |
| **项目概念** | 基于目录路径 | 需要从 `cwd` 聚合 |
| **Git 信息** | 基本信息 | 完整快照 |

### 5.3 数据格式对比

| 项目 | Claude Code | Codex CLI |
|------|-------------|-----------|
| **消息格式** | Anthropic Messages API | OpenAI Chat API |
| **Token 字段** | `cache_creation_input_tokens` | `cached_input_tokens` |
| **推理 Token** | 无 | `reasoning_output_tokens` |
| **工具格式** | MCP Tools | OpenAI Function Calling |

### 5.4 Token 字段映射表

```javascript
// Codex -> 统一格式
const tokenMapping = {
  'input_tokens': 'input',
  'cached_input_tokens': 'cacheRead',
  'cache_creation_input_tokens': 'cacheCreation', // Codex 可能没有这个字段
  'output_tokens': 'output',
  'reasoning_output_tokens': 'reasoning',
  'total_tokens': 'total'
};

// Claude Code -> 统一格式
const claudeMapping = {
  'input_tokens': 'input',
  'cache_read_input_tokens': 'cacheRead',
  'cache_creation_input_tokens': 'cacheCreation',
  'output_tokens': 'output',
  // Claude 没有 reasoning tokens
};
```

---

## 6. 技术实现方案

### 6.1 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                     前端 (Vue 3)                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │ Claude 项目│  │ Codex 项目 │  │  全局搜索   │        │
│  │   列表     │  │   列表     │  │            │        │
│  └────────────┘  └────────────┘  └────────────┘        │
│         │               │               │               │
└─────────┼───────────────┼───────────────┼───────────────┘
          │               │               │
          │ API 调用      │               │
          ▼               ▼               ▼
┌─────────────────────────────────────────────────────────┐
│                  后端 API 层 (Express)                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │ /api/      │  │ /api/codex/│  │ /api/      │        │
│  │ projects   │  │ projects   │  │ search     │        │
│  └────────────┘  └────────────┘  └────────────┘        │
│         │               │               │               │
└─────────┼───────────────┼───────────────┼───────────────┘
          │               │               │
          │ 调用服务层    │               │
          ▼               ▼               ▼
┌─────────────────────────────────────────────────────────┐
│                  服务层 (Business Logic)                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │ sessions.js│  │ codex-     │  │ search.js  │        │
│  │            │  │ sessions.js│  │            │        │
│  └────────────┘  └────────────┘  └────────────┘        │
│         │               │               │               │
└─────────┼───────────────┼───────────────┼───────────────┘
          │               │               │
          │ 读取本地文件  │               │
          ▼               ▼               ▼
┌─────────────────────────────────────────────────────────┐
│                    本地文件系统                           │
│  ┌────────────┐  ┌────────────┐                         │
│  │ ~/.claude/ │  │ ~/.codex/  │                         │
│  │ sessions/  │  │ sessions/  │                         │
│  └────────────┘  └────────────┘                         │
└─────────────────────────────────────────────────────────┘
```

### 6.2 目录结构

```
src/
├── server/
│   ├── api/
│   │   ├── projects.js              # Claude Code 项目 API
│   │   ├── sessions.js              # Claude Code 会话 API
│   │   ├── codex-projects.js        # ✨ Codex 项目 API (新)
│   │   └── codex-sessions.js        # ✨ Codex 会话 API (新)
│   ├── services/
│   │   ├── sessions.js              # Claude Code 会话服务
│   │   ├── codex-config.js          # ✨ Codex 配置读取 (新)
│   │   ├── codex-sessions.js        # ✨ Codex 会话服务 (新)
│   │   └── codex-parser.js          # ✨ Codex JSONL 解析 (新)
│   └── index.js
└── web/
    ├── src/
    │   ├── api/
    │   │   ├── index.js             # Claude Code API 客户端
    │   │   └── codex.js             # ✨ Codex API 客户端 (新)
    │   ├── views/
    │   │   ├── ProjectList.vue      # Claude Code 项目列表
    │   │   ├── SessionList.vue      # Claude Code 会话列表
    │   │   ├── CodexProjectList.vue # ✨ Codex 项目列表 (新)
    │   │   └── CodexSessionList.vue # ✨ Codex 会话列表 (新)
    │   └── components/
    │       └── Layout.vue           # 添加 Codex 导航
    └── ...
```

### 6.3 核心流程

#### 6.3.1 项目列表流程

```
用户访问 Codex 项目列表页面
    ↓
前端调用 GET /api/codex/projects
    ↓
后端 codex-projects.js API
    ↓
调用 codex-sessions.js 服务
    ↓
1. 扫描 ~/.codex/sessions/ 目录（递归）
2. 读取每个 JSONL 文件的第一行（session_meta）
3. 提取 cwd 和 git 信息
4. 按 cwd 聚合成项目列表
    ↓
返回项目列表 JSON
    ↓
前端渲染项目卡片
```

#### 6.3.2 会话列表流程

```
用户点击项目卡片
    ↓
前端调用 GET /api/codex/sessions/:projectName
    ↓
后端 codex-sessions.js API
    ↓
1. 扫描所有会话
2. 过滤出属于该项目的会话（cwd 匹配）
3. 解析每个会话的 session_meta 和 token 统计
4. 按时间倒序排序
    ↓
返回会话列表 JSON
    ↓
前端渲染会话列表
```

#### 6.3.3 对话内容流程

```
用户点击查看会话详情
    ↓
前端调用 GET /api/codex/sessions/:projectName/:sessionId/messages
    ↓
后端 codex-sessions.js API
    ↓
1. 根据 sessionId 找到对应的 JSONL 文件
2. 逐行解析 response_item
3. 提取用户/助手消息、工具调用等
4. 分页返回（可选）
    ↓
返回消息列表 JSON
    ↓
前端渲染对话内容
```

### 6.4 数据流图

```
┌─────────────┐
│  JSONL 文件  │
│  (sessions)  │
└──────┬──────┘
       │
       │ 读取
       ▼
┌─────────────────┐
│  JSONL Parser   │ ← codex-parser.js
│  (逐行解析)      │
└──────┬──────────┘
       │
       │ 提取数据
       ▼
┌─────────────────┐
│  Session 对象   │ ← codex-sessions.js
│  - meta         │
│  - messages     │
│  - tokens       │
└──────┬──────────┘
       │
       │ 聚合
       ▼
┌─────────────────┐
│  Project 对象   │ ← codex-sessions.js
│  - name         │
│  - sessions[]   │
└──────┬──────────┘
       │
       │ JSON
       ▼
┌─────────────────┐
│   API 响应      │ ← codex-projects.js
│   (JSON)        │
└──────┬──────────┘
       │
       │ HTTP
       ▼
┌─────────────────┐
│   前端页面      │
└─────────────────┘
```

---

## 7. 核心代码示例

### 7.1 配置读取服务

**文件：** `src/server/services/codex-config.js`

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

// 需要安装: npm install toml
const toml = require('toml');

/**
 * 获取 Codex 配置目录
 */
function getCodexDir() {
  return path.join(os.homedir(), '.codex');
}

/**
 * 读取 config.toml
 */
function loadConfig() {
  const configPath = path.join(getCodexDir(), 'config.toml');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    return toml.parse(content);
  } catch (err) {
    console.error('Failed to parse config.toml:', err);
    return null;
  }
}

/**
 * 读取 auth.json
 */
function loadAuth() {
  const authPath = path.join(getCodexDir(), 'auth.json');

  if (!fs.existsSync(authPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(authPath, 'utf8'));
  } catch (err) {
    console.error('Failed to parse auth.json:', err);
    return {};
  }
}

/**
 * 读取 history.jsonl
 */
function loadHistory() {
  const historyPath = path.join(getCodexDir(), 'history.jsonl');

  if (!fs.existsSync(historyPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(historyPath, 'utf8');
    const lines = content.trim().split('\n').filter(line => line);

    return lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (err) {
        return null;
      }
    }).filter(Boolean);
  } catch (err) {
    console.error('Failed to read history.jsonl:', err);
    return [];
  }
}

module.exports = {
  getCodexDir,
  loadConfig,
  loadAuth,
  loadHistory
};
```

### 7.2 JSONL 解析器

**文件：** `src/server/services/codex-parser.js`

```javascript
const fs = require('fs');

/**
 * 读取 JSONL 文件
 * @param {string} filePath - JSONL 文件路径
 * @returns {Array} JSON 对象数组
 */
function readJSONL(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(line => line);

    return lines.map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        console.error(`Failed to parse line ${index + 1} in ${filePath}:`, err.message);
        return null;
      }
    }).filter(Boolean);
  } catch (err) {
    console.error('Failed to read JSONL file:', filePath, err);
    return [];
  }
}

/**
 * 提取会话元数据
 * @param {Array} lines - JSONL 行数组
 * @returns {Object|null} 会话元数据
 */
function extractSessionMeta(lines) {
  const metaLine = lines.find(line => line.type === 'session_meta');

  if (!metaLine || !metaLine.payload) {
    return null;
  }

  const payload = metaLine.payload;

  return {
    sessionId: payload.id,
    timestamp: payload.timestamp,
    cwd: payload.cwd,
    cliVersion: payload.cli_version,
    provider: payload.model_provider,
    git: payload.git ? {
      branch: payload.git.branch,
      commitHash: payload.git.commit_hash,
      repositoryUrl: payload.git.repository_url
    } : null
  };
}

/**
 * 提取对话消息
 * @param {Array} lines - JSONL 行数组
 * @returns {Array} 消息数组
 */
function extractMessages(lines) {
  const messages = [];

  lines.forEach(line => {
    if (line.type !== 'response_item') return;

    const payload = line.payload;

    // 用户/助手消息
    if (payload.type === 'message') {
      const contentParts = payload.content || [];
      const text = contentParts
        .map(c => c.text || c.input_text || '')
        .join('\n')
        .trim();

      if (text) {
        messages.push({
          role: payload.role,
          content: text,
          timestamp: line.timestamp
        });
      }
    }

    // 工具调用
    if (payload.type === 'function_call') {
      messages.push({
        role: 'tool_call',
        name: payload.name,
        arguments: payload.arguments,
        callId: payload.call_id,
        timestamp: line.timestamp
      });
    }

    // 工具输出
    if (payload.type === 'function_call_output') {
      messages.push({
        role: 'tool_output',
        callId: payload.call_id,
        output: payload.output,
        timestamp: line.timestamp
      });
    }

    // 推理内容
    if (payload.type === 'reasoning') {
      const summary = payload.summary || [];
      const text = summary
        .map(s => s.text || '')
        .join('\n')
        .trim();

      if (text) {
        messages.push({
          role: 'reasoning',
          content: text,
          timestamp: line.timestamp
        });
      }
    }
  });

  return messages;
}

/**
 * 提取 Token 统计
 * @param {Array} lines - JSONL 行数组
 * @returns {Object|null} Token 统计
 */
function extractTokenUsage(lines) {
  // 找到最后一个 token_count 事件
  const tokenEvents = lines.filter(line =>
    line.type === 'event_msg' &&
    line.payload?.type === 'token_count'
  );

  if (tokenEvents.length === 0) {
    return null;
  }

  const lastEvent = tokenEvents[tokenEvents.length - 1];
  const usage = lastEvent.payload.info?.total_token_usage;

  if (!usage) {
    return null;
  }

  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheRead: usage.cached_input_tokens || 0,
    cacheCreation: usage.cache_creation_input_tokens || 0,
    reasoning: usage.reasoning_output_tokens || 0,
    total: usage.total_tokens || 0
  };
}

/**
 * 解析完整会话
 * @param {string} filePath - JSONL 文件路径
 * @returns {Object} 会话对象
 */
function parseSession(filePath) {
  const lines = readJSONL(filePath);

  if (lines.length === 0) {
    return null;
  }

  const meta = extractSessionMeta(lines);
  const messages = extractMessages(lines);
  const tokens = extractTokenUsage(lines);

  if (!meta) {
    return null;
  }

  return {
    filePath,
    meta,
    messages,
    tokens,
    messageCount: messages.filter(m => m.role === 'user' || m.role === 'assistant').length
  };
}

module.exports = {
  readJSONL,
  extractSessionMeta,
  extractMessages,
  extractTokenUsage,
  parseSession
};
```

### 7.3 会话服务

**文件：** `src/server/services/codex-sessions.js`

```javascript
const fs = require('fs');
const path = require('path');
const glob = require('glob');
const { getCodexDir } = require('./codex-config');
const { parseSession, extractSessionMeta, readJSONL } = require('./codex-parser');

/**
 * 获取会话目录
 */
function getSessionsDir() {
  return path.join(getCodexDir(), 'sessions');
}

/**
 * 扫描所有会话文件
 * @returns {Array} 会话文件路径数组
 */
function scanSessionFiles() {
  const sessionsDir = getSessionsDir();

  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const pattern = path.join(sessionsDir, '**', 'rollout-*.jsonl');
  const files = glob.sync(pattern);

  return files.map(filePath => {
    const filename = path.basename(filePath);
    const match = filename.match(/rollout-([\d-T]+)-([\w-]+)\.jsonl/);

    if (!match) return null;

    return {
      filePath,
      timestamp: match[1],
      sessionId: match[2],
      date: match[1].split('T')[0]
    };
  }).filter(Boolean);
}

/**
 * 获取所有会话
 * @returns {Array} 会话对象数组
 */
function getAllSessions() {
  const files = scanSessionFiles();

  return files.map(file => {
    const session = parseSession(file.filePath);

    if (!session) return null;

    return {
      ...session,
      sessionId: file.sessionId,
      date: file.date
    };
  }).filter(Boolean);
}

/**
 * 聚合项目列表
 * @returns {Array} 项目对象数组
 */
function getProjects() {
  const sessions = getAllSessions();
  const projectMap = new Map();

  sessions.forEach(session => {
    const meta = session.meta;

    // 使用 cwd 的最后一级目录作为项目名
    const projectName = path.basename(meta.cwd);

    if (!projectMap.has(projectName)) {
      projectMap.set(projectName, {
        name: projectName,
        path: meta.cwd,
        gitRepo: meta.git?.repositoryUrl,
        branch: meta.git?.branch,
        sessions: [],
        sessionCount: 0,
        lastActivity: null
      });
    }

    const project = projectMap.get(projectName);
    project.sessions.push(session);
    project.sessionCount++;

    // 更新最后活动时间
    const sessionTime = new Date(session.meta.timestamp).getTime();
    if (!project.lastActivity || sessionTime > project.lastActivity) {
      project.lastActivity = sessionTime;
    }
  });

  // 转换为数组并按最后活动时间排序
  return Array.from(projectMap.values())
    .sort((a, b) => b.lastActivity - a.lastActivity);
}

/**
 * 根据项目名获取会话列表
 * @param {string} projectName - 项目名称
 * @returns {Array} 会话数组
 */
function getSessionsByProject(projectName) {
  const sessions = getAllSessions();

  return sessions
    .filter(session => {
      const sessionProjectName = path.basename(session.meta.cwd);
      return sessionProjectName === projectName;
    })
    .sort((a, b) => {
      // 按时间倒序
      return new Date(b.meta.timestamp).getTime() - new Date(a.meta.timestamp).getTime();
    });
}

/**
 * 根据 sessionId 获取会话
 * @param {string} sessionId - 会话 ID
 * @returns {Object|null} 会话对象
 */
function getSessionById(sessionId) {
  const files = scanSessionFiles();
  const file = files.find(f => f.sessionId === sessionId);

  if (!file) {
    return null;
  }

  return parseSession(file.filePath);
}

/**
 * 搜索会话（全局）
 * @param {string} keyword - 搜索关键词
 * @returns {Array} 搜索结果
 */
function searchSessions(keyword) {
  const sessions = getAllSessions();
  const results = [];

  sessions.forEach(session => {
    session.messages.forEach((message, index) => {
      if (message.role !== 'user' && message.role !== 'assistant') {
        return;
      }

      const content = message.content.toLowerCase();
      const keywordLower = keyword.toLowerCase();

      if (content.includes(keywordLower)) {
        // 提取上下文
        const startIndex = Math.max(0, content.indexOf(keywordLower) - 50);
        const endIndex = Math.min(content.length, content.indexOf(keywordLower) + keyword.length + 50);
        const context = content.substring(startIndex, endIndex);

        results.push({
          sessionId: session.sessionId,
          projectName: path.basename(session.meta.cwd),
          messageIndex: index,
          role: message.role,
          context: (startIndex > 0 ? '...' : '') + context + (endIndex < content.length ? '...' : ''),
          timestamp: message.timestamp
        });
      }
    });
  });

  return results;
}

module.exports = {
  getSessionsDir,
  scanSessionFiles,
  getAllSessions,
  getProjects,
  getSessionsByProject,
  getSessionById,
  searchSessions
};
```

### 7.4 API 接口

**文件：** `src/server/api/codex-projects.js`

```javascript
const express = require('express');
const router = express.Router();
const { getProjects } = require('../services/codex-sessions');

module.exports = function(config) {
  /**
   * GET /api/codex/projects
   * 获取所有项目列表
   */
  router.get('/', (req, res) => {
    try {
      const projects = getProjects();
      res.json({ projects });
    } catch (err) {
      console.error('Failed to get Codex projects:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
```

**文件：** `src/server/api/codex-sessions.js`

```javascript
const express = require('express');
const router = express.Router();
const {
  getSessionsByProject,
  getSessionById,
  searchSessions
} = require('../services/codex-sessions');

module.exports = function(config) {
  /**
   * GET /api/codex/sessions/:projectName
   * 获取项目的所有会话
   */
  router.get('/:projectName', (req, res) => {
    try {
      const { projectName } = req.params;
      const sessions = getSessionsByProject(projectName);

      res.json({
        projectName,
        sessions: sessions.map(s => ({
          sessionId: s.sessionId,
          date: s.date,
          timestamp: s.meta.timestamp,
          branch: s.meta.git?.branch,
          provider: s.meta.provider,
          messageCount: s.messageCount,
          tokens: s.tokens,
          firstMessage: s.messages.find(m => m.role === 'user')?.content.substring(0, 100)
        }))
      });
    } catch (err) {
      console.error('Failed to get Codex sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/codex/sessions/:projectName/:sessionId/messages
   * 获取会话的消息列表
   */
  router.get('/:projectName/:sessionId/messages', (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = getSessionById(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({
        sessionId,
        meta: session.meta,
        messages: session.messages,
        tokens: session.tokens
      });
    } catch (err) {
      console.error('Failed to get session messages:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/codex/sessions/search/global?keyword=xxx
   * 全局搜索
   */
  router.get('/search/global', (req, res) => {
    try {
      const { keyword } = req.query;

      if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
      }

      const results = searchSessions(keyword);

      res.json({
        keyword,
        results
      });
    } catch (err) {
      console.error('Failed to search sessions:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
```

---

## 8. 常见问题与注意事项

### 8.1 JSONL 解析问题

**问题：** 不能直接 `JSON.parse` 整个文件

**解决：**
```javascript
// ❌ 错误
const data = JSON.parse(fs.readFileSync('file.jsonl', 'utf8'));

// ✅ 正确
const lines = fs.readFileSync('file.jsonl', 'utf8').split('\n');
const data = lines.map(line => JSON.parse(line));
```

### 8.2 项目聚合策略

**问题：** 同一项目可能有多个 `cwd` 路径

**示例：**
```
C:\Users\admin\Desktop\project
C:\Users\admin\Desktop\project\src
C:\Users\admin\Desktop\project\src\server
```

**解决方案：**

**方案1：** 使用最后一级目录名（简单但可能重复）
```javascript
const projectName = path.basename(cwd); // "project"
```

**方案2：** 使用 Git 仓库名（更准确）
```javascript
const repoUrl = meta.git?.repository_url || '';
const projectName = repoUrl.split('/').pop().replace('.git', '');
```

**方案3：** 使用完整路径哈希（唯一但不可读）
```javascript
const projectId = crypto.createHash('md5').update(cwd).digest('hex');
```

**推荐：** 方案2（优先）+ 方案1（兜底）

### 8.3 Token 字段缺失

**问题：** 某些会话可能没有 `token_count` 事件

**解决：**
```javascript
const tokens = extractTokenUsage(lines) || {
  input: 0,
  output: 0,
  cacheRead: 0,
  reasoning: 0,
  total: 0
};
```

### 8.4 文件编码问题

**问题：** Windows 中文路径可能乱码

**解决：**
```javascript
// 指定 UTF-8 编码
fs.readFileSync(filePath, 'utf8');
```

### 8.5 性能优化

**问题：** 扫描大量会话文件很慢

**优化方案：**

1. **缓存项目列表**
```javascript
let projectCache = null;
let cacheTime = null;

function getProjects() {
  const now = Date.now();

  // 缓存5分钟
  if (projectCache && cacheTime && (now - cacheTime) < 5 * 60 * 1000) {
    return projectCache;
  }

  projectCache = scanAndAggregateProjects();
  cacheTime = now;

  return projectCache;
}
```

2. **使用 history.jsonl 加速搜索**
```javascript
function quickSearch(keyword) {
  const history = loadHistory();

  // 先在 history 中搜索
  const matchedSessions = history
    .filter(h => h.text.toLowerCase().includes(keyword.toLowerCase()))
    .map(h => h.session_id);

  // 再读取完整会话
  return matchedSessions.map(id => getSessionById(id));
}
```

3. **分页加载**
```javascript
function getSessionsByProject(projectName, page = 1, limit = 20) {
  const allSessions = getAllSessions()
    .filter(s => path.basename(s.meta.cwd) === projectName)
    .sort((a, b) => new Date(b.meta.timestamp) - new Date(a.meta.timestamp));

  const start = (page - 1) * limit;
  const end = start + limit;

  return {
    sessions: allSessions.slice(start, end),
    total: allSessions.length,
    page,
    limit
  };
}
```

### 8.6 Fork 实现注意事项

**核心逻辑：**
```javascript
const { v7: uuidv7 } = require('uuid');

function forkSession(sessionId) {
  // 1. 读取原会话
  const original = getSessionById(sessionId);

  if (!original) {
    throw new Error('Session not found');
  }

  // 2. 生成新 ID 和时间戳
  const newId = uuidv7();
  const now = new Date().toISOString();
  const timestamp = now.replace(/:/g, '-').split('.')[0];

  // 3. 创建新文件路径
  const date = now.split('T')[0].split('-'); // [2025, 11, 22]
  const newDir = path.join(getSessionsDir(), date[0], date[1], date[2]);
  fs.mkdirSync(newDir, { recursive: true });

  const newFile = path.join(newDir, `rollout-${timestamp}-${newId}.jsonl`);

  // 4. 读取原文件内容
  const lines = readJSONL(original.filePath);

  // 5. 修改 session_meta
  const metaLine = lines.find(l => l.type === 'session_meta');
  metaLine.payload.id = newId;
  metaLine.payload.timestamp = now;
  metaLine.payload.forked_from = sessionId; // 自定义字段
  metaLine.timestamp = now;

  // 6. 写入新文件
  const content = lines.map(line => JSON.stringify(line)).join('\n') + '\n';
  fs.writeFileSync(newFile, content, 'utf8');

  return {
    sessionId: newId,
    filePath: newFile,
    forkedFrom: sessionId
  };
}
```

### 8.7 错误处理

**统一错误处理：**

```javascript
// API 层
router.get('/api/codex/projects', (req, res) => {
  try {
    const projects = getProjects();
    res.json({ projects });
  } catch (err) {
    console.error('[Codex] Failed to get projects:', err);

    // 判断错误类型
    if (err.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Codex not installed or sessions directory not found'
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: err.message
    });
  }
});
```

---

## 9. 依赖安装

```bash
# 主要依赖
npm install toml        # 解析 TOML 配置
npm install glob        # 文件扫描
npm install uuid        # UUID v7 生成（用于 Fork）

# 可选依赖
npm install @fast-csv/parse  # 如果需要导出 CSV
```

---

## 10. 测试检查清单

开发完成后，请验证以下功能：

- [ ] 能正确读取 `config.toml` 和 `auth.json`
- [ ] 能扫描并列出所有项目
- [ ] 项目列表显示正确的会话数量
- [ ] 能查看项目下的所有会话
- [ ] 会话按时间倒序排列
- [ ] 能查看完整的对话内容
- [ ] Token 统计显示正确
- [ ] Git 分支信息显示正确
- [ ] 全局搜索能找到关键词
- [ ] Fork 功能生成新会话
- [ ] 终端启动功能正常
- [ ] 处理 Codex 未安装的情况
- [ ] 处理会话文件损坏的情况

---

## 11. 参考资料

- **Codex CLI 官方文档:** (如果有的话)
- **TOML 格式规范:** https://toml.io/
- **UUID v7 规范:** https://www.ietf.org/archive/id/draft-ietf-uuidrev-rfc4122bis-14.html
- **JSONL 格式说明:** https://jsonlines.org/

---

**祝开发顺利！如有问题，请随时咨询。** 🚀
