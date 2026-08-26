# Configuration-Driven CLI Platform Design

## Goal

将平台扩展重构为“Manifest + Capability Driver”架构：通用 CLI 能力由声明式配置和共享用例层提供；会话格式、原生配置、认证和代理协议等差异由能力 driver 隔离。

目标不是让任意 CLI 无条件获得全部功能，而是让符合已有通用协议的 CLI 只新增 Manifest；特殊 CLI 只新增对应 driver，不再复制一整套 API、服务、Dashboard 和前端代码。

现有五个平台 Claude、Codex、Gemini、OpenCode、OMP 的行为、CLI 命令、API 路径和原生文件保护规则保持不变。

## Current Problems

当前平台扩展的主要重复来自：

- `src/index.js` 在一个入口中集中处理服务、代理、日志、统计、插件和交互菜单。
- `src/server/index.js` 手动注册每个平台路由，并在 `autoRestoreProxies()` 中重复启动逻辑。
- `src/server/services/dashboard-snapshot-worker.js` 对项目、统计、渠道使用平台 `switch`。
- `src/shared/platforms.js` 与 `src/web/src/config/platforms.js` 各自维护平台定义。
- `src/web/src/components/channel/channelPanelFactories.js` 同时承载通用表单逻辑和各平台差异。
- `config-sync-manager.js` 已有配置类型定义，但同步、移除和批量处理仍按平台重复分支。
- `config-templates-service.js`、配置导出和统计聚合继续维护多份平台映射。

可复用的现有边界是 `src/server/services/session-history-adapters/`：索引层已经通过 `inventory()` 和 `parse()` 接收平台适配器。

## Scope

### Included

- 统一平台 Manifest 与 Registry。
- 将平台能力拆为独立 driver：项目、会话、渠道、代理、统计、资源同步、原生配置。
- 用 Registry 驱动 CLI、Dashboard、daemon 恢复、配置同步和服务端路由工厂。
- 后端作为平台目录的权威来源，前端消费安全的只读平台元数据。
- 保留现有模块路径、导出契约和测试 mock path。
- 以渐进迁移替代一次性重写。

### Excluded

- 不重写五个平台的协议实现。
- 不把所有平台强行统一成同一个代理或会话协议。
- 不允许用户配置动态加载任意 Node.js 模块。
- 不在本次设计中增加新的业务能力，例如新的 OAuth provider、统计维度或代理协议。
- 不改变现有公开 CLI 命令和现有 API 响应格式。

## Architecture

```text
CLI / HTTP API / Web UI
          |
          v
Transport adapters
          |
          v
Application use cases
(projects, sessions, channels, proxy, stats, sync)
          |
          v
Platform Registry
(manifest, capability check, path resolution, driver lookup)
          |
          +-------------------+
          v                   v
Capability drivers       Shared infrastructure
(session, channel,      storage, cache, logging,
 proxy, resources...)   snapshot, filesystem, network
```

### Platform Manifest

平台定义统一放在以下目录：

```text
src/platforms/
  manifests/
    claude.json
    codex.json
    gemini.json
    opencode.json
    omp.json
  registry.js
  path-resolver.js
  driver-registry.js
  drivers/
```

内置 Manifest 和用户扩展平台都使用同一份 schema。用户扩展配置放在 `~/.cc-tool/config/platforms.json`，内置定义仍随包发布。

Manifest 包含：

```json
{
  "key": "codex",
  "label": "Codex",
  "title": "Codex-CLI",
  "command": "codex",
  "iconToken": "code",
  "color": "#3b82f6",
  "defaultVisible": true,
  "paths": {
    "home": "$CODEX_HOME",
    "config": "{home}/config.toml",
    "sessions": "{home}/sessions"
  },
  "capabilities": {
    "projects": "codex",
    "sessions": "codex",
    "channels": "codex",
    "proxy": "codex",
    "statistics": "codex",
    "resourceSync": "standard"
  }
}
```

约束：

- `key` 全局唯一，只允许小写字母、数字、下划线和中划线。
- `paths` 只允许受控变量、用户目录和 Manifest 声明的相对路径。
- `capabilities` 的值必须指向已注册的 driver ID，不能任意填写模块路径。
- `iconToken` 是前端安全字符串，不在共享配置中存放 Vue 组件或函数。
- 用户平台不能覆盖内置平台 key。
- 用户平台可以使用内置 generic driver，但不能声明新的可执行代码。

### Platform Registry

Registry 提供以下职责：

```text
resolve(key)
list({ enabledOnly })
getCapability(key, capability)
resolvePaths(key)
getPublicDefinition(key)
```

`getPublicDefinition()` 只返回 UI 所需的 key、label、iconToken、color、defaultVisible 和能力状态；绝对路径、driver ID 和内部配置不返回浏览器。

