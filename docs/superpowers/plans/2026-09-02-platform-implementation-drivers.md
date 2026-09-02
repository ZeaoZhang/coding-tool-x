# Platform Implementation Drivers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all platform-specific channel, proxy, session, statistics, native-config, resource, prompt, and MCP behavior out of `src/server` into per-platform Drivers, then delete obsolete platform services and remove CLI platform branches.

**Architecture:** `src/platforms/drivers/<platform>/<capability>.js` owns provider-specific behavior and may use platform-local helpers. `src/server` retains HTTP/CLI facades, shared application orchestration, SQLite/cache/scheduler/security infrastructure, and protocol-neutral utilities. Runtime remains the only capability lookup seam; legacy HTTP URLs and CLI command names remain unchanged.

**Tech Stack:** Node.js 22, CommonJS, Express, Vitest, Platform Registry/Runtime, existing filesystem/TOML/JSON/native configuration adapters.

---

## Scope and ownership map

### Driver-owned implementations

- Claude: existing `channels-implementation.js`, plus proxy, sessions, statistics, native config, and provider-specific resource/config behavior.
- Codex: existing `channels-implementation.js`, plus proxy, sessions, statistics, native config, and provider-specific resource/config behavior.
- Gemini: contents of `gemini-channels.js`, `gemini-proxy-server.js`, `gemini-sessions.js`, `gemini-statistics-service.js`, `gemini-settings-manager.js`, and Gemini-specific serialization/helpers.
- OpenCode: contents of `opencode-channels.js`, `opencode-proxy-server.js`, `opencode-sessions.js`, `opencode-statistics-service.js`, `opencode-settings-manager.js`, `opencode-gateway-converter.js`, `opencode-normalization.js`, and OpenCode-specific serialization/helpers.
- OMP: contents of `omp-channels.js`, `omp-proxy-server.js`, `omp-sessions.js`, `omp-statistics-service.js`, `omp-settings-manager.js`, `omp-gateway*.js`, `omp-native-plugin-adapter.js`, and OMP managed-mode/auth behavior.

### Server-owned implementations

- `src/server/api/**`: route, validation, status code, response-shape, and websocket compatibility.
- `src/commands/**`: prompt/menu/output handling and generic command dispatch.
- `src/server/services/base/**`, `session-history-index.js`, `channel-scheduler.js`, `channel-health.js`, `enhanced-cache.js`, `sqlite-connection.js`, `security/**`: platform-neutral infrastructure.
- `src/server/services/claude-wire.js`, `codex-wire.js`, `gemini-wire.js`: retain only if used as protocol-neutral wire utilities; platform-specific orchestration moves into the owning Driver.

## Shared Driver contract

Each built-in Driver factory receives the existing Runtime context and returns capability methods. Methods return existing DTOs at the Driver/facade boundary; failures use `DriverResult` and preserve `cause` as a non-enumerable property.

```js
const driver = runtime.getDriver(platform, capability);
const result = await driver[operation](input);
```

The CLI-facing capability metadata uses this shape:

```js
{
  supportsCliCreate: true,
  supportsCliToggle: true,
  managedProviderConfig: false,
  defaultPort: 20088
}
```

The generic CLI must read metadata and methods; it must not compare platform names.

---

### Task 1: Freeze behavior and add migration guards

**Files:**
- Create: `tests/unit/platforms/drivers/platform-implementation-boundary.test.js`
- Modify: `tests/unit/platforms/drivers/builtin-driver-contract.test.js`
- Modify: `scripts/test-driver-reachability.js`

- [ ] **Step 1: Add failing boundary assertions**

Add tests that inspect production source files and fail while the current delegation remains:

```js
it('does not load platform channel implementations from server services', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/platforms/drivers/gemini/channels.js'), 'utf8');
  expect(source).not.toMatch(/server\/services\/gemini-channels/);
});

it('does not keep concrete platform branches in CLI channel command', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/commands/channels.js'), 'utf8');
  expect(source).not.toMatch(/cliType === ['"](?:claude|codex|gemini|opencode|omp)/);
});
```

Repeat the source assertion for all five proxy Drivers and both CLI commands. These tests are migration guards, not substitutes for behavior tests.

- [ ] **Step 2: Record every current caller before moving code**

Search production and tests for each implementation file. Save the caller list in the task notes and classify each caller as:

- HTTP facade that must be changed to Runtime;
- CLI facade that must be changed to Runtime;
- shared infrastructure that must receive a narrow injected callback;
- test-only mock path that must be moved to Driver seam;
- worker/dynamic entry point that must remain explicitly documented.

- [ ] **Step 3: Run the guard tests and confirm red state**

