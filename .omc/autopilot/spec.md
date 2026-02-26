# OpenCode Configuration Issue - Diagnostic & Fix Specification

## Problem Statement

OpenCode's `/model` command doesn't display the model despite:
- API configured
- Dynamic switching enabled

## Root Causes (From Analysis)

### 1. All Channels Disabled (CRITICAL)
- All 3 OpenCode channels in `~/.cc-tool/opencode-channels.json` have `"enabled": false`
- Proxy start handler returns 400 error: "No enabled OpenCode channel found"
- Without enabled channels, proxy never starts, config is never written

### 2. Config File Missing (CRITICAL)
- `~/.config/opencode/opencode.json` does NOT exist
- Only a user backup from Feb 14 exists (`opencode.json.user-backup-20260214202645`)
- Config file should be created when proxy starts, but proxy can't start without enabled channels

### 3. Missing `model` Field in Config (HIGH)
- `setProxyConfig()` at `src/server/services/opencode-settings-manager.js:154-177` only writes:
  - `provider.openai.options.baseURL`
  - `provider.openai.options.apiKey`
- Does NOT write `provider.openai.model`
- OpenCode's `/model` command reads from config, finds no model field, shows nothing

### 4. Claude Gateway Lacks `channel.model` Fallback (MEDIUM)
- Codex gateway (line 2539): passes `channel.model` to converter
- Gemini gateway (line 3301): passes `channel.model` to converter
- Claude gateway (line 2396): does NOT pass `channel.model`
- Hardcoded fallback: `claude-sonnet-4-20250514`

### 5. Empty Model List (MEDIUM)
- `/v1/models` endpoint depends on `channel.model` or `speedTestModel`
- All channels have `model: null`
- Only `88code` has `speedTestModel: "claude-opus-4-6"`

## Technical Specification

### Fix 1: Enable At Least One Channel (USER ACTION)
**File:** `~/.cc-tool/opencode-channels.json`
**Action:** User must enable at least one channel via Web UI or manual edit
**Impact:** Allows proxy to start

### Fix 2: Write `model` Field in `setProxyConfig()` (CODE FIX)
**File:** `src/server/services/opencode-settings-manager.js`

**Change function signature (line 154):**
```javascript
// BEFORE:
function setProxyConfig(proxyPort) {

// AFTER:
function setProxyConfig(proxyPort, options = {}) {
```

**Add model write (after line 172):**
```javascript
next.provider.openai.options.baseURL = `http://127.0.0.1:${proxyPort}/v1`;
next.provider.openai.options.apiKey = 'PROXY_KEY';

// NEW: Write model so OpenCode's /model shows the active model
if (options.model) {
  next.provider.openai.model = options.model;
}
```

**Update caller in `src/server/api/opencode-proxy.js` (line 103):**
```javascript
// BEFORE:
setProxyConfig(proxyResult.port);

// AFTER:
const activeModel = currentChannel.model || currentChannel.speedTestModel || null;
setProxyConfig(proxyResult.port, { model: activeModel });
```

### Fix 3: Pass `channel.model` to Claude Gateway (CODE FIX)
**File:** `src/server/opencode-proxy-server.js`

**Update gateway call (line 2396):**
```javascript
// BEFORE:
const claudePayload = convertOpenCodePayloadToClaude(pathname, originalPayload);

// AFTER:
const claudePayload = convertOpenCodePayloadToClaude(pathname, originalPayload, channel.model);
```

**Update converter function (line 530):**
```javascript
// BEFORE:
function convertOpenCodePayloadToClaude(pathname, payload = {}, fallbackModel = '') {
  // ...
  model: payload.model || 'claude-sonnet-4-20250514',

// AFTER:
function convertOpenCodePayloadToClaude(pathname, payload = {}, fallbackModel = '') {
  // ...
  model: payload.model || fallbackModel || 'claude-sonnet-4-20250514',
```

### Fix 4: Populate Channel `model` Fields (DATA FIX)
**File:** `~/.cc-tool/opencode-channels.json`

**Suggested values:**
- `anyrouter_linuxdo`: `"model": "claude-sonnet-4-20250514"`
- `88code`: `"model": "claude-opus-4-6"`
- `Anthropic API`: `"model": "claude-sonnet-4-20250514"`

## Implementation Plan

### Phase 1: Diagnostic Verification
1. Verify all channels are disabled
2. Verify config file missing
3. Verify model list empty

### Phase 2: Code Fixes
1. Fix `setProxyConfig()` to accept and write model
2. Update caller in opencode-proxy.js
3. Fix Claude gateway to use channel.model
4. Update converter function signature

### Phase 3: Configuration
1. Enable at least one channel
2. Set model field on enabled channel(s)

### Phase 4: Validation
1. Start proxy via API
2. Verify opencode.json created with model field
3. Verify /v1/models returns models
4. Test OpenCode `/model` command

## Verification Steps

```bash
# 1. Check channel status
cat ~/.cc-tool/opencode-channels.json | jq '.channels[] | {name, enabled, model}'

# 2. Check config file
ls -la ~/.config/opencode/opencode.json

# 3. Start proxy (requires enabled channel)
curl -X POST http://localhost:9999/api/opencode-proxy/start

# 4. Verify config written
cat ~/.config/opencode/opencode.json | jq '.provider.openai'

# 5. Check model list
curl http://localhost:20091/v1/models | jq '.data'

# 6. Stop proxy
curl -X POST http://localhost:9999/api/opencode-proxy/stop
```

## Expected Outcomes

**After fixes:**
- ✅ At least one channel enabled
- ✅ Proxy starts successfully
- ✅ `~/.config/opencode/opencode.json` exists
- ✅ Config contains `provider.openai.model` field
- ✅ `/v1/models` returns non-empty list
- ✅ OpenCode `/model` command shows the model

## Files Modified

1. `src/server/services/opencode-settings-manager.js` - Add model parameter and write logic
2. `src/server/api/opencode-proxy.js` - Pass model to setProxyConfig
3. `src/server/opencode-proxy-server.js` - Pass channel.model to Claude converter
4. `~/.cc-tool/opencode-channels.json` - Enable channel(s) and set model fields

**EXPANSION_COMPLETE**
