# Codex Conversion Compatibility Design

## Goal

Restore Codex-only upstream compatibility for both OpenCode conversion proxy requests and OMP-managed providers, using `https://api.ai-edge.xyz/v1` with `gpt-5.5` as the live acceptance target without persisting credentials.

## Observed failure

- The installed official `codex-cli 0.144.1` succeeds against the target service and returns `OK`.
- The project's current simulated Codex request uses a hard-coded `0.101.0` identity and receives HTTP 403: `This account only allows Codex official clients`.
- The OpenCode proxy contains a duplicated Codex payload converter in `opencode-proxy-server.js` in addition to `opencode-gateway-adapters.js`.
- OMP maps `responses` to generic `openai-responses`; Codex-only services require OMP's `openai-codex-responses` provider contract.

## Architecture

### Shared Codex compatibility module

Add one focused module under `src/server/services/` that owns Codex wire compatibility:

- current pinned client identity matching the reference implementation;
- stable request-scoped session, conversation, thread, window, and client metadata;
- Codex request headers;
- Codex Responses body normalization.

The body normalization will force streaming upstream, disable storage, convert system roles to developer roles, ensure encrypted reasoning inclusion, and remove unsupported sampling/output-cap fields. It will preserve caller-owned tools, input items, model selection, and response conversion semantics.

### OpenCode conversion path

`opencode-proxy-server.js` will import the shared compatibility functions instead of maintaining a second payload converter. Its responsibilities remain routing, credential selection, upstream transport, SSE collection/relay, and conversion back to the caller's requested streaming mode.

Session identity will derive from an existing prompt cache/session identifier when supplied; otherwise the handler creates one request identity and uses it consistently in headers and body metadata.

### OMP configuration path

OMP remains a byte-transparent data-plane gateway. For channels configured with Codex conversion semantics, generated provider configuration must use `openai-codex-responses`, allowing OMP's native provider implementation to construct the official Codex wire request. Generic OpenAI Responses providers remain `openai-responses`; no global remapping is allowed.

The normalization decision is based on the channel's explicit provider API first and Codex gateway source only when a generic `responses` alias would otherwise be emitted.

## Error handling

- Invalid or missing models continue to fail before upstream dispatch.
- Invalid upstream URLs continue to return the existing structured proxy error.
- Upstream status and body remain visible through the existing failure logger without logging authorization credentials.
- The compatibility layer is deterministic and side-effect free except for explicitly injected/generated identity values.

## Tests

1. Adapter unit test: Codex body contains current compatibility metadata and removes every unsupported sampling/output-cap field.
2. Header unit test: current version, beta, originator, session/conversation/thread/window identifiers, and official-compatible user agent are emitted consistently.
3. OpenCode proxy integration test with a local fake upstream: inspect the actual headers/body crossing the process boundary and return a minimal Responses SSE stream.
4. OMP settings test: a Codex-source channel using `responses` emits `openai-codex-responses`; a generic OpenAI channel remains `openai-responses`.
5. Live acceptance:
   - OpenCode proxy conversion path against the provided service;
   - generated OMP provider exercised by installed OMP against the same service.

## Non-goals

- No WebSocket implementation in the OpenCode proxy.
- No OAuth or ChatGPT account-token handling.
- No change to generic OpenAI, Claude, or Gemini conversion behavior.
- No persistence of the provided API key in source, fixtures, logs, or design documents.
