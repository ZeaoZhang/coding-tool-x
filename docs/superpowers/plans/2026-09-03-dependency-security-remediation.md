# Dependency Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale dependency graphs and update root/web dependencies so GitHub and npm no longer report the tracked vulnerabilities.

**Architecture:** npm is the only package manager. The root application and the `src/web` application each keep their existing npm manifest and npm lockfile; the duplicate pnpm lockfiles are removed. Dependency upgrades are manifest-driven, and any compatibility edits stay at the affected build or API boundary.

**Tech Stack:** Node.js >=22.13.0, npm, Vue 3, Vite, Vitest, ECharts, Vue-ECharts, Express.

---

## Files and ownership

- Modify `package.json`: root security overrides only.
- Modify `package-lock.json`: npm-generated root dependency tree.
- Modify `src/web/package.json`: patched direct web dependencies and compatible toolchain versions.
- Modify `src/web/package-lock.json`: npm-generated web dependency tree.
- Delete `pnpm-lock.yaml`: stale root dependency graph not used by project scripts.
- Delete `src/web/pnpm-lock.yaml`: stale web dependency graph not used by project scripts.
- Modify web source/configuration only if the upgraded Vite/Vitest/ECharts/Vue-ECharts APIs require a concrete compatibility fix.

## Task 1: Refresh root dependency constraints

- [ ] Update the root `overrides` in `package.json`:
  - Change `qs` from `^6.15.3` to `^6.16.0`.
  - Add `fast-uri` at `^3.1.6`.
  - Preserve existing patched overrides for `basic-ftp`, `js-yaml`, `lodash`, `lodash-es`, and `systeminformation`.
- [ ] Regenerate only the root npm lockfile without running lifecycle scripts:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected result: `package-lock.json` records fixed `qs` and `fast-uri` versions and remains synchronized with `package.json`.

- [ ] Run the root audit before web changes to verify the root tree no longer reports the known `qs`/`fast-uri` advisories:

```bash
npm audit --json
```

Expected result: no `high` or `critical` root vulnerabilities; inspect any remaining report instead of suppressing it.

## Task 2: Upgrade vulnerable web dependencies

- [ ] Update `src/web/package.json` to these exact minimum fixed versions:
  - `axios`: `1.20.0`
  - `echarts`: `6.1.0`
  - `markdown-it`: `14.3.1`
  - `vue-echarts`: `8.2.0`
  - `@vitejs/plugin-vue`: `6.0.8`
  - `vite`: `8.2.2`
  - `vitest`: `5.0.0`
- [ ] Keep unrelated dependency versions unchanged unless npm reports a peer-resolution conflict caused by the listed upgrades.
- [ ] Regenerate the web npm manifest and lockfile through npm, preserving exact-version style:

```bash
cd src/web
npm install --save-exact axios@1.20.0 echarts@6.1.0 markdown-it@14.3.1 vue-echarts@8.2.0
npm install --save-dev --save-exact @vitejs/plugin-vue@6.0.8 vite@8.2.2 vitest@5.0.0
```

Expected result: `src/web/package.json` and `src/web/package-lock.json` agree, and patched versions of `follow-redirects`, `form-data`, `lodash`, `lodash-es`, `nanoid`, `postcss`, and `rollup` are selected transitively.

## Task 3: Remove stale pnpm dependency graphs

- [ ] Delete `pnpm-lock.yaml`.
- [ ] Delete `src/web/pnpm-lock.yaml`.
- [ ] Confirm no package-manager policy or npm script references either pnpm lockfile. Do not add audit-ignore rules or security exceptions.

## Task 4: Verify web compatibility and fix only concrete breakage

- [ ] Run the Web unit suite:

```bash
cd src/web
npm run test:unit
```

Expected result: all existing Web tests pass.

- [ ] Build the production bundle from the root:

```bash
cd ../..
npm run build:web
```

Expected result: Vite writes the existing `dist/web` output successfully, including current manual chunking and Terser compression.

- [ ] If a test or build fails, update only the failing web call site/configuration. Preserve current Axios request contracts, chart behavior, Markdown rendering, and output directory. Re-run the failing command after each compatibility edit.

## Task 5: Final security and regression verification

- [ ] Run root audit:

```bash
npm audit
```

Expected result: no unresolved high or critical vulnerabilities; target zero total vulnerabilities.

- [ ] Run web audit:

```bash
cd src/web
npm audit
```

Expected result: zero vulnerabilities.

- [ ] Run the root regression suite:

```bash
cd ../..
npm test
```

Expected result: all existing basic, API, Codex-agent, skill, plugin-market, and unit checks pass.

- [ ] Inspect the final change set and verify only dependency manifests/locks, stale lockfile deletions, required compatibility edits, and the committed design/plan documents changed. Confirm no audit-ignore configuration, placeholder, or unrelated refactor was added.

## Task 6: Commit the implementation

- [ ] Commit the dependency remediation after all checks pass:

```bash
git add package.json package-lock.json src/web/package.json src/web/package-lock.json pnpm-lock.yaml src/web/pnpm-lock.yaml src/web
git commit -m "fix: remediate dependency vulnerabilities"
```

Expected result: one implementation commit containing the synchronized npm dependency state and any required compatibility fixes.
