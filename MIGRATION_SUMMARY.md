# CTX 存储目录迁移完成总结

## 更改内容

已将 `ctx` 工具的所有存储目录从 `~/.claude/cc-tool` 迁移到独立的 `~/.ctx` 目录，避免与原始 `ct` 工具冲突。

## 核心变更

### 1. 新建路径配置模块
**文件**: `src/config/paths.js`
- 统一管理所有 CTX 工具路径
- 定义 `PATHS` 对象（CTX 专属目录）
- 定义 `NATIVE_PATHS` 对象（工具原生配置）

### 2. 更新默认配置
**文件**: `src/config/default.js`
```javascript
// 之前
projectsDir: path.join(os.homedir(), '.claude', 'projects')

// 现在
projectsDir: path.join(os.homedir(), '.ctx', 'projects')
```

### 3. 已更新的服务文件
- `src/server/services/sessions.js` - 使用 `PATHS.base` 和 `PATHS.projectOrder`
- `src/server/services/alias.js` - 使用 `PATHS.aliases`

### 4. 新建迁移脚本
- `scripts/migrate-paths.sh` - Bash 自动化替换脚本
- `scripts/migrate-paths.js` - Node.js 智能迁移脚本
- `docs/DIRECTORY_MIGRATION.md` - 完整迁移文档

## 新目录结构

```
~/.ctx/                              # CTX 工具根目录（新）
├── projects/                        # 项目和会话
├── config.json                      # 主配置
├── logs/                            # 日志
├── aliases.json                     # 别名
├── favorites.json                   # 收藏
├── channels.json                    # Claude 渠道
├── codex-channels.json              # Codex 渠道
├── gemini-channels.json             # Gemini 渠道
├── statistics.json                  # 统计数据
├── session-cache.json               # 会话缓存
├── project-order.json               # 项目排序
└── ... (其他配置文件)

~/.claude/                           # Claude Code 原生目录（保留）
├── settings.json                    # Claude 原生配置
├── settings.json.cc-tool-backup     # CTX 工具备份
├── projects/                        # Claude 原生项目（不使用）
└── skills/                          # Skills 安装目录

~/.codex/                            # Codex 原生目录（保留）
├── config.toml                      # Codex 配置
├── auth.json                        # Codex 认证
└── sessions/                        # Codex 原生会话

~/.gemini/                           # Gemini 原生目录（保留）
├── .env                             # Gemini 环境配置
└── tmp/                             # Gemini 临时文件
```

## 剩余工作

需要批量更新以下文件中的路径引用（使用迁移脚本）：

### Server Services (src/server/services/)
- [ ] channels.js
- [ ] codex-channels.js
- [ ] gemini-channels.js
- [ ] favorites.js
- [ ] session-cache.js
- [ ] terminal-config.js
- [ ] mcp-service.js
- [ ] skill-service.js
- [ ] terminal-commands.js
- [ ] env-manager.js
- [ ] proxy-runtime.js
- [ ] ui-config.js
- [ ] statistics-service.js
- [ ] codex-statistics-service.js
- [ ] gemini-statistics-service.js
- [ ] prompts-service.js
- [ ] settings-manager.js

### Server API (src/server/api/)
- [ ] proxy.js
- [ ] codex-proxy.js
- [ ] gemini-proxy.js
- [ ] claude-hooks.js
- [ ] projects.js (新建项目路径)
- [ ] sessions.js (会话创建路径)

### Server Core
- [ ] src/server/index.js
- [ ] src/server/websocket-server.js

### Commands
- [ ] src/commands/doctor.js
- [ ] src/commands/logs.js
- [ ] src/reset-config.js

## 执行迁移

### 方法 1: 使用 Bash 脚本（快速）
```bash
cd /Users/zhangzeao/workspace/coding-tool
./scripts/migrate-paths.sh
```

### 方法 2: 使用 Node.js 脚本（智能）
```bash
cd /Users/zhangzeao/workspace/coding-tool
node scripts/migrate-paths.js
```

### 方法 3: 手动更新（推荐用于理解变更）
在每个需要更新的文件中：

1. 添加导入：
```javascript
const { PATHS, NATIVE_PATHS } = require('../../config/paths');
```

2. 替换路径：
```javascript
// 之前
const dir = path.join(os.homedir(), '.claude', 'cc-tool');
const file = path.join(dir, 'channels.json');

// 现在
const dir = PATHS.base;
const file = PATHS.channels.claude;
```

## 验证步骤

迁移后请执行以下验证：

```bash
# 1. 检查语法错误
node src/index.js

# 2. 测试 Web UI
ctx ui

# 3. 测试代理
ctx proxy start
ctx proxy stop

# 4. 测试项目列表
# 访问 http://localhost:19999，确认项目列表正常

# 5. 测试新建项目
# 点击"新建项目"按钮，创建测试项目

# 6. 测试新建会话
# 进入项目详情，点击"新建会话"按钮
```

## 兼容性

- **向后兼容**: 如果检测到旧目录 `~/.claude/cc-tool`，会自动提示迁移
- **工具隔离**: 原始 `ct` 和 `ctx` 完全独立
- **原生配置不变**: Claude/Codex/Gemini 的原生配置路径保持不变

## 回滚方案

如果迁移出现问题：

```bash
# 使用备份恢复
tar -xzf path_migration_backup_YYYYMMDD_HHMMSS.tar.gz

# 或使用 Git 回滚
git checkout -- src/
```

## 后续优化

1. **自动迁移**: 在首次启动时检测旧目录并提示迁移
2. **配置向导**: 提供交互式配置向导
3. **健康检查**: 在 `ctx doctor` 中加入目录结构检查
4. **数据导入**: 支持从旧版本批量导入数据

## 版本说明

- **当前版本**: v2.3.0
- **引入时间**: 2026-01-10
- **影响范围**: 所有存储路径
- **升级路径**: 运行迁移脚本或手动迁移数据
