# Skill Usage Tracking (per-skill invocation count and last-used time)

* **Author:** adversity
* **Date:** 2026-11-27

## Overview

Add, to each installed skill in the platform-scoped Skills list, an invocation count, a last-used timestamp, and a "not used in the last N days" tag. Data comes only from local CLI session transcripts on this machine, across all projects, for both user-triggered and model-triggered use. N is one server-side global setting, default 30 days.

The design changed in three places after checking the code and the transcripts:

1. The existing session index cannot answer "which skill was used". It persists `role='user'` text only; every assistant and tool row in the live index (333,509 messages) has an empty `content`, and `session_message` has no tool-name or argument column. Reusing the index requires extracting tool-call signatures at parse time first.
2. Text matching is unusable. The Codex corpus contains 576,277 `SKILL.md` mentions, almost all from the skill catalog injected into every turn, while real skill reads are 180 structured entries. Any grep-based count measures the catalog.
3. Skill identity cannot be `controlKey`. It embeds absolute paths and scope, changes on move/rename, and the list merges shadowed installations (the merged entries do not carry the discarded keys). Usage is therefore recorded against a normalized skill name and resolved to the visible row at read time.

The resulting shape: per-platform extractors pull structured tool-call records into an append-only usage ledger stored outside the cache directory; a fold produces a monotonic per-skill counter; the Skills API joins that counter into the existing list payload; the UI adds one tag, one meta line, one drawer section.

## Analysis

### Reviewer Status

Seven independent reviewers ran in fresh contexts (harness `task` agents, one per persona). An earlier inline attempt by the synthesizer was discarded because same-context review is not a Goldfish review; no finding from it is carried forward except measurements that were independently re-checked.

| Reviewer | Status |
| --- | --- |
| `egm-design` | completed |
| `egm-codebase-details` | completed |
| `egm-zoom-out` | completed |
| `egm-comprehension` | completed |
| `egm-implementation-readiness` | completed |
| `egm-structural` | completed |
| `egm-inventive-catalyst` | completed |

### Measured evidence (2026-11-27, this machine)

| Source | Corpus | Tool-call records | Skill-use records |
| --- | --- | --- | --- |
| claude | `~/.claude/projects` 160 MB / 208 JSONL | 5,432 in `agent-*.jsonl` (155 files) | 11 `Skill` calls, 7 names, 4 namespaced/plugin |
| omp | `~/.omp/agent/sessions` 800 MB / 539 JSONL | `content[].type='toolCall'` | 458 distinct `read` calls with `skill://<name>`, 48 names |
| codex | `~/.codex/sessions` 1.6 GB / 1,547 rollouts | 91,388 `function_call`, 6,645 `exec_command_end` | 180 distinct `parsed_cmd` reads of `<root>/<name>/SKILL.md`, 45 names |
| gemini | `~/.gemini/tmp` ~10 MB / 26–28 chats | 653 `toolCalls` (read_file 198, run_shell_command 143, replace 268, …) | 0 with a skill path; 3 chat files contain catalog text only |
| dsh | `~/.dsh/sessions` 214 MB, 420 zstd JSONL v4 | 43,255 `tool/call`, 43,616 `tool/result` | 114 `read` with a path under a `skills/` root + 152 explicit `cat/sed/head/tail` reads of `SKILL.md` |
| opencode | `~/.local/share/opencode/opencode.db` 3.1 MB | `part` table: 6 sessions, 12 messages, 9 parts, 0 tool parts | none |

Additional measurements:

- Installed skill directories: `~/.omp/agent/skills` 47, `~/.codex/skills` 59, `~/.claude/skills` 13.
- 264 of the 458 omp events (58%) name skills that are not in `~/.omp/agent/skills`; they resolve to `~/.claude/skills` or plugin marketplaces (verified for `omc-reference`, `verify`). Name resolution must span all discovery roots, not one platform directory.
- Live index (`~/.cc-tool/storage/cache/session-history.sqlite`): 333,509 messages; `tool_call` 91,388, `tool_use` 3,598, `tool_output` 91,304; all non-user rows have empty `content`.
- Full substring scan of omp + claude corpora: 0.42 s; full JSON parse and walk: ~4–8 s. The backfill is not a multi-minute job on this corpus.

