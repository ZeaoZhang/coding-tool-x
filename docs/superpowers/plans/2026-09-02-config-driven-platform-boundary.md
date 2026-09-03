# 配置化平台边界实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 删除平台专属 API 和项目配置适配器目录，把平台业务收敛到 Driver，把跨平台核心工具收敛到 `src/shared`。

**Architecture:** 保留一个通用 platform API route factory，使用 manifest 的 aliases、capabilities 和 route definitions 生成旧 URL；Driver 提供平台操作和校验。`src/server` 只保留 HTTP 注册、请求响应转换、通用服务与基础设施；`src/platforms/drivers/<platform>` 不创建 shared 子目录。

**Tech Stack:** Node.js 22、CommonJS、Express、Vitest、现有 Registry/Runtime/manifest loader。

---

### Task 1: 搬迁共享项目配置核心

**Files:**
- Create: `src/shared/project-config.js`
- Modify: `src/server/services/project-config-service.js`
- Modify: `src/server/services/mcp-service.js`
- Modify: `src/server/services/config-templates-service.js`
- Modify: `src/server/services/config-sync-manager.js`
- Modify: `src/server/services/skill-service.js`
- Modify: `src/server/services/skill-projection-service.js`
- Modify: `src/server/api/mcp.js`
- Create/modify: `src/platforms/drivers/{claude,codex,gemini,opencode,omp}/project-config.js`
- Delete: `src/server/services/project-config-adapters/`
- Test: affected project-config and MCP tests

- [ ] 将 `project-config-adapters/shared.js` 的通用路径安全、JSON/TOML 原子读写、MCP patch、secret 脱敏函数搬到 `src/shared/project-config.js`，只修正相对 import。
- [ ] 将五个平台 adapter 搬到对应 Driver 的 `project-config.js`，导出相同 `createAdapter`，平台格式仅由 Driver 自身实现。
- [ ] 修改 `ProjectConfigService`，从 Runtime/manifest 获取 `projectConfig` Driver，不再维护 `FACTORIES` 和旧目录路径。
- [ ] 将通用服务和 API 的 shared import 统一改为 `src/shared/project-config`。
- [ ] 删除旧 `project-config-adapters` 目录。
- [ ] 运行 `npx vitest run tests/unit/services/project-config-service.test.js tests/unit/services/mcp-service.test.js tests/unit/api/project-config.test.js --no-file-parallelism --maxWorkers=1`。

### Task 2: 建立配置化平台 API 路由描述

**Files:**
- Create: `src/server/api/platform-api-config.js`
- Modify: `src/platforms/manifest-schema.js`
- Modify: `src/platforms/manifests/*.json`
- Modify: `src/platforms/drivers/legacy.js`
- Modify: `src/server/api/platform-route-factory.js`
- Test: platform registry and route factory tests

- [ ] 为 manifest 增加可选 `api` 描述，包含平台旧 URL alias 和 capability route operation；schema 严格校验 path、method、capability、operation。
- [ ] 把各平台共同的 projects、sessions、channels、proxy、statistics 路由整理成一份配置，不复制五份 Express route 文件。
- [ ] 在 route factory 中统一解析 platform、project、session、channel 参数，调用 Runtime Driver，并统一映射 `ok/unsupported/invalid/failed`。
- [ ] 将仅平台不同的参数名、安装检测、默认值和校验作为 Driver operation 或 manifest data，不在路由 factory 中写平台分支。
- [ ] 为旧 `/api/channels`、`/api/codex/...`、`/api/gemini/...`、`/api/opencode/...`、`/api/omp/...` 注册 aliases。
- [ ] 添加未知平台、unsupported capability、Driver error 和旧 URL 等价响应测试。

### Task 3: 将平台 API 业务下沉到 Driver

**Files:**
- Create: `src/platforms/drivers/{claude,codex,gemini,opencode,omp}/api-operations.js`
- Modify: corresponding channel/proxy/session/statistics/config Driver files
- Modify: `src/server/index.js`
- Delete: platform-specific files under `src/server/api/`
- Modify: API tests to exercise generic router and old aliases

- [ ] 从平台 API 文件提取 provider 校验、CLI 安装检测、默认模型、speed-test、native config、session operation 和 platform DTO 到对应 `api-operations.js` 或现有 capability Driver。
- [ ] 保持旧请求参数和响应格式，由 operation adapter 生成兼容 DTO；通用路由只负责调用和输出。
- [ ] 让每个平台 Driver 暴露相同 operation names，不支持的 operation 返回结构化 `unsupported`。
- [ ] 用一个通用 router 替换 server index 中的平台 API require/mount 列表。
- [ ] 删除 `codex-channels.js`、`gemini-channels.js`、`opencode-channels.js`、`omp-channels.js`、各平台 proxy/projects/sessions/statistics API 文件及不再需要的单独路由目录。
- [ ] 保留真正通用的 `platform-route-factory.js`、validation、response 和 websocket 基础设施。

### Task 4: 清理引用和迁移测试

**Files:**
- Modify: all production imports of deleted API/config adapter paths
- Modify: tests under `tests/unit/api`, `tests/unit/services`, `tests/unit/platforms`
- Delete: tests that only assert deleted platform route modules

- [ ] 全局搜索并消除 `src/server/api/<platform>-*.js` 和 `src/server/services/project-config-adapters` 的生产及测试引用。
- [ ] 将 require.cache mock seam 改为 generic router 或 Driver operation seam。
- [ ] 删除仅覆盖重复路由实现的测试，保留每个平台的行为 contract test。
- [ ] 检查 `src/platforms/drivers` 不存在 `shared` 子目录。

### Task 5: 完整验证与提交

- [ ] 运行所有 API、Driver、项目配置和 CLI 相关测试。
- [ ] 运行完整 `npx vitest run tests/unit --no-file-parallelism --maxWorkers=1 --testTimeout=30000`。
- [ ] 运行所有平台 capability Driver 加载冒烟和 `git diff --check`。
- [ ] 检查工作树无测试生成数据库差异。
- [ ] 提交：`refactor: make platform APIs configuration-driven`。
