# Configuration-Driven CLI Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将平台扩展改造成 Manifest + Capability Driver 架构，让符合通用协议的 CLI 只需增加安全的 Manifest 配置，同时保持现有五个平台行为和测试 mock path。

**Architecture:** 内置和用户平台由 `Platform Registry` 统一加载、校验和暴露。项目、会话、渠道、代理、统计和资源同步分别使用能力 driver；Claude、Codex、Gemini、OpenCode、OMP 的现有模块保留为稳定 facade 和专用 driver。CLI、HTTP、Dashboard 和 Web UI 只依赖 Registry 与 application use case，不直接维护平台 `switch`。

**Tech Stack:** Node.js >= 22.13.0、CommonJS、Express、AJV、Vitest、Vue 3、Vite、Pinia、现有 `require.resolve()` + `require.cache` 测试 seam。

---

## Constraints and Working-Tree Safety

- 不重置、覆盖或格式化当前已有的 skill 相关未提交修改：`package-lock.json`、`scripts/test-skill-providers.js`、`src/server/api/plugins.js`、`src/server/api/skills.js`、`src/server/services/skill-service.js`、`tests/unit/services/skill-service.test.js` 和两个 SQLite WAL 文件。
- 每个提交只 `git add` 本任务明确列出的文件。
- 保留现有模块路径和导出名称，尤其是 `src/config/paths.js`、五个平台 channel service、五个平台 proxy server 和对应 API facade。
- 不在迁移中改变公开 CLI 命令、现有 API 路径、OMP managed mode 或原生配置恢复语义。
- 每个任务先写行为测试，再写实现；任务内只运行对应的 focused test，整套测试放在最终验证任务运行。

## File Map

### New core files

- `src/platforms/manifest-schema.js`: Manifest 的 AJV schema、校验错误格式和 driver ID allowlist 校验。
- `src/platforms/manifests/*.json`: Claude、Codex、Gemini、OpenCode、OMP 的内置声明。
- `src/platforms/path-resolver.js`: 受控环境变量、`{home}` 模板和内置特殊路径解析。
- `src/platforms/driver-registry.js`: capability driver 注册、allowlist 和 lazy factory。
- `src/platforms/registry.js`: 内置 Manifest、`~/.cc-tool/config/platforms.json`、旧 UI 配置兼容数据的合并与公开字段投影。
- `src/platforms/runtime.js`: Registry、PathResolver、DriverRegistry 和基础依赖的组合入口。
- `src/platforms/drivers/unsupported.js`: 明确返回 `unsupported` 的 driver。
- `src/platforms/drivers/generic-jsonl.js`: 声明式 JSONL 会话 inventory/parse driver。
- `src/platforms/drivers/generic-filesystem.js`: 声明式目录/文件资源同步 driver。
- `src/platforms/drivers/generic-openai-compatible.js`: 标准 OpenAI-compatible 渠道传输 driver。
- `src/platforms/drivers/legacy.js`: 通过原有模块路径懒加载现有平台实现的 driver factory。
- `src/server/api/platforms.js`: 平台目录和通用平台能力 API。
- `src/server/api/platform-route-factory.js`: 新平台使用的通用 route factory。
- `src/web/src/api/platforms.js`: 平台目录 API client。
- `src/web/src/stores/platforms.js`: 前端平台目录的加载、缓存和状态。
- `src/web/src/config/iconTokens.js`: `iconToken` 到 Vue 图标组件的唯一映射。
- `src/web/src/components/channel/commonChannelSchema.js`: 通用渠道表单 schema。

### Existing files to modify

- `package.json`: 将 `src/platforms/` 纳入发布文件。
- `src/config/paths.js`: 增加中心平台配置文件路径，同时保留既有 `PATHS`、`NATIVE_PATHS` 结构。
- `src/shared/platforms.js`: 保留规范化函数，改为消费 Registry 投影或调用共享归一化逻辑。
- `src/server/services/session-history-adapters/index.js`: 保留路径和导出，接入 Registry 的 session driver 兼容层。
- `src/server/services/session-history-index.js`: 默认 adapter 从 runtime 获取，显式 `adapterRegistry` 仍优先。
- `src/server/services/dashboard-snapshot-worker.js`: 用 capability driver 替换平台聚合 `switch`。
- `src/server/index.js`: 挂载平台目录 API，逐步切换自动恢复和 route registration。
- `src/server/services/config-sync-manager.js`: 增加 `syncToPlatform`，让批量同步遍历 Registry。
- `src/server/services/config-registry-service.js`: 平台集合和支持矩阵从 Registry 派生。
- `src/server/services/config-export-service.js`: 平台 snapshot 和 native config 通过 driver 获取。
- `src/server/services/config-templates-service.js`: AI config 文件名和支持平台从 Manifest 派生。
- `src/server/services/ui-config.js`: 读取旧 `customCliPlatforms` 并迁移到 `platforms.json`。
- `src/commands/proxy-control.js`: 标签、端点和可用平台从 Registry 获取。
- `src/commands/toggle-proxy.js`: 通过 ProxyDriver 解析平台。
- `src/commands/daemon.js`: 端口和状态输出遍历 Registry。
- `src/commands/cli-type.js`: 类型选项从 Registry 派生。
- `src/index.js`: 保留兼容命令，平台路由使用 command registry。
- `src/web/src/config/platforms.js`: 删除完整内置平台副本，只保留 API 归一化、图标和排序 fallback。
- `src/web/src/api/channels.js`: 增加基于 platform key 的通用请求函数，保留旧导出。
- `src/web/src/components/channel/channelPanelFactories.js`: 提取 common schema，保留平台专用字段和 driver。
- `src/web/src/composables/useUIConfig.js`、`src/web/src/views/Home.vue`、`SettingsDrawer.vue` 及平台面板：消费 reactive platform catalog。

- `src/web/vitest.config.js`: 扩展前端测试发现范围。
### New test files

- `tests/unit/platforms/manifest-schema.test.js`
- `tests/unit/platforms/path-resolver.test.js`
- `tests/unit/platforms/registry.test.js`
- `tests/unit/platforms/generic-drivers.test.js`
- `tests/unit/platforms/legacy-drivers.test.js`
- `tests/unit/services/dashboard-snapshot-worker.test.js`
- `tests/unit/api/platforms-api.test.js`
- `tests/unit/commands/proxy-control.test.js`
- `tests/unit/commands/platform-command-registry.test.js`
- `tests/unit/commands/cli-type.test.js`
- `src/web/src/config/__tests__/platforms.test.js`
- `src/web/src/components/channel/__tests__/commonChannelSchema.test.js`

---

### Task 1: Add Manifest Schema and Registry Foundation

**Files:**
- Create: `src/platforms/manifest-schema.js`
- Create: `src/platforms/manifests/claude.json`
- Create: `src/platforms/manifests/codex.json`
- Create: `src/platforms/manifests/gemini.json`
- Create: `src/platforms/manifests/opencode.json`
- Create: `src/platforms/manifests/omp.json`
- Create: `src/platforms/path-resolver.js`
- Create: `src/platforms/registry.js`
- Create: `src/platforms/runtime.js`
- Modify: `src/config/paths.js`
- Modify: `package.json`
- Test: `tests/unit/platforms/manifest-schema.test.js`
- Test: `tests/unit/platforms/path-resolver.test.js`
- Test: `tests/unit/platforms/registry.test.js`

- [ ] **Step 1: Write failing Manifest validation tests**

```js
const { validateManifest, normalizeManifestError } = require('../../../src/platforms/manifest-schema');

test('accepts a valid generic platform manifest', () => {
  const result = validateManifest({
    key: 'demo-cli',
    label: 'Demo CLI',
    command: 'demo',
    iconToken: 'terminal',
    paths: { home: '~/.demo', sessions: '{home}/sessions' },
    capabilities: { sessions: 'generic-jsonl' }
  });

  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
});

test('rejects executable module paths and unknown drivers', () => {
  const result = validateManifest({
    key: 'bad-cli',
    label: 'Bad',
    command: 'bad',
    driverModule: '/tmp/driver.js',
    capabilities: { sessions: 'user-code' }
  });

  expect(result.valid).toBe(false);
  expect(normalizeManifestError(result.errors)).toContain('driver');
});

test('rejects duplicate or malformed platform keys', () => {
  const result = validateManifest({
    key: 'Bad Key',
    label: 'Bad',
    command: 'bad',
    capabilities: {}
  });

  expect(result.valid).toBe(false);
  expect(normalizeManifestError(result.errors)).toContain('key');
});
```

