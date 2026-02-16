# OAuth Multi-Account Support - Issue Analysis & Fix Specification

## Executive Summary

The recent OAuth token exchange fix (changing from `openai-api-key` to `codex-cli`) works correctly for single-account scenarios, but the analysis revealed **8 critical issues** affecting multi-account support and token management.

---

## Critical Issues Identified

### 1. **No Account Identity Tracking** [CRITICAL]

**Problem**: The system never decodes the `id_token` JWT to extract user identity (email, sub, organization).

**Impact**:
- Users cannot distinguish between multiple accounts
- No way to detect duplicate logins for the same account
- Token list shows only masked access tokens (indistinguishable)

**Evidence**:
- `oauth.js:136` stores `id_token` as opaque string
- Token object has no `email`, `sub`, or `name` fields
- UI displays tokens with no human-readable identifier

### 2. **Token ID Collision Risk** [CRITICAL]

**Problem**: Token IDs use `token-${Date.now()}` which can collide if two OAuth callbacks complete within the same millisecond.

**Impact**: Second token overwrites the first, losing user data

**Evidence**: `oauth-token-storage.js:49`

### 3. **No Token Deduplication** [HIGH]

**Problem**: Re-authenticating the same account creates duplicate tokens instead of updating the existing one.

**Impact**:
- Unbounded token accumulation
- Orphaned tokens when channels are deleted
- Confusion about which token to use

**Evidence**: No check for existing tokens by account identity before creating new ones

### 4. **Provider Identity Confusion** [HIGH]

**Problem**: `codex` and `openai_chatgpt` providers share identical OAuth configuration (same client ID, callback port, `requestedToken`).

**Impact**:
- Tokens are functionally identical but stored under different provider labels
- Cross-provider token sharing doesn't work due to provider filtering
- User confusion about which provider to use

**Evidence**: `oauth-providers.js:17-33` and `oauth-providers.js:75-94`

### 5. **No Referential Integrity** [MEDIUM]

**Problem**:
- Deleting a channel doesn't clean up its OAuth token
- Deleting a token doesn't clear `oauthTokenId` on channels
- Channel can reference deleted token, token can reference deleted channel

**Impact**: Dangling references, orphaned tokens, confusing UI state

**Evidence**: `opencode-channels.js:138-150` (delete channel has no token cleanup)

### 6. **No Automatic Token Refresh** [MEDIUM]

**Problem**: `getEffectiveApiKey()` returns `null` on expired tokens instead of attempting refresh.

**Impact**: Users see opaque API failures instead of clear "token expired" messages

**Evidence**: `opencode-channels.js:185-205`

### 7. **Concurrent Flow Port Collision** [MEDIUM]

**Problem**: Both `codex` and `openai_chatgpt` use port 1455. Concurrent OAuth flows will conflict.

**Impact**: Second flow fails or hijacks the first

**Evidence**: `oauth-providers.js:32` and `oauth-providers.js:92`

### 8. **Token File Race Condition** [LOW]

**Problem**: `saveToken()` does read-modify-write without file locking.

**Impact**: Concurrent OAuth callbacks can lose tokens

**Evidence**: `oauth-token-storage.js:47-61`

---

## Solution Design

### Phase 1: Critical Fixes (Must Have)

#### Fix 1.1: Decode ID Token for Account Identity

**File**: `src/server/services/oauth-service.js`

Add function to decode JWT (no verification needed for display):

```javascript
function decodeIdToken(idToken) {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return {
      sub: payload.sub,           // Unique user ID
      email: payload.email,       // User email
      name: payload.name,         // Display name
      organizations: payload.organizations  // For Claude
    };
  } catch (err) {
    console.warn('Failed to decode id_token:', err);
    return null;
  }
}
```

**File**: `src/server/api/oauth.js`

Update token storage to include decoded identity (line 131-141):

```javascript
const userInfo = decodeIdToken(tokenData.id_token);

const tokenId = await saveToken({
  provider: flow.provider,
  channelId: flow.channelId,
  accessToken: tokenData.access_token,
  refreshToken: tokenData.refresh_token,
  idToken: tokenData.id_token,
  expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
  scope: tokenData.scope,
  platformApiKey: apiKey,
  platformApiKeyExpiresAt: apiKeyExpiresAt,
  // NEW: Add user identity
  userEmail: userInfo?.email,
  userSub: userInfo?.sub,
  userName: userInfo?.name
});
```

#### Fix 1.2: Use UUID for Token IDs

