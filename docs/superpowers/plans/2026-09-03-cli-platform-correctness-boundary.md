# CLI 平台正确性边界实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove remaining platform-specific correctness leaks from CLI and HTTP transport while preserving legacy Drivers, public CLI commands, old API URLs, and normal response shapes.

**Architecture:** Add one narrow `src/platforms/access.js` seam for Registry-backed platform, capability, and operation resolution. Migrate transport and interactive CLI callers to this seam; keep platform protocol implementations behind existing Runtime/`legacy:*` Drivers. Tighten Manifest route validation and make missing operations explicitly unsupported instead of returning empty success.

**Tech Stack:** Node.js 22, CommonJS, Express, Inquirer, Vitest, existing Platform Registry/Runtime, DriverResult conventions.

---

## Scope and invariants

The implementation must preserve:

- `ctx claude|codex|gemini|opencode|omp start|stop|restart|status`.
- Existing `/api/<platform>/...` and root alias URLs.
- Existing successful response fields and response codecs.
- Existing built-in `legacy:*` Driver IDs and platform implementations.
- Existing user data, native files, session files, and configuration formats.
- Default Claude behavior only when the caller supplies no platform at all and the existing public contract defines Claude as the default.

The implementation must change:

- A non-empty unknown platform must never become Claude.
- A registered platform without a requested capability must return `unsupported`.
- A declared capability without the requested operation must return `unsupported`.
- Interactive CLI session and status paths must use the selected platform, not direct Claude imports.
- Missing Driver operations must never be represented as a successful empty GET response.

Out of scope:

- Deleting `legacy.js` or `legacy:*` Drivers.
- Rewriting the five platform protocols.
- Extracting shared API route profiles.
- Changing `enabledOnly` or Manifest `enabled` semantics.
- Replacing the Commands/Agents resource implementations with new generic Drivers.
- Changing Web UI information architecture.

---

## File ownership map

### New

- `src/platforms/access.js`: Registry/Runtime-backed platform and operation resolution, stable error objects.
- `tests/unit/platforms/access.test.js`: Access seam behavior.

### Platform routing and Manifest

- `src/platforms/manifest-schema.js`: Route operation and codec contract validation.
- `src/server/api/platform-api-config.js`: Export codec lookup predicates used by schema validation.
- `src/server/api/platform-route-factory.js`: Return `unsupported` for missing Driver operations.
- `tests/unit/platforms/manifest-schema.test.js`: Invalid operation/codec tests.
- `tests/unit/api/platform-route-factory.test.js`: Missing-operation behavior.
- `tests/unit/api/platform-routes.test.js`: Existing alias regression.

### HTTP transport

- `src/server/api/project-config.js`: Registry/capability validation instead of a fixed platform Set.
- `src/server/api/commands.js`: Preserve no-platform Claude default, reject unknown non-empty platform, report unsupported registered platforms.
- `src/server/api/agents.js`: Same platform resolution policy; preserve Codex scope behavior through service/manifest metadata where applicable.
- `src/server/api/mcp.js`: Remove fixed platform/export lists where Registry capability resolution already provides the answer.
- `src/server/services/platform-resolution.js`: Resolve against Registry or become a compatibility wrapper over `access.js`.
- `tests/unit/api/project-config-api.test.js`: Unknown, unsupported, and default platform behavior.
- `tests/unit/api/commands-api.test.js`: Unknown and registered custom platform behavior.
- `tests/unit/api/agents-api.test.js`: Unknown and registered custom platform behavior.
- `tests/unit/api/mcp-api.test.js`: Registry-driven platform behavior.

### Interactive CLI