- [ ] **Step 2: Run focused tests and verify the foundation is absent**

Run: `npx vitest run tests/unit/platforms/manifest-schema.test.js`
Expected: FAIL because `src/platforms/manifest-schema.js` does not exist.

- [ ] **Step 3: Implement the schema and safe validation result**

Use the existing `ajv` dependency and export exactly:

```js
const Ajv = require('ajv');

const DRIVER_IDS = new Set([
  'unsupported',
  'generic-jsonl',
  'generic-filesystem',
  'generic-openai-compatible',
  'legacy:claude',
  'legacy:codex',
  'legacy:gemini',
  'legacy:opencode',
  'legacy:omp'
]);

const PATH_RESOLVER_IDS = new Set([
  'declarative',
  'claude',
  'codex',
  'gemini',
  'opencode',
  'omp'
]);

const schema = {
  type: 'object',
  required: ['key', 'label', 'command', 'capabilities'],
  additionalProperties: false,
  properties: {
    key: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' },
    label: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    command: { type: 'string', minLength: 1 },
    iconToken: { type: 'string', minLength: 1 },
    color: { type: 'string' },
    defaultVisible: { type: 'boolean' },
    custom: { type: 'boolean' },
    apiBasePath: { type: 'string', minLength: 1 },
    logFile: { type: 'string', minLength: 1 },
    logAliases: { type: 'array', items: { type: 'string', minLength: 1 } },
    portKey: { type: 'string', minLength: 1 },
    defaultPort: { type: 'integer', minimum: 1 },
    statisticsPath: { type: 'string', minLength: 1 },
    promptFile: { type: ['string', 'null'] },
    paths: { type: 'object', additionalProperties: { type: 'string' } },
    pathResolverId: { enum: [...PATH_RESOLVER_IDS] },
    sessionMapping: { type: 'object', additionalProperties: { type: 'string' } },
    resourceMappings: { type: 'object', additionalProperties: { type: 'string' } },
    capabilities: {
      type: 'object',
      additionalProperties: { enum: [...DRIVER_IDS] }
    }
  }
};

const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

function validateManifest(manifest) {
  const valid = validate(manifest);
  return { valid, errors: valid ? [] : (validate.errors || []) };
}

function normalizeManifestError(errors = []) {
  return errors.map(error => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

module.exports = { DRIVER_IDS, PATH_RESOLVER_IDS, schema, validateManifest, normalizeManifestError };
```

The implementation must additionally reject `capabilities` whose value is not in `DRIVER_IDS`; do not accept arbitrary `modulePath` fields.

- [ ] **Step 4: Add path resolution tests with injected environment and command runner**

```js
const { resolveManifestPaths } = require('../../../src/platforms/path-resolver');

test('expands home and environment values without touching the real home directory', () => {
  const paths = resolveManifestPaths({
    key: 'demo-cli',
    paths: { home: '$DEMO_HOME', sessions: '{home}/sessions' }
  }, { env: { DEMO_HOME: '/tmp/demo-home' }, homeDir: '/tmp/test-home' });

  expect(paths).toEqual({
    home: '/tmp/demo-home',
    sessions: '/tmp/demo-home/sessions'
  });
});

test('uses the injected OMP command runner for special native paths', () => {
  const paths = resolveManifestPaths({ key: 'omp', pathResolverId: 'omp' }, {
    env: { OMP_COMMAND: 'omp' },
    commandRunner: () => '/tmp/omp-agent\n'
  });

  expect(paths.home).toBe('/tmp/omp-agent');
});
```

- [ ] **Step 5: Implement `PathResolver` and add the center config path**

`resolveManifestPaths(manifest, { env, homeDir, commandRunner })` must:

```js
function resolveTemplate(value, resolved) {
  return String(value)
    .replace(/\$([A-Z][A-Z0-9_]*)/g, (_, name) => resolved.env[name] || '')
    .replace(/\{home\}/g, resolved.home);
}
```

It must support `~`, `$ENV_NAME`, `{home}`, path normalization, and the existing OMP command/profile path behavior. It must reject an empty required root and never resolve a path outside the configured home unless the Manifest explicitly uses an absolute path.

Add `PATHS.platforms = path.join(CONFIG_DIR, 'platforms.json')` in `src/config/paths.js`. Existing tests that provide partial `PATHS` objects must continue to work through a fallback:

```js
const platformsFile = PATHS.platforms || path.join(PATHS.config || process.cwd(), 'platforms.json');
```

- [ ] **Step 6: Add the five built-in Manifests**

Each JSON file must contain the current display metadata, path resolver ID when native paths are special, and capability IDs. The OMP Manifest must keep `proxy: 'legacy:omp'`; it must not be assigned the generic proxy driver.

- [ ] **Step 7: Implement Registry and Runtime with deterministic merge rules**

Export:

```js
function createPlatformRegistry({ builtIns, userFile, legacyUiConfig, fsImpl, logger } = {}) {
  return {
    resolve(key),
    list({ enabledOnly = false } = {}),
    getCapability(key, capability),
    resolvePaths(key, options),
    getPublicDefinition(key),
    diagnostics()
  };
}

function createPlatformRuntime({ registry, driverRegistry, dependencies = {} } = {}) {
  return {
    registry,
    getDriver(platform, capability, context = {}),
    invoke(platform, capability, operation, args = [])
  };
}
```

`runtime.js` also exports lazy `getPlatformRegistry()` and `getPlatformRuntime()` singletons for production callers. Tests use `createPlatformRegistry()` and `createPlatformRuntime()` directly to avoid global state.

Merge order is built-in definitions, then valid user definitions, with built-in keys winning. Legacy `ui-config.customCliPlatforms` is metadata-only until Task 9 migration. An invalid user entry is excluded and added to `diagnostics()`; an invalid built-in entry throws.

- [ ] **Step 8: Add Registry tests and package inclusion**

```js
const { createPlatformRegistry } = require('../../../src/platforms/registry');
test('resolves built-ins and rejects a user override', () => {
  const registry = createPlatformRegistry({
    builtIns: [{ key: 'claude', label: 'Claude', command: 'claude', capabilities: {} }],
    userFile: {
      platforms: [
        { key: 'claude', label: 'Fake Claude', command: 'fake', capabilities: {} },
        { key: 'demo-cli', label: 'Demo', command: 'demo', capabilities: { sessions: 'generic-jsonl' } }
      ]
    }
  });

  expect(registry.resolve('claude').label).toBe('Claude');
  expect(registry.resolve('demo-cli').label).toBe('Demo');
  expect(registry.diagnostics()).toEqual([]);
});
```

Add `src/platforms/` to the `files` array in `package.json`. Run: `npx vitest run tests/unit/platforms/manifest-schema.test.js tests/unit/platforms/path-resolver.test.js tests/unit/platforms/registry.test.js`. Expected: PASS.

- [ ] **Step 9: Commit the foundation**

```bash
git add package.json src/config/paths.js src/platforms tests/unit/platforms
git commit -m "feat: add platform manifest registry"
```

---

### Task 2: Add Driver Registry and Generic Drivers

**Files:**
- Create: `src/platforms/driver-registry.js`
- Create: `src/platforms/drivers/unsupported.js`
- Create: `src/platforms/drivers/generic-jsonl.js`
- Create: `src/platforms/drivers/generic-filesystem.js`
- Create: `src/platforms/drivers/generic-openai-compatible.js`
- Create: `tests/unit/platforms/generic-drivers.test.js`

