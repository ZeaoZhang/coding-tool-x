# Coding-Tool-X

> 面向 Claude Code、Codex CLI、Gemini CLI、OpenCode 的统一增强控制台  
> Web UI + CLI + Proxy + Config Sync + MCP/Skills/Agents/Prompts 管理

本项目基于 [CooperJiang/coding-tool](https://github.com/CooperJiang/coding-tool) 扩展而来，在原有会话管理和渠道切换能力之上，继续补齐了多平台代理、配置同步、工作区编排、MCP 管理、Skills/Commands/Agents 管理、OAuth 凭证管理、配置导入导出、OpenCode 适配与分析面板等能力。

![Home Preview](docs/home.png)

## 项目定位

`coding-tool-x` 不只是一个会话浏览器，而是一个多平台代理与配置中枢：

- 统一查看 Claude / Codex / Gemini / OpenCode 的项目与会话
- 为各平台配置多渠道、代理、模型重定向、测速与健康检查
- 管理并同步 Prompts、Skills、Commands、Agents、MCP、插件配置
- 提供工作区、Git worktree、配置模板、导入导出与诊断能力
- 通过 Web 面板查看实时日志、请求统计、Token/费用趋势

## 当前核心能力

### 1. 多平台会话与代理

- 统一管理 `Claude`、`Codex`、`Gemini`、`OpenCode` 四类项目与会话
- 支持会话别名、最近会话、全局搜索、会话 Fork、跨平台会话转换
- 每个平台都有独立代理入口与独立端口
- 支持多渠道启用/停用、测速、健康状态、优先级与模型列表探测
- 支持 Claude / Codex / Gemini 的模型重定向与默认测速模型配置
- OpenCode 支持网关适配与会话格式转换/导出

### 2. 配置与同步中枢

- 集中存储项目配置到 `~/.cc-tool`
- 自动读写平台原生配置目录，而不是替换你的平台使用方式
- 支持 Prompts 预设创建、激活、停用与平台状态查看
- 支持配置模板、工作区模板与导入配置时的预览
- 支持 ZIP / JSON 配置导入导出
- 支持 Claude / Codex / Gemini / OpenCode 的配置同步

### 3. 扩展能力

- MCP 服务器管理、平台启用开关、连通性测试、预设与导入
- Skills 管理：远程仓库安装、本地托管、详情查看、按平台安装
- Commands 管理：当前支持 Claude / OpenCode
- Agents 管理：当前支持 Claude / Codex / OpenCode
- 插件系统：支持 Git 安装、启用/禁用、升级、配置
- OAuth 凭证管理：集中管理 Claude / Codex / Gemini / OpenCode OAuth 数据

### 4. 运维与观测

- 首页 Dashboard 按平台展示状态卡、代理状态、实时日志和快捷操作
- Analytics 页面查看多平台请求数、Token、费用趋势并导出 CSV/JSON
- `ctx logs` 查看 UI/代理日志，支持 `--follow` / `--lines` / `--clear`
- `ctx stats` 查看总体和分平台统计
- `ctx doctor` 做环境、端口、配置、日志、磁盘与进程诊断
- Web UI 支持访问密码；`--host` 暴露 LAN 时默认禁止远程写操作


## 架构概览

### CLI 层

- 命令入口：`bin/ctx.js`
- 主逻辑：`src/index.js`
- 后台运行：PM2 管理 `ctx start / stop / restart / status`

### 服务端

- Express API：`src/server/index.js`
- WebSocket：用于 Dashboard / 日志 / 状态推送
- API 范围覆盖：
  - 项目 / 会话
  - 渠道 / 代理
  - Skills / Commands / Agents / Plugins
  - Prompts / MCP / OAuth / Config Export / Config Sync
  - Dashboard / Analytics / Security / Workspace

### 前端

- Vue 3 + Vite + Pinia + Naive UI + ECharts
- 主要页面：
  - Dashboard 首页
  - 四个平台的项目/会话列表
  - Workspaces
  - Config Templates
  - Skills
  - Plugins
  - Analytics

## 安装

### 方式 1：全局安装

```bash
npm install -g coding-tool-x
```

### 方式 2：从源码运行

```bash
git clone https://github.com/ZeaoZhang/coding-tool.git
cd coding-tool
npm install
npm run build:web
npm link
```

### 环境要求

- Node.js `>= 14.0.0`（仓库当前 `package.json` 的声明）
- 建议先至少运行过目标 CLI 一次，以便生成其原生配置目录

### 验证安装

```bash
ctx --version
ctx --help
```

## 快速开始

### 推荐方式：后台启动整套服务

```bash
ctx start
ctx status
```

默认访问地址：

- Web UI: `http://localhost:19999`

### 前台启动 Web UI

```bash
ctx ui
```

### 开启 LAN 访问

```bash
ctx ui --host
```

说明：

- `--host` 会让服务监听 `0.0.0.0`
- LAN 模式下，服务端默认阻止远程写操作
- 如确需允许远程写操作，可显式设置环境变量：

```bash
CC_TOOL_ALLOW_REMOTE_WRITE=true ctx ui --host
```

### 分平台启动代理

```bash
ctx claude start
ctx codex start
ctx gemini start
ctx opencode start
```

## 常用命令

### 服务与 UI

| 命令 | 说明 |
| --- | --- |
| `ctx start` | 后台启动服务（推荐） |
| `ctx stop` | 停止后台服务 |
| `ctx restart` | 重启后台服务 |
| `ctx status` | 查看后台服务状态 |
| `ctx ui` | 前台启动 Web UI |
| `ctx ui --host` | 前台启动 Web UI 并允许局域网访问 |

### 分平台代理

| 命令 | 说明 |
| --- | --- |
| `ctx claude start|stop|restart|status` | Claude 代理管理 |
| `ctx codex start|stop|restart|status` | Codex 代理管理 |
| `ctx gemini start|stop|restart|status` | Gemini 代理管理 |
| `ctx opencode start|stop|restart|status` | OpenCode 代理管理 |

### 日志、统计、诊断

| 命令 | 说明 |
| --- | --- |
| `ctx logs` | 查看全部日志 |
| `ctx logs ui` | 查看 UI 日志 |
| `ctx logs claude` | 查看 Claude 代理日志 |
| `ctx logs --follow` | 实时追踪日志 |
| `ctx logs --lines 100` | 查看最近 100 行 |
| `ctx logs --clear` | 清空日志 |
| `ctx stats` | 查看总体统计 |
| `ctx stats claude` | 查看某个平台统计 |
| `ctx stats export` | 导出统计数据 |
| `ctx doctor` | 运行系统诊断 |

### 配置与维护

| 命令 | 说明 |
| --- | --- |
| `ctx update` | 检查并更新版本 |
| `ctx port` | 配置默认端口 |
| `ctx reset` | 重置 cc-tool 配置 |
| `ctx security reset` | 清除 Web UI 访问密码 |
| `ctx plugin list` | 查看已安装插件 |
| `ctx plugin install <git-url>` | 从 Git 安装插件 |

### 兼容命令

`ctx proxy start|stop|status` 仍然保留，但它是偏旧的 Claude 兼容入口。当前更推荐使用按平台拆分的命令：`ctx claude ...`、`ctx codex ...`、`ctx gemini ...`、`ctx opencode ...`。

## Web UI 主要模块

### 首页 Dashboard

- 四个平台列式面板
- 拖拽排序
- 代理状态
- 实时日志
- 快捷操作

### 项目 / 会话

- 项目列表与排序
- 最近会话
- 全局搜索
- 会话别名
- 会话 Fork
- 会话详情查看

### 工作区

- 聚合多个项目为一个工作区
- 支持为 Git 仓库创建 worktree
- 支持使用工作区内配置模版

### 配置与扩展

- Config Templates
- Prompts
- Skills
- Commands
- Agents
- MCP
- Plugins
- OAuth Credentials
- Config Export / Import

### Analytics

- 多平台统一统计
- 模型 / 渠道 / 工具维度分析
- 1d / 3d / 7d / 30d / 90d / 自定义区间
- CSV / JSON 导出

## 默认端口

| 服务 | 默认端口 |
| --- | --- |
| Web UI / WebSocket | `19999` |
| Claude Proxy | `20088` |
| Codex Proxy | `20089` |
| Gemini Proxy | `20090` |
| OpenCode Proxy | `20091` |

可通过 `ctx port` 修改。

## 目录与数据存放

### Coding-Tool-X 中央目录

默认集中存放在：

```text
~/.cc-tool
```

其中常见文件/目录包括：

- `config/`：主配置、UI 配置、Prompts、MCP、OAuth、工作区等集中配置
- `storage/`：渠道、运行时状态、统计、缓存、请求快照、托管 skills 仓库等内部数据
- `logs/`：日志
- `configs/`：同步管理的 skills / commands / agents / plugins
- `plugins/`：插件安装与插件配置

### 平台原生配置目录

工具会继续读写各平台的原生配置目录：

- Claude：`~/.claude`
- Codex：`${CODEX_HOME:-~/.codex}`
- Gemini：`~/.gemini`
- OpenCode：按系统/XDG 规则解析，常见为：
  - 配置：`~/.config/opencode`
  - 数据：`~/.local/share/opencode`

说明：

- Coding-Tool-X 负责集中管理与同步
- 平台自身仍然可以直接使用原生目录
- 仓库内实现对旧的 `~/.claude/cc-tool` 数据做自动迁移

## 开发

### 安装依赖

```bash
npm install
```

### 启动前端开发服务器

```bash
npm run dev:web
```

### 启动后端开发模式

```bash
npm run dev:server
```

### 构建前端

```bash
npm run build:web
```

### 运行测试

```bash
npm test
```

当前仓库内置的测试覆盖了基础命令、API 一致性、Codex agents 与 skills provider 回归。

## 与上游仓库的关系

本仓库不是对上游 README 的原样搬运，而是在 [CooperJiang/coding-tool](https://github.com/CooperJiang/coding-tool) 的基础上继续演进。当前代码相较原始项目，重点扩展在：

- 四平台统一支持：Claude / Codex / Gemini / OpenCode
- 分平台代理与统计体系
- OpenCode 网关适配、会话转换与导出
- Skills / Commands / Agents / Prompts / MCP 的集中管理
- OAuth 凭证管理与原生配置同步
- 工作区、Git worktree、配置模板、配置导入导出
- 更完整的 Dashboard 与 Analytics 面板

## 已知说明

- `ctx ui --host` 开启 LAN 访问时，默认不允许远程写操作，这是服务端的安全保护，不是故障。
- 部分高级能力依赖目标平台本身的原生目录存在；首次使用前请先启动对应 CLI。

## 相关文档

- [CHANGELOG.md](CHANGELOG.md)
- [docs/multi-channel-load-balancing.md](docs/multi-channel-load-balancing.md)
- [src/web/README.md](src/web/README.md)

## License

[MIT](LICENSE)