- `src/ui/menu.js`: Registry-derived label/color and Runtime-derived channel/proxy state.
- `src/commands/list.js`: Current platform `projects`/`sessions` Driver.
- `src/commands/search.js`: Current platform `projects`/`sessions` Driver.
- `src/commands/workspace.js`: Current platform project Driver.
- `src/commands/resume.js`: Current platform session launch operation.
- `src/index.js`: Pass current platform and runtime dependencies into CLI handlers where required; keep command dispatch unchanged.
- `tests/unit/commands/cli-type.test.js`: Dynamic platform choice behavior.
- `tests/unit/commands/channels.test.js`: Existing channel contract plus custom platform seam.
- `tests/unit/commands/runtime-driven-cli.test.js`: New CLI Runtime behavior tests.
- `tests/unit/commands/list.test.js`: Session Driver use and unsupported behavior.
- `tests/unit/commands/search.test.js`: Session Driver use and unsupported behavior.
- `tests/unit/commands/resume.test.js`: Launch Driver use and no Claude fallback.
- `tests/unit/commands/workspace.test.js`: Project Driver use.

### Verification and documentation

- `scripts/test-driver-reachability.js`: Add checks for direct Claude imports in migrated interactive CLI paths.
- `README.md`: Verify existing configuration-driven boundary wording remains accurate; modify only its platform-boundary paragraph if implementation changes the claim.

---

## Task 1: Establish the platform access seam

**Files:**
- Create: `src/platforms/access.js`
- Create: `tests/unit/platforms/access.test.js`
- No other production file is required; `access.js` lazily reads `getPlatformContext()` when dependencies are not injected.

- [ ] **Step 1: Write behavior tests for platform resolution.**

Test the public behavior with injected fake Registry and Runtime objects:

```js
const registry = {
  resolve: key => key === 'demo-cli' ? { key, label: 'Demo CLI' } : null,
  getCapability: (_key, capability) => capability === 'sessions' ? 'generic-jsonl' : null
};
const runtime = {
  getDriver: (_key, capability) => capability === 'sessions' ? { recent: vi.fn() } : null
};
```

Cover these cases:

- `resolvePlatform('demo-cli')` returns normalized key and manifest.
- `resolvePlatform('missing')` throws an error with `code: 'not_found'`.
- `resolveCapability('demo-cli', 'sessions')` returns the sessions Driver.
- Missing capability throws `code: 'unsupported'` with platform and capability.
- `resolveOperation('demo-cli', 'sessions', 'recent')` returns the bound operation.
- Missing operation throws `code: 'unsupported'` with operation.
- Empty key uses explicit `fallback` only when configured.
- A non-empty unknown key never uses fallback.
- Runtime creation errors are exposed as `code: 'failed'` and preserve the original cause non-enumerably.

Run:

```bash
npx vitest run tests/unit/platforms/access.test.js --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because `src/platforms/access.js` does not exist.

- [ ] **Step 2: Implement the minimal access interface.**

Use this stable shape:

```js
function resolvePlatform(key, options = {}) {}
function resolveCapability(key, capability, options = {}) {}
function resolveOperation(key, capability, operation, options = {}) {}

module.exports = {
  resolvePlatform,
  resolveCapability,
  resolveOperation,
  createPlatformAccessError
};
```

The implementation must:

1. Normalize keys with `normalizePlatformKey`.
2. Use injected `registry`/`runtime`, defaulting to `getPlatformContext()` lazily.
3. Throw `not_found` for non-empty unknown keys.
4. Use a fallback only for an empty key.
5. Check `registry.getCapability()` when available; otherwise inspect `manifest.capabilities`.
6. Treat `null`, `undefined`, and `'unsupported'` as unsupported.
7. Call Runtime only after capability validation.
8. Return `{ key, manifest, driver }` for capability resolution.
9. Return `{ key, manifest, driver, operation }` for operation resolution, where `operation` is the callable bound to the Driver.
10. Attach `cause` as a non-enumerable property for runtime failures.

- [ ] **Step 3: Run the seam tests.**

Run:

```bash
npx vitest run tests/unit/platforms/access.test.js --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 4: Commit the seam.**

