# OMP Skill Refresh Boundary Design

## Problem

Opening the OMP surface must not start a remote Skill repository refresh. A Skill panel load is a local scan; remote repository work is an explicit user action. The current source already sends `GET /api/skills` on panel load and reserves `POST /api/skills/refresh` for `handleRefresh`, but this invariant is not explicit in the component naming and lacks an OMP-specific mount regression test. A stale running process or stale packaged Web bundle can therefore look like a source regression.

Observed behavior in the current workspace:

- Entering `/cli/omp` produced `GET /api/skills?platform=omp&scope=user`.
- Opening the Skills drawer produced the same scan request.
- Neither flow produced `POST /api/skills/refresh`.
- The OMP route separately schedules `GET /api/channel-balances?source=omp`; that is a balance probe, not Skill refresh, and remains out of scope for this change.

## Goals

- Make local Skill scanning and remote refresh separate, named operations in `SkillsPanel.vue`.
- Guarantee every lifecycle path (mount, drawer open, platform/scope change, repository update, local Skill creation, and post-settings-save reload) uses the scan-only operation.
- Keep the manual `刷新远端` button as the only UI path that enqueues a remote refresh task.
- Preserve the existing asynchronous refresh-task polling and post-task local scan.
- Lock the behavior with frontend and server regression tests.
- Rebuild the ignored production bundle as part of verification so deployment uses the current client code.

## Non-goals

- No change to OMP channel balance probing.
- No change to plugin marketplace discovery.
- No change to refresh task persistence, scheduling, repository adapters, or Skill control semantics.
- No compatibility shim for the removed legacy `getSkills(forceRefresh, platform)` signature.

## Design

### Frontend boundary

Rename the current generic `loadData` operation to `scanLocalSkills`. It accepts only presentation/error options and calls `getSkills(platform, scopeOptions)`. All non-user-refresh callers use this function:

- component mount for standalone mode;
- drawer visibility transition;
- platform, scope, or project-path changes;
- repository, create, and detail update events;
- successful OMP settings save.

Keep `handleRefresh` as the only remote operation. It calls `refreshSkills(platform, scopeOptions)`, polls the returned task while queued/running, then calls `scanLocalSkills()` after the task reaches a terminal state. It must not pass a force flag to the scan function.

This is a naming and call-graph boundary, not a new abstraction layer: the existing request APIs and state remain unchanged.

### Server boundary

Keep `GET /api/skills` scan-only. It calls `service.scanSkills(options)` and ignores any legacy `refresh` query value. Keep `POST /api/skills/refresh` as the sole route that enqueues `SkillRefreshTaskService` work. Add an OMP-specific assertion in the API tests that a GET with `refresh=1` calls `scanSkills` and never calls `refreshRemoteSkills`.

### Data flow

```text
panel mount/open/change
  -> scanLocalSkills
  -> GET /api/skills (local scan)
  -> render cached/native/control state

manual 刷新远端 click
  -> handleRefresh
  -> POST /api/skills/refresh
  -> poll GET /api/skills/refresh/:taskId
  -> scanLocalSkills
  -> render newly cached state
```

### Error handling

- Local scan errors keep the existing notification behavior and request-generation guard.
- Remote task errors keep the existing failed/partial messages.
- Switching platform/scope while a refresh is pending continues to invalidate its context and suppress stale results; no new remote task is created by the subsequent scan.
- No debug instrumentation or additional fallback network request is added.

## Tests

1. Frontend OMP SkillsPanel mount, both standalone and drawer-visible paths, asserts `getSkills` is called and `refreshSkills` is not called.
2. Frontend OMP drawer visibility transition asserts opening the drawer performs only a scan and does not enqueue refresh.
3. Existing manual refresh test continues to assert one explicit `refreshSkills` call and a post-task scan.
4. Server Skills API test with `platform=omp&refresh=1` asserts scan-only behavior and no `refreshRemoteSkills` call.
5. Run focused frontend/server tests and build `src/web` to verify the deployed bundle contains the scan-only request path.

## Rollout and verification

The source change is committed separately from this design. Because `dist/` is ignored and packaged by `prepack`, deployment must rebuild the Web UI and restart the backend process; an already-running process or old package cannot be used as evidence for the new source.
