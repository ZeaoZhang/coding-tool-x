# OMP Restart Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve OMP dynamic-provider state during process shutdown and allow `ctx start` to restore the gateway after `ctx stop`.

**Architecture:** Add an explicit `preserveManagedMode` option to the OMP gateway lifecycle. Explicit OMP stop and foreground UI exit keep the current direct-channel handoff; the PM2 daemon process drains only the local gateway and leaves the persisted managed state for boot recovery. Increase PM2's graceful shutdown window.

**Tech Stack:** Node.js, PM2, Vitest, CommonJS.

---

### Task 1: Add the failing OMP lifecycle regression test

**Files:**
- Modify: `tests/unit/services/omp-proxy-server.test.js`

- [ ] Add a test asserting `stopOmpProxyServer({ preserveManagedMode: true })` stops the gateway without calling `activateStaticOmpChannel`, `disableManagedOmpProviders`, or `disableManagedOmpMode`.
- [ ] Run the focused test and confirm it fails because the option is not implemented.

### Task 2: Implement restart-safe OMP shutdown

**Files:**
- Modify: `src/server/omp-proxy-server.js`
- Modify: `src/index.js`

- [ ] Branch the stop operation on `preserveManagedMode` while retaining the existing default handoff path.
- [ ] Pass `preserveManagedMode: true` from process-exit cleanup.
- [ ] Run the focused OMP suite and confirm both explicit stop and preserved shutdown pass.

### Task 3: Extend PM2 graceful shutdown time and regression coverage

**Files:**
- Modify: `src/commands/daemon.js`
- Modify: `tests/unit/commands/daemon.test.js`

- [ ] Set `kill_timeout: 5000` in the PM2 start options.
- [ ] Add a focused assertion for the configured timeout.
- [ ] Run daemon and OMP tests.

### Task 4: Verify end-to-end behavior

**Files:**
- No source changes unless verification exposes a defect.

- [ ] Run the focused Vitest suites.
- [ ] Run a service status/start smoke check without claiming success beyond observed output.
- [ ] Inspect the final diff and report any remaining runtime caveat.
