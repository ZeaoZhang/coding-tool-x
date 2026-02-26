<div align="center">

<img src="docs/logo.png" alt="Coding-Tool-X Logo" width="140" />

# Coding-Tool-X

**Claude Code / Codex / Gemini CLI 增强工具**

智能会话管理 | 多渠道动态切换 | 实时 Token 监控

[![npm version](https://img.shields.io/npm/v/coding-tool-x.svg?style=flat-square)](https://www.npmjs.com/package/coding-tool-x)
[![npm downloads](https://img.shields.io/npm/dm/coding-tool-x.svg?style=flat-square)](https://www.npmjs.com/package/coding-tool-x)
[![GitHub stars](https://img.shields.io/github/stars/CooperJiang/cc-tool?style=flat-square)](https://github.com/ZeaoZhang/coding-tool/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg?style=flat-square)](package.json)

<br />

<img src="docs/home.png" alt="Coding-Tool Preview" width="90%" />

<p><sub>现代化 Web 界面 - 项目管理、会话浏览、实时日志监控</sub></p>

</div>

---

## ✨ 特性

| 功能 | 描述 |
|------|------|
| **智能会话管理** | 自动识别 Claude/Codex/Gemini 历史会话，支持命名、搜索、Fork 分支 |
| **多渠道负载均衡** | 同时启用多个渠道，按权重自动分配请求，支持并发控制和健康检查 |
| **动态渠道切换** | 管理多个 API 渠道，一键切换无需重启，成本优化与稳定性兼得 |
| **模型智能重定向** | 代理模式下自动将高成本模型重定向到低成本模型（如 opus → sonnet），大幅节省 token 消耗 |
| **实时 Token 监控** | 可视化展示每次请求的 Token 消耗（输入/输出/缓存命中） |
| **全局搜索** | `⌘/Ctrl + K` 跨项目搜索会话内容，快速定位历史对话 |
| **现代化 Web UI** | 响应式设计，支持亮色/暗色主题，三列拖拽排序 |

---

## 📦 安装

### npm（推荐）

```bash
npm install -g coding-tool-x
```

### 从源码构建

```bash
git clone https://github.com/ZeaoZhang/coding-tool.git
cd coding-tool
npm install && npm link
```

### 验证安装

```bash
ctx --version
```

---

## 🚀 快速开始

### 启动 Web UI（推荐）

```bash
ctx ui
```

浏览器自动打开 `http://localhost:19999`，即可开始管理会话和渠道。

### 命令行交互模式

```bash
ctx
```

启动交互式菜单，通过键盘完成会话管理和渠道切换。

---

## 📋 命令参考

### 核心命令

| 命令 | 描述 |
|------|------|
| `ctx` | 启动交互式命令行界面 |
| `ctx ui` | 启动 Web UI 管理界面 |
| `ctx update` | 检查并更新到最新版本 |
| `ctx --version` | 显示版本号 |
| `ctx --help` | 显示帮助信息 |

### 代理管理

| 命令 | 描述 |
|------|------|
| `ctx proxy start` | 启动代理服务（动态切换渠道） |
| `ctx proxy stop` | 停止代理服务 |
| `ctx proxy status` | 查看代理运行状态 |

### 后台运行（基于 PM2）

| 命令 | 描述 |
|------|------|
| `ctx daemon start` | 后台启动服务（可关闭终端） |
| `ctx daemon stop` | 停止后台服务 |
| `ctx daemon restart` | 重启后台服务 |
| `ctx daemon status` | 查看后台服务状态 |
| `ctx daemon logs` | 查看 PM2 运行日志 |

### 日志管理

| 命令 | 描述 |
|------|------|
| `ctx logs` | 查看所有日志 |
| `ctx logs ui` | 查看 Web UI 日志 |
| `ctx logs claude` | 查看 Claude 代理日志 |
| `ctx logs codex` | 查看 Codex 代理日志 |
| `ctx logs gemini` | 查看 Gemini 代理日志 |
| `ctx logs --follow` | 实时跟踪日志输出 |
| `ctx logs --lines 100` | 显示最后 100 行日志 |
| `ctx logs --clear` | 清空所有日志文件 |

### 系统工具

| 命令 | 描述 |
|------|------|
| `ctx doctor` | 运行系统诊断，检查配置和环境 |
| `ctx port` | 配置 Web UI 和各代理端口 |
| `ctx stats` | 查看使用统计（会话数、Token 等） |
| `ctx reset` | 重置配置文件 |

---

## 📖 核心功能

### 会话管理

- **多平台支持**：统一管理 Claude Code、Codex CLI、Gemini CLI 的会话
- **会话别名**：为会话设置易记的名称，方便识别
- **Fork 会话**：基于现有对话创建分支，探索不同方向
- **快速启动**：一键在终端中恢复历史会话

### 多渠道管理

- **多渠道负载均衡**：同时启用多个渠道，系统自动按权重分配请求
- **权重配置**：为每个渠道设置权重（1-100），高权重渠道获得更多流量
- **并发控制**：为每个渠道设置最大并发数，精细控制负载
- **健康检查**：自动检测渠道状态，问题渠道自动冻结和恢复
- **会话绑定**：可选开启，确保同一会话的请求发送到同一渠道
- **可视化配置**：添加、编辑、删除渠道，拖拽调整优先级
- **安全存储**：API Key 脱敏显示，配置本地加密存储

### 后台运行模式

- **PM2 集成**：基于 PM2 进程管理，稳定可靠
- **持久化运行**：启动后可关闭终端，服务持续运行
- **开机自启**：支持系统启动时自动启动服务
- **日志管理**：统一日志存储，支持实时查看和清理
- **状态监控**：随时查看后台服务运行状态

### 系统诊断与监控

- **健康检查**：`ctx doctor` 一键诊断系统健康状态
  - Node.js 版本兼容性检查
  - 配置文件完整性验证
  - 端口占用情况检测
  - 磁盘空间监控
- **日志管理**：`ctx logs` 查看和管理各类日志
  - 支持按类型筛选（UI/Claude/Codex/Gemini）
  - 实时跟踪模式（--follow）
  - 灵活的行数控制
- **使用统计**：`ctx stats` 查看详细统计信息
  - 会话数量和分布
  - Token 使用情况
  - API 调用统计

### 实时监控

- **WebSocket 推送**：实时查看 API 请求详情
- **Token 统计**：输入/输出/缓存写入/缓存命中分类统计
- **成本估算**：基于自定义价格计算 API 调用成本

---

## 🎨 使用技巧

<details>
<summary><b>多渠道负载均衡配置</b></summary>

1. 在 Web UI 的渠道管理中添加多个渠道
2. 点击渠道卡片上的「启用」按钮，启用需要参与负载均衡的渠道
3. 设置每个渠道的**权重**（1-100），权重越高获得的请求越多
4. 设置每个渠道的**最大并发数**，控制同时处理的请求数量
5. 启动代理后，系统自动按权重分配请求到各个启用的渠道

> **提示**：渠道出现问题时会自动冻结，恢复后自动解冻，无需人工干预

</details>

<details>
<summary><b>模型智能重定向（节省 Token）</b></summary>

在代理模式下，可以将高成本模型自动重定向到低成本模型，大幅节省 token 消耗。

**使用场景**：
- GitHub 插件或 oh-my-claudecode skills 默认使用 opus 模型
- 修改插件配置过于复杂，希望透明地降低成本

**配置步骤**：
1. 启动代理：`ctx proxy start`
2. 在 Web UI 中编辑渠道，展开「模型重定向」部分
3. 配置重定向规则，例如：
   - **Opus 重定向** → `claude-sonnet-4-5`（将所有 opus 请求重定向到 sonnet）
   - **Sonnet 重定向** → 留空（保持不变）
   - **Haiku 重定向** → 留空（保持不变）
4. 保存配置，重定向立即生效

**成本节省示例**：
- Opus → Sonnet：节省约 **80%** 成本（$15/M → $3/M 输入，$75/M → $15/M 输出）
- 对于大量使用 opus 的场景，成本节省非常显著

**验证重定向**：
- 查看代理服务器控制台，会输出重定向日志：
  ```
  [Model Redirect] claude-opus-4-20250514 → claude-sonnet-4-5 (channel: xxx)
  ```

> **注意**：模型重定向仅在代理开启时生效。代理关闭时，modelConfig 用于模型映射（写入 settings.json）。

详细文档：[docs/model-redirection.md](docs/model-redirection.md)

</details>

<details>
<summary><b>后台运行服务</b></summary>

1. 使用 `ctx daemon start` 启动后台服务
2. 服务启动后，可以安全关闭终端窗口
3. 使用 `ctx daemon status` 随时查看运行状态
4. 使用 `ctx daemon logs` 查看实时日志

> **优势**：无需保持终端窗口打开，服务持久运行

</details>

<details>
<summary><b>系统诊断</b></summary>

遇到问题时，首先运行 `ctx doctor` 进行全面诊断：

```bash
ctx doctor
```

诊断工具会自动检查：
- Node.js 版本是否兼容
- 配置文件是否正常
- 端口是否被占用
- 磁盘空间是否充足

并提供针对性的修复建议。

</details>

<details>
<summary><b>日志管理</b></summary>

查看实时日志，排查问题：

```bash
# 实时跟踪所有日志
ctx logs --follow

# 查看 Claude 代理日志的最后 100 行
ctx logs claude --lines 100

# 清空所有日志文件
ctx logs --clear
```

</details>

<details>
<summary><b>全局搜索</b></summary>

1. 在任意页面按 `⌘/Ctrl + K`
2. 输入关键词搜索所有项目的会话内容
3. 点击搜索结果直接启动对话

</details>

<details>
<summary><b>渠道管理</b></summary>

1. 在渠道列表中点击「启用/禁用」按钮切换渠道状态
2. 启用的渠道会自动参与负载均衡
3. 可以随时调整权重和并发数，实时生效
4. 渠道健康状态异常时可点击「重置」恢复

> **注意**：使用 `ctx daemon start` 后台运行时，渠道变更会实时生效

</details>

<details>
<summary><b>Fork 会话</b></summary>

1. 在会话列表中点击 Fork 按钮
2. 新会话继承原会话的所有历史消息
3. 可以基于相同上下文探索不同方向

</details>

---

## ❓ 常见问题

<details>
<summary>如何后台运行服务？</summary>

使用 `ctx daemon start` 启动后台服务，基于 PM2 进程管理，启动后可以安全关闭终端窗口。

查看状态：`ctx daemon status`
查看日志：`ctx daemon logs`
停止服务：`ctx daemon stop`

</details>

<details>
<summary>后台服务如何开机自启？</summary>

在 Web UI 的设置中，开启"开机自启"选项，或使用 API：

```bash
ctx daemon start
# 然后在 Web UI 设置中启用开机自启
```

</details>

<details>
<summary>如何查看运行日志？</summary>

使用 `ctx logs` 命令：

```bash
ctx logs              # 查看所有日志
ctx logs claude       # 查看 Claude 代理日志
ctx logs --follow     # 实时跟踪日志
ctx logs --clear      # 清空日志
```

日志文件存储在 `~/.cc-tool/logs/` 目录。

</details>

<details>
<summary>遇到问题如何诊断？</summary>

运行 `ctx doctor` 进行系统诊断，会自动检查：
- Node.js 版本
- 配置文件
- 端口占用
- 磁盘空间
- 进程状态

并提供针对性的修复建议。

</details>

<details>
<summary>如何配置多渠道负载均衡？</summary>

1. 添加多个渠道到系统
2. 启用需要参与负载均衡的渠道
3. 为每个渠道设置权重和最大并发数
4. 启动代理，系统自动按权重分配请求

渠道出现问题时会自动冻结，恢复后自动解冻。

</details>

<details>
<summary>动态切换不生效？</summary>

1.6.0 版本后，不再需要手动切换"默认渠道"。系统会自动在所有启用的渠道间进行负载均衡。

确保至少有一个渠道处于启用状态，代理启动后会自动使用。

</details>

<details>
<summary>实时日志不显示？</summary>

实时日志需要先开启「动态切换」功能，代理服务运行后才能捕获请求。

推荐使用 `ctx daemon start` 后台运行，然后通过 `ctx logs --follow` 查看实时日志。

</details>

<details>
<summary>如何备份配置？</summary>

直接复制以下目录即可备份所有配置和数据：
- 配置：`~/.cc-tool/`
- 日志：`~/.cc-tool/logs/`

</details>

---

## 📝 更新日志

### v2.4.0 (2026-01-18)

**模板管理增强**
- ♻️ 移除内置/自定义模板区分：所有模板在界面上不再显示"内置"或"自定义"标签
- 🔓 允许编辑所有模板：内置模板现在可以编辑和删除，编辑后自动保存为自定义覆盖版本
- 🎨 简化模板显示：配置模板下拉选项中不再显示"(内置)"后缀

查看完整更新日志：**[CHANGELOG.md](CHANGELOG.md)**

---

## 🤝 贡献

欢迎提交 [Issue](https://github.com/ZeaoZhang/coding-tool/issues) 和 [Pull Request](https://github.com/ZeaoZhang/coding-tool/pulls)！

---

## 📄 许可证

[MIT License](LICENSE) © 2026
