# Platform Implementation Driver Boundary

## Problem

The previous migration added Registry/Runtime Driver entry points, but several built-in Drivers still delegate their implementation to platform-specific modules under `src/server`:

- `src/platforms/drivers/{gemini,opencode,omp}/channels.js` delegate to `src/server/services/*-channels.js`.
- `src/platforms/drivers/*/proxy.js` delegate to `src/server/*-proxy-server.js`.
- `src/platforms/drivers/*/{sessions,statistics,native-config}.js` delegate to platform-specific services.
- `src/commands/channels.js` and `src/commands/toggle-proxy.js` retain platform conditionals and direct server imports.

This leaves Driver ownership nominal rather than real and prevents unused platform services from being removed.

## Goals

1. Move platform-specific behavior and I/O into the corresponding platform/capability Driver.
2. Keep `src/server` limited to transport facades, shared application orchestration, and platform-neutral infrastructure.
3. Make CLI channel/proxy commands Runtime-driven instead of platform-switch-driven.
4. Delete platform service/proxy modules after all production callers and test seams are migrated.
5. Preserve public HTTP paths, CLI commands, response shapes, native-config protection, OMP managed mode, and existing provider behavior.
6. Keep platform code separated by platform directory; do not create one monolithic Driver implementation.

## Non-goals

- Do not remove public legacy HTTP URLs.
- Do not expose arbitrary user-provided executable Driver modules.
- Do not move generic SQLite/cache/scheduler/security infrastructure into every platform Driver.
- Do not change provider protocol semantics while relocating ownership.

## Target structure

```text
src/platforms/drivers/
  claude/
    channels.js
    proxy.js
    sessions.js
    statistics.js
    native-config.js
    resource-sync.js
    prompts.js
    mcp.js
    helpers/                 # only Claude-specific helpers
  codex/
    ...
  gemini/
    ...
  opencode/
    ...
  omp/
    ...
  shared/                    # result contracts and truly platform-neutral helpers

src/server/api/              # HTTP URL/parameter/response compatibility facades
src/commands/                # CLI interaction and output formatting only
src/server/services/base/    # shared application and infrastructure services
```

A Driver may be split into platform-local helper files when a capability is large. Platform-specific configuration paths, provider serialization, auth lookup, wire conversion, proxy request handling, session parsing, and statistics parsing must remain under that platform directory.

## Ownership rules

### Driver-owned

- Channel storage normalization and platform-specific native synchronization.
- Platform provider IDs, model/provider configuration, auth/keychain integration, and platform-specific environment updates.
- Proxy lifecycle and request protocol conversion, including headers, body formats, retry behavior, upstream target resolution, and usage extraction.
- Native configuration read/write/restore and protection semantics.
- Session inventory/parsing/read/mutation semantics that depend on a platform schema.
- Platform statistics parsing, pricing selection, and persistence payload construction.
- Platform-specific prompt, MCP, resource, and config serialization.
- Capability metadata used by CLI, including `supportsCliCreate`, managed-mode behavior, and available operations.

### Server-owned

- Express routers, legacy URL mounting, HTTP status/response conversion, and websocket transport.
- CLI prompts, menus, terminal formatting, and command dispatch.
- Generic channel application operations, scheduler policy, health aggregation, caches, SQLite schema/orchestration, worker lifecycle, security validation, and logging infrastructure.
- Registry/Runtime lookup and capability iteration.

Server facades may translate old argument order and return shapes, but must not contain provider I/O, platform branches, or duplicated platform business logic.

## Dispatch contracts

CLI code obtains capability objects through Runtime:

```js
const runtime = getPlatformRuntime();
const channels = runtime.getDriver(platform, 'channels');
const proxy = runtime.getDriver(platform, 'proxy');
```

The CLI must use capability metadata/methods instead of checking concrete platform names. A new manifest platform with compatible generic Drivers must be discoverable without editing `src/commands`.

Legacy HTTP modules may retain names and paths, but their implementation is limited to:

1. deserialize and validate request input;
2. get the Driver from Runtime;
3. invoke the capability;
4. map Driver DTOs/results to the old response shape;
5. broadcast transport events.

## Migration order

1. Characterize existing platform service/proxy behavior and identify production callers.
2. Move remaining channel implementations, then proxy/wire implementations.
3. Move sessions, statistics, native config, resource sync, prompts, and MCP implementations.
4. Replace CLI platform branches with Runtime capability dispatch.
5. Remove `legacy.js` mappings to platform-specific server modules.
6. Migrate tests and `require.cache` seams to Driver/facade boundaries.
7. Delete server modules with no production or explicitly supported compatibility caller.
8. Run API, CLI, capability contract, reachability, and full regression checks.

## Acceptance criteria

- No production `src` import from CLI or shared application code directly requires a platform-specific channel/session/statistics/settings/proxy implementation under `src/server`.
- No Driver capability is only a wrapper around a platform-specific server implementation.
- `legacy.js` contains no mapping to the migrated platform-specific implementation files.
- `src/commands/channels.js` and `toggle-proxy.js` contain no platform-specific require/switch branches.
- Public legacy HTTP URLs and CLI command names remain functional.
- Platform-specific implementation files exist only under their platform Driver directories, except explicitly classified shared protocol/infrastructure utilities.
- Reachability reports no unexplained orphan modules.
- Focused behavior tests cover each migrated capability and preserve error/secret/native-config semantics.
