# Autopilot Spec: Codex/Gemini CLI Speed Test Failures

## User Report
- Codex speed test returns: request parameter error (`请求参数错误`).
- Gemini CLI speed test returns: HTTP 405.
- Need root-cause analysis against local code and reference to `CLIProxyAPI`.

## Scope
- Analyze speed test request construction in this repo.
- Compare endpoint and payload assumptions with `CLIProxyAPI` behavior.
- Produce a concrete fix plan (no production code change in this step).

## Evidence

### Local implementation (coding-tool)
1. Gemini CLI path builder appends `/v1internal:generateContent` to any non-root pathname:
   - `src/server/services/speed-test.js:148-163`
2. Gemini format selector does **not** force CLI format when pathname is `/v1`:
   - `src/server/services/speed-test.js:179-196`
3. Codex speed test is hardcoded to streaming request + SSE accept header:
   - `src/server/services/speed-test.js:493-513`
4. Codex errors are parsed as plain JSON only; SSE error frames are not decoded, causing generic fallback:
   - `src/server/services/speed-test.js:583-590`, `src/server/services/speed-test.js:726-734`

### CLIProxyAPI reference
1. Codex-compatible responses endpoint is mounted at `/v1/responses`:
   - `/tmp/CLIProxyAPI/internal/api/server.go:338-340`
2. Gemini CLI endpoint is mounted at `/v1internal:method` (root-level, not `/v1/...`):
   - `/tmp/CLIProxyAPI/internal/api/server.go:363`
3. Config example shows custom codex base-url and model-prefix/alias usage patterns (can affect tested model validity):
   - `/tmp/CLIProxyAPI/config.example.yaml:119-134`

## Root-Cause Hypotheses

### H1 (high confidence): Gemini 405 caused by wrong route format for CLIProxy-style targets
- If user configures Gemini base URL with `/v1`, current builder can generate `/v1/v1internal:generateContent` or choose native `/v1/models/...:generateContent` path.
- `CLIProxyAPI` expects `/v1internal:method`.
- Result: method/path mismatch, observed as HTTP 405.

### H2 (medium-high confidence): Codex "request parameter error" is masked upstream error
- Speed test uses streaming for codex and expects SSE success events.
- On failure, upstream may return SSE-framed error or non-JSON payload; current parser only attempts `JSON.parse(fullBody)`.
- This degrades to generic `请求参数错误`, hiding actual upstream message.

### H3 (medium confidence): Codex tested model may not match provider-available model naming
- Without `speedTestModel`, speed test can fall back to default `gpt-5-codex`.
- Providers like CLIProxy deployments may require prefixed/aliased model names.
- Can yield 400-level invalid-model style failures.

## Constraints
- Keep compatibility with existing OpenAI/Gemini native providers.
- Avoid regressions in successful current speed-test flows.
- Prefer additive fallback strategies over behavior-breaking hard switch.

## Success Criteria
1. Gemini speed test succeeds against CLIProxy-style base URLs (`root` and `/v1` variants).
2. Codex speed test surfaces upstream error details instead of generic `请求参数错误` when possible.
3. Model mismatch errors become actionable (show actual upstream message/model candidate).
4. Existing OpenAI/Gemini native speed tests still pass.