Run:

```bash
npx vitest run tests/unit/platforms/drivers/platform-implementation-boundary.test.js
```

Expected: failures identify the current Driver-to-service and CLI-to-service delegation points.

- [ ] **Step 4: Commit the characterization guard**

```bash
git add tests/unit/platforms/drivers/platform-implementation-boundary.test.js tests/unit/platforms/drivers/builtin-driver-contract.test.js scripts/test-driver-reachability.js
git commit -m "test: guard platform implementation driver ownership"
```

---

### Task 2: Move remaining channel implementations

**Files:**
- Create/modify: `src/platforms/drivers/gemini/channels.js`, `src/platforms/drivers/gemini/helpers/**`
- Create/modify: `src/platforms/drivers/opencode/channels.js`, `src/platforms/drivers/opencode/helpers/**`
- Create/modify: `src/platforms/drivers/omp/channels.js`, `src/platforms/drivers/omp/helpers/**`
- Modify: `src/server/services/base/base-channel-service.js`
- Modify: `src/server/services/channel-sync-utils.js`
- Delete after caller migration: `src/server/services/gemini-channels.js`, `src/server/services/opencode-channels.js`, `src/server/services/omp-channels.js`
- Modify: `src/server/api/gemini-channels.js`, `src/server/api/opencode-channels.js`, `src/server/api/omp-channels.js`
- Modify: `tests/unit/platforms/drivers/gemini-channels.test.js`, `opencode-channels.test.js`, `omp-channels.test.js`

- [ ] **Step 1: Define the per-platform channel Driver methods**

Each Driver must expose the methods already consumed by facades plus the common contract:

```js
list(options = {})
getEnabled(options = {})
create(input)
update(id, patch)
remove(id)
markRecentlyUsed(id)
syncCurrent(options = {})
applyChannelToSettings(id, options = {})
getEffectiveApiKey(channel)
disableAll(options = {})
resetChannel(id)
getCliMetadata()
```

Gemini-specific methods own `.env`, `apiFormat`, and Vertex handling. OpenCode-specific methods own provider ID derivation, config path selection, model collection, and Codex fallback key. OMP-specific methods own static/managed mode, provider grouping, OAuth credential lookup, and managed provider writes.

- [ ] **Step 2: Move actual function bodies, not imports**

Move each platform service function and its platform-only helper into that platform Driver directory. Replace direct imports of another platform service with injected shared callbacks or the owning Driver:

```js
const shared = context.shared || {};
const channelStore = shared.channelStore;
const scheduler = shared.scheduler;
```

Do not implement `createDriver()` by calling `createChannelDriver({ servicePath })`. The final factory must construct the implementation directly.

- [ ] **Step 3: Keep shared storage and scheduling generic**

Extend `BaseChannelService` only with platform-neutral operations required by more than one Driver. Do not add Gemini/OpenCode/OMP fields to its schema. Platform-specific fields remain under `extra` or the platform Driver DTO.

- [ ] **Step 4: Convert channel APIs to Runtime-only access**

For each route module, replace direct service imports with:

```js
const { getPlatformRuntime } = require('../../platforms/runtime');

function getChannelsDriver() {
  return getPlatformRuntime().getDriver('gemini', 'channels');
}
```

Keep route-specific validation, HTTP status codes, response field names, health broadcasts, and speed-test orchestration in the API facade. The API must not import a platform service or proxy server.

- [ ] **Step 5: Migrate channel tests to the Driver seam**

Preserve tests for native config sync, invalid `apiFormat`, provider IDs, managed mode, and secret redaction. Replace `require.cache` mocks of deleted service paths with Driver factory/runtime mocks.

- [ ] **Step 6: Run channel regression**

```bash
npx vitest run tests/unit/platforms/drivers/gemini-channels.test.js tests/unit/platforms/drivers/opencode-channels.test.js tests/unit/platforms/drivers/omp-channels.test.js tests/unit/api/gemini-channels-api.test.js tests/unit/api/opencode-channels-api.test.js tests/unit/api/omp-channels-api.test.js
```

Expected: all existing channel behavior passes with no platform channel service import in production.

- [ ] **Step 7: Delete obsolete channel services and commit**

```bash
git add src/platforms/drivers src/server/services/base src/server/services/channel-sync-utils.js src/server/api tests
 git rm src/server/services/gemini-channels.js src/server/services/opencode-channels.js src/server/services/omp-channels.js
git commit -m "refactor: move platform channel implementations into drivers"
```

---

### Task 3: Move proxy lifecycle and protocol implementations