```bash
git add src/platforms/access.js tests/unit/platforms/access.test.js
git commit -m "feat: add registry-backed platform access seam"
```

---

## Task 2: Make Manifest route contracts fail early

**Files:**
- Modify: `src/platforms/manifest-schema.js`
- Modify: `src/server/api/platform-api-config.js`
- Modify: `tests/unit/platforms/manifest-schema.test.js`
- Modify: `tests/unit/api/platform-route-factory.test.js`
- Modify: `tests/unit/api/platform-routes.test.js`

- [ ] **Step 1: Add failing Manifest tests.**

Add valid and invalid descriptors using the existing Manifest fixture style:

```js
const base = {
  key: 'demo-cli',
  label: 'Demo CLI',
  command: 'demo',
  capabilities: { sessions: 'generic-jsonl' },
  api: { prefix: 'demo', routes: [] }
};
```

Assert that validation rejects:

- `operation: 'notAnOperation'` for `sessions`.
- `request: 'missing-codec'`.
- `response: 'missing-codec'`.
- A route whose capability is not declared.

Assert that existing custom operation names used by the five built-in manifests remain valid.

Add route factory tests with a Driver that has no requested method. Assert both GET and POST return HTTP 404 with `body.error.code === 'unsupported'`; neither may return 200 or an empty payload.

Run:

```bash
npx vitest run tests/unit/platforms/manifest-schema.test.js tests/unit/api/platform-route-factory.test.js --no-file-parallelism --maxWorkers=1
```

Expected: new tests fail before implementation.

- [ ] **Step 2: Export codec existence predicates.**

In `src/server/api/platform-api-config.js`, add narrow predicates next to the existing codec maps:

```js
function hasRequestCodec(codec) {
  return typeof codec === 'function' || typeof requestCodecs[codec] === 'function';
}

function hasResponseCodec(codec) {
  return typeof codec === 'function' || typeof responseCodecs[codec] === 'function';
}
```

Export both functions. Do not expose the codec implementation maps to user configuration validation.

- [ ] **Step 3: Add operation contract data and validation.**

In `manifest-schema.js`, add the exact frozen capability-to-operation map below; it is the union currently declared by the five built-in Manifests:

```js
const CAPABILITY_OPERATIONS = Object.freeze({
  api: new Set(['getConfig', 'getConfigAuthProviders', 'getConfigCapabilities', 'getConfigResources']),
  channels: new Set(['applyToSettings', 'bestForRestore', 'catalogMetadata', 'create', 'current', 'enabled', 'list', 'models', 'order', 'poolStatus', 'probeModels', 'remove', 'resetHealth', 'speedTest', 'speedTestAll', 'sync', 'update']),
  health: new Set(['healthCheck']),
  hooks: new Set(['getHooks', 'saveHooks', 'testHooks']),
  projects: new Set(['createProject', 'deleteProject', 'listProjects', 'saveProjectOrder']),
  proxy: new Set(['clearLogs', 'start', 'status', 'stop']),
  sessions: new Set(['batchDelete', 'createSession', 'delete', 'fork', 'launch', 'listSessions', 'messages', 'outline', 'recent', 'saveSessionOrder', 'search', 'searchAcrossProjects', 'status']),
  statistics: new Set(['daily', 'summary', 'today'])
});
```

Reject operations absent from the matching Set with `/api/routes/<index>/operation`. Validate named request codecs against `default` and named response codecs against `default`, `projects-list`, `projects`, `sessions-list`, and `sessions` through the predicates exported from `platform-api-config.js`. Function-valued codecs remain valid only for in-process built-in definitions; user JSON cannot contain functions.

- [ ] **Step 4: Remove missing-operation empty success.**

In `platform-route-factory.js`, change the missing Driver/operation branch so it always calls `makeUnsupported(context)` and `sendDriverResult()`. Leave `emptyPayload()` for explicitly successful Driver results only.