- [ ] **Step 1: Write driver contract tests first**

```js
const { createDriverRegistry } = require('../../../src/platforms/driver-registry');
const { createGenericJsonlDriver } = require('../../../src/platforms/drivers/generic-jsonl');
const { createGenericFilesystemDriver } = require('../../../src/platforms/drivers/generic-filesystem');
const { createGenericOpenAICompatibleDriver } = require('../../../src/platforms/drivers/generic-openai-compatible');

function makeRegistry() {
  return createDriverRegistry({
    drivers: {
      'generic-jsonl': createGenericJsonlDriver,
      'generic-filesystem': createGenericFilesystemDriver,
      'generic-openai-compatible': createGenericOpenAICompatibleDriver,
      unsupported: ({ platform, capability }) => ({
        status: 'unsupported', platform, capability
      })
    }
  });
}

test('generic JSONL driver inventories and normalizes sessions', async () => {
  const fsImpl = {
    readdir: async () => ['session-1.jsonl'],
    stat: async () => ({ size: 20, mtimeMs: 10 }),
    readFile: async () => '{"id":"m1","role":"user","content":"hello"}\n'
  };
  const driver = makeRegistry().create('generic-jsonl', {
    platform: 'demo-cli',
    manifest: {
      paths: { sessions: '/tmp/demo/sessions' },
      sessionMapping: { sessionId: 'id', messages: 'messages' }
    },
    fsImpl
  });

  const descriptors = await driver.inventory();
  expect(descriptors[0]).toEqual(expect.objectContaining({ sessionId: 'session-1' }));
  const parsed = await driver.parse(descriptors[0]);
  expect(parsed.messages[0]).toEqual(expect.objectContaining({ role: 'user', content: 'hello' }));
});

test('unsupported driver never returns a successful empty value', () => {
  const result = makeRegistry().create('unsupported', {
    platform: 'demo-cli', capability: 'proxy'
  });

  expect(result.status).toBe('unsupported');
  expect(result.status).not.toBe('ok');
});
```

- [ ] **Step 2: Run the focused contract test and verify it fails**

Run: `npx vitest run tests/unit/platforms/generic-drivers.test.js`
Expected: FAIL because the driver registry and generic driver modules do not exist.

- [ ] **Step 3: Implement lazy driver registration**

```js
function createDriverRegistry({ drivers = {} } = {}) {
  const factories = new Map(Object.entries(drivers));

  return {
    register(id, factory) {
      if (!/^[a-z0-9:_-]+$/.test(id) || typeof factory !== 'function') {
        throw new Error(`Invalid capability driver: ${id}`);
      }
      factories.set(id, factory);
    },
    has(id) {
      return factories.has(id);
    },
    create(id, context = {}) {
      const factory = factories.get(id);
      if (!factory) throw new Error(`Unknown capability driver: ${id}`);
      return factory(context);
    },
    ids() {
      return [...factories.keys()];
    }
  };
}

module.exports = { createDriverRegistry };
```
`unsupported.js` exports a concrete factory:

```js
function createUnsupportedDriver({ platform, capability }) {
  return { status: 'unsupported', platform, capability };
}

module.exports = { createUnsupportedDriver };
```

The Registry must call `driverRegistry.create()` only after resolving a capability. It must not load all platform services at module import time.

- [ ] **Step 4: Implement `generic-jsonl` with explicit field mappings**

The driver must accept `manifest.paths.sessions`, an optional `sessionGlob`, and mappings for `sessionId`, `projectName`, `messages`, `role`, `content`, `timestamp`, and `model`. It returns descriptors matching the existing index contract:

```js
{
  filePath,
  size,
  mtimeMs,
  sessionId,
  projectHint
}
```

Parsing malformed lines must produce a `failed` error with `platform`, `capability: 'sessions'`, `operation: 'parse'`, and the file path. It must not silently convert malformed input into a successful empty session.

- [ ] **Step 5: Implement `generic-filesystem` with safe roots**

The driver must expose:

```js
{
  list(type),
  sync(type, name, sourceRoot),
  remove(type, name)
}
```

It must normalize relative names, reject `..`, enforce the Manifest target root, preserve directory/file semantics, and return `{ status: 'ok', target }` or a typed failure. Do not add recursive deletion outside the resolved target root.

- [ ] **Step 6: Implement the generic OpenAI-compatible transport driver**

`generic-openai-compatible.js` handles endpoint normalization and request authentication only; it is not a local proxy lifecycle driver. A Manifest must use `proxy: 'unsupported'` unless a separate allowlisted proxy driver is implemented.

```js
function createGenericOpenAICompatibleDriver({ platform, manifest, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = String(manifest.paths?.baseUrl || manifest.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error(`Missing base URL for ${platform}`);
  return {
    platform,
    capability: 'channels',
    normalizeEndpoint(pathname = '') {
      return `${baseUrl}/${String(pathname).replace(/^\/+/, '')}`;
    },
    buildHeaders(channel = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (channel.apiKey) headers.Authorization = `Bearer ${channel.apiKey}`;
      return headers;
    },
    async request(pathname, channel, init = {}) {
      const response = await fetchImpl(this.normalizeEndpoint(pathname), {
        ...init,
        headers: { ...this.buildHeaders(channel), ...(init.headers || {}) }
      });
      if (!response.ok) {
        throw new Error(`OpenAI-compatible request failed: ${response.status}`);
      }
      return response.json();
    }
  };
}

module.exports = { createGenericOpenAICompatibleDriver };
```

The driver must strip duplicate trailing slashes and never log API keys.

- [ ] **Step 7: Add generic driver tests for boundary failures**

Cover missing session directories, malformed JSONL, path traversal, duplicate session IDs, unsupported proxy capabilities, and OpenAI-compatible endpoint normalization. Run: `npx vitest run tests/unit/platforms/generic-drivers.test.js`. Expected: PASS.

- [ ] **Step 8: Commit generic drivers**

```bash
git add src/platforms/driver-registry.js src/platforms/drivers tests/unit/platforms/generic-drivers.test.js
git commit -m "feat: add generic platform capability drivers"
```

---
### Task 3: Wrap Existing Implementations Without Breaking Mock Paths

**Files:**
- Create: `src/platforms/drivers/legacy.js`
- Test: `tests/unit/platforms/legacy-drivers.test.js`
- Reference unchanged: `src/config/paths.js`, `src/server/services/channels.js`, `src/server/services/codex-channels.js`, `src/server/services/gemini-channels.js`, `src/server/services/opencode-channels.js`, `src/server/services/omp-channels.js`, `src/server/omp-proxy-server.js`

- [ ] **Step 1: Write the cache-interception regression test**

```js
const CHANNEL_SERVICE_PATH = require.resolve('../../../src/server/services/codex-channels');
const PATHS_PATH = require.resolve('../../../src/config/paths');

test('legacy driver loads the exact facade path after require.cache stubbing', () => {
  const listChannels = vi.fn(() => ({ channels: [{ id: 'mock-channel' }] }));
  require.cache[CHANNEL_SERVICE_PATH] = {
    id: CHANNEL_SERVICE_PATH,
    filename: CHANNEL_SERVICE_PATH,
    loaded: true,
    exports: { getChannels: listChannels }
  };
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: { PATHS: { activeChannel: { codex: '/tmp/mock-active.json' } } }
  };

  const { createLegacyDriver } = require('../../../src/platforms/drivers/legacy');
  const driver = createLegacyDriver({ platform: 'codex', capability: 'channels' });
  expect(driver.list().channels).toEqual([{ id: 'mock-channel' }]);
  expect(listChannels).toHaveBeenCalledTimes(1);

  delete require.cache[CHANNEL_SERVICE_PATH];
  delete require.cache[PATHS_PATH];
});
```

- [ ] **Step 2: Run the focused test and verify the new factory is absent**

Run: `npx vitest run tests/unit/platforms/legacy-drivers.test.js`
Expected: FAIL because `src/platforms/drivers/legacy.js` does not exist.

