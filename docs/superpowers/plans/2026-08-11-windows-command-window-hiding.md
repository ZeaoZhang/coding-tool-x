# Windows Command Window Hiding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every non-interactive child process launched by the project hides its Windows console window, without changing interactive session resume behavior.

**Architecture:** Keep the existing direct child-process APIs and add `windowsHide: true` at each missing launch boundary. Use the existing injectable command runners and Windows regression script to prove options are passed, and use a focused source audit for launchers without test seams.

**Tech Stack:** Node.js `child_process`, Vitest, Node assertion-based Windows regression script.

---

### Task 1: Add failing regression coverage for missing launch options

**Files:**
- Modify: `scripts/test-windows-regression.js`
- Test reference: `src/commands/resume.js`, `src/server/services/session-history-worker.js`, `src/commands/update.js`

- [ ] **Step 1: Add source-level assertions for known missing launch sites**

Add a helper that reads a file and asserts each child-process call's surrounding options contain `windowsHide: true`. Apply it to the session-history worker, update version probe, and resume launcher with separate expectations: the worker and update probe require hidden windows; resume requires both `stdio: 'inherit'` and `windowsHide: true` so its terminal behavior remains explicit.

- [ ] **Step 2: Run the focused regression to verify it fails**

Run: `npm run test:windows`
Expected: FAIL because `session-history-worker.js` has no `windowsHide: true`, `update.js`'s `execFileAsync` options omit it, and/or other audited launch sites remain unhidden.

---

### Task 2: Hide command and worker windows at missing launch boundaries

**Files:**
- Modify: `src/server/services/session-history-worker.js:13-24`
- Modify: `src/commands/update.js:15-19`
- Modify: `src/server/services/plugins-service.js:2817-2822`
- Modify: `src/server/services/notification-hooks.js` generated OpenCode/OMP spawn option templates around lines 393 and 446, if absent after the audit
- Modify: any additional `spawn`/`exec`/`execFile`/`spawnSync`/`fork` site found by the launch inventory that lacks `windowsHide: true`

- [ ] **Step 1: Add only the missing option fields**

For `session-history-worker`, add `windowsHide: true` to the `fork` options while preserving `silent`, `stdio`, environment, IPC, timeout, and signal handling.

For `update.getLatestVersion`, add `windowsHide: true` to the options passed to `execFileAsync` while preserving the 15-second timeout.

For every other non-interactive launcher found by the audit, add `windowsHide: true` directly to its existing options object. Do not change command strings, argument arrays, shell settings, output routing, cwd, environment, or error handling. Keep `src/commands/resume.js`'s `stdio: 'inherit'` unchanged; its existing `windowsHide: true` is retained as an explicit compatibility option.

- [ ] **Step 2: Run the focused regression to verify it passes**

Run: `npm run test:windows`
Expected: PASS with `Windows 专项回归测试通过`.

---

### Task 3: Add runner-level tests for command option propagation

**Files:**
- Modify: `tests/unit/services/omp-settings-manager.test.js` or the existing closest service test file for each injectable runner
- Modify: `tests/unit/services/omp-auth-gateway-client.test.js` or relevant existing test file if it already covers the runner
- Modify: `tests/unit/commands/daemon.test.js` only if a tested command launcher is added there

- [ ] **Step 1: Add behavior assertions where the module exposes an injected runner**

Capture the options argument in existing `catalogRunner`, `modelsRunner`, `commandRunner`, or equivalent test callbacks and assert `options.windowsHide === true`. Use real module behavior with only the existing runner seam; do not test a mock's own implementation.

- [ ] **Step 2: Run the focused unit tests**

Run: `npx vitest run tests/unit/services/omp-settings-manager.test.js tests/unit/services/omp-auth-gateway-client.test.js tests/unit/commands/daemon.test.js`
Expected: PASS with zero failures. If a listed file has no relevant test, run the closest existing test file instead and record the exact command output.

---

### Task 4: Verify complete launch inventory and interactive behavior

**Files:**
- Modify: `scripts/test-windows-regression.js` only if the audit needs a final explicit launcher list

- [ ] **Step 1: Re-run the scoped launch inventory**

Run the repository search for `spawn`, `spawnSync`, `exec`, `execFile`, `execSync`, and `fork` under `src`, `bin`, and `scripts`. Review every actual child-process call, ignoring regex `.exec` and database `.exec` calls. Confirm every non-interactive launch has `windowsHide: true` and the resume launcher retains `stdio: 'inherit'`.

- [ ] **Step 2: Run all required verification commands**

Run: `npm run test:windows`
Run: `npm run test:unit`
Run: `npm test`
Expected: each command exits 0 with no test failures. The Windows-specific script may be run on the current non-Windows host because it uses platform-parameterized helpers and source assertions.

- [ ] **Step 3: Inspect the final diff for scope**

Confirm only the approved spec/plan, runtime launch options, and focused regression tests changed. Do not alter unrelated existing working-tree changes in `CHANGELOG.md`, `package.json`, `package-lock.json`, `src/server/services/omp-gateway.js`, or `tests/unit/services/omp-gateway.test.js`.
