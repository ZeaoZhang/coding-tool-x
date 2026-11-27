<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

Use the `/trellis:start` command when starting a new session to:
- Initialize your developer identity
- Understand current project context
- Read relevant guidelines

Use `@/.trellis/` to learn:
- Development workflow (`workflow.md`)
- Project structure guidelines (`spec/`)
- Developer workspace (`workspace/`)

Keep this managed block so 'trellis update' can refresh the instructions.

<!-- TRELLIS:END -->

## Branching & releases

`develop` is the mainline and the only integration target.

- It is the GitHub default branch (`origin/HEAD -> origin/develop`). Every feature, fix, perf, refactor, docs and chore PR targets `develop`.
- `main` is a frozen legacy line (last commit 2026-09-04, ~491 commits behind `develop` and diverged). Do not open PRs against it and do not merge it back into `develop`.
- Never commit or push to `develop` directly. Cut a topic branch from the current `origin/develop` (`feat/…`, `fix/…`, `perf/…`, `refactor/…`, `docs/…`, `chore/…`), push it, then open a PR into `develop`.
- Merge only when the PR reports `MERGEABLE` / `CLEAN` and the relevant checks pass locally:
  - backend/CLI: `npm run test:unit`
  - web UI (`src/web/**`): `npm run test:unit` inside `src/web`
- Merge with a merge commit (`gh pr merge <number> --merge`) so branch history is preserved; delete the source branch only when the author asks.
- When PR A depends on an unmerged PR B, open A with `--base` pointing at B's branch and merge B first; GitHub retargets A to `develop` automatically.
- Never revert, skip or re-pin existing tests to make a change pass. Update an expectation only when the contract itself changed on purpose.

## Platform UI reuse rules

- The existing frontend and backend CLI workflow is the complete baseline. Adding a new CLI should require only platform configuration and the necessary Driver adapter; do not reimplement an existing CLI page, component, panel, lifecycle, or API flow.
- DSH and other platform features must reuse existing platform-agnostic UI before adding new components. For channel management, use `BaseChannelPanel`, `createGenericChannelPanel`, `useChannelManager`, and the manifest-driven `/platforms/:platform/channels` API whenever the existing generic form covers the capability.
- Reuse the existing Skills, Plugins, MCP, Prompts, channel, drawer, form, and API infrastructure when the platform contract can be represented by it. Do not create a platform-specific page, drawer, tab set, or duplicate add/edit panel merely to display or manage the same resource.
- Before adding a platform-specific component, search the existing components, composables, API helpers, manifest capability declarations, and driver contracts. Add a new component only when the existing component cannot represent a proven platform-specific requirement, and keep the platform difference in the manifest or driver adapter where possible.
