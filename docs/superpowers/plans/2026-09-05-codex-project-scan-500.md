# Codex Project Scan 500 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Codex 项目扫描因 Worker 循环加载导致的 500，并锁定回归行为。

**Architecture:** 保持 `session-history-index` 的生产 Worker 隔离。让 `runInventoryWorker()` 为 fork 子进程显式设置 `CC_TOOL_SESSION_HISTORY_CHILD=1`，使 Worker 子进程直接执行本地索引而不再递归启动 Worker。使用现有 Vitest 单元测试和真实 Codex 项目扫描命令验证。

**Tech Stack:** Node.js 22、CommonJS、Vitest、better-sqlite3。

---

### Task 1: Add regression test for Worker recursion

**Files:**
- Create: `tests/unit/services/session-history-worker.test.js`
- Reference: `src/server/services/session-history-worker.js`

- [ ] **Step 1: Write the failing test**

Create a Vitest test that starts a production-mode Node subprocess, requires `runInventoryWorker`, and invokes it with a temporary SQLite path and empty Codex projects directory. The test must assert the subprocess exits successfully. Before the fix, the forked Worker inherits production mode without a child marker, recursively enters the Worker path, and exits with `runInventoryWorker is not a function`.

- [ ] **Step 2: Run the test to verify it fails for the regression**

Run:

```bash
npx vitest run tests/unit/services/session-history-worker.test.js
```

Expected before the fix: FAIL with a non-zero child-process status. The failure is at the real process boundary, not a source-text assertion.

- [ ] **Step 3: Keep the test isolated**

The subprocess must set `NODE_ENV=production`, use a temporary database, and use an empty temporary projects directory. It must not depend on the user's Codex files.

- [ ] **Step 4: Commit the regression test**

```bash
git add tests/unit/services/session-history-worker.test.js
git commit -m "test: reproduce codex session worker recursion"
```

### Task 2: Mark forked Worker children

**Files:**
- Modify: `src/server/services/session-history-worker.js:152-160`

- [ ] **Step 1: Add the child-process marker**

Add `CC_TOOL_SESSION_HISTORY_CHILD: '1'` to the environment passed to `childProcess.fork`:

```js
env: {
  ...process.env,
  CC_TOOL_SESSION_HISTORY_WORKER: '1',
  CC_TOOL_SESSION_HISTORY_CHILD: '1',
  CC_TOOL_SESSION_HISTORY_SOURCE: source,
  CC_TOOL_SESSION_HISTORY_DB: indexDbPath,
  CC_TOOL_SESSION_HISTORY_FORCE: options.force === true ? '1' : '0',
  CC_TOOL_SESSION_HISTORY_PROJECTS_DIR: options.projectsDir || ''
}
```

This makes the forked Worker run the index locally instead of starting another Worker. Do not change IPC, timeout behavior, or error serialization.

- [ ] **Step 2: Run the focused regression test**

Run:

```bash
npx vitest run tests/unit/services/session-history-worker.test.js
```

Expected: PASS, with no `runInventoryWorker is not a function` error.

- [ ] **Step 3: Run the real Codex scan feedback loop**

Run:

```bash
node -e "require('./src/platforms/drivers/codex/sessions-implementation').getProjects().then(v=>{if(!Array.isArray(v)) throw new Error('projects is not an array'); console.log(JSON.stringify({count:v.length,projects:v.slice(0,3)},null,2)}).catch(e=>{console.error(e.stack);process.exit(1)})"
```

Expected: exit code 0 and JSON containing a numeric `count`; no 500-equivalent Worker error.

- [ ] **Step 4: Run related existing tests**

Run:

```bash
npx vitest run tests/unit/services/codex-sessions.test.js tests/unit/services/session-history-index.test.js tests/unit/api/platform-route-factory.test.js
```

Expected: all selected tests pass.


### Task 3: Final verification and review

**Files:**
- Review: `src/server/services/session-history-worker.js`
- Review: `tests/unit/services/session-history-worker.test.js`
- Review: `docs/superpowers/specs/2026-09-05-codex-project-scan-500-design.md`

- [ ] **Step 1: Run the project API consistency check**

```bash
npm run test:api
```

Expected: PASS.

- [ ] **Step 2: Run the full unit suite**

```bash
npm run test:unit
```

Expected: PASS with no new Worker or Codex failures.

- [ ] **Step 3: Inspect the final diff**

```bash
git diff --check HEAD~2..HEAD
git diff --stat HEAD~2..HEAD
```

Expected: no whitespace errors; only the child-environment marker, regression test, and design/plan documents are included in this fix (unrelated existing workspace changes remain untouched).