- [ ] **Step 3: Implement lazy legacy module resolution**

Use an explicit allowlisted table and lazy `require` calls:

```js
const MODULE_PATHS = {
  claude: {
    sessions: '../../server/services/sessions',
    channels: '../../server/services/channels',
    proxy: '../../server/proxy-server',
    statistics: '../../server/services/claude-statistics-service'
  },
  codex: {
    sessions: '../../server/services/codex-sessions',
    channels: '../../server/services/codex-channels',
    proxy: '../../server/codex-proxy-server',
    statistics: '../../server/services/codex-statistics-service'
  },
  gemini: {
    sessions: '../../server/services/gemini-sessions',
    channels: '../../server/services/gemini-channels',
    proxy: '../../server/gemini-proxy-server',
    statistics: '../../server/services/gemini-statistics-service'
  },
  opencode: {
    sessions: '../../server/services/opencode-sessions',
    channels: '../../server/services/opencode-channels',
    proxy: '../../server/opencode-proxy-server',
    statistics: '../../server/services/opencode-statistics-service'
  },
  omp: {
    sessions: '../../server/services/omp-sessions',
    channels: '../../server/services/omp-channels',
    proxy: '../../server/omp-proxy-server',
    statistics: '../../server/services/omp-statistics-service'
  }
};

function createLegacyDriver({ platform, capability, requireImpl = require } = {}) {
  const modulePath = MODULE_PATHS[platform]?.[capability];
  if (!modulePath) {
    return { status: 'unsupported', platform, capability };
  }
  const moduleExports = requireImpl(modulePath);
  return adaptLegacyModule(platform, capability, moduleExports);
}
```

`adaptLegacyModule` normalizes `getAllChannels()` versus `getChannels().channels`, `getProjects()` signatures, proxy method names, and statistics method names. It must not move or rename the legacy modules.

- [ ] **Step 4: Add adapters for current method differences**

The adapter table must explicitly map:

```text
claude channels: getAllChannels / createChannel / updateChannel / deleteChannel
codex channels: getChannels().channels / createChannel / updateChannel / deleteChannel
Gemini channels: getChannels().channels / createChannel / updateChannel / deleteChannel
OpenCode channels: getChannels().channels / createChannel / updateChannel / deleteChannel
OMP channels: getChannels().channels / createChannel / updateChannel / deleteChannel
```

For proxy drivers preserve OMP `preserveManagedMode`, `forceAfterMs`, drain and restoration options. Do not normalize away platform-specific options.

- [ ] **Step 5: Extend tests for every existing mock seam**

Add tests that stub `src/config/paths.js`, `src/server/services/omp-channels.js`, `src/server/omp-proxy-server.js`, and one non-OMP proxy module by `require.resolve()`. Assert the legacy driver invokes the stub rather than the real implementation. Run: `npx vitest run tests/unit/platforms/legacy-drivers.test.js tests/unit/index.test.js tests/unit/services/omp-proxy-server.test.js`. Expected: PASS.

- [ ] **Step 6: Commit the compatibility layer**

```bash
git add src/platforms/drivers/legacy.js tests/unit/platforms/legacy-drivers.test.js
git commit -m "feat: adapt legacy platform modules to capability drivers"
```

---

### Task 4: Migrate Session Indexing and Dashboard Read Aggregation

**Files:**
- Modify: `src/server/services/session-history-adapters/index.js`
- Modify: `src/server/services/session-history-index.js`
- Modify: `src/server/services/dashboard-snapshot-worker.js`
- Test: `tests/unit/services/session-history-index.test.js`
- Create: `tests/unit/services/dashboard-snapshot-worker.test.js`

- [ ] **Step 1: Add a Dashboard runtime-injection test**

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildPayload } = require('../../../src/server/services/dashboard-snapshot-worker');
const { createSessionHistoryIndex } = require('../../../src/server/services/session-history-index');

const tempDbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'platform-index-test-')),
  'history.sqlite'
);

test('builds a project payload through the injected platform driver', async () => {
  const listProjects = vi.fn(async () => [{ name: 'demo-project', lastUsed: 10 }]);
  const runtime = {
    getDriver: vi.fn((platform, capability) => {
      expect(platform).toBe('demo-cli');
      expect(capability).toBe('projects');
      return { listProjects };
    })
  };

  const result = await buildPayload({
    kind: 'projects',
    source: 'demo-cli',
    config: {},
    options: {},
    runtime
  });

  expect(result.projects).toEqual([{ name: 'demo-project', lastUsed: 10 }]);
  expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({ force: false, config: {} }));
});

test('explicit adapterRegistry remains authoritative for tests and workers', async () => {
  const inventory = vi.fn(async () => []);
  const parse = vi.fn();
  const index = createSessionHistoryIndex({
    dbPath: tempDbPath,
    adapterRegistry: { demo: { inventory, parse } },
    workerRunner: async () => {}
  });

  await index.ensureSourceIndexed('demo', { consistency: 'complete' });
  expect(inventory).toHaveBeenCalledTimes(1);
  expect(parse).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Refactor `session-history-index.js` default adapter selection**

Keep this precedence:

```js
const adapters = opts.adapterRegistry || getDefaultSessionAdapters();
```

`getDefaultSessionAdapters()` obtains the session drivers from `runtime`; explicit test adapters never load the Registry or native paths. Keep the existing `inventory`, `parse`, stale handling, retry and SQLite schema unchanged.

- [ ] **Step 3: Replace Dashboard `switch` with capability dispatch**

Implement one dispatcher per capability:

```js
async function buildProjectsPayload(source, config = {}, options = {}, runtime = getPlatformRuntime()) {
  const driver = runtime.getDriver(source, 'projects');
  const projects = await driver.listProjects({ force: options.force === true, config });
  return {
    projects,
    currentProject: projects[0] ? projects[0].name : null
  };
}
```

Apply the same pattern to counts, today statistics and channels. Existing legacy adapters provide the current five-platform behavior; generic platforms use their configured drivers. Production child-process IPC must continue to send only serializable `kind`, `source`, `config` and `options`; test-only runtime injection is used only when `NODE_ENV === 'test'`.

- [ ] **Step 4: Keep `session-history-adapters/index.js` as a stable facade**

It must continue exporting `claude`, `codex`, `gemini`, and `omp` objects with `inventory` and `parse`. OpenCode remains excluded from this index until its native database adapter is represented by a driver. Existing tests that stub this module path must still intercept default loading.

- [ ] **Step 5: Run focused read-side tests**

Run: `npx vitest run tests/unit/services/session-history-index.test.js tests/unit/services/dashboard-snapshot-worker.test.js tests/unit/services/{sessions,codex-sessions,gemini-sessions,opencode-sessions,omp-sessions}.test.js`
Expected: PASS with the current session normalization and snapshot behavior.

- [ ] **Step 6: Commit the read-side migration**

```bash
git add src/server/services/session-history-adapters/index.js src/server/services/session-history-index.js src/server/services/dashboard-snapshot-worker.js tests/unit/services/session-history-index.test.js tests/unit/services/dashboard-snapshot-worker.test.js
git commit -m "refactor: route read aggregation through platform drivers"
```

---

### Task 5: Add the Public Platform Catalog and Generic Route Factory

**Files:**
- Create: `src/server/api/platforms.js`
- Create: `src/server/api/platform-route-factory.js`
- Modify: `src/server/index.js`
- Create: `tests/unit/api/platforms-api.test.js`

- [ ] **Step 1: Write catalog and unsupported-capability API tests**

```js
const express = require('express');
const { once } = require('events');
const createPlatformRouter = require('../../../src/server/api/platforms');

async function requestJson(app, route) {
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${route}`);
  const body = await response.json();
  await new Promise(resolve => server.close(resolve));
  return { status: response.status, body };
}