Registry 初始化时完成 Manifest 校验。内置 Manifest 无效时启动失败；用户 Manifest 无效时只拒绝该条目并记录明确诊断，不影响其他平台。

### Capability Drivers

每种能力拥有独立契约，避免出现包含所有平台方法的巨型 `Platform` 基类。

核心契约：

```text
ProjectDriver
  listProjects(options)
  getProjectAndSessionCounts(options)
  deleteProject(projectId)

SessionDriver
  inventory()
  parse(descriptor)
  getMessages(sessionId, options)
  delete(sessionId)
  fork(sessionId, options)

ChannelDriver
  list()
  create(input)
  update(id, input)
  remove(id)
  syncCurrent()
  resetHealth(id)

ProxyDriver
  status()
  start(options)
  stop(options)

StatisticsDriver
  getTodayStatistics()
  getStatistics(range)

ResourceSyncDriver
  sync(type, name)
  remove(type, name)
```

driver 返回统一结果或规范化 DTO。平台特有字段通过 `extra` 或平台专用 DTO 扩展，不污染通用必需字段。

`session-history-adapters` 迁移为 `SessionDriver` 的兼容实现。已有 `inventory()` / `parse()` 适配器先保持不变，再逐步补齐读取和变更能力。

### Generic Drivers

提供少量受控的通用 driver：

- `generic-jsonl`：声明 glob、session ID、project 字段和消息字段映射。
- `generic-filesystem`：声明资源目录、文件扩展名、目录/文件语义。
- `generic-openai-compatible`：声明标准 OpenAI-compatible endpoint 和认证字段。
- `unsupported`：明确返回不支持，不伪造成功。

通用 driver 只能覆盖可声明的稳定协议。遇到特殊 SQLite schema、OAuth/keychain、非标准配置或特殊 fork 语义时，必须增加能力 driver。

## Application and Transport Changes

### CLI

CLI 入口只负责：

1. 解析命令和平台 key。
2. 从 Registry 取得平台和能力。
3. 调用 application use case。
4. 将统一结果格式化为终端输出。

平台列表、服务标签、端口标签和可用操作从 Registry 派生。现有 `ctx claude ...`、`ctx codex ...` 等命令保持不变。

### HTTP API

第一阶段不改变现有 API 路径。现有平台 API 模块改为稳定 facade，并由 route factory 复用通用 handler。

可新增只读目录接口：

```text
GET /api/platforms
```

现有 `/api/codex/...`、`/api/gemini/...` 等路径继续返回当前格式；新通用 handler 只复用内部 application 层，不要求前端立即迁移 URL。

### Dashboard and Daemon

Dashboard snapshot、统计聚合和 daemon proxy recovery 通过 Registry 遍历启用平台，再按 capability 选择 driver。不存在针对五个平台的重复 `switch`。

OMP 的 managed mode、gateway drain、原生配置恢复和退出清理作为 OMP 专用 ProxyDriver 语义保留，不能被 generic proxy driver 覆盖。

### Web UI

前端只通过 `/api/platforms` 获取平台元数据。接口不可用时仅使用最小 UI fallback，不保留第二份完整内置平台定义。`src/web/src/config/platforms.js` 最终只保留：

- API 返回值归一化；
- iconToken 到 Vue 图标的通用映射；
- UI fallback 和排序规则。

渠道面板拆成：

```text
common channel panel schema
  provider fields
  auth fields
  schedule fields
  health fields

platform manifest fields
  display metadata
  capabilities

platform channel driver schema
  platform-specific fields
  validation
  API serialization
```

Claude、Codex、Gemini、OpenCode、OMP 仍可保留各自特殊字段，但通用列表、健康状态、启停、删除和基础表单行为只实现一次。

## Error Model

统一结果状态：

```text
ok
unsupported
unavailable
invalid
failed
```

语义：

- `unsupported`：Manifest 未声明能力，映射为隐藏功能或 404。
- `unavailable`：CLI 未安装、目录不存在或环境不可用。
- `invalid`：Manifest 或用户输入不符合 schema。
- `failed`：driver 已支持，但实际 I/O、解析或网络操作失败。
- `ok`：操作成功。

显式传入未知平台时不得回退到 Claude。只有没有提供平台时，才允许使用默认平台。

错误必须带有 `platform`、`capability` 和 `operation` 上下文，并保留原始 cause。仅允许已有 snapshot 的 stale-while-refresh 行为作为明确的缓存策略，不能用空结果掩盖 driver 错误。

## Mock Path and Dependency Injection

现有路径保持不变并继续作为稳定测试 seam，包括：

