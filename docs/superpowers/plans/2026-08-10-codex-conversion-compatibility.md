# Codex Conversion Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both OpenCode's Codex conversion proxy and OMP's managed Codex provider work with Codex-only OpenAI-compatible services.

**Architecture:** Add a small shared Codex wire helper for current client identity, request metadata, headers, and body normalization. OpenCode uses it before sending upstream; OMP provider API normalization emits `openai-codex-responses` only for explicit Codex channels while generic OpenAI Responses remains unchanged.

**Tech Stack:** Node.js 22 CommonJS, Express/http, Vitest, js-yaml, installed `codex-cli 0.144.1`, OMP 17.2.12.

---

### Task 1: Lock the Codex wire contract with failing tests

**Files:**
- Create: `tests/unit/services/codex-wire.test.js`
- Modify: `tests/unit/services/opencode-gateway-adapters.test.js` if the existing adapter test file exists; otherwise extend `scripts/test-opencode-gateway-adapters.js`
- Modify: `tests/unit/services/omp-settings-manager.test.js:41-90`

- [ ] **Step 1: Write the failing shared-wire test**

Add a Vitest test that calls the planned `codex-wire` exports with a payload containing `system` input, `temperature`, `top_p`, `max_output_tokens`, `max_completion_tokens`, `service_tier`, `prompt_cache_retention`, and a caller session id. Assert the output has:

```js
expect(result.body.input[0].role).toBe('developer');
expect(result.body.stream).toBe(true);
expect(result.body.store).toBe(false);
expect(result.body.include).toContain('reasoning.encrypted_content');
expect(result.body.temperature).toBeUndefined();
expect(result.body.max_output_tokens).toBeUndefined();
expect(result.headers['version']).toBe('0.144.1');
expect(result.headers.originator).toBe('codex_exec');
expect(result.headers['session-id']).toBe('session-test');
expect(result.headers['thread-id']).toBeTruthy();
expect(result.headers['x-codex-window-id']).toBeTruthy();
expect(result.body.client_metadata['x-codex-turn-metadata']).toBeTruthy();
```

The test must import `createCodexRequest` from `src/server/services/codex-wire.js`, so it fails with module-not-found before implementation.

- [ ] **Step 2: Run the focused test and verify the expected red failure**

Run: `npx vitest run tests/unit/services/codex-wire.test.js`

Expected: FAIL because `src/server/services/codex-wire.js` does not exist.

- [ ] **Step 3: Add the OMP mapping regression test**

In `tests/unit/services/omp-settings-manager.test.js`, add a test beside the provider writer tests:

```js
test('writes Codex-source providers with the Codex Responses API while preserving generic Responses', () => {
  const manager = require('../../../src/server/services/omp-settings-manager');
  const target = manager.writeManagedOmpProviders([
    {
      id: 'edge-codex',
      providerKey: 'edge-codex',
      baseUrl: 'https://edge.example/v1',
      apiKey: 'secret',
      gatewaySourceType: 'codex',
      providerApi: 'responses',
      model: 'gpt-5.5'
    },
    {
      id: 'generic-openai',
      providerKey: 'generic-openai',
      baseUrl: 'https://generic.example/v1',
      apiKey: 'secret',
      gatewaySourceType: 'openai_compatible',
      providerApi: 'openai-responses',
      model: 'gpt-4.1'
    }
  ]);
  const config = yaml.load(fs.readFileSync(target, 'utf8'));
  expect(config.providers['ctx-edge-codex'].api).toBe('openai-codex-responses');
  expect(config.providers['ctx-generic-openai'].api).toBe('openai-responses');
});
```

- [ ] **Step 4: Run the OMP test and verify it fails for the current mapping**

Run: `npx vitest run tests/unit/services/omp-settings-manager.test.js -t "Codex-source providers"`

Expected: FAIL because `normalizeProviderApi('responses')` currently returns `responses`, or the provider entry does not classify the Codex source.

---

### Task 2: Implement the shared Codex wire helper

**Files:**
- Create: `src/server/services/codex-wire.js`
- Test: `tests/unit/services/codex-wire.test.js`

- [ ] **Step 1: Implement deterministic request identity and headers**

Export:

```js
const CODEX_CLIENT_VERSION = '0.144.1';
function createCodexRequest(payload, options = {}) { /* { body, headers, model } */ }
function normalizeCodexResponsesInput(inputValue) { /* exported for direct tests */ }
function buildCodexTargetUrl(baseUrl) { /* exported for direct tests */ }
```