test('catalog exposes only safe public platform fields', async () => {
  const app = express();
  app.use('/api/platforms', createPlatformRouter({
    registry: {
      list: () => [{
        key: 'demo-cli', label: 'Demo', command: 'demo', iconToken: 'terminal',
        color: '#000', capabilities: { sessions: 'generic-jsonl' },
        paths: { home: '/private/home' }, driverIds: { sessions: 'generic-jsonl' }
      }]
    }
  }));

  const response = await requestJson(app, '/api/platforms');
  expect(response.status).toBe(200);
  expect(response.body.platforms[0]).toEqual(expect.objectContaining({ key: 'demo-cli', label: 'Demo' }));
  expect(response.body.platforms[0]).not.toHaveProperty('paths');
  expect(response.body.platforms[0]).not.toHaveProperty('driverIds');
});

test('unsupported capability is explicit', async () => {
  const app = express();
  app.use('/api/platforms', createPlatformRouter({
    registry: { list: () => [], resolve: () => ({ key: 'demo-cli' }) },
    runtime: { getDriver: () => ({ status: 'unsupported', platform: 'demo-cli', capability: 'proxy' }) }
  }));

  const response = await requestJson(app, '/api/platforms/demo-cli/proxy/status');
  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe('unsupported');
});
```

- [ ] **Step 2: Run the API test and verify the route factory is absent**

Run: `npx vitest run tests/unit/api/platforms-api.test.js`
Expected: FAIL because the catalog router does not exist.

- [ ] **Step 3: Implement public projection and generic routes**

`src/server/api/platforms.js` must export the factory both as the CommonJS default and as a named property so old-style route loading and focused tests use the same implementation:

```js
module.exports = createPlatformRouter;
module.exports.createPlatformRouter = createPlatformRouter;
```

`src/server/api/platform-route-factory.js` must contain the shared handler construction; `platforms.js` only supplies the catalog route and binds the factory to the Registry/runtime.

The router must expose:

```text
GET /api/platforms
GET /api/platforms/:platform/projects
GET /api/platforms/:platform/sessions/:projectName
GET /api/platforms/:platform/channels
GET /api/platforms/:platform/proxy/status
```

Route handlers resolve the platform, call the capability driver, and map driver states as follows:

```text
ok           -> 200
unsupported  -> 404 { error: { code: 'unsupported', ... } }
unavailable  -> 503
invalid      -> 400
failed       -> 500
```

Use `createPlatformRouter({ registry, runtime })` so tests can inject fakes. Do not import all legacy services at module scope.

- [ ] **Step 4: Mount the router without changing old endpoints**

In `src/server/index.js`, add the catalog route before static files:

```js
const { getPlatformRegistry, getPlatformRuntime } = require('../platforms/runtime');

app.use('/api/platforms', require('./api/platforms')({
  registry: getPlatformRegistry(),
  runtime: getPlatformRuntime()
}));
```

Keep existing `/api/channels`, `/api/codex/channels`, `/api/gemini/channels`, `/api/opencode/channels` and `/api/omp/channels` mounts unchanged in this task. The new route is the extension path for Manifest-driven platforms.

- [ ] **Step 5: Run focused API tests**

Run: `npx vitest run tests/unit/api/platforms-api.test.js tests/unit/api/{channels,codex-channels-api,gemini-channels-api,opencode-channels-api,omp-channels-api}.test.js`
Expected: PASS; old APIs remain available and the new catalog only exposes safe fields.

- [ ] **Step 6: Commit the catalog and route factory**

```bash
git add src/server/api/platforms.js src/server/api/platform-route-factory.js src/server/index.js tests/unit/api/platforms-api.test.js
git commit -m "feat: expose registry-backed platform routes"
```

---


### Task 6: Move Channel, Proxy, and Daemon Aggregation to the Registry

**Files:**
- Modify: `src/commands/proxy-control.js`
- Modify: `src/commands/toggle-proxy.js`
- Modify: `src/commands/daemon.js`
- Modify: `src/server/index.js`
- Modify: `src/server/services/channel-scheduler.js`
- Create: `tests/unit/commands/proxy-control.test.js`
- Test: `tests/unit/commands/daemon.test.js`
- Test: `tests/unit/services/channel-scheduler.test.js`

- [ ] **Step 1: Add a Registry-derived proxy control test**

```js
const { createProxyControl } = require('../../../src/commands/proxy-control');

test('proxy labels and endpoint are derived from the resolved Manifest', async () => {
  const httpRequest = vi.fn(async () => ({ data: { success: true, port: 23100 }, status: 200 }));
  const registry = {
    resolve: () => ({
      key: 'demo-cli', label: 'Demo CLI', apiBasePath: '/api/platforms/demo-cli',
      capabilities: { proxy: 'legacy:codex' }
    }),
    list: () => [{ key: 'demo-cli', label: 'Demo CLI' }]
  };

  const control = createProxyControl({ registry, httpRequest, loadConfig: () => ({ ports: { webUI: 19999 } }) });
  await control.start('demo-cli');
  expect(httpRequest).toHaveBeenCalledWith('POST', '/api/platforms/demo-cli/proxy/start');
});
```

`proxy-control.js` must export `createProxyControl` in addition to the four existing `handleProxy*` functions. The factory receives `{ registry, httpRequest, loadConfig }` and contains no direct terminal output in its pure methods; the existing handlers remain the CLI output adapter.

- [ ] **Step 2: Refactor `proxy-control.js` to use Registry metadata**

Remove the fixed five-entry `CHANNEL_CONFIG` as the source of truth. Keep OMP-specific labels in its Manifest or legacy driver metadata:

```js
const platform = registry.resolve(normalizePlatformKey(channel));
if (!platform) return failUnknownPlatform(channel);
const basePath = platform.apiBasePath || `/api/platforms/${platform.key}`;
```

Preserve HTTP timeout, error text, status formatting, and `process.exit` behavior for existing commands. Existing tests may inject `require.cache` stubs for the underlying API modules; do not replace those seams with direct network calls.

- [ ] **Step 3: Refactor toggle-proxy service lookup**

Replace the hard-coded `SETTINGS_MANAGERS` lookup with a driver lookup for `nativeConfig` or `proxy`. Keep these existing service modules as allowlisted legacy drivers:

```text
src/server/services/settings-manager.js
src/server/services/codex-settings-manager.js
src/server/services/gemini-settings-manager.js
src/server/services/opencode-settings-manager.js
```

OMP remains handled by `omp-proxy-server.js` and `omp-settings-manager.js` with its managed-mode semantics.

- [ ] **Step 4: Refactor daemon status and automatic recovery**

Replace five repeated status blocks in `src/commands/daemon.js` with:

```js
for (const platform of registry.list({ enabledOnly: true })) {
  const proxy = runtime.getDriver(platform.key, 'proxy');
  const status = await Promise.resolve(proxy.status());
  printProxyStatus(platform, status, config);
}
```

Replace `autoRestoreProxies()` with the same driver iteration. A driver may expose `restoreOnBoot()` for Codex config sync, OpenCode model sync, or OMP managed recovery. Generic drivers without that method are skipped with no error. Failures remain visible with platform and capability context.

- [ ] **Step 5: Preserve scheduler source keys**

`channel-scheduler.js` must accept any Registry key but retain existing persisted source names. Add a test for `demo-cli` and keep current `claude`, `codex`, `gemini`, `opencode`, and `omp` state behavior. Do not rename storage files in this task.

- [ ] **Step 6: Run focused command and scheduler tests**

Run: `npx vitest run tests/unit/commands/proxy-control.test.js tests/unit/commands/daemon.test.js tests/unit/commands/toggle-proxy.test.js tests/unit/services/channel-scheduler.test.js tests/unit/index.test.js`
Expected: PASS, including OMP shutdown preservation and existing CLI proxy output.

- [ ] **Step 7: Commit aggregation migration**

```bash
git add src/commands/proxy-control.js src/commands/toggle-proxy.js src/commands/daemon.js src/server/index.js src/server/services/channel-scheduler.js tests/unit/commands/proxy-control.test.js tests/unit/commands/daemon.test.js tests/unit/commands/toggle-proxy.test.js tests/unit/services/channel-scheduler.test.js
git commit -m "refactor: derive proxy aggregation from platform registry"
```

---

### Task 7: Make Config Sync, Registry, Export, and Templates Data-Driven

**Files:**
- Modify: `src/server/services/config-sync-manager.js`
- Modify: `src/server/services/config-registry-service.js`
- Modify: `src/server/services/config-export-service.js`
- Modify: `src/server/services/config-templates-service.js`
- Test: `tests/unit/services/config-sync-manager.test.js`
- Test: `tests/unit/services/config-registry-service.test.js`
- Test: `tests/unit/services/config-export-service.test.js`
- Test: `tests/unit/services/config-templates-service.test.js`

- [ ] **Step 1: Write a generic platform sync test**

```js
const { ConfigSyncManager } = require('../../../src/server/services/config-sync-manager');

