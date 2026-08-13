# Windows Command Window Hiding Design

**Date:** 2026-08-11

## Goal

Prevent Windows console windows from appearing for every background, non-interactive command launched by the project, including `ps`, PowerShell, `node`, `npm`, PM2, MCP, and worker processes, while preserving the current terminal behavior of interactive session resume commands.

## Scope

The audit covers actual child-process launch APIs under `src/`, `bin/`, and project scripts: `spawn`, `spawnSync`, `exec`, `execFile`, `execSync`, and `fork`.

Every non-interactive child-process launch must pass `windowsHide: true`. This includes command probes, process inspection/termination, package installation and update operations, PM2 shell commands, MCP transports, OAuth/provider probes, generated notification helpers, certificate generation, web builds, and background workers.

The interactive session-resume path in `src/commands/resume.js` remains terminal-attached (`stdio: 'inherit'`) so Claude/CLI input and output continue to work in the caller's terminal. It is not treated as a hidden background process.

## Design

Use the existing project convention: add or retain `windowsHide: true` directly in each child-process options object. Do not introduce a process wrapper or global monkey patch. This keeps dependency injection used by tests intact, limits the behavioral change to Windows process creation, and avoids changing command arguments, shell selection, stdio, environment, cwd, timeout, or error handling.

The implementation will update only missing call sites. Existing `windowsHide: true` options remain unchanged. For `fork` workers, add the option alongside the existing `stdio`/`silent` configuration. For callback and promise-based APIs, options must be passed to the actual launch call, not merely to a higher-level helper that may be bypassed.

## Affected Areas

The implementation audit will verify and update the following areas when a launch lacks the option:

- `src/commands/`: log following, updates, and any other command launchers; preserve interactive resume semantics.
- `src/utils/`: process/port inspection and termination commands.
- `src/plugins/`: plugin installation commands.
- `src/server/api/`: PM2 autostart and API-triggered command launches.
- `src/server/services/`: MCP clients, OAuth/provider probes, OMP model probes, marketplace sync, certificate/web-build helpers, notification-generated Node helpers, and all worker forks.
- `scripts/`: Windows regression coverage; scripts themselves are not runtime package APIs unless they launch child processes as part of tested project behavior.

## Testing

Add focused regression assertions using existing injectable runners where available. The assertions must verify `windowsHide: true` is passed to command runners and worker/process launch options. Extend the Windows regression test for source-level worker/background launch coverage only where existing source checks are insufficient. Keep the interactive resume test/behavior unchanged and verify its `stdio: 'inherit'` option remains present.

Run the focused unit tests for changed modules, `npm run test:windows`, and the project test command appropriate to the changed contract. A passing test must demonstrate the options are present at the actual launch boundary; source-only checks are a fallback for modules without injectable launch seams.

## Non-goals

- Do not hide the user's interactive Claude/CLI terminal.
- Do not alter process lifetime, signal handling, shell quoting, command resolution, or output routing.
- Do not add retries, new abstractions, or unrelated Windows compatibility changes.