### Blockers

**B1. Skill use must be extracted from structured tool-call fields, and each platform has a different grammar.** No single rule covers the observed data: claude uses a `Skill` tool with `input.skill`; omp uses `read` with `arguments.path = "skill://<name>[/subpath]"`; codex uses shell/file tools whose `parsed_cmd` entries contain `{type:'read', path:'…/skills/<name>/SKILL.md'}`. Gemini's sampled tool calls contain no skill reads. The original rule ("reading any file under the skill root") measured zero hits under `~/.claude/skills`, and would still miss omp's `skill://` scheme and claude's name-only `Skill` call. Fix: a per-platform grammar table (tool name + argument key + target normalization), never message text. All six platforms are in scope. Where this machine shows zero skill events (gemini, opencode), the extractor is validated by fixtures built from the observed record shape (gemini `messages[].toolCalls[]`) or the format the existing driver already reads (opencode `part.data`), and a successfully parsed platform with zero skill hits is reported as zero, not as `unsupported`.

**B2. Usage cannot be keyed by `controlKey`.** `controlKey` is `skill:${platform}:${scope}:${location}:${sourceKey}` (`skill-service.js:781-785`), and `sourceKey` embeds absolute paths (`:755-779`). Moving a project, re-projecting a skill, or renaming a directory changes it; the list's dedupe/merge (`skill-service.js:3501-3595`) collapses several keys into one visible row and does not preserve the discarded keys. Key the ledger on `(platform, normalized_name, raw_target)`; join to visible rows by normalized name after the existing dedupe pass.

**B3. Extracting at parse time requires an adapter change and a one-time re-parse; the standalone scanner is rejected.** `extra_json` is persisted for every message regardless of role (`session-history-index.js:1517` passes `msg.extraJson`), while `content` is dropped for non-user rows. Adapters currently set `extraJson: null` and discard the payloads they already hold: codex reduces a tool call to `[调用工具: X]` (`codex/session-history-adapter.js:110-112`), omp stringifies `message.toolCall` into text (`omp/session-history-adapter.js:68-72`), and claude emits `tool_use`/`tool_result` rows but persists no name or arguments (3,598 such rows in the live index, all empty). Decision D2 below: add a compact `toolCalls` array to `extraJson`, bump `parser_version` per source. Cost: one-time re-parse of the indexed corpus (measured parse speed above), run through the existing worker and maintenance lock, not on the HTTP path.

**B4. Counts must not live behind a cascade or inside the cache directory.** `_pruneMissingFiles` deletes `session_file` rows (`session-history-index.js:2287`) and `session_message` cascades (`:330`). `PATHS.sessionHistoryIndex` sits under `CACHE_DIR` (`src/config/paths.js:24,463`), which is by definition disposable. Put the ledger in a new `skill-usage.sqlite` under the durable storage root, with no foreign keys to index tables; the cache may be regenerated without touching counts.

**B5. A stale claim is only valid with coverage, loadability, and a parsable record source.** `createdAt` is stamped on first registration (`effective-control-service.js:200`), so every pre-existing skill shares the rollout date; missing artifacts are synthesized as rows with `artifactState:'missing'` (`skill-service.js:1333-1410`) and can never be invoked; a platform whose tool records cannot be parsed cannot produce evidence at all. Rendering any of these as "未使用" is a false claim. Fix: the state machine in D5, which requires a completed backfill covering N days, a ready artifact, and successful parsing of that platform's tool records (a skill hit is not a precondition).

**B6. One state enum, one field name.** The draft mixed `no_data | never_used | used | stale` with a two-value emission and `usageState`/`state`. Fix: `usage.state ∈ {used, stale, pending, unsupported}` and `usage.reason` for the pending/unsupported detail; no other names.

### Majors

