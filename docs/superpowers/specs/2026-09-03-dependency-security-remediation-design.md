# Dependency Security Remediation Design

## Problem

A push to the GitHub default branch reports:

```text
175 vulnerabilities
84 high, 84 moderate, 7 low
```

The repository currently contains both npm and pnpm manifests/lockfiles at the root and under `src/web`, while project scripts use npm. Local audit reports are lower but still show tracked vulnerable dependency trees:

- Root: 1 high and 2 moderate vulnerabilities.
- Web: 1 critical, 9 high, and 6 moderate vulnerabilities.
- Root `pnpm-lock.yaml` is stale relative to `package.json`; it still locks packages such as `qs@6.13.0` and `lodash@4.17.21`.

The duplicate and inconsistent lockfiles can cause GitHub to scan multiple dependency trees and report repeated or stale alerts.

## Goal

Make the repository's dependency state reproducibly secure and remove stale dependency scan sources.

Success criteria:

1. npm is the sole supported package manager for this repository.
2. Root and web npm lockfiles match their package manifests.
3. Root and web `npm audit` report no unresolved high or critical vulnerabilities; the target is zero vulnerabilities where available fixes exist.
4. Web production build and unit tests pass.
5. Existing root tests pass.
6. No runtime vulnerability is hidden through audit exclusions or ignored advisories.

## Scope

### In scope

- Root `package.json` and `package-lock.json` dependency updates.
- `src/web/package.json` and `src/web/package-lock.json` dependency updates.
- Removal of the stale root and web `pnpm-lock.yaml` files.
- Compatibility fixes required by dependency upgrades.
- Existing test/build configuration adjustments required by major toolchain upgrades.

### Out of scope

- Unrelated business logic refactors.
- Replacing npm with pnpm.
- Suppressing or downgrading vulnerability reports.
- Changes to application security behavior unrelated to dependency compatibility.

## Design

### Package manager policy

Use npm because the repository's scripts invoke npm, the root packaging flow calls `npm run build:web`, and both npm lockfiles are already tracked. Remove the two pnpm lockfiles rather than maintaining a second dependency graph that is not used by the project.

### Root dependency remediation

Refresh the root npm lockfile and update vulnerable transitive packages through direct dependency constraints or the existing `overrides` block. Preserve the current runtime API versions unless a security fix requires an upgrade. Keep `package.json` and `package-lock.json` synchronized.

### Web dependency remediation

Upgrade direct packages with available security fixes, including Axios, ECharts, Markdown-It, Vite, Vitest, and Vue-ECharts. Apply the minimum versions containing fixes. Where a main-version upgrade is required, update only the affected configuration or call sites and verify existing behavior:

- Vite/Vitest/plugin-vue toolchain remains compatible with Node `>=22.13.0`.
- ECharts/Vue-ECharts chart initialization and option rendering remain compatible.
- Axios API modules retain their existing request/response behavior.
- Markdown rendering remains compatible with current components.

Regenerate the web npm lockfile after package changes. Do not hand-edit generated lockfile entries.

## Failure handling

If an upgrade introduces a build or test failure, fix the concrete compatibility issue at its call site or configuration boundary. Do not add fallbacks that mask errors. If an advisory has no available fixed version, retain the dependency and document the exact unresolved path and reason in the implementation result.

## Verification

Run, in order:

1. Root `npm install --package-lock-only` or equivalent manifest-driven lockfile refresh.
2. Web dependency installation and lockfile refresh.
3. Root `npm audit`.
4. Web `npm audit`.
5. `npm run build:web` from the root.
6. Web unit tests through the existing web test script.
7. Root `npm test`.

The final check must inspect the changed files and confirm no pnpm lockfiles remain tracked, no audit-ignore configuration was introduced, and generated locks are reproducible from their manifests.