- [ ] **Step 5: Run focused route tests.**

```bash
npx vitest run tests/unit/platforms/manifest-schema.test.js tests/unit/api/platform-route-factory.test.js tests/unit/api/platform-routes.test.js --no-file-parallelism --maxWorkers=1
```

Expected: PASS, including all existing alias and response-shape assertions.

- [ ] **Step 6: Commit route contract enforcement.**

```bash
git add src/platforms/manifest-schema.js src/server/api/platform-api-config.js src/server/api/platform-route-factory.js tests/unit/platforms/manifest-schema.test.js tests/unit/api/platform-route-factory.test.js tests/unit/api/platform-routes.test.js
git commit -m "fix: reject invalid platform route operations"
```

---

## Task 3: Remove HTTP platform allowlists and silent fallbacks

**Files:**
- Modify: `src/server/api/project-config.js`
- Modify: `src/server/api/commands.js`
- Modify: `src/server/api/agents.js`
- Modify: `src/server/api/mcp.js`
- Modify: `src/server/services/platform-resolution.js`
- Modify: corresponding API tests

- [ ] **Step 1: Add failing HTTP behavior tests.**

For each API family, add tests for:

1. No platform supplied: existing Claude default remains.
2. `platform=missing`: 404/not-found behavior; no Claude service constructed.
3. Registered `demo-cli` without the requested capability: 404/unsupported behavior.
4. Registered `demo-cli` with the required capability and injected service/Driver: request reaches that platform.

Use fake Registry/Runtime injection or the existing module cache seam already used by the API tests. Do not assert implementation source text.

Run:

```bash
npx vitest run tests/unit/api/project-config-api.test.js tests/unit/api/commands-api.test.js tests/unit/api/agents-api.test.js tests/unit/api/mcp-api.test.js --no-file-parallelism --maxWorkers=1
```

Expected: new tests fail because the APIs currently use fixed Sets and Claude fallback.

- [ ] **Step 2: Migrate Project Config platform validation.**

Replace the fixed Set in `project-config.js` with `resolveCapability(platform, 'projectConfig')` or the existing `ProjectConfigService` adapter lookup. Keep request field validation and existing `sendApiError` status mapping. Preserve the default `claude` when `platform` is absent.

- [ ] **Step 3: Migrate Commands and Agents platform resolution.**

Use the access seam for platform existence. Keep their existing platform-specific format maps and Codex scope restrictions for built-in platforms. Change behavior as follows:

```text
empty platform → claude
non-empty unknown platform → not_found
registered platform without commands/agents implementation → unsupported
registered built-in platform → existing service behavior
```

A custom Manifest must not be treated as fully supported merely because it exists or declares an unrelated resource type.

- [ ] **Step 4: Migrate MCP platform/export checks.**

Resolve import/export platform capability through Registry and Runtime. Keep `json` as the generic export format. A platform name is valid only if Registry resolves it and the platform declares MCP capability; unsupported formats continue to return the existing 404 body.

- [ ] **Step 5: Narrow the managed-platform resolver.**

If `src/server/services/platform-resolution.js` remains for compatibility, make it delegate to Registry-backed resolution and keep the existing `pi` → `omp` deprecation mapping. It must no longer own a hardcoded supported-platform array.

- [ ] **Step 6: Run focused HTTP tests.**

```bash
npx vitest run tests/unit/api/project-config-api.test.js tests/unit/api/commands-api.test.js tests/unit/api/agents-api.test.js tests/unit/api/mcp-api.test.js tests/unit/services/project-config-service.test.js --no-file-parallelism --maxWorkers=1
```

Expected: PASS; absent-platform Claude compatibility remains, while non-empty unknown platforms never touch Claude services.

- [ ] **Step 7: Commit the HTTP boundary fix.**