**M1. Idempotency needs a natural key that survives re-indexing and multi-target calls.** `_writeSessionRows` deletes and re-inserts all rows for a session (`session-history-index.js:1782`), so ordinals are not stable; provider call ids are. Omp logs the same call twice (assistant `content[].toolCall.id` and a `custom/tool_execution_start` event with the same `toolCallId`), and 5 codex commands bundle two skill reads under one `call_id`. Key: `event_key = sha256(platform | session_id | call_id | normalized_target)` with `INSERT OR IGNORE`; when a provider id is absent, synthesize `file_path + line_offset + ordinal`. Do not store raw arguments.

**M2. Scheduling reuses existing machinery, not a new scanner loop.** The index already runs a forked worker (`session-history-worker.js:258-274`), a pid-locked maintenance pass with a 60 s initial delay (`session-history-maintenance.js:7-11,26-70`), and per-source `parser_version` migration (`session-history-index.js:841-849`). The backfill is a one-shot fold of newly parsed rows; the incremental path is the existing index refresh. No new cursor table and no second inventory walk.

**M3. Resolution must be name-first across all roots, with unmatched events kept, not guessed.** Observed names include plugin namespaces (`oh-my-claudecode:autopilot`), names present only in another platform's directory (`omc-reference`), and path artifacts (`plan:1-300`, `code-review'`). Normalize: strip `skill://`, strip any `/<subpath>` suffix, strip a `<namespace>:` prefix, case-fold. Resolution order: project-scoped skill whose directory covers the session `cwd` → user-scoped unique name → unique name across roots. Ambiguous or unmatched names are stored and reported as `unattributed`, never silently dropped and never assigned to a random row.

**M4. The global setting has four touch points and must be server-side.** `src/config/default.js`, `src/config/loader.js` (normalize), `src/server/api/config.js:426-466` (GET/POST `/advanced`, hand-written destructuring), `SettingsDrawer.vue:597-655` (clone/compare/save). A key added outside all four is silently dropped. Define `skillUsage: { staleDays: 30 }`, integer 1–365, validated on write, normalized on read.

**M5. Join at read time after dedupe, in both scan paths.** `scanSkills` returns a cached prepared list (`skill-service.js:1412-1448`); dsh bypasses it; the project view calls the same service (`project-config-service.js:283-306`) and the web wrapper returns only `response.data.skills` (`src/web/src/api/project-config.js:37`). Attach usage in the mapping step, and add the policy object to both response shapes; do not persist the joined result.

**M6. Card copy must not duplicate existing state tags or overclaim.** `SkillCard.vue:14-22` already shows 已启用/已关闭/不支持投影. Exact copy: tag `近 N 天未使用` only for `stale`; meta line `调用 N 次 · 最近 <time>` only when `used`; `统计中` for `pending`; `本平台暂不支持使用统计` for `unsupported`; nothing when the artifact is missing or the skill is closed. No counts of 0 are rendered as a bare number; use `记录中未发现`.

**M7. Subagent transcripts must be included or explicitly excluded.** The Claude index skips `agent-*.jsonl` (155 of 208 files, 5,432 tool calls, 0 `Skill` calls today). Subagents can read skills; excluding them loses real use. Decision: scan them for usage even though the index does not, and record the difference.

**M8. Diagnostics distinguish "no use" from "cannot read".** Each extractor reports `parsed_tool_events` and `unparsed_tool_events`. `unsupported` is reserved for the case where tool records exist but none parse (format change); a platform that parses cleanly with zero skill hits reports a real zero.

### Inventive Catalyst: contradictions and resolutions