**Files:**
- Modify/create: `src/platforms/drivers/{claude,codex,gemini,opencode,omp}/proxy.js`
- Create: `src/platforms/drivers/{claude,codex,gemini,opencode,omp}/proxy-helpers/**`
- Modify: `src/server/services/proxy-runtime.js`, `proxy-log-helper.js`, `request-logger.js`, `server-shutdown.js`
- Modify: `src/server/api/{proxy,codex-proxy,gemini-proxy,opencode-proxy,omp-proxy}.js`
- Delete after caller migration: `src/server/{proxy-server,codex-proxy-server,gemini-proxy-server,opencode-proxy-server,omp-proxy-server}.js`
- Modify: `src/commands/toggle-proxy.js`
- Modify: proxy Driver/API tests

- [ ] **Step 1: Split common listener infrastructure from platform behavior**

Extract only listener concerns into reusable infrastructure: Express app creation, HTTP server bind/close, shutdown hooks, request logging, health/scheduler callbacks, and runtime timestamps. Keep provider protocol logic in the platform Driver.

The Driver contract is:

```js
status(options = {})
start(options = {})
stop(options = {})
restoreOnBoot(options = {})
handleRequest(request, response, options = {})
```

- [ ] **Step 2: Move each proxy implementation by platform**

Move provider headers, target URLs, body conversion, stream conversion, retries, model collection, usage extraction, and native restoration into the corresponding Driver. Keep `claude-wire.js`, `codex-wire.js`, and `gemini-wire.js` only as stateless utilities when they have more than one caller; Driver orchestration must own their use.

OMP Driver must retain gateway drain, managed-provider routing, retry policy, and auth header mapping.

- [ ] **Step 3: Replace old proxy server exports with Runtime calls in every caller**

Update API, CLI, daemon, OAuth broadcast, channel API cache invalidation, and server shutdown paths to resolve `runtime.getDriver(platform, 'proxy')`. No production caller may require a `*-proxy-server.js` module.

- [ ] **Step 4: Remove platform branches from proxy APIs**

Keep old URL and payload compatibility. API flow:

```js
const driver = getPlatformRuntime().getDriver(platform, 'proxy');
const result = await driver.start(options);
return sendLegacyProxyResponse(res, result);
```

Active-channel selection belongs to the channel Driver/shared channel application helper, not repeated in each API file.

- [ ] **Step 5: Add fake-upstream behavior tests**

For each platform, send a fake request through `handleRequest()` and assert target URL, headers, body conversion, streaming/non-streaming response, and typed failure. Assert failed upstream requests do not return HTTP 200 with an empty body.

- [ ] **Step 6: Run proxy regression**

```bash
npx vitest run tests/unit/platforms/drivers/*-proxy.test.js tests/unit/api/proxy-api.test.js tests/unit/api/codex-proxy-api.test.js tests/unit/api/gemini-proxy-api.test.js tests/unit/api/opencode-proxy-api.test.js tests/unit/api/omp-proxy-api.test.js
```

- [ ] **Step 7: Delete proxy server modules and commit**

```bash
git add src/platforms/drivers src/server/services src/server/api src/commands tests
git rm src/server/proxy-server.js src/server/codex-proxy-server.js src/server/gemini-proxy-server.js src/server/opencode-proxy-server.js src/server/omp-proxy-server.js
git commit -m "refactor: move platform proxy implementations into drivers"
```

---

### Task 4: Move sessions, statistics, and native configuration

**Files:**
- Modify: `src/platforms/drivers/{claude,codex,gemini,opencode,omp}/{sessions,statistics,native-config}.js`
- Create: platform-local helpers required by the moved implementations
- Modify: `src/server/services/session-history-index.js`, `session-history-worker.js`, `statistics-service.js`, `config-sync-manager.js`
- Delete after caller migration: platform `*-sessions.js`, `*-statistics-service.js`, and platform settings manager files under `src/server/services`
- Modify: all platform sessions/statistics API modules
- Modify: `src/commands/**` session/status callers

- [ ] **Step 1: Move session-history parsing and inventory ownership**

Move platform-specific inventory and parse functions from `src/server/services/session-history-adapters/{claude,codex,gemini,omp}.js` into each platform `sessions.js`. Keep SQLite schema, stale/complete consistency, cache invalidation, and worker orchestration in `session-history-index.js`.

The Driver must expose:

```js
inventory(options = {})
parse(descriptor, options = {})
listSessions(options = {})
recent(options = {})
search(query, options = {})
status(sessionId, options = {})
messages(sessionId, options = {})
delete(sessionId, options = {})
fork(sessionId, options = {})
```

- [ ] **Step 2: Move platform statistics logic**