```text
src/config/paths.js
src/server/services/channels.js
src/server/services/codex-channels.js
src/server/services/gemini-channels.js
src/server/services/opencode-channels.js
src/server/services/omp-channels.js
src/server/omp-proxy-server.js
src/server/api/channels.js
src/server/api/codex-channels.js
src/server/api/gemini-channels.js
src/server/api/opencode-channels.js
src/server/api/omp-channels.js
```

这些模块可以变成 facade，但不能在本次迁移中删除、改名或绕过其加载边界。现有测试继续使用：

```js
const modulePath = require.resolve('...');
require.cache[modulePath] = { ... };
```

通用 application 层增加显式依赖注入：

```text
createPlatformUseCases({
  registry,
  drivers,
  paths,
  storage,
  clock,
  logger
})
```

这样现有 `require.cache` mock 仍能拦截 facade，新测试可直接传入 fake Registry、fake driver、临时路径和固定时钟。

不将测试强制迁移到另一套 mock API，也不允许通用层在测试路径被替换后私自重新加载真实模块。

## Migration Plan

### Phase 1: Extract and Validate

- 从现有 `src/shared/platforms.js`、`paths.js` 和同步配置提取内置 Manifest。
- 建立 Registry、PathResolver、Manifest schema 和 driver allowlist。
- 保持现有模块与导出不变。
- 为五个平台增加 Manifest contract test。

### Phase 2: Migrate Read Paths

- 将 session-history adapters 接入 Registry。
- 迁移项目、会话、Dashboard snapshot 和统计聚合。
- 先保留现有 API facade，验证响应格式和快照行为不变。

### Phase 3: Migrate Mutations

- 迁移渠道 CRUD、健康检查、代理控制和配置同步。
- 用 route factory 替换平台 API 中重复的通用 handler。
- 保留 Claude/Codex/Gemini/OpenCode/OMP 的专用 driver。

### Phase 4: Migrate CLI and Web UI

- CLI 平台路由改为 Registry 派生。
- daemon 自动恢复改为 capability driver 遍历。
- 前端消费平台目录，拆分渠道面板通用 schema 与平台字段。

### Phase 5: Enable Config-Only Extensions

- 增加用户 `platforms.json` 的加载、校验和安全字段过滤。
- 将现有 `ui-config.customCliPlatforms` 作为兼容输入迁移到平台目录；迁移期间继续读取旧字段，但 `platforms.json` 成为运行时权威来源。
- 用虚拟 `demo-cli` 验证只添加 Manifest 和已存在的 generic driver 配置即可进入通用聚合。
- 仅当所有旧测试和 contract test 通过后删除重复平台数组和无法再被调用的旧分支。

## Testing Contract

### Existing Regression Tests

现有 unit、API、Windows、Codex、OMP、skill 和 plugin 测试继续运行。重构不能改变它们的 mock path、模块导出和外部响应契约。

### Manifest Contract Tests

每个 Manifest 必须覆盖：

- key 唯一且合法；
- label、command 和路径可解析；
- capability 与 driver allowlist 一致；
- 禁止覆盖内置平台；
- 不支持能力返回 `unsupported`。

### Driver Contract Tests

在临时目录和注入路径下验证：

- 正常 inventory / parse；
- 缺失、损坏和权限错误文件；
- 文件读取期间发生变化；
- CRUD 与删除幂等性；
- driver 错误包含平台、能力和操作上下文。

### Mock Compatibility Tests

验证：

- mock `paths.js` 后不会读取真实用户目录；
- mock 各平台 service facade 后不会偷偷加载真实 service；
- mock `omp-proxy-server.js` 后退出清理仍受测试控制；
- API 模块重新加载时仍使用 `require.cache` stub；
- 注入 `adapterRegistry` 后 session index 不访问真实平台目录。

### Config-Only Extension Test

加入虚拟 `demo-cli`：

1. 只注册 Manifest 和已存在的 generic driver。
2. 不修改 Dashboard、统计聚合、CLI router 和前端平台列表源码。
3. 验证 Registry、能力枚举、路径解析和通用聚合自动发现该平台。

## Acceptance Criteria

- 新增符合 generic-jsonl 或 generic-filesystem 契约的 CLI 时，不需要复制平台 API、服务或 Dashboard 分支。
- 特殊 CLI 只需要新增对应能力 driver，不需要新增一套完整平台栈。
- 现有五个平台的 CLI、API、原生配置保护、OMP managed mode 和退出恢复行为不变。
- 现有 `require.resolve()` + `require.cache` mock path 全部保持有效。
- 显式未知平台不会静默回退到 Claude。
- 前后端不再各自维护一份完整内置平台定义。
- 未支持能力返回明确的 `unsupported`，而不是空成功或隐式 fallback。
