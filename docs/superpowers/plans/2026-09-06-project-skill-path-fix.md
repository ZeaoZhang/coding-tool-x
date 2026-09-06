# Project Skill Path Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent project configuration Skills from triggering the generic project-path scan error, especially for OMP projects, while preserving project-scoped refresh and toggle behavior across all CLI platforms.

**Architecture:** The project configuration drawer already fetches a canonical project snapshot through `/project-config`. The Skills panel will use `/project-config/skills` for its initial project-scope load instead of issuing a second generic `/skills` request. The returned `{ project, inherited }` collections will be flattened for the existing card model; user-scope panels continue using `/skills` unchanged. Project refresh, approval, and toggles retain their existing APIs.

**Tech Stack:** Vue 3 `<script setup>`, Vitest, Express API client.

---

### Task 1: Add failing project-scope API regression coverage

**Files:**
- Modify: `src/web/src/components/__tests__/SkillsPanelProjectScope.test.js`

- [ ] **Step 1: Extend the API mocks with `getProjectSkills`**

Add a hoisted mock for `getProjectSkills`, mock `../../api/project-config` with both `getProjectSkills` and `setProjectSkillEnabled`, and reset/configure it in `beforeEach` to return:

```js
{
  supported: true,
  project: [{ name: 'project-skill', sourceScope: 'project', scope: 'project' }],
  inherited: [{ name: 'user-skill', sourceScope: 'user', scope: 'user' }],
  path: '.omp/skills'
}
```

- [ ] **Step 2: Change the project-scope expectation to the project config endpoint**

Keep the existing project props (`platform: 'codex'`, `scope: 'project'`, `projectPath: '/tmp/project'`) and assert that `getProjectSkills` is called with `'/tmp/project'` and `'codex'`, while `getSkills` is not called during the initial scan.

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
npm exec vitest run src/web/src/components/__tests__/SkillsPanelProjectScope.test.js
```

Expected: FAIL because `SkillsPanel` currently calls `getSkills` for project scope.

### Task 2: Route project initial scans through project configuration

**Files:**
- Modify: `src/web/src/components/SkillsPanel.vue:153-155,260-285`

- [ ] **Step 1: Import the project Skills API**

Change the project-config import to include `getProjectSkills` alongside `setProjectSkillEnabled`.

- [ ] **Step 2: Add a project response normalizer at the scan seam**

In `scanLocalSkills`, use `getProjectSkills(props.projectPath, platform)` when `props.scope === 'project'`; otherwise retain `getSkills(platform, scopeOptions.value)`. For the project response, concatenate `response.project` and `response.inherited`, defaulting non-arrays to empty arrays. For user scope, continue validating the generic response through `validateOmpSkillListResponse`.

The resulting behavior must preserve the existing request-id/platform race guards, refresh state handling, loading cleanup, and error message.

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```bash
npm exec vitest run src/web/src/components/__tests__/SkillsPanelProjectScope.test.js
```

Expected: PASS, including the assertion that the generic `/skills` API is not used for the initial project scan.

### Task 3: Verify all affected behavior

**Files:**
- No additional files unless the focused regression test exposes an existing contract mismatch.

- [ ] **Step 1: Run project configuration and Skills component tests**

Run:

```bash
npm exec vitest run tests/unit/services/project-config-service.test.js tests/unit/api/project-config-api.test.js src/web/src/components/__tests__/SkillsPanelProjectScope.test.js src/web/src/components/__tests__/ProjectConfigDrawer.test.js
```

Expected: all tests pass.

- [ ] **Step 2: Run the broader unit suite**

Run:

```bash
npm run test:unit
```

Expected: Vitest exits successfully with no regressions in user-scope Skills or other project configuration panels.

- [ ] **Step 3: Smoke-test the running API/UI path**

With the development server running, request the OMP project snapshot and confirm it returns `skills.project`, `skills.inherited`, and `path: '.omp/skills'`. Then open the OMP project configuration Skills tab and verify the browser network log contains the project-config Skills request rather than a duplicate generic project `/skills` scan, with no path error.
