# CLI 平台正确性边界设计

## 目标

修复配置驱动平台内核之外仍存在的平台硬编码和错误回退，使 CLI 与 HTTP transport 统一通过 Registry/Runtime 解析平台和能力，同时严格保留现有 CLI 命令、旧 API URL、正常响应结构以及 `legacy:*` Driver。

本轮是正确性边界修复，不完成 `legacy.js` 删除、共享 route profile 提取或全部平台实现重写。

## 问题

当前平台目录、Runtime、统一平台路由和 Web 平台目录已经配置驱动，但外围仍存在四类不一致：

1. `cli-type.js` 接受 Registry 中的平台，`ui/menu.js` 却只接受四个内置平台，其他值静默回退 Claude。
2. 交互式会话列表、搜索、工作区和恢复命令直接 import 或执行 Claude 实现，忽略 `currentCliType`。
3. Project Config、Commands、Agents 等 HTTP/service 入口维护独立平台白名单，已注册平台仍可能被外层拒绝；部分未知平台会静默回退 Claude。
4. Manifest route 引用不存在的 Driver operation 时，GET route 可能返回 200 空数据，掩盖配置或实现错误。

这些行为破坏同一 invariant：平台存在性应只由 Registry 决定，能力可用性应只由 capability Driver 决定。

## 决策

采用一个窄的平台访问模块作为共享 seam。CLI 与 HTTP transport 不再判断具体平台名，只提供平台 key、capability 和可选 operation。

不采用逐文件复制解析逻辑，因为那会形成第二套分散约定。不采用一次性删除全部 legacy Driver，因为其回归面超过正确性修复范围。

## 平台访问模块

新增跨 transport、与 Express/Inquirer 无关的平台访问模块。建议位置：

```text
src/platforms/access.js
```

模块 interface：

```js
resolvePlatform(key, options)
resolveCapability(key, capability, options)
resolveOperation(key, capability, operation, options)
```

返回值：

```js
{
  key,
  manifest,
  driver,
  operation
}
```

`resolvePlatform()` 只验证并返回 Registry definition。`resolveCapability()` 还验证 capability 声明并通过 Runtime 获取 Driver。`resolveOperation()` 再验证 Driver operation 存在。

依赖通过 options 注入，生产环境默认使用 `getPlatformContext()`：

```js
{
  registry,
  runtime,
  fallback
}
```

`fallback` 只适用于调用方没有提供平台值的兼容场景。只要调用方提供了非空平台值，未知值必须报错，绝不回退 Claude。

## 错误模型

平台访问错误包含稳定的机器字段：

```js
{
  code: 'not_found' | 'unsupported' | 'invalid' | 'failed',
  platform,
  capability,
  operation,
  message
}
```

错误语义：

| 场景 | code |
|---|---|
| 非空平台 key 未注册 | `not_found` |
| 已注册平台未声明 capability | `unsupported` |
| capability Driver 不存在 | `unsupported` |
| Driver 不提供 operation | `unsupported` |
| 调用参数格式错误 | `invalid` |
| Driver 创建或执行抛错 | `failed` |

HTTP 层继续使用现有状态映射：`invalid` 400、`not_found`/`unsupported` 404、`failed` 500。CLI 输出明确错误并停止当前操作，不改写配置、不访问 Claude 数据。

## CLI 数据流

### 平台选择与主菜单

`src/commands/cli-type.js` 继续从 Registry 生成可选平台。

`src/ui/menu.js` 删除平台枚举与具体 Driver implementation import。主菜单从 Registry definition 获取 label、terminalColor；通过 `resolveOperation()` 获取：

- `channels.current` 或 `channels.list`；
- `proxy.status`。

不支持某项能力时只隐藏或显示“不支持”的对应状态，不把整个平台变成 Claude。

### 会话列表与搜索

`src/commands/list.js` 和 `src/commands/search.js` 不再 import Claude sessions implementation。调用方传入当前平台，命令通过 Runtime 获取 `sessions` 和 `projects` Driver。

Driver interface 使用现有标准 operation：

```text
projects.listProjects(options)
sessions.recent(limit, options)
sessions.searchAcrossProjects(keyword, limit, options)
sessions.search(projectName, keyword, contextLength, options)
```

CLI 只格式化规范化 DTO。平台专属路径解析、项目显示名和会话文件结构留在 Driver。

如果 Driver 不支持跨项目搜索，CLI 返回明确 `unsupported`，不扫描 Claude 会话目录作为 fallback。

### 工作区

工作区自身的创建、删除和元数据仍由 `workspace-service` 管理。需要发现平台项目时，通过当前平台 `projects` Driver 获取项目集合，不再直接调用 Claude session implementation。

### 恢复会话

`src/commands/resume.js` 不再拼接硬编码的 `claude` 命令。恢复操作调用当前平台的 `sessions.launch(sessionId, options)`。

