# OMP Skill Refresh Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OMP Skill panel's local scan path explicit and ensure only the manual “刷新远端” action can enqueue a remote Skill refresh.

**Architecture:** Keep the existing scan/refresh API split. Rename the generic `SkillsPanel.vue` list-loading operation to `scanLocalSkills`, route every lifecycle/update callback through it, and leave `handleRefresh` as the only caller of `refreshSkills`. Preserve the existing server GET scan-only contract and lock it with an OMP-specific API test; rebuild the ignored Web bundle for deployment verification.

**Tech Stack:** Vue 3 `<script setup>`, Vitest, Vue Test Utils, Express, Supertest, Vite, Node.js.

---

### Task 1: Lock OMP panel scan-only lifecycle

**Files:**
- Modify: `src/web/src/components/__tests__/SkillsPanelSwitch.test.js`
- Modify: `src/web/src/components/SkillsPanel.vue:260-286,297,430,454,468-486`

- [ ] **Step 1: Extend the frontend test fixture to include OMP**

Add OMP to the mocked platform catalog and retain the existing `getSkills`, `refreshSkills`, and task mocks. Add a helper that mounts the real `SkillsPanel` with explicit OMP props:

```js
async function createOmpWrapper(props = {}) {
  const { default: SkillsPanel } = await import('../SkillsPanel.vue')
  return mount(SkillsPanel, {
    props: { platform: 'omp', ...props },
    global: {
      stubs: {
        SkillCard: { template: '<div />' },
        SkillRepoManager: { template: '<div />' },
        SkillCreateModal: { template: '<div />' },
        SkillDetailDrawer: { template: '<div />' },
        OmpSkillSettingsModal: { template: '<div />' }
      }
    }
  })
}
```

- [ ] **Step 2: Add the OMP mount and drawer-open regression assertions**

Add tests that exercise both initial standalone rendering and a hidden-then-visible drawer. The assertions must distinguish a local GET scan from the remote refresh command:

```js
test.each([
  { inDrawer: false, drawerVisible: false },
  { inDrawer: true, drawerVisible: true }
])('OMP panel load scans local state without remote refresh (%o)', async props => {
  const wrapper = await createOmpWrapper(props)
  await flushPromises()

  expect(api.getSkills).toHaveBeenCalledWith('omp', {})
  expect(api.refreshSkills).not.toHaveBeenCalled()
  wrapper.unmount()
})

test('opening a hidden OMP drawer scans once without enqueuing refresh', async () => {
  const wrapper = await createOmpWrapper({ inDrawer: true, drawerVisible: false })
  await flushPromises()
  expect(api.getSkills).not.toHaveBeenCalled()

  await wrapper.setProps({ drawerVisible: true })
  await flushPromises()

  expect(api.getSkills).toHaveBeenCalledWith('omp', {})
  expect(api.refreshSkills).not.toHaveBeenCalled()
  wrapper.unmount()
})
```

Run before the production rename:

```bash
npm run test:unit -- --run src/components/__tests__/SkillsPanelSwitch.test.js
```

Expected baseline: the existing source's scan-only behavior remains green; this is a regression characterization because the reported behavior is not reproducible in the checked-out source. Do not change the assertions to force a false failure.

- [ ] **Step 3: Rename the generic loader to make the boundary explicit**

In `src/web/src/components/SkillsPanel.vue`, rename `loadData` to `scanLocalSkills` and update every non-refresh reference:

```js
async function scanLocalSkills({ notifyError = true } = {}) {
  // Keep the existing request-id, platform/scope checks, GET getSkills call,
  // response validation, state assignment, and error handling unchanged.
}
```

Update these call sites to `scanLocalSkills`:

- `SkillRepoManager @updated`;
- `SkillCreateModal @created`;
- `SkillDetailDrawer @updated`;
- `handleImport` completion;
- `handleRefresh` completion after task polling;
- `handleOmpSettingsSaved` passed callback;
- standalone `onMounted` load;
- `drawerVisible` watcher;
- platform/scope/project-path watcher.