Use `options.sessionId` as the stable prompt/session identity, defaulting to `crypto.randomUUID()`. Generate UUIDs for `threadId`, `windowId`, `turnId`, and a process-local installation id. Use `originator: 'codex_exec'` and `user-agent: codex_exec/0.144.1 (<OS> <release>; <arch>) <terminal> (codex_exec; 0.144.1)`, with `process.platform`, `process.release.name`/`TERM_PROGRAM` fallback, and `process.arch`; tests may inject `userAgent` to avoid platform dependence.

Emit lowercase header keys:

```js
{
  authorization: `Bearer ${apiKey}`,
  accept: 'text/event-stream',
  'content-type': 'application/json',
  originator: 'codex_exec',
  'user-agent': userAgent,
  'session-id': sessionId,
  'thread-id': threadId,
  'x-client-request-id': sessionId,
  'x-codex-window-id': windowId,
  'x-codex-turn-metadata': JSON.stringify({
    installation_id: installationId,
    session_id: sessionId,
    thread_id: threadId,
    turn_id: turnId,
    window_id: windowId,
    request_kind: 'turn'
  })
}
```

Do not include `openai-beta`, `version`, `session_id`, or `conversation_id` because the verified official `0.144.1` request to the target service did not emit them. Never log the authorization value.

- [ ] **Step 2: Implement Codex body normalization**

Clone JSON-compatible payload data. Fill `model` from `fallbackModel` if absent. Convert string input to a single `message/user/input_text` item. Clone array input and rewrite only `role: 'system'` to `role: 'developer'`. Force `stream: true`, `store: false`; preserve tools, tool choice, reasoning, text, and unknown fields. Ensure `include` is a clean string array containing `reasoning.encrypted_content`.

Delete Codex-rejected fields: `max_output_tokens`, `max_completion_tokens`, `temperature`, `top_p`, `top_k`, `min_p`, `presence_penalty`, `frequency_penalty`, `repetition_penalty`, `stop`, `service_tier`, `user`, `previous_response_id`, `prompt_cache_retention`, and `safety_identifier`. Set `prompt_cache_key` to the stable session id unless the caller supplied a non-empty key. Add `client_metadata` with the same identity projection as the official client; preserve non-reserved caller metadata.

- [ ] **Step 3: Run focused tests and verify green**

Run: `npx vitest run tests/unit/services/codex-wire.test.js`

Expected: PASS.

---

### Task 3: Replace OpenCode's duplicated Codex conversion path

**Files:**
- Modify: `src/server/opencode-proxy-server.js:24-30,1044-1121,1335-1356,3089-3158`
- Modify: `src/server/services/opencode-gateway-adapters.js:741-811`
- Create: `tests/unit/services/opencode-codex-proxy.test.js`

- [ ] **Step 1: Add the local fake-upstream integration regression test**

Start a local `http.createServer` that records request headers/body and returns a minimal successful Responses SSE stream containing `response.created`, `response.completed`, and `[DONE]`. Start the OpenCode proxy on port 0 with stubs for channel allocation, API key, and configuration dependencies as needed by the existing module seams. POST `/v1/responses` with a Codex channel and payload containing a system input plus rejected sampling fields. Assert the fake upstream receives `/v1/responses`, `originator: codex_exec`, `user-agent` containing `0.144.1`, `session-id`, `thread-id`, `x-codex-window-id`, `x-codex-turn-metadata`, and a body without the rejected fields. Assert the downstream response completes and the upstream API key was not written to logs or body metadata.

- [ ] **Step 2: Run the integration test and verify the old path fails**

Run: `npx vitest run tests/unit/services/opencode-codex-proxy.test.js`

Expected: FAIL because the current handler sends `codex_cli_rs/0.101.0`, `Version: 0.101.0`, and lacks the current Codex identity metadata.

- [ ] **Step 3: Make the proxy use the shared helper**

Import `createCodexRequest` and `buildCodexTargetUrl` in `opencode-proxy-server.js`. Remove the local `normalizeCodexResponsesInput`, `convertOpenCodePayloadToCodexResponses`, and `buildCodexTargetUrl` implementations. Keep the independent response relay functions unchanged.

In `handleCodexGatewayRequest`, derive `sessionId` from `extractSessionIdFromRequest(req, originalPayload)` or let the helper generate it. Call `createCodexRequest(originalPayload, { apiKey: effectiveKey, fallbackModel: channel.model, sessionId })`, use its `body` and `headers`, and dispatch to the helper's target URL. Keep `wantsStream`, target-model validation, and existing error reporting behavior.