| Contradiction | Resolution |
| --- | --- |
| Precision (count invocations) vs coverage (count file reads) | One event per tool call that targets a skill; the grammar table decides which field is the target. Signals are not summed into different units because each platform contributes at most one event per call. |
| Immutable counts vs disposable cache / pruned transcripts | Append-only ledger in durable storage, no FKs to session tables; displayed count = aggregate over ledger rows, recomputable from the ledger alone. |
| No false "unused" vs useful in month one | `stale` requires three independent conditions: completed backfill spanning N days, ready artifact, parsable record source. Pre-existing skills become eligible through `min(firstSeenAt, birthtime)` and the backfilled coverage start, not through a blanket rollout delay. |
| One identity vs mutable `controlKey` | Two layers: immutable observation (platform, raw name, raw target, call id, timestamp) and read-time attribution to the visible row by normalized name. |
| Counting once vs append-only evidence | `INSERT OR IGNORE` on the natural key; the aggregate is updated only when the insert changed a row. Re-scans, re-indexing and appended files are no-ops. |

**Ideal Final Result.** Every skill row answers "how often and when last" with a number that cannot go backwards, derived from one ledger row per real tool call, resolved by name so moves and renames do not erase history; the only new persistent state is one small append-only table plus one write-once observation row per skill; no transcript is parsed twice, no catalog text is ever mistaken for use, and "未使用" is never displayed when the evidence base is missing.

### Evidence gaps

- The cost of a full `parser_version` re-index was not benchmarked end to end; the parse-speed measurement above is per-corpus and excludes index writes.
- dsh, gemini and opencode grammars are inferred from record shapes (dsh `tool/call`, gemini `messages[].toolCalls[]`, opencode `part.data`) but have no end-to-end fixture run yet; gemini and opencode have zero live positives on this machine.
- opencode holds only 6 sessions / 12 messages / 0 tool parts locally, so its extractor has no local calibration and is proven by fixture only.
- Codex `parsed_cmd` is absent for failed commands; a shell-verb fallback would reintroduce regex fragility and is not planned.
- Whether a claude session fork duplicates the same `tool_use.id` across files was not proven; 0 duplicates were observed in the current 208 files.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  - Show, per installed skill and per platform, an invocation count and a last-used timestamp derived from local CLI transcripts across all projects.
  - Mark a skill `近 N 天未使用` only when no use was observed in N days, the backfill covers N days, the artifact is ready, and the platform's tool records parse.
  - Backfill all existing local history once, then update incrementally; re-scans are idempotent.
  - Counts never decrease when transcripts are deleted, sessions expire, the index is rebuilt, or the cache is cleared.
  - One server-side global setting for N days (default 30), validated and exposed in the existing settings surface.
  - All six platforms (claude, codex, gemini, opencode, omp, dsh) ship in the first release; `本平台暂不支持使用统计` is reserved for a platform whose records cannot be parsed.

* **Out-of-Scope Non-Goals:**
  - IDE sessions and other machines.
  - Auto-delete or auto-disable of skills; the tag is informational and has no write path.
  - Per-platform thresholds; one global policy.
  - Usage-based sorting, trend charts, or ranking.
  - Counting plugin-cache skills that are not in the catalog (`~/.claude/plugins/...`); they appear in the unattributed diagnostic only.
  - Counting catalog text, prompt injections, `AGENTS.md`/`CLAUDE.md`, or search/glob patterns as use.

## Alternatives Weighed

