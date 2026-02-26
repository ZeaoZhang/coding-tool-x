# Autopilot Implementation Plan: Fix Codex/Gemini Speed Test Compatibility

## Phase 1: Gemini route/format compatibility (P0)

1. Normalize Gemini CLI path generation for proxy-style base URLs.
- File: `src/server/services/speed-test.js`
- Change:
  - When building Gemini CLI path, treat `/v1` as proxy root for CLI method route.
  - Ensure generated path can be `/v1internal:generateContent` for CLIProxy-compatible endpoints.

2. Add fallback strategy for Gemini speed test.
- File: `src/server/services/speed-test.js`
- Change:
  - Primary attempt by heuristic.
  - If result is `404/405/501` (route/method mismatch), retry with alternate format:
    - native (`/v1beta/models/...:generateContent`) <-> cli (`/v1internal:generateContent`).

Acceptance criteria:
- Gemini speed test no longer fails with 405 for CLIProxy-style URLs.

## Phase 2: Codex request robustness and error visibility (P0)

1. Decouple codex speed test from mandatory streaming mode.
- File: `src/server/services/speed-test.js`
- Change:
  - First attempt with non-stream body (`stream: false`) and `Accept: application/json`.
  - Optional fallback to stream mode only when needed.

2. Improve codex error extraction.
- File: `src/server/services/speed-test.js`
- Change:
  - Parse SSE-framed error payload (`data: {...}`) before generic JSON parsing.
  - Preserve upstream `error.message`/`detail` in response.

Acceptance criteria:
- Codex speed test failures show actionable upstream reason, not generic `请求参数错误`.

## Phase 3: Model selection reliability (P1)

1. Better default model candidate resolution for speed test.
- Files:
  - `src/server/services/speed-test.js`
  - `src/server/services/model-detector.js` (reuse, no behavior break)
- Change:
  - Priority: `speedTestModel` > explicit channel model > provider model list (`/v1/models`) > probe fallback.
  - Include tested model in failure output consistently.

Acceptance criteria:
- Fewer invalid-model 400s on custom relays using prefixed/aliased models.

## Phase 4: Tests and regression guard (P1)

1. Add unit tests for path/mode decisions.
- Suggested file: `scripts/test-api-consistency.js` extension or new `scripts/test-speed-test.js`.
- Cases:
  - Gemini URL normalization (`root`, `/v1`, `/v1beta`, explicit `/v1internal:...`).
  - Gemini fallback trigger on 405.
  - Codex error parser handling JSON and SSE-framed errors.

2. Add fixtures for CLIProxy-compatible responses.
- Validate that parsed errors and success metrics remain stable.

Acceptance criteria:
- Automated checks cover both successful and fallback paths.

## Phase 5: Verification checklist (P0)

Manual verification targets:
1. Codex channel against CLIProxy-compatible endpoint (`/v1/responses`) returns success or detailed failure.
2. Gemini channel against CLIProxy-compatible endpoint (`/v1internal:generateContent`) does not return 405.
3. Existing OpenAI official (`https://api.openai.com/v1`) codex speed test unchanged.
4. Existing Gemini native (`https://generativelanguage.googleapis.com/v1beta`) speed test unchanged.

## Rollout Strategy
- Implement in one PR with two commits:
  1. behavior fixes (Phase 1-3)
  2. tests (Phase 4)
- If regression risk is high, guard fallback retry with a small internal flag defaulting to enabled.

## Risk
- Over-aggressive fallback could mask misconfiguration.
Mitigation:
- Include `attemptedPaths` and `attemptedFormats` in debug logs.
