# 实时日志面板空白修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复渠道管理页未渲染 `ProxyLogs` 导致实时日志区域空白的问题。

**Architecture:** 保持现有日志数据流和组件边界不变，仅在 `RightPanel.vue` 显式导入其模板使用的 `ProxyLogs.vue`。使用仓库已有的静态前端组件测试模式增加回归断言，并通过前端构建和真实页面冒烟验证渲染结果。

**Tech Stack:** Vue 3 `<script setup>`、Vite、Vitest、Node.js。

---

### Task 1: Add regression coverage for component registration

**Files:**
- Modify: `tests/unit/web/log-components.test.js`

- [ ] **Step 1: Write the failing test**

在现有 `describe('web log components source routing', ...)` 中追加：

```js
test('RightPanel registers the ProxyLogs component used by its template', () => {
  const source = readProjectFile('src/web/src/components/RightPanel.vue')

  expect(source).toContain("import ProxyLogs from './ProxyLogs.vue'")
  expect(source).toContain('<ProxyLogs :source="currentChannel" />')
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from repository root:

```bash
npx vitest run tests/unit/web/log-components.test.js
```

Expected: the new test fails because `RightPanel.vue` currently has no `ProxyLogs` import.

- [ ] **Step 3: Confirm failure is the intended regression**

The failure must identify the missing import assertion, not a test parse/setup error. Do not change production code before this failure is observed.

### Task 2: Register and render the existing log component

**Files:**
- Modify: `src/web/src/components/RightPanel.vue:147-152`

- [ ] **Step 1: Add the minimal import**

Add the import alongside the other channel panel imports:

```js
import ProxyLogs from './ProxyLogs.vue'
```

Do not change the existing template binding:

```vue
<ProxyLogs :source="currentChannel" />
```

Do not modify `ProxyLogs.vue`, WebSocket handling, Pinia state, statistics APIs, or layout CSS.

- [ ] **Step 2: Run the focused regression test**

```bash
npx vitest run tests/unit/web/log-components.test.js
```

Expected: all tests in this file pass.

- [ ] **Step 3: Build the frontend**

```bash
npm run build:web
```

Expected: Vite completes successfully without unresolved component warnings or build errors.

### Task 3: Verify the real channel-management surface

**Files:**
- No source changes.

- [ ] **Step 1: Open the running local application**

Use the existing local service at `http://localhost:19999` and navigate to:

```text
http://localhost:19999/cli/omp
```

- [ ] **Step 2: Verify the rendered log panel**

Confirm the right panel contains:

- `实时日志`
- the table header (`渠道`, `请求`, `回复`, platform-specific columns, `时间`)
- either existing log rows or `暂无日志`
- the connection status footer

The `.logs-section` must contain rendered `.proxy-logs` content rather than an unresolved `<proxylogs>` custom element.

- [ ] **Step 3: Verify the changed contract after build**

Refresh the page and repeat the check on at least one other channel route, such as `/cli/codex` or `/cli/claude`. Existing dashboard log behavior must remain intact.

### Task 4: Final review and cleanup

**Files:**
- Review only: `src/web/src/components/RightPanel.vue`, `tests/unit/web/log-components.test.js`

- [ ] **Step 1: Inspect the final diff**

Confirm only the intended import and regression test are present, and existing user modifications remain untouched.

- [ ] **Step 2: Run the focused test once more**

```bash
npx vitest run tests/unit/web/log-components.test.js
```

Expected: PASS.