| Option | Technical reason | Raised by |
| --- | --- | --- |
| Reuse `session_message.content` for tool calls | Rejected: non-user content is never persisted; measured 0 non-empty rows in 333,509 messages (`session-history-index.js:1517`). | `egm-codebase-details` |
| Flip `storeAssistantContent: true` | Rejected: contradicts the recorded design decision at `:650-653`, roughly doubles a 1.23 GB index, and still yields no tool name/args because adapters discard them. | `egm-zoom-out` |
| Text/FTS search for skill names or paths | Rejected: FTS indexes only user messages; codex has 576,277 injected `SKILL.md` mentions versus 180 real reads. | `egm-codebase-details` |
| Count `tool_result`/`tool_output` rows | Rejected: no target, no name; 91,304 codex output rows cannot be attributed to a skill. | `egm-design` |
| Standalone scanner with its own inventory and cursor table | Rejected: duplicates the index's inventory, worker, lock and freshness logic, and creates a second definition of "session"; it also drifts from the adapters on every format change. | `egm-design`, `egm-codebase-details`, `egm-zoom-out` |
| Key events by `controlKey` | Rejected: keys embed absolute paths and scope, and the list merges shadowed rows without keeping discarded keys; rename/move would reset counts. | `egm-codebase-details` |
| `manifest.createdAt` as observation start | Rejected: it is stamped on first registration, so every pre-existing skill shares the rollout date. Replaced by write-once `firstSeenAt` combined with artifact `birthtime`. | `egm-codebase-details` |
| Filesystem `atime` on skill files | Rejected: mount options and backup tools make it unreliable. | `egm-design` |
| Proxy request snapshots (`CC_TOOL_LOG_REQUESTS`) | Rejected: default-off and covers only traffic through this proxy. | `egm-zoom-out` |
| Hooks (`PreToolUse`) as the only source | Deferred, not built: exact but cannot backfill, and mutates the user's platform configuration. | `egm-zoom-out` |
| Turn-level episodes as the counting unit | Deferred: turn keys exist per platform, but the user's question is invocation count; episodes can be added later without changing the ledger. | `egm-inventive-catalyst` |
| Keep usage in `session-history.sqlite` with an FK | Rejected: `ON DELETE CASCADE` plus `_pruneMissingFiles` would delete counts with expired transcripts. | `egm-design` |
| Treat 0 uses as stale for every platform without a verified extractor | Rejected: gemini and opencode have no live positive, so their grammar must be fixture-proven; a zero is only claimed after that platform's tool records parse. | `egm-comprehension` |

## Key Decisions & Staging for Next Steps

**D1. Storage.** New SQLite at the durable storage root (sibling of `storage/`, not `CACHE_DIR`), opened with the existing `sqlite-connection` helper. Tables:
- `usage_event(event_key TEXT PRIMARY KEY, platform, session_id, call_id, extractor_version, raw_name, raw_target, skill_path, occurred_at, inserted_at)` — append-only, no foreign keys.
- `skill_observation(platform, normalized_name, first_seen_at)` — write-once (`INSERT OR IGNORE`), survives re-scans.
- `usage_scan_state(platform, coverage_start, coverage_end, status, parsed_tool_events, unparsed_tool_events, updated_at)`.
No aggregate table in the first release: `SELECT COUNT(*), MAX(occurred_at) … GROUP BY normalized_name` over ~2.5k rows is microseconds; materialize only if events exceed 10⁶.

**D2. Extraction seam.** Two hooks, both on readers that already exist; no new inventory walk:
- claude, codex, omp, gemini: extend each session-history adapter to emit `extraJson = { toolCalls: [{ id, name, target }] }` for assistant/tool rows, bump `parser_version` per source, and fold new rows into `usage_event` with `INSERT OR IGNORE`.
- dsh and opencode: hook their existing session readers (`drivers/dsh/sessions.js` over zstd JSONL; `drivers/opencode/sessions-implementation.js` over the `part` table), which already produce tool events, and write `usage_event` rows directly with the same natural key.

The fold runs inside the existing maintenance pass, one bounded batch per tick. A standalone scanner with its own file inventory and cursor table remains rejected.

**D3. Signal grammar.** claude: `name='Skill'` → `input.skill`. omp: `name='read'` and `path` starts with `skill://` → first path segment. codex: a `parsed_cmd` entry with `type='read'` whose path is under `<root>/<name>/`; commands whose verb is `rg`, `grep`, `find` or `glob` never count. gemini: `toolCalls[].name ∈ {read_file, run_shell_command}` where the path, or an explicit `cat/head/tail/sed` argument, points under a skill root. dsh: `tool/call` with `name='read'` and `arguments.path` under a skill root, or `name='bash'` with an explicit `cat/head/tail/sed` of such a path; `glob`/`grep` never count. opencode: `part.data.type='tool'` whose input path or explicit read command points under a skill root. Skill roots include user-level installs and project-local ones (`<project>/.dsh/skills`, `<project>/.opencode/skills`); the dsh measurements show project-local roots carry most of the real use. Everything else is a tool event, not a use.