Move platform pricing/usage parsing, request payload construction, and platform file persistence into `statistics.js`. Shared `statistics-service.js` aggregates Driver DTOs and does not require platform statistics services.

- [ ] **Step 3: Move native config implementations**

Move platform settings manager behavior into `native-config.js`: path resolution, backup/restore, protected writes, native OAuth synchronization, env/TOML/JSON serialization, and proxy configuration state. Keep path validation and permission policy shared.

- [ ] **Step 4: Convert session/statistics APIs and CLI callers**

Replace direct platform service imports with Runtime capability lookups. Preserve old route response shapes, `source`, project identifiers, and installed-CLI error messages. CLI status/session commands must resolve `sessions` and `statistics` Driver methods.

- [ ] **Step 5: Run session/statistics/native regression**

```bash
npx vitest run tests/unit/services/session-history-index.test.js tests/unit/services/statistics-service.test.js tests/unit/platforms/drivers/*-sessions.test.js tests/unit/platforms/drivers/*-statistics.test.js tests/unit/api/statistics.test.js
```

- [ ] **Step 6: Delete obsolete platform services and commit**

```bash
git add src/platforms/drivers src/server/services src/server/api src/commands tests
git rm src/server/services/codex-sessions.js src/server/services/gemini-sessions.js src/server/services/opencode-sessions.js src/server/services/omp-sessions.js src/server/services/claude-statistics-service.js src/server/services/codex-statistics-service.js src/server/services/gemini-statistics-service.js src/server/services/opencode-statistics-service.js src/server/services/omp-statistics-service.js
git commit -m "refactor: move session statistics and native config implementations"
```

Delete only files proven to have no remaining production caller; retain generic `sessions.js` if it is the shared Claude/session application implementation and remove its platform-specific logic first.

---

### Task 5: Move resource, prompt, MCP, and platform serialization behavior

**Files:**
- Modify: `src/platforms/drivers/{claude,codex,gemini,opencode,omp}/{resource-sync,prompts,mcp}.js`
- Modify: `src/server/services/config-sync-manager.js`, `config-templates-service.js`, `prompts-service.js`, `mcp-service.js`, `config-export-service.js`
- Modify: `src/server/services/project-config-adapters/*.js`
- Modify: related Driver/API tests

- [ ] **Step 1: Move platform-specific projections**

Each Driver owns native paths, format conversion, provider serialization, and remove/restore semantics. Shared services keep traversal, manifest precedence, permissions, secret redaction, and project root validation.

- [ ] **Step 2: Keep shared services capability-agnostic**

Replace platform-name branches with:

```js
for (const platform of runtime.list({ enabledOnly: true })) {
  const driver = runtime.getDriver(platform.key, capability);
  if (!driver || typeof driver[operation] !== 'function') continue;
  await driver[operation](payload);
}
```

- [ ] **Step 3: Run resource/prompt/MCP regression**

```bash
npx vitest run tests/unit/services/config-sync-manager.test.js tests/unit/services/config-templates-service.test.js tests/unit/services/prompts-service.test.js tests/unit/services/mcp-service.test.js tests/unit/platforms/drivers/resource-sync.test.js tests/unit/platforms/drivers/capabilities.test.js
```

- [ ] **Step 4: Commit capability projection migration**

```bash
git add src/platforms/drivers src/server/services src/server/api tests
git commit -m "refactor: move platform resource projections into drivers"
```

---

### Task 6: Make CLI commands Runtime-driven

**Files:**
- Modify: `src/commands/channels.js`
- Modify: `src/commands/toggle-proxy.js`
- Modify: `src/commands/daemon.js`, `src/commands/status.js`, `src/commands/sessions.js` if present
- Modify: `src/platforms/drivers/*/channels.js`, `proxy.js`, `native-config.js`
- Test: `tests/unit/commands/channels.test.js`, `toggle-proxy.test.js`, `status.test.js`, and new `tests/unit/commands/runtime-driven-cli.test.js`

- [ ] **Step 1: Add generic capability access helpers**

Use one helper with no platform switch:

```js
function getCapability(platform, capability) {
  const runtime = getPlatformRuntime();
  return runtime.getDriver(normalizePlatformKey(platform), capability);
}
```

`getChannelServices()` returns normalized Driver methods and metadata; it must not contain `require('../server/services/...')` or platform comparisons.

- [ ] **Step 2: Move platform CLI policy into Driver metadata**

Expose `getCliMetadata()` from each channel/proxy Driver. OMP returns `{ supportsCliCreate: false, managedProviderConfig: true }`; other platforms return their actual supported operations. Default port comes from Driver metadata or the validated platform manifest, not a CLI map.

