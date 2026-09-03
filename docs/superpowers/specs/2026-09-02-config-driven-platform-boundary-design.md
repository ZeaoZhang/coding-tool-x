# 配置化平台边界设计

## 目标

删除按平台复制的 API、项目配置适配器和共享目录，把平台差异集中到 Registry/Manifest 与 Driver；`src/server` 只保留通用应用、HTTP 注册和基础设施。

## 边界

### `src/platforms`

- Manifest 描述平台能力、路由别名、配置资源和可用操作。
- `src/platforms/drivers/<platform>/` 保存平台专属业务：渠道、代理、会话、统计、原生配置、项目配置和 CLI/API 操作。
- 平台目录不再创建 `shared` 子目录。

### `src/shared`

保存跨平台、与 HTTP 无关的核心工具：

- 项目配置文件读写和路径安全
- MCP 配置格式转换和 secret 脱敏
- Driver 结果、错误和调用上下文
- 通用模型、渠道、会话 DTO 转换

### `src/server`

- `src/server/api` 只保留通用路由工厂、请求解析、响应转换和路由注册。
- `src/server/services` 只保留通用应用服务、缓存、日志、调度和持久化基础设施。
- 不再保留 `codex-channels.js`、`gemini-proxy.js`、`project-config-adapters/codex.js` 等按平台文件。

## API 设计

统一路由从 manifest 和 capability 生成，兼容原有 URL 前缀：

```js
const route = {
  path: '/:platform/channels',
  capability: 'channels',
  operation: 'list'
};

const driver = runtime.getDriver(platform, route.capability);
const result = await driver[route.operation](requestContext);
return sendDriverResult(response, result);
```

平台 API 不再直接 import 具体 Driver 实现文件。平台专属校验、默认值、CLI 安装检测、配置文件路径和响应字段由 Driver 暴露的能力处理。

## 项目配置

`project-config-adapters/<platform>.js` 移入对应 Driver 的 `project-config.js`。跨平台文件工具和 MCP 安全逻辑移入 `src/shared/project-config`。`ProjectConfigService` 只按 manifest 获取 Driver adapter，不维护平台工厂表。

## 删除策略

- 删除重复的平台 API 路由文件和旧项目配置 adapter 目录。
- 删除迁移后没有生产调用方的兼容入口。
- 保留旧 URL，由统一路由注册器按 manifest aliases 注册。
- 不删除用户磁盘上的配置和会话数据。

## 验证

- 静态扫描确认 `src/server/api` 和 `src/server/services` 不再直接引用平台实现文件。
- 每个平台的 channels、proxy、nativeConfig、sessions、statistics、projectConfig Driver 均可通过 Runtime 获取。
- 完整 `tests/unit` 通过。
- 旧平台 API URL 的响应格式和状态码测试通过。