test('syncAll discovers a generic platform from the Registry', () => {
  const sync = vi.fn(() => ({ status: 'ok', target: '/tmp/demo/skills/review' }));
  const remove = vi.fn(() => ({ status: 'ok' }));
  const manager = new ConfigSyncManager({
    registry: {
      list: () => [{ key: 'demo-cli', capabilities: { resourceSync: 'generic-filesystem' } }]
    },
    runtime: {
      getDriver: () => ({ sync, remove })
    }
  });

  const result = manager.syncAll('skills', {
    review: { enabled: true, platforms: { 'demo-cli': true } }
  });

  expect(sync).toHaveBeenCalledWith('skills', 'review');
  expect(result.synced).toContainEqual({ type: 'skills', name: 'review', platform: 'demo-cli' });
});
```

- [ ] **Step 2: Add dynamic platform assertions to registry and export tests**

Use a fake Registry containing `demo-cli` and the new pure export helper:

```js
const { getSupportedPlatforms } = require('../../../src/server/services/config-registry-service');
const { exportPlatformSnapshots } = require('../../../src/server/services/config-export-service');

const registry = {
  list: () => [{ key: 'demo-cli', capabilities: { resourceSync: 'generic-filesystem' } }]
};

expect(getSupportedPlatforms(registry)).toContain('demo-cli');
expect(exportPlatformSnapshots({
  registry,
  exportByPlatform: () => ({})
})).toHaveProperty('demo-cli');
```

Also assert that a platform with `agents: 'unsupported'` is reported as skipped rather than exported as an empty successful config.


- [ ] **Step 3: Add `syncToPlatform` and retain old method wrappers**

Implement these methods on `ConfigSyncManager`; its constructor accepts `{ registry, runtime }` for tests and defaults both from `src/platforms/runtime.js`:

```js
constructor({ registry = getPlatformRegistry(), runtime = getPlatformRuntime() } = {}) {
  this.registry = registry;
  this.runtime = runtime;
}

syncToPlatform(platform, type, name) {
  const driver = this.runtime.getDriver(platform, 'resourceSync');
  return driver.sync(type, name);
}

removeFromPlatform(platform, type, name) {
  const driver = this.runtime.getDriver(platform, 'resourceSync');
  return driver.remove(type, name);
}
```

Keep `syncToClaude`, `syncToCodex`, `syncToGemini`, `syncToOpenCode`, `syncToOmp` and matching remove methods as wrappers that call the same runtime. This preserves current service exports and tests while replacing `syncAll` platform enumeration with `registry.list()`.

- [ ] **Step 4: Derive config registry support from Manifest capabilities**

Import `getPlatformRegistry` from `src/platforms/runtime.js` and add:

```js
function getSupportedPlatforms(registry = getPlatformRegistry()) {
  return registry.list({ enabledOnly: true }).map(platform => platform.key);
}
```

Replace the static `SUPPORTED_PLATFORMS` source with `getSupportedPlatforms(registry)` while retaining the exported `SUPPORTED_PLATFORMS` name for existing tests. Build `PLATFORM_SUPPORT` from `resourceSync` capability and resource type declarations. Existing OMP false support for agents must remain false, and export `getSupportedPlatforms`.

- [ ] **Step 5: Refactor export and template maps**

Add and export this pure helper in `config-export-service.js` so the platform map can be tested without reading the real home directory:

```js
function exportPlatformSnapshots({ registry, exportByPlatform }) {
  return Object.fromEntries(
    registry.list({ enabledOnly: true }).map(platform => [
      platform.key,
      exportByPlatform(platform.key)
    ])
  );
}
```

`config-export-service.js` must use `nativeConfig` drivers for native snapshots and `resourceSync` drivers for managed resources. Keep existing special handling for Claude hooks, Codex TOML, OpenCode package configuration and OMP package/extension records.

`config-templates-service.js` must derive AI config file names from Manifest fields such as `promptFile` and use an explicit `unsupported` result when no file mapping exists. Preserve current fallback from Codex to OpenCode and OMP command-template semantics.

- [ ] **Step 6: Run focused service tests**

Run: `npx vitest run tests/unit/services/config-sync-manager.test.js tests/unit/services/config-registry-service.test.js tests/unit/services/config-export-service.test.js tests/unit/services/config-templates-service.test.js`
Expected: PASS, including old platform snapshots, OMP resource skips, and new `demo-cli` discovery.

- [ ] **Step 7: Commit data-driven config services**

```bash
git add src/server/services/config-sync-manager.js src/server/services/config-registry-service.js src/server/services/config-export-service.js src/server/services/config-templates-service.js tests/unit/services/config-sync-manager.test.js tests/unit/services/config-registry-service.test.js tests/unit/services/config-export-service.test.js tests/unit/services/config-templates-service.test.js
git commit -m "refactor: drive config services from platform capabilities"
```

---

### Task 8: Refactor CLI Routing and Platform Type Selection

**Files:**
- Create: `src/commands/platform-command-registry.js`
- Modify: `src/index.js`
- Modify: `src/commands/cli-type.js`
- Modify: `src/commands/logs.js`
- Modify: `src/commands/stats.js`
- Modify: `src/commands/port-config.js`
- Create: `tests/unit/commands/platform-command-registry.test.js`
- Create: `tests/unit/commands/cli-type.test.js`
- Test: `tests/unit/index.test.js`
- Test: `tests/unit/commands/logs.test.js`
- Test: `tests/unit/commands/stats.test.js`
- Test: `tests/unit/commands/port-config.test.js`

- [ ] **Step 1: Write command registry tests**

```js
const { createPlatformCommandRegistry } = require('../../../src/commands/platform-command-registry');

test('adds a configured platform to proxy, logs, stats, and port command options', () => {
  const registry = createPlatformCommandRegistry({
    platforms: [{
      key: 'demo-cli', label: 'Demo CLI', command: 'demo',
      logFile: 'demo-proxy.log', portKey: 'demoProxy', capabilities: {
        proxy: 'unsupported', statistics: 'unsupported'
      }
    }]
  });

  expect(registry.resolve('demo-cli').label).toBe('Demo CLI');
  expect(registry.logTypes()).toContain('demo-cli');
  expect(registry.portKeys()).toContain('demoProxy');
});
```

- [ ] **Step 2: Implement a pure command registry**

The registry exposes `resolve`, `platformKeys`, `logTypes`, `portKeys`, and `helpEntries`. It receives the Registry as a dependency and returns no terminal output. Existing aliases such as `omp` remain exact keys.

- [ ] **Step 3: Replace platform arrays in CLI commands**

Use `registry.list()` in `logs.js`, `stats.js`, `port-config.js`, and `cli-type.js`. Preserve:

- `omp` log alias to UI/server logs;
- `omp` dynamic gateway labels;
- existing default ports;
- existing stats endpoint paths for five built-ins;
- existing CLI type colors and prompts.

An unsupported capability is excluded from the relevant option list; an unknown explicit key still produces the current error path.

- [ ] **Step 4: Extract the platform branch from `src/index.js`**

Add a command table for non-platform commands and a Registry-derived platform route:

```js
const commandHandlers = {
  start: () => handleStart(),
  stop: () => handleStop(),
  restart: () => handleRestart(),
  status: () => handleStatus()
};