**File**: `src/server/services/oauth-token-storage.js`

Replace `token-${Date.now()}` with `crypto.randomUUID()` (line 49):

```javascript
const { randomUUID } = require('crypto');

async function saveToken(tokenData) {
  const tokens = await loadTokens();
  const tokenId = randomUUID();  // CHANGED: Use UUID instead of timestamp
  // ...
}
```

#### Fix 1.3: Token Deduplication

**File**: `src/server/services/oauth-token-storage.js`

Add function to find existing token by account:

```javascript
async function findTokenByAccount(provider, userSub) {
  const tokens = await loadTokens();
  return Object.entries(tokens).find(([id, token]) =>
    token.provider === provider && token.userSub === userSub
  )?.[0];  // Return token ID if found
}
```

**File**: `src/server/api/oauth.js`

Check for existing token before creating new one (after line 131):

```javascript
const userInfo = decodeIdToken(tokenData.id_token);

// Check if token already exists for this account
let tokenId;
if (userInfo?.sub) {
  tokenId = await findTokenByAccount(flow.provider, userInfo.sub);
}

if (tokenId) {
  // Update existing token
  await updateToken(tokenId, {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    idToken: tokenData.id_token,
    expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
    platformApiKey: apiKey,
    platformApiKeyExpiresAt: apiKeyExpiresAt
  });
} else {
  // Create new token
  tokenId = await saveToken({ /* ... */ });
}
```

#### Fix 1.4: Clarify Provider Relationship

**Decision**: Merge `codex` and `openai_chatgpt` into a single provider since they're identical.

**File**: `src/server/config/oauth-providers.js`

Option A: Keep both but document they're aliases:

```javascript
// Lines 17-33: codex provider
// Add comment:
// NOTE: 'codex' and 'openai_chatgpt' are aliases for the same OAuth client.
// Tokens are interchangeable between Codex CLI and OpenCode ChatGPT channels.

// Lines 75-94: openai_chatgpt provider
// Add comment:
// NOTE: This is an alias for 'codex' provider. Uses the same OAuth client.
```

Option B: Normalize provider name on token save:

```javascript
// In oauth-service.js, normalize provider name:
function normalizeProvider(provider) {
  if (provider === 'openai_chatgpt') return 'codex';
  return provider;
}
```

**Recommendation**: Option B (normalize to `codex`) for cleaner token management.

### Phase 2: High-Priority Fixes (Should Have)

#### Fix 2.1: Referential Integrity

**File**: `src/server/services/opencode-channels.js`

Update `deleteChannel()` to clean up token (line 138-150):

```javascript
async function deleteChannel(id) {
  const channels = await loadChannels();
  const channel = channels[id];

  if (channel?.oauthTokenId) {
    // Clean up associated OAuth token
    const { deleteToken } = require('./oauth-token-storage');
    await deleteToken(channel.oauthTokenId);
  }

  delete channels[id];
  await saveChannels(channels);
  return true;
}
```

**File**: `src/server/services/oauth-token-storage.js`

Add `deleteToken()` function and update channels on token delete:

```javascript
async function deleteToken(tokenId) {
  const tokens = await loadTokens();
  delete tokens[tokenId];
  await saveTokens(tokens);

  // Clear oauthTokenId on affected channels
  const { clearTokenFromChannels } = require('./opencode-channels');
  await clearTokenFromChannels(tokenId);

  return true;
}

// Export
module.exports = {
  // ... existing exports
  deleteToken
};
```

**File**: `src/server/services/opencode-channels.js`

Add helper to clear token references:

```javascript
async function clearTokenFromChannels(tokenId) {
  const channels = await loadChannels();
  let modified = false;

  for (const [id, channel] of Object.entries(channels)) {
    if (channel.oauthTokenId === tokenId) {
      channel.oauthTokenId = null;
      modified = true;
    }
  }

  if (modified) {
    await saveChannels(channels);
  }
}

module.exports = {
  // ... existing exports
  clearTokenFromChannels
};
```

#### Fix 2.2: Automatic Token Refresh

**File**: `src/server/services/opencode-channels.js`

Update `getEffectiveApiKey()` to attempt refresh (line 185-205):