- [ ] **Step 3: Replace CLI proxy lifecycle branches**

`toggle-proxy.js` gets `channels`, `proxy`, and `nativeConfig` Drivers from Runtime. Active channel restoration calls `channels.getBestChannelForRestore()` and `channels.applyChannelToSettings()`. It must not load `*-proxy-server.js`, `*-channels.js`, or `*-settings-manager.js`.

- [ ] **Step 4: Add config-only CLI regression**

Register a test-only `demo-cli` manifest with generic channels/proxy metadata. Verify CLI capability resolution works without adding a platform branch or editing a command source file.

- [ ] **Step 5: Run CLI tests and commit**

```bash
npx vitest run tests/unit/commands/channels.test.js tests/unit/commands/toggle-proxy.test.js tests/unit/commands/runtime-driven-cli.test.js tests/unit/platforms/demo-cli-contract.test.js
```

```bash
git add src/commands src/platforms/drivers tests
git commit -m "refactor: make CLI commands runtime-driven"
```

---

### Task 7: Remove legacy mappings, facades, and orphan files

**Files:**
- Modify: `src/platforms/drivers/legacy.js`
- Modify: `src/platforms/runtime.js`, `src/platforms/driver-registry.js` if required by removed registrations
- Modify: `scripts/test-driver-reachability.js`
- Delete: only server platform implementations with zero production/test-supported callers
- Modify: affected tests and mocks

- [ ] **Step 1: Remove migrated mappings from `legacy.js`**

Delete mappings for migrated platform channels, proxies, sessions, statistics, native config, prompts, MCP, and resource sync. `legacy.js` may retain only compatibility registration metadata and generic unsupported behavior; it must not point at platform implementation files under `src/server`.

- [ ] **Step 2: Search all production callers**

Run targeted repository searches for every deleted module name and classify any remaining result. Migrate valid callers before deletion. Keep only explicitly documented dynamic worker entries and generic infrastructure.

- [ ] **Step 3: Delete obsolete facades**

Delete a server facade only after all public API/CLI callers and test mocks use Runtime. Internal `require.resolve` compatibility is not preserved unless it is an explicitly supported public integration.

- [ ] **Step 4: Extend reachability checks**

Require the script to fail if:

- a built-in Driver loads `src/server` platform implementation;
- a command module contains a platform-specific require or branch;
- a deleted server platform module is imported;
- a Driver capability is only a `servicePath`/`localServicePath` wrapper.

- [ ] **Step 5: Commit cleanup**

```bash
git add src/platforms src/server src/commands scripts tests
git commit -m "refactor: remove obsolete platform service implementations"
```

---

### Task 8: Validate behavior and publish the follow-up PR

**Files:**
- Modify: tests only if a behavior gap is found
- Modify: plan/checklist only for completed steps

- [ ] **Step 1: Run focused migration tests**

```bash
npx vitest run tests/unit/platforms/drivers tests/unit/commands/runtime-driven-cli.test.js tests/unit/services/session-history-index.test.js
```

- [ ] **Step 2: Run API consistency**

```bash
npm run test:api
```

Expected: all existing API consistency checks pass.

- [ ] **Step 3: Run reachability and diff checks**

```bash
node scripts/test-driver-reachability.js
git diff --check
git status --short
```

Expected: no unexplained orphan modules and clean status after commit.

- [ ] **Step 4: Run the actual CLI smoke paths**

Exercise `--help`, `channel-status`, `switch-channel`, `toggle-proxy`, and `daemon` with mocked native/provider dependencies. Verify old command names, output status, and unsupported capability messages remain stable.

- [ ] **Step 5: Run full unit tests**

```bash
npm run test:unit
```

Record any environment-only failures exactly; do not report the suite as fully passing when Pinia resolution or unrelated plugin timeout failures occur.

- [ ] **Step 6: Review final ownership**

Search for:

```bash
rg "server/(?:services/)?(?:gemini|opencode|omp|codex|claude)-(?:channels|sessions|statistics|settings)|server/(?:codex|gemini|opencode|omp)?-proxy-server|cliType ===" src
```

The only allowed matches are HTTP facade names/comments and explicitly classified shared protocol/infrastructure utilities.

- [ ] **Step 7: Commit any final test-only corrections**

```bash
git add tests scripts
git commit -m "test: verify platform implementation ownership"
```

- [ ] **Step 8: Push and create the follow-up PR**

```bash
git push -u origin refactor/move-platform-implementations-to-drivers
```

Create a PR targeting `develop` with the ownership boundary, deleted modules, focused verification, API verification, reachability output, and any full-suite environment failures listed explicitly.