const platform = registry.resolve(normalizePlatformKey(args[0]));
if (platform) {
  return dispatchPlatformCommand(platform, args.slice(1), runtime);
}
```

Do not remove compatibility branches for `daemon`, `proxy`, `security`, `plugin`, `ui`, or `reset`. Preserve `finishCli`, OMP exit cleanup, uncaught exception handling, and `_test.stopOwnedOmpGatewayBeforeExit`.

- [ ] **Step 5: Make help output Registry-derived**

Keep static descriptions for global commands, but render platform commands from `helpEntries()`. The output for existing five platforms must remain semantically identical; adding `demo-cli` must not require editing `showHelp()`.

- [ ] **Step 6: Run focused CLI tests and smoke help**

Run: `npx vitest run tests/unit/index.test.js tests/unit/commands/cli-type.test.js tests/unit/commands/logs.test.js tests/unit/commands/stats.test.js tests/unit/commands/port-config.test.js`
Expected: PASS.

Run: `node bin/ctx.js --help`
Expected: existing global command sections and all enabled Registry platform entries are printed, followed by exit code 0.

- [ ] **Step 7: Commit CLI routing**

```bash
git add src/index.js src/commands/platform-command-registry.js src/commands/cli-type.js src/commands/logs.js src/commands/stats.js src/commands/port-config.js tests/unit/index.test.js tests/unit/commands/platform-command-registry.test.js tests/unit/commands/cli-type.test.js tests/unit/commands/logs.test.js tests/unit/commands/stats.test.js tests/unit/commands/port-config.test.js
git commit -m "refactor: derive CLI platform commands from registry"
```

---

### Task 9: Migrate User Platform Config and Preserve Legacy UI Config

**Files:**
- Modify: `src/server/services/ui-config.js`
- Modify: `src/shared/platforms.js`
- Modify: `src/platforms/registry.js`
- Test: `tests/unit/services/ui-config.test.js`
- Test: `tests/unit/shared/platforms.test.js`
- Test: `tests/unit/platforms/registry.test.js`

- [ ] **Step 1: Write migration compatibility tests**

```js
const { createPlatformRegistry } = require('../../../src/platforms/registry');
test('legacy customCliPlatforms remain readable and become Registry metadata', () => {
  const registry = createPlatformRegistry({
    builtIns: [{ key: 'claude', label: 'Claude', command: 'claude', capabilities: {} }],
    legacyUiConfig: {
      customCliPlatforms: [{ key: 'demo-cli', name: 'Demo', command: 'demo', enabled: true }]
    },
    userFile: { platforms: [] }
  });

  expect(registry.resolve('demo-cli')).toEqual(expect.objectContaining({
    key: 'demo-cli', label: 'Demo', custom: true
  }));
});

test('user definitions cannot override built-in behavior or driver IDs', () => {
  const registry = createPlatformRegistry({
    builtIns: [{ key: 'claude', label: 'Claude', command: 'claude', capabilities: {} }],
    userFile: {
      platforms: [{ key: 'claude', label: 'Fake', command: 'fake', capabilities: { proxy: 'user-code' } }]
    }
  });

  expect(registry.resolve('claude').label).toBe('Claude');
  expect(registry.diagnostics()[0].reason).toMatch(/built-in|driver/i);
});
```

- [ ] **Step 2: Add `platforms.json` loading without changing current UI file shape**

`ui-config.js` continues returning `customCliPlatforms` for old frontend callers during migration. The Registry reads `PATHS.platforms` first, then imports valid legacy custom metadata. Saving UI config must not erase legacy fields before the frontend migration completes.

- [ ] **Step 3: Normalize custom metadata once**

Move key normalization, duplicate rejection, built-in collision rejection, and enabled filtering to one shared normalizer. Keep `normalizePlatformKey`, `normalizeCustomCliPlatform`, `normalizeCustomCliPlatforms`, and `normalizeHomeCliColumns` exports from `src/shared/platforms.js`; change their data source, not their observable behavior.

- [ ] **Step 4: Add safe user Manifest fields**

Allow user config to set only:

```text
key, label, title, command, iconToken, color, defaultVisible,
paths, pathResolverId from allowlist, capabilities from allowlist,
resource mappings and session field mappings
```

Reject `modulePath`, `require`, function-valued fields, shell commands, and driver IDs not in `DRIVER_IDS`. Validate all filesystem roots before Registry insertion.

- [ ] **Step 5: Run focused migration tests**

Run: `npx vitest run tests/unit/services/ui-config.test.js tests/unit/shared/platforms.test.js tests/unit/platforms/registry.test.js`
Expected: PASS, including existing OMP key normalization and custom home column behavior.

- [ ] **Step 6: Commit configuration migration**

```bash
git add src/server/services/ui-config.js src/shared/platforms.js src/platforms/registry.js tests/unit/services/ui-config.test.js tests/unit/shared/platforms.test.js tests/unit/platforms/registry.test.js
git commit -m "feat: load user CLI platform manifests safely"
```

---

### Task 10: Remove Frontend Platform Duplication and Add Generic Channel UI

**Files:**
- Create: `src/web/src/api/platforms.js`
- Create: `src/web/src/stores/platforms.js`
- Create: `src/web/src/config/iconTokens.js`
- Create: `src/web/src/components/channel/commonChannelSchema.js`
- Modify: `src/web/vitest.config.js`
- Modify: `src/web/src/config/platforms.js`
- Modify: `src/web/src/api/channels.js`
- Modify: `src/web/src/composables/useUIConfig.js`
- Modify: `src/web/src/views/Home.vue`
- Modify: `src/web/src/components/SettingsDrawer.vue`
- Modify: `src/web/src/components/channel/channelPanelFactories.js`
- Modify: `src/web/src/components/AgentsPanel.vue`
- Modify: `src/web/src/components/CommandsPanel.vue`
- Modify: `src/web/src/components/PluginsPanel.vue`
- Modify: `src/web/src/components/SkillsPanel.vue`
- Create: `src/web/src/config/__tests__/platforms.test.js`
- Create: `src/web/src/components/channel/__tests__/commonChannelSchema.test.js`

- [ ] **Step 1: Add frontend API and store tests**

```js
import { beforeEach, expect, test } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePlatformStore } from '../../stores/platforms'

beforeEach(() => setActivePinia(createPinia()))

test('loads public platform metadata from the server', async () => {
  const store = usePlatformStore()
  store.fetchPlatforms = async () => {
    store.platforms = [{ key: 'demo-cli', label: 'Demo CLI', iconToken: 'terminal', capabilities: {} }]
  }

  await store.load()
  expect(store.get('demo-cli').label).toBe('Demo CLI')
})
```

- [ ] **Step 2: Implement `api/platforms.js` and `stores/platforms.js`**

The client calls `GET /platforms`, stores only public fields, and exposes `get(key)`, `all`, `enabled`, and `hasCapability(key, capability)`. Loading must be idempotent and retain the last successful catalog on a transient failure.

- [ ] **Step 3: Reduce `config/platforms.js` to normalization and icon mapping**

Delete the duplicated complete built-in platform array. Retain:

```js
export function normalizePublicPlatform(platform) {
  return {
    key: String(platform?.key || '').trim().toLowerCase(),
    label: String(platform?.label || platform?.title || platform?.key || '').trim(),
    title: String(platform?.title || platform?.label || platform?.key || '').trim(),
    command: String(platform?.command || platform?.key || '').trim(),
    iconToken: String(platform?.iconToken || 'terminal').trim(),
    color: String(platform?.color || '#64748b').trim(),
    defaultVisible: platform?.defaultVisible !== false,
    capabilities: { ...(platform?.capabilities || {}) }
  }
}

export function normalizePublicPlatforms(platforms = []) {
  const seen = new Set()
  return platforms.map(normalizePublicPlatform).filter(platform => {
    if (!platform.key || seen.has(platform.key)) return false
    seen.add(platform.key)
    return true
  })
}

export function getPlatformConfig(key, platforms = []) {
  return normalizePublicPlatforms(platforms).find(platform => platform.key === key) || null
}