```bash
git add src/server/api/project-config.js src/server/api/commands.js src/server/api/agents.js src/server/api/mcp.js src/server/services/platform-resolution.js tests/unit/api/project-config-api.test.js tests/unit/api/commands-api.test.js tests/unit/api/agents-api.test.js tests/unit/api/mcp-api.test.js
git commit -m "fix: resolve HTTP platforms through registry"
```

---

## Task 4: Migrate the interactive menu to Registry/Runtime

**Files:**
- Modify: `src/ui/menu.js`
- Modify: `src/index.js` to keep the existing one-argument production menu call while allowing injected test dependencies
- Modify: `tests/unit/commands/channels.test.js`
- Create: `tests/unit/commands/runtime-driven-cli.test.js`

- [ ] **Step 1: Add failing menu tests.**

Inject a fake Registry with `demo-cli` and fake Runtime Drivers:

```js
const registry = {
  resolve: key => key === 'demo-cli' ? {
    key: 'demo-cli', label: 'Demo CLI', terminalColor: 'blue', cliSelectable: true
  } : null,
  getCapability: (_key, capability) => ['channels', 'proxy'].includes(capability) ? 'fake' : null
};
const runtime = {
  getDriver: (_key, capability) => capability === 'channels'
    ? { current: () => ({ name: 'Demo Channel' }) }
    : { status: () => ({ running: false }) }
};
```

Assert that `showMainMenu({ currentCliType: 'demo-cli' })` calls only demo Drivers. Assert that `omp` is not normalized to Claude. Assert that missing channel/proxy capabilities produce a visible unsupported state or omitted optional status, not a Claude lookup.

- [ ] **Step 2: Replace platform enum and direct imports.**

Remove `normalizeCliType()` comparisons and the four-way `getChannelAndProxyStatus()` branch. Resolve the current platform through `access.js`; call the declared `channels.current` operation when available, otherwise `channels.list`; call `proxy.status` when available.

Derive display name and color from Manifest fields with safe terminal-color fallback. Preserve menu choices and user-facing menu action values.

- [ ] **Step 3: Pass explicit dependencies where tests need isolation.**

Keep production defaults lazy. Allow `showMainMenu(config, { registry, runtime })` or an equivalent dependency object without changing the existing one-argument call contract.

- [ ] **Step 4: Run menu and channel tests.**

```bash
npx vitest run tests/unit/commands/channels.test.js tests/unit/commands/cli-type.test.js tests/unit/commands/runtime-driven-cli.test.js --no-file-parallelism --maxWorkers=1
```

Expected: PASS, including dynamic `demo-cli` and `omp` cases.

- [ ] **Step 5: Commit menu migration.**

```bash
git add src/ui/menu.js src/index.js tests/unit/commands/channels.test.js tests/unit/commands/cli-type.test.js tests/unit/commands/runtime-driven-cli.test.js
git commit -m "refactor: drive interactive menu from platform runtime"
```

---

## Task 5: Migrate session list and search commands

**Files:**
- Modify: `src/commands/list.js`
- Modify: `src/commands/search.js`
- Modify: `src/index.js` call sites for `handleList` and `handleSearch`
- Create: `tests/unit/commands/list.test.js`
- Create: `tests/unit/commands/search.test.js`

- [ ] **Step 1: Add failing Driver seam tests.**

Test `listRecentSessionsAcrossProjects`, `searchSessionsAcrossProjects`, and the handler path using a fake `demo-cli` Runtime:

```js
const sessions = {
  recent: vi.fn().mockResolvedValue([{ sessionId: 's1', projectName: 'demo', firstMessage: 'hello' }]),
  searchAcrossProjects: vi.fn().mockResolvedValue([{ sessionId: 's1', projectName: 'demo', matches: [], matchCount: 1 }])
};
const projects = { listProjects: vi.fn().mockResolvedValue([{ name: 'demo' }]) };
```

Assert the fake Driver is called and the Claude module is not imported. Add a missing-operation test that returns `unsupported` without scanning Claude sessions.