平台 Driver 负责：

- 可执行文件和参数；
- 工作目录；
- session ID/项目 ID 的平台格式；
- 继承 stdio；
- 子进程退出码。

本轮只要求内置平台保持已有可支持行为。尚无安全 launch 语义的平台返回 `unsupported`；不能退回 Claude。用户 Manifest 不允许直接声明任意 executable 或 shell 字符串，因此 generic Driver 默认不提供 `launch`。

## HTTP 与应用服务

以下模块删除独立平台 allowlist 或 fallback：

- Project Config API；
- Commands API/service；
- Agents API/service；
- MCP 中仅用于固定平台判定的常量；
- 共用的 managed platform resolver。

统一规则：

1. 请求层解析字符串和必填字段。
2. Registry 判断平台是否存在。
3. capability 判断功能是否存在。
4. Driver 或应用服务处理平台语义。

Project Config 已经通过 Runtime 构建 adapter；HTTP 层只需删除额外白名单并依赖该 seam。

Commands 和 Agents 在本轮不强制改造成新的 capability Driver。它们仍可维护内置平台的格式映射，但必须：

- 对已注册但实现不支持的平台返回 `unsupported`；
- 对未知平台返回 `not_found`；
- 不回退 Claude；
- 不声称 `resourceTypes.commands/agents` 支持即可自动获得专属实现。

这样先修正边界语义，不扩大为资源系统重写。

## Manifest 与路由验证

Manifest 加载阶段增加 route contract 校验：

1. capability 必须已声明；
2. operation 必须属于该 capability 的允许 operation 集；
3. request codec 名必须存在；
4. response codec 名必须存在；
5. method/path 仍遵循现有 schema。

operation contract 由代码中的只读表维护，不允许用户 Manifest 定义任意 executable behavior。该表只描述可调用的 interface，不包含平台实现。

`platform-route-factory` 的运行时规则改为：

- Driver 或 operation 缺失时一律返回结构化 `unsupported`；
- 不再因 GET 请求返回 200 空 payload；
- 正常 Driver 返回值、旧 aliases 和响应 codec 保持不变。

`emptyPayload()` 仅用于 Driver 明确返回成功但数据为空的正常化，不用于掩盖缺失实现。

## 兼容性

必须保留：

- `ctx claude|codex|gemini|opencode|omp start|stop|restart|status`；
- 现有 root aliases 和平台 API 前缀；
- 正常请求的响应字段和状态码；
- `legacy:*` Driver ID；
- `legacy.js` 及现有实现模块；
- 用户磁盘配置和会话数据格式；
- 现有 Web 平台目录接口。

有意改变：

- 未知平台不再回退 Claude；
- 已知平台缺少 capability/operation 不再伪造空成功；
- 当前平台不是 Claude 时，交互式 CLI 不再访问 Claude 会话或配置。

这些属于错误修复，不提供兼容 shim。

## 测试策略

行为测试必须覆盖：

1. 非空未知平台产生 `not_found`，且没有调用 Claude Driver。
2. 缺省平台仍按原公开契约使用 Claude，仅限明确允许 fallback 的入口。
3. `omp` 与测试用 `demo-cli` 在主菜单中不被归一为 Claude。
4. `demo-cli` 声明 generic projects/sessions 后，CLI 通过 Runtime Driver 读取。
5. 无 `sessions.launch` 的平台恢复会话返回 `unsupported`。
6. Project Config、Commands、Agents 对未知平台和已知但不支持的平台分别返回正确错误。
7. Manifest 拒绝未知 codec 和 capability/operation 组合。
8. route Driver 缺少 operation 时 GET/写请求均返回 `unsupported`。
9. 五个内置平台命令和旧 API aliases 的既有 contract 保持通过。
10. 平台 Driver contract、API contract、CLI command contract 和完整 unit suite 通过。

测试只断言可观察行为和 Driver 调用，不把源码正则扫描作为主要正确性证明。

## 实施顺序

1. 建立平台访问模块及错误 contract。
2. 修正 route validation 和 GET 空成功。
3. 移除 Project Config/Commands/Agents 的错误回退和 transport 白名单。
4. 迁移主菜单状态读取。
5. 迁移会话列表和搜索。
6. 迁移工作区项目发现。
7. 引入并迁移 session launch operation。
8. 运行聚焦回归、CLI smoke 和完整 unit suite。

每一步单独提交，并保持旧公开契约可运行。

## 非目标

- 删除 `legacy:*` 或 `legacy.js`；
- 重写五个平台的协议实现；
- 提取共享 API route profile；
- 修改 Manifest `enabled` 或 Registry `enabledOnly` 语义；
- 重构全部 Commands/Agents 内部格式映射；
- 允许用户 Manifest 执行任意命令或加载模块；
- 修改 Web UI 信息架构；
- 删除旧 URL、命令别名或响应字段。