export function normalizeHomeCliColumns(input = [], platforms = []) {
  const allowed = new Set(normalizePublicPlatforms(platforms).map(platform => platform.key))
  const result = []
  for (const value of input) {
    const key = String(value || '').trim().toLowerCase()
    if (key && allowed.has(key) && !result.includes(key)) result.push(key)
  }
  return result.slice(0, 4)
}

export function buildCliPlatformOptions(platforms = []) {
  return normalizePublicPlatforms(platforms).map(platform => ({
    label: platform.label || platform.title || platform.key,
    value: platform.key
  }))
}
```

`iconTokens.js` contains the only static map from strings to imported Ionicons. Unknown tokens use `TerminalOutline`.

- [ ] **Step 4: Extract common channel schema**

Move schedule, enable/disable, health, provider URL and generic auth fields out of `channelPanelFactories.js`:

```js
export const commonChannelSchema = {
  endpoint: [
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: true },
    { key: 'websiteUrl', label: '官网链接', type: 'text', required: false }
  ],
  auth: [
    { key: 'authMode', label: '认证方式', type: 'select', options: ['api_key', 'none'] },
    { key: 'apiKey', label: 'API Key', type: 'password', required: false }
  ],
  schedule: [
    { key: 'maxConcurrency', label: '最大并发', type: 'number', required: false },
    { key: 'weight', label: '调度权重', type: 'number', min: 1, max: 100 },
    { key: 'enabled', label: '渠道状态', type: 'switch', default: true }
  ]
}

export function createGenericChannelPanel(manifest, api) {
  return {
    type: manifest.key,
    displayName: manifest.label,
    formSections: [
      { title: '基本信息', fields: commonChannelSchema.endpoint },
      { title: '认证', fields: commonChannelSchema.auth },
      { title: '调度配置', fields: commonChannelSchema.schedule }
    ],
    api
  }
}
```

Keep Claude/Codex/Gemini/OpenCode/OMP-specific field definitions and serializers in their existing factories. Generic platforms use the generic factory only when their channel capability is a generic driver.

- [ ] **Step 5: Add generic channel API functions while retaining old exports**

Add:

```js
export function getPlatformChannels(platform) {
  return client.get(`/platforms/${platform}/channels`).then(response => response.data)
}

export function createPlatformChannel(platform, payload) {
  return client.post(`/platforms/${platform}/channels`, payload).then(response => response.data)
}
```

Keep `getCodexChannels`, `createCodexChannel`, and all existing named functions as wrappers. Existing specialized panels must not be forced through generic serialization.

- [ ] **Step 6: Migrate Home, Settings, and resource panels to the store**

Replace module-scope `BUILT_IN_CLI_PLATFORMS` filtering with `platformStore.enabled` and `hasCapability`. Preserve current `customCliPlatforms` loading behavior during the backend migration, then use the Registry catalog as the source for display and ordering.

- [ ] **Step 7: Add frontend tests and build**

Test generic option generation, unknown icon fallback, capability filtering, duplicate home columns, and common schema validation. Update `src/web/vitest.config.js` to include `src/**/__tests__/**/*.test.js`, then run:

```bash
cd src/web && npm run test:unit -- src/config/__tests__/platforms.test.js src/components/channel/__tests__/commonChannelSchema.test.js
npm run build
```

Expected: PASS and a successful Vite production build.

- [ ] **Step 8: Commit frontend migration**

```bash
git add src/web/vitest.config.js src/web/src/api/platforms.js src/web/src/stores/platforms.js src/web/src/config src/web/src/api/channels.js src/web/src/composables/useUIConfig.js src/web/src/views/Home.vue src/web/src/components/SettingsDrawer.vue src/web/src/components/channel src/web/src/components/AgentsPanel.vue src/web/src/components/CommandsPanel.vue src/web/src/components/PluginsPanel.vue src/web/src/components/SkillsPanel.vue
git commit -m "refactor: consume registry-backed platform metadata in web UI"
```

---

### Task 11: Complete Contract Tests, Documentation, and Regression Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: all affected unit/API tests
- Smoke: `node bin/ctx.js --help`, service status, and Web UI build

- [ ] **Step 1: Add the config-only `demo-cli` contract test**

Register this platform only through a test Manifest and existing generic drivers:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-contract-home-'));
const demoManifest = {
  key: 'demo-cli',
  label: 'Demo CLI',
  command: 'demo',
  paths: { home: tempHome, sessions: '{home}/sessions' },
  capabilities: {
    sessions: 'generic-jsonl',
    resourceSync: 'generic-filesystem',
    proxy: 'unsupported',
    statistics: 'unsupported'
  }
};
```

Assert that Registry listing, path resolution, generic route discovery, session indexing and resource sync work without editing Dashboard, CLI router, or platform-specific source files.

- [ ] **Step 2: Add mock path compatibility assertions to existing suites**

Run and retain tests covering:

```text
tests/unit/index.test.js
tests/unit/api/channels.test.js
tests/unit/api/codex-proxy-api.test.js
tests/unit/api/gemini-proxy-api.test.js
tests/unit/api/opencode-proxy-api.test.js
tests/unit/api/proxy-api.test.js
tests/unit/services/session-history-index.test.js
tests/unit/services/omp-proxy-server.test.js
```

At least one test for every preserved path must install a `require.cache` stub before loading the module under test. Do not replace these with source-text assertions.

- [ ] **Step 3: Add explicit error-state tests**

Cover:

```text
unknown explicit platform -> invalid / 400 or existing CLI error
unsupported capability     -> unsupported / 404
missing executable/path    -> unavailable / 503 or diagnostic output
malformed Manifest          -> invalid with field path
runtime driver exception   -> failed with platform/capability/operation
```

Assert that none of these cases returns `{ success: true }` with an empty value.

- [ ] **Step 4: Update README and CHANGELOG**

Document:

- generic CLI support requires a valid Manifest and an allowlisted generic driver;
- special CLI protocols require a capability driver;
- user Manifest location `~/.cc-tool/config/platforms.json`;
- arbitrary Node module loading is prohibited;
- existing CLI/API compatibility and mock path behavior are intentional.

Do not claim that every arbitrary CLI gains full parity from configuration alone.

- [ ] **Step 5: Run the focused suites**

Run:

```bash
npx vitest run tests/unit/platforms tests/unit/services/session-history-index.test.js tests/unit/services/dashboard-snapshot-worker.test.js tests/unit/api/platforms-api.test.js
npm run test:unit
npm run test:basic
npm run test:api
npm run test:codex-agents
npm run test:skills
npm run test:plugins-market
npm run test:windows
```

Expected: all commands exit 0. If a pre-existing user-modified skill test fails, record the exact failure and do not revert those files.

- [ ] **Step 6: Run runtime smoke checks**

Run:

```bash
node bin/ctx.js --version
node bin/ctx.js --help
npm run build:web
```

Expected: version output, Registry-derived help output, and a successful Web UI build. If a local service is available, start it through the existing CLI and verify `GET /api/platforms` returns the five built-ins plus any configured user platform; stop it using the existing command.

- [ ] **Step 7: Inspect final diff and commit only owned files**

Run: `git diff --check`

Then inspect `git status --short` and verify unrelated skill changes remain untouched. Commit only the documentation and contract tests:

```bash
git add README.md CHANGELOG.md tests/unit/platforms tests/unit/services/dashboard-snapshot-worker.test.js tests/unit/api/platforms-api.test.js
git commit -m "docs: document configurable CLI platform extensions"
```

- [ ] **Step 8: Final acceptance review**

Confirm each approved-spec requirement has evidence:

```text
Manifest + Registry present
capability drivers isolated
config-only generic demo works
legacy platform facades remain loadable
require.resolve + require.cache mocks still intercept
old CLI/API paths unchanged
OMP managed mode and exit recovery unchanged
unsupported and failed states are distinguishable
frontend has no second complete built-in platform catalog
```

Only after these checks pass is the refactor complete.