- [ ] **Step 2: Add platform parameters without breaking existing calls.**

Use an options object after existing arguments, for example:

```js
listRecentSessionsAcrossProjects(config, limit, {
  platform: config.currentCliType,
  runtime,
  registry
});
```

Existing callers that omit the options object continue to use `config.currentCliType || 'claude'` through the access seam.

- [ ] **Step 3: Replace direct Claude session imports.**

For listing:

- Resolve `projects`/`sessions` Drivers from the selected platform.
- Use `sessions.recent(limit, { config })` for cross-project recent sessions.
- Use `sessions.listSessions(projectName, { config })` for a project list.

For search:

- Use `sessions.searchAcrossProjects(keyword, limit, { config })` when available.
- Use the platform session Driver’s `parse`/normalization result for project and message display fields.
- Do not call Claude helpers for path parsing or aliases.

Preserve prompt text, choice values, sorting, alias presentation, and fork confirmation.

- [ ] **Step 4: Route resume through the platform-aware handler.**

Pass the selected platform through `resumeSession(config, sessionId, fork, { platform, runtime, registry })`. Do not rely on a global mutable platform.

- [ ] **Step 5: Run focused CLI tests.**

```bash
npx vitest run tests/unit/commands/list.test.js tests/unit/commands/search.test.js tests/unit/commands/channels.test.js --no-file-parallelism --maxWorkers=1
```

Expected: PASS with fake platform Driver calls and no Claude fallback.

- [ ] **Step 6: Commit session list/search migration.**

```bash
git add src/commands/list.js src/commands/search.js src/index.js tests/unit/commands/list.test.js tests/unit/commands/search.test.js
git commit -m "refactor: route CLI session reads through platform drivers"
```

---

## Task 6: Migrate workspace project discovery

**Files:**
- Modify: `src/commands/workspace.js`
- Modify: `src/index.js` to pass the selected platform into workspace handling
- Create: `tests/unit/commands/workspace.test.js`

- [ ] **Step 1: Add a failing project Driver test.**

Inject a `demo-cli` `projects` Driver exposing `listProjects` and assert workspace project choices use its result. Include a test where the project Driver is unsupported and workspace creation stops with an explicit message rather than reading Claude sessions.

- [ ] **Step 2: Replace `getProjectsWithStats` import.**

Resolve the selected platform’s `projects` Driver. Normalize its result into the existing workspace choice fields (`displayName`, `fullPath`, `sessionCount`) using generic fields first. Preserve the existing worktree creation and workspace persistence logic.

- [ ] **Step 3: Remove the Claude-specific user-facing instruction.**

Build the final message from the selected platform Manifest label/command. Use the Manifest command alias only for display; do not execute it in workspace code.

- [ ] **Step 4: Run workspace tests.**

```bash
npx vitest run tests/unit/commands/workspace.test.js tests/unit/services/workspace-service.test.js --no-file-parallelism --maxWorkers=1
```

Expected: PASS, with workspace creation behavior unchanged for Claude and Runtime-based discovery for other platforms.

- [ ] **Step 5: Commit workspace migration.**

```bash
git add src/commands/workspace.js src/index.js tests/unit/commands/workspace.test.js
git commit -m "refactor: use platform project drivers in workspace CLI"
```

---

## Task 7: Route Claude session launch through the Driver seam

**Files:**
- Modify: `src/commands/resume.js`
- Modify: `src/platforms/drivers/claude/sessions.js`
- Modify: `src/platforms/drivers/claude/sessions-implementation.js`
- Create: `tests/unit/commands/resume.test.js`
- Modify: `tests/unit/platforms/builtin-driver-contract.test.js`

- [ ] **Step 1: Characterize current Claude resume behavior.**

Add a test around injected process execution and filesystem/session metadata that verifies Claude still receives:

```text
executable: claude
arguments: -r <sessionId>
arguments: --fork-session only when fork=true
stdio: inherit
cwd: session cwd when readable, otherwise current cwd
```

Do not run a real Claude executable.

- [ ] **Step 2: Add the `sessions.launch` Driver operation.**

Expose this method only from the Claude session Driver in this repair:

```js
launch(sessionId, {
  fork: false,
  config,
  cwd,
  processRunner
})
```

Move existing Claude session-file cwd discovery and executable argument construction into `claude/sessions-implementation.js`. Use an argument-vector runner such as `spawnSync('claude', args, { cwd, stdio: 'inherit', windowsHide: true })`; never construct a shell command string. Codex, Gemini, OpenCode, OMP, and generic user platforms do not gain launch behavior in this scope and therefore resolve as `unsupported`.

- [ ] **Step 3: Migrate `resume.js`.**

Remove `execSync`, direct Claude session-file parsing, and the hardcoded `claude` command. Resolve the selected platform `sessions.launch` operation. Keep terminal cleanup, spinner, display, and process exit handling in the CLI facade. Pass structured arguments to the Driver and preserve the child exit status/SIGINT behavior.

- [ ] **Step 4: Test no-fallback behavior.**

Assert:

- `demo-cli` without launch returns `unsupported`.
- Codex, Gemini, OpenCode, and OMP return `unsupported` until they own verified launch semantics.
- An unknown platform does not invoke Claude.
- Claude preserves existing arguments, cwd selection, inherited stdio, and exit behavior.

Run:

```bash
npx vitest run tests/unit/commands/resume.test.js tests/unit/platforms/builtin-driver-contract.test.js --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Commit launch migration.**

```bash
git add src/commands/resume.js src/platforms/drivers/claude/sessions.js src/platforms/drivers/claude/sessions-implementation.js tests/unit/commands/resume.test.js tests/unit/platforms/builtin-driver-contract.test.js
git commit -m "refactor: launch Claude sessions through platform driver"
```

---

## Task 8: Remove direct-import regressions and update compatibility tests

**Files:**
- Modify: `scripts/test-driver-reachability.js`
- Modify: `tests/unit/platforms/demo-cli-contract.test.js`
- Modify: tests that currently mock the five migrated concrete Claude seams, limited to the test files named in Tasks 4–7.

- [ ] **Step 1: Add reachability assertions.**

The reachability script must fail if these migrated files directly reference a concrete Claude implementation:

```text
src/ui/menu.js
src/commands/list.js
src/commands/search.js
src/commands/workspace.js
src/commands/resume.js
```

The assertion may allow `src/platforms/drivers/legacy.js`, because it remains the intentional compatibility adapter. Do not ban platform-specific code inside platform Driver directories.

- [ ] **Step 2: Expand `demo-cli` contract coverage.**

Register a Manifest with generic sessions/projects/resource capability and assert:

- Registry resolves it.
- CLI-facing access resolves its Drivers.
- Missing proxy or launch reports `unsupported`.
- No built-in platform branch is required.

- [ ] **Step 3: Run reachability and platform contracts.**

```bash
node scripts/test-driver-reachability.js
npx vitest run tests/unit/platforms/demo-cli-contract.test.js tests/unit/commands/platform-command-registry.test.js tests/unit/platforms/access.test.js --no-file-parallelism --maxWorkers=1
```

Expected: PASS with no migrated interactive CLI direct Claude imports.

- [ ] **Step 4: Commit regression guards.**

```bash
git add scripts/test-driver-reachability.js tests/unit/platforms/demo-cli-contract.test.js tests/unit/commands/platform-command-registry.test.js
git commit -m "test: guard runtime-driven CLI platform boundaries"
```

---

## Task 9: Verify documentation boundary

**Files:**
- Read: `README.md`
- Modify: `README.md` when its platform-boundary paragraph is inaccurate after implementation.

- [ ] **Step 1: Compare documentation with the implemented boundary.**

Keep the existing statements that generic platforms use allowlisted Drivers and special protocols require code. The final documented claim must state that Registry/Runtime resolves transport platforms while platform-specific protocols remain in Capability Drivers. Do not claim that a Manifest alone provides full feature parity.

- [ ] **Step 2: Run Markdown diff validation.**

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 3: Commit documentation when the comparison identifies an inaccurate claim.**

```bash
git add README.md
git commit -m "docs: clarify runtime-driven platform boundary"
```

---

## Task 10: Full verification and smoke checks

**Files:**
- No source changes expected unless a verification failure identifies a specific regression.

- [ ] **Step 1: Run all focused platform and CLI tests.**

```bash
npx vitest run \
  tests/unit/platforms/access.test.js \
  tests/unit/platforms/manifest-schema.test.js \
  tests/unit/platforms/runtime.test.js \
  tests/unit/platforms/registry.test.js \
  tests/unit/platforms/demo-cli-contract.test.js \
  tests/unit/platforms/builtin-driver-contract.test.js \
  tests/unit/api/platform-route-factory.test.js \
  tests/unit/api/platform-routes.test.js \
  tests/unit/api/project-config-api.test.js \
  tests/unit/api/commands-api.test.js \
  tests/unit/api/agents-api.test.js \
  tests/unit/api/mcp-api.test.js \
  tests/unit/commands/cli-type.test.js \
  tests/unit/commands/channels.test.js \
  tests/unit/commands/list.test.js \
  tests/unit/commands/search.test.js \
  tests/unit/commands/workspace.test.js \
  tests/unit/commands/resume.test.js \
  --no-file-parallelism --maxWorkers=1 --testTimeout=30000
