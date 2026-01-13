# CTX 工具目录结构迁移说明

## 背景

为避免与原始 `ct` 工具冲突，`ctx` 工具的所有数据目录已从 `~/.claude/cc-tool` 迁移到独立的 `~/.ctx` 目录。

## 新目录结构

```
~/.ctx/                                # CTX 工具根目录
├── projects/                          # 项目配置和会话存储
│   └── {projectName}/                 # 项目目录
│       ├── .claude-project.json       # 项目配置文件
│       └── {sessionId}.jsonl          # Claude 会话文件
├── config.json                        # CTX 主配置文件
├── logs/                              # 日志目录
│   ├── cc-tool-out.log               # 输出日志
│   └── cc-tool-error.log             # 错误日志
├── aliases.json                       # 会话别名
├── favorites.json                     # 收藏夹
├── channels.json                      # Claude 渠道配置
├── codex-channels.json                # Codex 渠道配置
├── gemini-channels.json               # Gemini 渠道配置
├── active-channel.json                # Claude 当前激活渠道
├── codex-active-channel.json          # Codex 当前激活渠道
├── gemini-active-channel.json         # Gemini 当前激活渠道
├── statistics.json                    # Claude 统计数据
├── codex-statistics.json              # Codex 统计数据
├── gemini-statistics.json             # Gemini 统计数据
├── daily-stats/                       # Claude 每日统计
├── codex-daily-stats/                 # Codex 每日统计
├── gemini-daily-stats/                # Gemini 每日统计
├── session-cache.json                 # 会话缓存
├── project-order.json                 # 项目排序
├── fork-relations.json                # 会话 Fork 关系
├── env-backups/                       # 环境配置备份
├── ui-config.json                     # UI 配置
├── notify-hook.js                     # 飞书通知钩子
├── mcp-config.json                    # MCP 服务器配置
├── terminal-config.json               # 终端配置
├── prompts.json                       # 自定义提示词
├── proxy-runtime.json                 # Claude 代理运行时状态
├── codex-proxy-runtime.json           # Codex 代理运行时状态
└── gemini-proxy-runtime.json          # Gemini 代理运行时状态
```

## 工具原生配置路径（不变）

以下路径仍使用各工具的原生路径，不受迁移影响：

### Claude Code
- `~/.claude/settings.json` - Claude Code 配置
- `~/.claude/settings.json.cc-tool-backup` - CTX 工具备份
- `~/.claude/projects/` - Claude 原生项目目录（仅供参考，CTX 不直接使用）
- `~/.claude/skills/` - Claude Skills 安装目录

### Codex
- `~/.codex/config.toml` - Codex 配置
- `~/.codex/config.toml.cc-tool-backup` - CTX 工具备份
- `~/.codex/auth.json` - Codex 认证
- `~/.codex/auth.json.cc-tool-backup` - CTX 工具备份
- `~/.codex/sessions/` - Codex 原生会话目录

### Gemini
- `~/.gemini/.env` - Gemini 环境配置
- `~/.gemini/.env.cc-tool-backup` - CTX 工具备份
- `~/.gemini/tmp/` - Gemini 临时文件目录

## 配置文件引用

所有需要使用路径的模块，请引入统一的路径配置：

```javascript
const { PATHS, NATIVE_PATHS } = require('./config/paths');

// 使用 CTX 工具目录
const channelsPath = PATHS.channels.claude;

// 使用工具原生配置
const claudeSettings = NATIVE_PATHS.claude.settings;
```

## 迁移步骤

如果您已经有旧的 `~/.claude/cc-tool` 数据，可以通过以下方式迁移：

```bash
# 1. 停止所有服务
ctx daemon stop
ctx proxy stop

# 2. 迁移数据目录
cp -r ~/.claude/cc-tool/* ~/.ctx/

# 3. 更新项目配置路径（如果项目在 ~/.claude/projects/）
# 编辑 ~/.ctx/projects/*/. claude-project.json 中的 path 字段

# 4. 重新启动服务
ctx daemon start
ctx ui
```

## 兼容性说明

- **向后兼容**：如果检测到 `~/.claude/cc-tool` 目录存在，会自动提示迁移
- **工具隔离**：原始 `ct` 工具和 `ctx` 工具完全独立，互不影响
- **配置独立**：渠道配置、统计数据、别名等完全分离

## 更新日志

- **v2.3.0** - 引入独立的 `~/.ctx` 目录结构
- 之前版本使用 `~/.claude/cc-tool` 目录
