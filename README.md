# coding-tool-x

> 面向多种 Coding CLI 的本地工作台：统一管理项目与会话、模型渠道、配置资源和使用统计。

[![npm version](https://img.shields.io/npm/v/coding-tool-x?style=flat-square)](https://www.npmjs.com/package/coding-tool-x)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.13.0-43853d?style=flat-square)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/ZeaoZhang/coding-tool-x?style=flat-square)](https://github.com/ZeaoZhang/coding-tool-x/issues)

![coding-tool-x 首页预览](docs/home.png)

`coding-tool-x` 将常用的 Coding CLI 管理功能放在一个本地 Web UI 和 `ctx` 命令行入口中。它支持 Claude Code、Codex CLI、Gemini CLI、OpenCode、OMP 和 DSH；各平台的具体功能取决于其内置 Manifest 和实际可用能力。

## 功能

- **OAuth 管理与切换**：同步支持平台的本地 OAuth 凭证，在渠道配置中选择或切换账户、检查授权状态，并查看可用额度。
- **Token 计数与统计**：跨平台汇总请求数、Token 用量和费用，支持按模型、渠道等维度查看趋势与导出分析数据。
- **全局与项目配置**：分别管理全局及项目级 Skills、MCP；并集中管理 Prompts、Commands、Agents、Plugins 等资源，按平台能力同步到原生配置。
- **OMP 与 DSH 服务**：支持独立启停代理服务、查看运行状态，并管理相应渠道与配置；具体能力依平台实现而异。
- **项目与会话**：跨平台查看项目和会话、搜索历史、收藏会话，并在支持的平台上复制、删除或 Fork 会话。
- **工作区与扩展**：组织多个项目，支持 Git worktree 和配置模板；也可通过校验后的 Manifest 与内置 capability driver 接入兼容 CLI。

## 安装

需要 Node.js `>=22.13.0`。

```bash
npm install -g coding-tool-x
```

中国大陆网络环境也可以使用 npmmirror：

```bash
npm install -g coding-tool-x --registry=https://registry.npmmirror.com
```

安装后启动本地服务：

```bash
ctx start
```

打开 [http://localhost:19999](http://localhost:19999) 访问 Web UI。首次使用前，请先单独安装并初始化需要管理的 Coding CLI；`coding-tool-x` 不会替代这些 CLI 本身。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `ctx start` | 后台启动服务 |
| `ctx stop` / `ctx restart` | 停止或重启服务 |
| `ctx status` | 查看服务状态 |
| `ctx ui` | 在前台启动 Web UI |
| `ctx ui --https` | 以前台 HTTPS 模式启动 Web UI |
| `ctx doctor` | 检查运行环境 |
| `ctx logs --follow` | 实时查看日志 |
| `ctx stats` | 查看使用统计 |
| `ctx update` | 检查并更新 CLI |

平台代理可通过 `ctx <platform> start|stop|restart|status` 管理，例如 `ctx claude start`、`ctx codex start` 或 `ctx dsh start`。更多命令可运行 `ctx --help` 查看。

## 网络访问与安全

服务默认只监听本机。使用 `ctx ui --host` 可开启局域网访问；LAN 模式默认禁止远程写操作。如确实需要远程修改配置，可显式设置：

```bash
CC_TOOL_ALLOW_REMOTE_WRITE=true ctx ui --host
```

OAuth 凭证与项目配置由本地服务管理。请勿将密钥写入项目仓库或公开分享日志、配置导出文件。Skills、MCP 和项目级配置的具体行为见 [变更日志](CHANGELOG.md)。

## 数据与配置

应用数据默认保存在 `~/.cc-tool`。`coding-tool-x` 会读取或更新各 CLI 自己的原生配置；例如 Claude 使用 `~/.claude`、Codex 使用 `${CODEX_HOME:-~/.codex}`。原生目录和支持能力因平台而异。

平台 Manifest 位于 `~/.cc-tool/config/platforms.json`，原生路径覆盖位于 `~/.cc-tool/config/platform-paths.json`。扩展 Manifest 只能引用项目内置的 allowlisted driver，不支持加载任意 Node.js 模块或执行 shell 命令。

## 从源码运行

```bash
git clone https://github.com/ZeaoZhang/coding-tool-x.git
cd coding-tool-x
npm install
npm run build:web
npm link
```

开发命令：

```bash
npm run dev:server  # 后端开发模式
npm run dev:web     # 前端开发服务器
npm run build:web   # 构建前端
npm test            # 运行项目测试
```

## 文档与支持

- [GitHub Releases](https://github.com/ZeaoZhang/coding-tool-x/releases)
- [变更日志](CHANGELOG.md)
- [多渠道负载均衡说明](docs/multi-channel-load-balancing.md)
- [报告问题或提出功能建议](https://github.com/ZeaoZhang/coding-tool-x/issues)
- [npm 包](https://www.npmjs.com/package/coding-tool-x)

## 致谢

本项目基于 [CooperJiang/coding-tool](https://github.com/CooperJiang/coding-tool) 持续扩展。感谢上游项目以及所有提供反馈、测试和贡献的用户。

## License

[MIT](LICENSE)