```

Expected: PASS.

- [ ] **Step 2: Run the repository reachability and API checks.**

```bash
node scripts/test-driver-reachability.js
node scripts/test-api-consistency.js
node scripts/test-basic.js
```

Expected: each command exits 0.

- [ ] **Step 3: Run the complete unit suite.**

```bash
npx vitest run tests/unit --no-file-parallelism --maxWorkers=1 --testTimeout=30000
```

Expected: all unit tests pass. Any environment-only failure must be recorded with the exact command output and must not be hidden.

- [ ] **Step 4: Exercise CLI help and platform dispatch.**

Run:

```bash
node bin/ctx.js --help
node -e "const cli=require('./src/index.js'); console.log(typeof cli._test.dispatchPlatformCommand)"
```

Expected:

- Help lists Registry-derived proxy commands.
- The exported dispatch helper remains callable.
- No command starts a real proxy during this smoke check.

- [ ] **Step 5: Check the final diff and working tree.**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intentional source/test/documentation changes.

- [ ] **Step 6: Commit a final test-only correction when verification required one, then stop.**

Stage exactly the test files changed to repair the failing observable contract and commit them with:

```bash
git commit -m "test: preserve platform compatibility contract"
```

Do not introduce unrelated cleanup, new platform features, route profile extraction, or legacy Driver removal during final verification.

---

## Acceptance criteria

The refactor is complete only when all of the following are observable:

1. A non-empty unknown platform never reaches Claude code through CLI or HTTP.
2. `omp` remains `omp` in the interactive menu and status paths.
3. `demo-cli` generic Drivers can be resolved without adding platform branches to CLI/HTTP callers.
4. Interactive list/search/workspace paths use the selected platform Driver.
5. Session resume does not construct a hardcoded Claude shell command.
6. Missing route operations return structured `unsupported`, not 200 empty success.
7. Manifest invalid operation and codec names fail validation.
8. Project Config, Commands, Agents, and MCP no longer maintain authoritative fixed platform lists.
9. Existing built-in CLI commands, old API aliases, and normal response shapes remain compatible.
10. Focused tests, reachability checks, API consistency checks, and the complete unit suite pass.