**D4. Identity and resolution.** Normalize names as in M3; store raw values. Resolve at read time: project-scoped row for the session `cwd` first, then unique user-scoped name, then unique name across roots. Unmatched names increment `unparsed_tool_events` and appear in a diagnostic count, never in a card.

**D5. State machine and formula.**
- `unsupported`: the platform's tool records exist but none can be parsed (no grammar, or a format change). A platform that parses cleanly with zero skill hits yields a real zero, not `unsupported`.
- `pending`: backfill for that platform is not `complete`, or `now - max(coverage_start, first_seen_at) < N days`.
- `used`: `now - last_used_at < N days`.
- `stale`: coverage complete, `now - max(coverage_start, first_seen_at) >= N days`, `last_used_at` is null or older than N days, artifact `ready`, platform supported.
`coverage_start` = earliest session timestamp covered by a completed backfill for that platform. `first_seen_at` is write-once at first observation; for skills that predate the feature, the displayed eligibility uses `min(first_seen_at, birthtime(artifact_root))`, which can only delay a stale claim, never create one.

**D6. Settings.** `skillUsage.staleDays` (integer 1–365, default 30) in `default.js`, normalized in `loader.js`, accepted and validated in `POST /api/config/advanced`, exposed in `SettingsDrawer` as `技能未使用判定天数（天）` with the helper `超过该天数且没有使用记录时，在技能列表中标记“近 N 天未使用”；不影响任何技能状态。`

**D7. API and UI contract.** Additive `usage: { count, lastUsedAt, state, reason, coverageStart }` per skill plus top-level `usagePolicy: { staleDays, scan: { state, progress } }` on `GET /api/skills` **and** inside the project-skills response object. UI: one tag on `SkillCard`, one meta line, one `使用情况` block in `SkillDetailDrawer`, one matching filter option in `SkillsPanel` so the summary counter is actionable. No new component or page.

**D8. Dedupe and repeated calls.** Count each distinct `(session, call_id, target)` once; a call that reads two different skills contributes two events, one per skill. Do not count a `Skill` call and its resulting read as two uses of the same skill: the read carries a different call id only when it is a separate call, which is then a real second invocation.

**Staging**

All six platforms ship in one release; the stages below are implementation order, not release gates.

1. **Stage 0 — ledger + extraction for claude, omp, codex.** `extraJson.toolCalls`, `parser_version` bump, ledger, observation, scan state, fold under the maintenance lock. Acceptance: two consecutive scans produce identical counts; deleting a transcript changes no count; a malformed line skips only that line; re-index after the version bump does not double-count.
2. **Stage 1 — dsh and gemini extractors.** dsh: `tool/call` over zstd JSONL, `read` paths plus explicit `cat/head/tail/sed` reads, project-local roots included. gemini: `messages[].toolCalls[]`, `read_file` and explicit shell reads; 0 live positives on this machine, so fixtures carry the proof.
3. **Stage 2 — opencode extractor.** `part.data` tool parts; 0 live positives and only 6 local sessions, so the fixture is the only proof of the grammar.
4. **Stage 3 — resolution, settings, API join and UI for all six.** Name normalization across roots, state computation, settings plumbing, card tag, drawer section, summary counter and matching filter, project-scope response parity.
5. **Stage 4 — hardening.** `extractor_version` per event, `parsed/unparsed` diagnostics, backfill progress, a documented statement that renames keep history via normalized names while a reinstall at the same name inherits the count.

**Acceptance fixtures.** One synthetic record set per platform under `tests/fixtures/skill-usage/` (claude, codex, gemini, opencode, omp, dsh), each covering: user-triggered call, model-triggered call, non-skill tool call, two skills in one call, missing call id, duplicate line (omp), appended line, truncated tail, deleted transcript, N-day boundary, pre-existing skill exemption, and a deliberately unparsable record for the `unsupported` path. Fixtures must not read the developer's home directory.