- [ ] **Step 4: Remove the second adapter implementation without changing its public API**

Change `convertOpenCodePayloadToCodexResponses` in `opencode-gateway-adapters.js` to delegate to `createCodexRequest(payload, { fallbackModel, apiKey: '' })` and return `{ requestBody: body, model }`, or remove the export only after updating every test/callsite. Keep the adapter export during this cutover because the existing regression script imports it.

- [ ] **Step 5: Run focused tests and verify green**

Run: `npx vitest run tests/unit/services/codex-wire.test.js tests/unit/services/opencode-codex-proxy.test.js tests/unit/services/opencode-gateway-adapters.test.js`

Expected: PASS.

---

### Task 4: Emit the correct Codex API in OMP configuration

**Files:**
- Modify: `src/server/services/omp-settings-manager.js:63-71,308-364`
- Modify: `src/server/services/omp-channels.js:1-16,608-615`
- Modify: `tests/unit/services/omp-settings-manager.test.js`
- Modify: `tests/unit/services/omp-channels.test.js` if a direct normalization seam is available

- [ ] **Step 1: Implement explicit Codex alias normalization**

Change `normalizeProviderApi(value, options = {})` so:

```js
if (normalized === 'responses' && options.gatewaySourceType === 'codex') {
  return 'openai-codex-responses';
}
if (normalized === 'responses') return 'openai-responses';
```

Preserve all explicit supported API identifiers exactly. In `buildProviderEntry`, pass `channel.gatewaySourceType` into `normalizeProviderApi`. In the OMP sync candidate, normalize the provider API once using the source provider's `api` and the selected gateway source; keep the raw `wireApi` for compatibility with existing UI fields.

- [ ] **Step 2: Run the OMP mapping regression and verify green**

Run: `npx vitest run tests/unit/services/omp-settings-manager.test.js -t "Codex-source providers"`

Expected: PASS, with generic OpenAI Responses still serialized as `openai-responses`.

- [ ] **Step 3: Run all affected service tests**

Run: `npx vitest run tests/unit/services/omp-settings-manager.test.js tests/unit/services/omp-channels.test.js tests/unit/services/omp-gateway-routing.test.js`

Expected: PASS.

---

### Task 5: Verify both live paths and finish cleanup

**Files:**
- Modify: `CHANGELOG.md:7-12`
- No credential-bearing files

- [ ] **Step 1: Run the project's OpenCode adapter regression script**

Run: `node scripts/test-opencode-gateway-adapters.js`

Expected: `OpenCode gateway adapters regression tests passed`.

- [ ] **Step 2: Exercise the OpenCode proxy against the real target**

Start the project proxy with a temporary channel/config supplied through an isolated temporary HOME or injected test seam. Send a minimal OpenAI Responses request using `gpt-5.5`, `stream: true`, and a prompt asking for `OK`. Pass the key only through `EDGE_API_KEY` in the process environment. Assert the response reaches `response.completed` and contains non-empty output; capture only redacted headers and status.

- [ ] **Step 3: Exercise OMP with generated Codex provider configuration**

Generate a temporary `models.yml` entry for `openai-codex-responses` with base URL `https://api.ai-edge.xyz/v1`, model `gpt-5.5`, and an environment-backed key. Run installed `omp` with the temporary config and `EDGE_API_KEY` environment variable, asking for `OK`. Assert the command succeeds. Delete temporary config and ensure the repository contains no key.

- [ ] **Step 4: Run the complete relevant verification suite**

Run:

```bash
npx vitest run tests/unit/services/codex-wire.test.js tests/unit/services/opencode-codex-proxy.test.js tests/unit/services/opencode-gateway-adapters.test.js tests/unit/services/omp-settings-manager.test.js tests/unit/services/omp-gateway-routing.test.js
node scripts/test-opencode-gateway-adapters.js
npm run test:basic
```

Expected: all commands exit 0. If unrelated existing failures appear, report their exact command/output separately instead of weakening the new assertions.

- [ ] **Step 5: Record the fix in the changelog and scan for credentials**

Add one Unreleased fixed entry describing the current Codex compatibility headers/metadata and OMP API classification. Run a repository search for the literal key prefix/value and confirm no match in tracked source, tests, docs, or logs. Do not add a “follow-up” placeholder.