Keep `handleRefresh` unchanged in responsibility: it alone calls `refreshSkills(platform, scopeOptions.value)`, polls `getSkillRefreshTask`, and calls `scanLocalSkills()` after a terminal task. No lifecycle callback may call `refreshSkills` or pass a boolean force argument.

- [ ] **Step 4: Re-run the focused frontend tests**

Run:

```bash
npm run test:unit -- --run src/components/__tests__/SkillsPanelSwitch.test.js
```

Expected: all tests pass; the OMP mount/open cases show `getSkills('omp', {})` and zero `refreshSkills` calls.

- [ ] **Step 5: Commit the frontend boundary change**

```bash
git add src/web/src/components/SkillsPanel.vue src/web/src/components/__tests__/SkillsPanelSwitch.test.js
git commit -m "fix: keep OMP skill panel scans local"
```

---

### Task 2: Lock the server scan-only contract for OMP

**Files:**
- Modify: `tests/unit/api/skills-api.test.js:718-750`
- Verify only: `src/server/api/skills.js:145-209`

- [ ] **Step 1: Add an OMP-specific GET regression test**

Within `describe('new Skill control surface')`, add a test using the existing injected service fixture:

```js
test('OMP GET ignores refresh query and never starts remote work', async () => {
  const ompService = services.omp
  ompService.scanSkills = vi.fn(async () => ({
    skills: [{ name: 'omp-local', enabled: false, cached: true, managed: true }],
    refresh: { state: 'never_fetched', taskId: null, fetchedAt: null, error: null }
  }))
  ompService.refreshRemoteSkills = vi.fn()

  const app = buildInjectedApp({
    controlService: { setSkillEnabled: vi.fn() },
    refreshTasks: { enqueue: vi.fn(), get: vi.fn() }
  })
  const res = await request(app).get('/?platform=omp&refresh=1')

  expect(res.status).toBe(200)
  expect(ompService.scanSkills).toHaveBeenCalledWith({ scope: 'user' })
  expect(ompService.refreshRemoteSkills).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the server regression test before any server edit**

Run:

```bash
npm exec -- vitest run tests/unit/api/skills-api.test.js -t "OMP GET ignores refresh query and never starts remote work"
```

Expected baseline: PASS, confirming the server boundary is already correct in the checked-out source. No server production change is required unless this test exposes a regression.

- [ ] **Step 3: Commit the server contract test**

```bash
git add tests/unit/api/skills-api.test.js
git commit -m "test: cover OMP scan-only skill listing"
```

---

### Task 3: Rebuild and verify the deployed behavior

**Files:**
- Modify generated ignored output: `dist/web/` (via the existing build command; do not stage it)

- [ ] **Step 1: Run focused frontend and server tests together**

```bash
npm run test:unit -- --run src/components/__tests__/SkillsPanelSwitch.test.js
npm exec -- vitest run tests/unit/api/skills-api.test.js tests/unit/services/skill-service.test.js -t "OMP GET ignores refresh query and never starts remote work|scanSkills never performs a network refresh|scanSkills does not refresh remote OMP repositories"
```

Expected: all selected tests pass, with no `POST /skills/refresh` on panel mount/open paths.

- [ ] **Step 2: Rebuild the production Web bundle**

```bash
npm run build:web
```

Expected: Vite completes successfully and the generated bundle contains the scan-only `GET /skills` request path; `refreshSkills` remains reachable only from the explicit refresh handler.

- [ ] **Step 3: Run the original browser smoke scenario**

Use the actual Web UI to:

1. open `/cli/omp`;
2. open the Skills drawer;
3. record API requests during each action.

Expected: panel load/open produces `GET /api/skills?platform=omp&scope=user` and no `POST /api/skills/refresh`. The existing independent `GET /api/channel-balances?source=omp` balance probe is not part of this Skill-refresh assertion.

- [ ] **Step 4: Commit only tracked source/test changes and report deployment requirement**

```bash
git status --short
git log -2 --oneline
```

Expected: only the pre-existing untracked `.omx/` and `.worktrees/` entries remain outside the two task commits. Deployment must rebuild `dist/` and restart any existing backend process; a stale process or stale packaged bundle can retain the old behavior even when source tests pass.