```javascript
async function getEffectiveApiKey(channel) {
  if (channel.authType === 'oauth' && channel.oauthTokenId) {
    const { getToken, isTokenExpired, refreshToken } = require('./oauth-token-storage');
    let token = await getToken(channel.oauthTokenId);

    if (!token) return null;

    // Check if token is expired
    if (isTokenExpired(token)) {
      // Attempt automatic refresh
      try {
        const refreshed = await refreshToken(channel.oauthTokenId);
        if (refreshed) {
          token = refreshed;
        } else {
          return null;  // Refresh failed
        }
      } catch (err) {
        console.error('Token refresh failed:', err);
        return null;
      }
    }

    // Return platformApiKey if available, otherwise accessToken
    return token.platformApiKey || token.accessToken;
  }

  // Fallback to direct API key
  return channel.apiKey || null;
}
```

**File**: `src/server/services/oauth-token-storage.js`

Add `refreshToken()` function:

```javascript
async function refreshToken(tokenId) {
  const token = await getToken(tokenId);
  if (!token?.refreshToken) return null;

  const { refreshOAuthToken } = require('./oauth-service');
  const refreshed = await refreshOAuthToken(token.provider, token.refreshToken);

  if (refreshed) {
    await updateToken(tokenId, {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || token.refreshToken,
      idToken: refreshed.id_token,
      expiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000
    });
    return await getToken(tokenId);
  }

  return null;
}
```

### Phase 3: Medium-Priority Fixes (Nice to Have)

#### Fix 3.1: Serialize OAuth Flows Per Port

**File**: `src/server/services/oauth-service.js`

Add port-based flow queue:

```javascript
const activeCallbackPorts = new Set();

async function startFlow(provider, channelId, mode) {
  const config = getProviderConfig(provider);

  // Check if callback port is already in use
  if (activeCallbackPorts.has(config.callbackPort)) {
    throw new Error(`OAuth flow already in progress for port ${config.callbackPort}. Please wait.`);
  }

  activeCallbackPorts.add(config.callbackPort);

  // ... rest of function

  // Clean up on flow completion/failure
  flows.get(stateId).cleanup = () => {
    activeCallbackPorts.delete(config.callbackPort);
  };
}
```

#### Fix 3.2: File Locking for Token Storage

**File**: `src/server/services/oauth-token-storage.js`

Use `proper-lockfile` for atomic writes:

```javascript
const lockfile = require('proper-lockfile');

async function saveTokens(tokens) {
  const release = await lockfile.lock(TOKEN_FILE, { retries: 3 });
  try {
    await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    await fs.chmod(TOKEN_FILE, 0o600);
  } finally {
    await release();
  }
}
```

---

## Implementation Plan

### Priority 1: Critical Fixes (Day 1)
1. ✅ Decode ID token for account identity
2. ✅ Use UUID for token IDs
3. ✅ Implement token deduplication
4. ✅ Normalize provider names (codex/openai_chatgpt)

### Priority 2: High-Priority Fixes (Day 2)
5. ✅ Add referential integrity (token-channel cleanup)
6. ✅ Implement automatic token refresh

### Priority 3: Medium-Priority Fixes (Day 3)
7. ✅ Serialize OAuth flows per port
8. ✅ Add file locking for token storage

### Priority 4: Verification (Day 4)
9. ✅ Architect review
10. ✅ Manual testing with multiple accounts
11. ✅ Update documentation

---

## Testing Strategy

### Test Cases

1. **Single account, single channel**: Should work as before
2. **Single account, multiple channels**: Channels should share the same token
3. **Multiple accounts, multiple channels**: Each account gets its own token
4. **Re-authentication**: Should update existing token, not create duplicate
5. **Token expiry**: Should auto-refresh transparently
6. **Channel deletion**: Should clean up orphaned tokens
7. **Token deletion**: Should clear references from channels
8. **Concurrent OAuth flows**: Second flow should queue or fail gracefully

---

## Success Metrics

- ✅ Users can distinguish between multiple accounts (email displayed)
- ✅ Re-authentication updates existing token (no duplicates)
- ✅ Token-channel references remain valid (no dangling pointers)
- ✅ Expired tokens refresh automatically
- ✅ No token ID collisions
- ✅ No race conditions on concurrent operations

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/server/services/oauth-service.js` | Add `decodeIdToken()`, normalize provider names, port serialization |
| `src/server/services/oauth-token-storage.js` | UUID token IDs, deduplication, `deleteToken()`, `refreshToken()`, file locking |
| `src/server/api/oauth.js` | Store user identity, check for existing tokens |
| `src/server/services/opencode-channels.js` | Token cleanup on delete, auto-refresh in `getEffectiveApiKey()` |
| `src/server/config/oauth-providers.js` | Document provider aliases |

---

**EXPANSION_COMPLETE**
