const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('../config/paths');
const {
  inspectTool,
  SUPPORTED_TOOLS,
  fingerprintFor,
  readAllNativeOAuth,
  updateCodexOAuthTokens,
  applyOAuthCredential
} = require('./native-oauth-adapters');
const { maskToken } = require('../server/services/oauth-utils');

function createEmptyStore() {
  return {
    version: 1,
    tools: Object.fromEntries(SUPPORTED_TOOLS.map((tool) => [tool, {
      defaultCredentialId: null,
      credentials: []
    }]))
  };
}

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(PATHS.oauthCredentials), { recursive: true });
}

function readStore() {
  ensureStoreDir();
  if (!fs.existsSync(PATHS.oauthCredentials)) {
    return createEmptyStore();
  }

  try {
    const payload = JSON.parse(fs.readFileSync(PATHS.oauthCredentials, 'utf8'));
    const next = createEmptyStore();
    if (payload && typeof payload === 'object' && payload.tools && typeof payload.tools === 'object') {
      SUPPORTED_TOOLS.forEach((tool) => {
        const rawToolData = payload.tools[tool];
        if (!rawToolData || typeof rawToolData !== 'object') {
          return;
        }
        next.tools[tool] = {
          defaultCredentialId: rawToolData.defaultCredentialId || null,
          credentials: Array.isArray(rawToolData.credentials) ? rawToolData.credentials : []
        };
      });
    }
    return next;
  } catch {
    return createEmptyStore();
  }
}

function writeStore(store) {
  ensureStoreDir();
  fs.writeFileSync(PATHS.oauthCredentials, JSON.stringify(store, null, 2), 'utf8');
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(PATHS.oauthCredentials, 0o600);
    } catch {
      // ignore chmod failures
    }
  }
}

function assertSupportedTool(tool) {
  if (!SUPPORTED_TOOLS.includes(tool)) {
    throw new Error(`Unsupported OAuth tool: ${tool}`);
  }
}

function safeString(value) {
  return String(value || '').trim();
}


function buildCredentialName(tool, metadata, providedName = '') {
  const explicit = safeString(providedName);
  if (explicit) {
    return explicit;
  }

  if (tool === 'omp' && safeString(metadata.providerId)) {
    const accountLabel = safeString(metadata.accountId || metadata.accountEmail);
    return accountLabel
      ? `${tool} - ${metadata.providerId} - ${accountLabel}`
      : `${tool} - ${metadata.providerId}`;
  }

  const accountLabel = safeString(metadata.accountId || metadata.accountEmail);
  if (accountLabel) {
    return `${tool} - ${accountLabel}`;
  }

  return `${tool} - ${new Date().toISOString().slice(0, 10)}`;
}

function sanitizeCredential(entry, defaultCredentialId) {
  const primaryToken = entry?.secrets?.primaryToken
    || entry?.secrets?.accessToken
    || entry?.secrets?.token
    || '';

  return {
    id: entry.id,
    tool: entry.tool,
    name: entry.name,
    source: entry.source,
    storage: entry.storage || '',
    providerId: entry.providerId || '',
    accountId: entry.accountId || '',
    accountEmail: entry.accountEmail || '',
    identityKey: entry.identityKey || '',
    expiresAt: entry.expiresAt || null,
    lastRefresh: entry.lastRefresh || null,
    lastUsedAt: entry.lastUsedAt || null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    tokenPreview: maskToken(primaryToken),
    isDefault: defaultCredentialId === entry.id
  };
}

function sanitizeNativeCredential(entry = {}) {
  const primaryToken = entry.primaryToken
    || entry.accessToken
    || entry.token
    || '';

  return {
    providerId: entry.providerId || '',
    accountId: entry.accountId || '',
    accountEmail: entry.accountEmail || '',
    expiresAt: entry.expiresAt || null,
    lastRefresh: entry.lastRefresh || null,
    storage: entry.storage || '',
    tokenPreview: maskToken(primaryToken)
  };
}

function sanitizeToolSummary(tool, toolStore) {
  const credentials = (toolStore.credentials || [])
    .map((entry) => sanitizeCredential(entry, toolStore.defaultCredentialId))
    .sort((a, b) => {
      const aTime = a.lastUsedAt || 0;
      const bTime = b.lastUsedAt || 0;
      if (aTime !== bTime) return bTime - aTime;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  const nativeState = inspectTool(tool);
  const nativeCredentials = readAllNativeOAuth(tool).map((entry) => sanitizeNativeCredential(entry));
  return {
    tool,
    defaultCredentialId: toolStore.defaultCredentialId || null,
    credentials,
    nativeState: {
      ...nativeState,
      nativeCredentials
    }
  };
}

function getToolStore(store, tool) {
  assertSupportedTool(tool);
  if (!store.tools[tool]) {
    store.tools[tool] = { defaultCredentialId: null, credentials: [] };
  }
  return store.tools[tool];
}

function extractSecrets(tool, metadata) {
  // 只保留真正的 secret 字段，不污染非敏感数据
  switch (tool) {
    case 'claude':
      return {
        accessToken: metadata.accessToken || '',
        refreshToken: metadata.refreshToken || '',
        expiresAt: metadata.expiresAt || null,
        primaryToken: metadata.primaryToken || metadata.accessToken || ''
      };
    case 'codex':
      return {
        authMode: metadata.authMode || 'chatgpt',
        accessToken: metadata.accessToken || '',
        refreshToken: metadata.refreshToken || '',
        idToken: metadata.idToken || '',
        accountId: metadata.accountId || '',
        lastRefresh: metadata.lastRefresh || null,
        primaryToken: metadata.primaryToken || metadata.accessToken || ''
      };
    case 'gemini':
      return {
        accessToken: metadata.accessToken || '',
        refreshToken: metadata.refreshToken || '',
        tokenType: metadata.tokenType || 'Bearer',
        scope: metadata.scope || '',
        expiresAt: metadata.expiresAt || null,
        primaryToken: metadata.primaryToken || metadata.accessToken || ''
      };
    case 'omp':
      return {
        providerId: metadata.providerId || '',
        credentialType: metadata.credentialType || 'oauth',
        accessToken: metadata.accessToken || '',
        refreshToken: metadata.refreshToken || '',
        expiresAt: metadata.expiresAt || null,
        accountId: metadata.accountId || '',
        accountEmail: metadata.accountEmail || '',
        identityKey: metadata.identityKey || '',
        importPayload: metadata.importPayload || null,
        primaryToken: metadata.primaryToken || metadata.accessToken || ''
      };
    case 'opencode':
      return {
        providerId: metadata.providerId || '',
        accessToken: metadata.accessToken || '',
        idToken: metadata.idToken || '',
        refreshToken: metadata.refreshToken || '',
        expiresAt: metadata.expiresAt || null,
        accountId: metadata.accountId || '',
        accountEmail: metadata.accountEmail || '',
        identityKey: metadata.identityKey || '',
        primaryToken: metadata.primaryToken || metadata.accessToken || ''
      };
    default:
      return { primaryToken: metadata.primaryToken || metadata.accessToken || '' };
  }
}

function stableFingerprintValue(tool, metadata) {
  // 优先使用稳定标识符，避免 access token 轮换导致重复记录
  const stableId = metadata.accountEmail
    || metadata.accountId
    || (tool === 'omp' ? metadata.providerId : '')
    || metadata.refreshToken
    || metadata.primaryToken
    || metadata.accessToken
    || '';
  return stableId;
}

function resolveFingerprintValue(tool, metadata, options = {}) {
  if (options.fingerprintMode === 'primary-token') {
    return metadata.primaryToken
      || metadata.accessToken
      || stableFingerprintValue(tool, metadata);
  }
  return stableFingerprintValue(tool, metadata);
}

function upsertCredential(tool, metadata, options = {}) {
  const store = readStore();
  const toolStore = getToolStore(store, tool);
  const now = Date.now();
  const primaryToken = metadata.primaryToken || metadata.accessToken || '';
  const fingerprint = fingerprintFor(tool, resolveFingerprintValue(tool, metadata, options));
  const existingIndex = toolStore.credentials.findIndex((item) => item.fingerprint === fingerprint);
  const existing = existingIndex >= 0 ? toolStore.credentials[existingIndex] : null;

  const entry = {
    id: existing?.id || crypto.randomUUID(),
    tool,
    name: buildCredentialName(tool, metadata, options.name),
    source: options.source || existing?.source || 'manual',
    storage: metadata.storage || existing?.storage || '',
    providerId: metadata.providerId || existing?.providerId || '',
    accountId: metadata.accountId || existing?.accountId || '',
    accountEmail: metadata.accountEmail || existing?.accountEmail || '',
    expiresAt: metadata.expiresAt || existing?.expiresAt || null,
    lastRefresh: metadata.lastRefresh || existing?.lastRefresh || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    fingerprint,
    secrets: extractSecrets(tool, { ...existing?.secrets, ...metadata, primaryToken })
  };

  if (existingIndex >= 0) {
    toolStore.credentials.splice(existingIndex, 1, entry);
  } else {
    toolStore.credentials.unshift(entry);
  }

  if (!toolStore.defaultCredentialId) {
    toolStore.defaultCredentialId = entry.id;
  }

  writeStore(store);
  return sanitizeCredential(entry, toolStore.defaultCredentialId);
}


function getToolSummary(tool) {
  const store = readStore();
  const toolStore = getToolStore(store, tool);
  return sanitizeToolSummary(tool, toolStore);
}


function syncLocalCredential(tool) {
  assertSupportedTool(tool);
  const nativeCredentials = readAllNativeOAuth(tool);
  if (!nativeCredentials.length) {
    throw new Error('当前本地未检测到可同步的 OAuth 凭证。');
  }

  const credentials = nativeCredentials.map((metadata) => upsertCredential(tool, metadata, {
    source: 'synced-local',
    fingerprintMode: 'primary-token'
  }));

  return {
    credential: credentials[0] || null,
    credentials,
    summary: getToolSummary(tool)
  };
}

function restoreStoredOmpOAuthCredentials(channels = []) {
  const oauthChannels = (Array.isArray(channels) ? channels : [])
    .filter(channel => channel?.enabled !== false && channel?.authMode === 'oauth');
  if (oauthChannels.length === 0) return { restored: [], warnings: [] };

  const store = readStore();
  const toolStore = getToolStore(store, 'omp');
  const nativeCredentials = readAllNativeOAuth('omp');
  const restored = [];
  const warnings = [];
  const seenCredentialIds = new Set();

  for (const channel of oauthChannels) {
    const ref = channel.authRef || {};
    const stored = toolStore.credentials.find((entry) => {
      if (ref.credentialId && entry.id === ref.credentialId) return true;
      if (ref.providerId && entry.providerId !== ref.providerId) return false;
      if (ref.accountId && entry.accountId === ref.accountId) return true;
      if (ref.accountEmail && entry.accountEmail === ref.accountEmail) return true;
      return !ref.credentialId && !ref.accountId && !ref.accountEmail && !ref.providerId;
    });
    if (!stored || seenCredentialIds.has(stored.id)) continue;
    seenCredentialIds.add(stored.id);

    const accessToken = stored.secrets?.accessToken || stored.secrets?.primaryToken || '';
    if (!accessToken) {
      warnings.push(`OMP OAuth credential ${stored.id} has no access token.`);
      continue;
    }
    const expiresAt = Number(stored.expiresAt || stored.secrets?.expiresAt || 0);
    if (expiresAt > 0 && expiresAt <= Date.now()) {
      warnings.push(`OMP OAuth credential ${stored.id} is expired and was not restored.`);
      continue;
    }

    const alreadyNative = nativeCredentials.some((native) => (
      native.providerId === stored.providerId
      && ((!stored.accountId && !stored.accountEmail)
        || (stored.accountId && native.accountId === stored.accountId)
        || (stored.accountEmail && native.accountEmail === stored.accountEmail))
    ));
    if (alreadyNative) continue;

    try {
      applyOAuthCredential('omp', {
        providerId: stored.providerId || stored.secrets?.providerId,
        credentialType: stored.secrets?.credentialType || 'oauth',
        accessToken,
        refreshToken: stored.secrets?.refreshToken || '',
        expiresAt: expiresAt || null,
        accountId: stored.accountId || stored.secrets?.accountId || '',
        accountEmail: stored.accountEmail || stored.secrets?.accountEmail || '',
        identityKey: stored.identityKey || stored.secrets?.identityKey || stored.accountId || '',
        primaryToken: accessToken
      });
      restored.push(stored.id);
    } catch (error) {
      warnings.push(`OMP OAuth credential ${stored.id} restore failed: ${error.message}`);
    }
  }

  return { restored, warnings };
}


function findStoredCredential(tool, credentialId) {
  const store = readStore();
  const toolStore = getToolStore(store, tool);
  const entry = toolStore.credentials.find((item) => item.id === credentialId);
  if (!entry) {
    throw new Error('OAuth 凭证不存在。');
  }
  return entry;
}


function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
      timeout: 15000
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.end();
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(body);
    req.end();
  });
}

const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_REFRESH_SKEW_MS = 60 * 1000;
const codexRefreshPromises = new Map();

function parseJsonBody(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function fetchClaudeUsage(accessToken) {
  try {
    const result = await httpGet('https://api.anthropic.com/api/oauth/usage', {
      'Authorization': `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'anthropic-version': '2023-06-01',
      'User-Agent': 'claude-cli/1.0'
    });
    const data = parseJsonBody(result.body);
    return { raw: data, provider: 'claude', statusCode: result.statusCode };
  } catch (err) {
    return { error: err.message, provider: 'claude' };
  }
}

function extractCodexAccountId(...tokens) {
  const { decodeJwtPayload } = require('../server/services/oauth-utils');
  for (const token of tokens) {
    if (!token) continue;
    try {
      const payload = decodeJwtPayload(token) || {};
      const accountId = payload.chatgpt_account_id
        || payload['https://api.openai.com/auth.chatgpt_account_id']
        || payload['https://api.openai.com/auth']?.chatgpt_account_id
        || payload.organizations?.[0]?.id;
      if (accountId) return String(accountId);
    } catch (_) {
      // Try the next token; malformed JWTs should not prevent the usage request.
    }
  }
  return '';
}

function isCodexOAuthProvider(providerId = '') {
  const value = String(providerId || '').trim().toLowerCase();
  return value === 'codex'
    || value === 'openai'
    || value.includes('openai-codex')
    || value.includes('codex');
}

async function fetchCodexUsage(accessToken, accountId = '') {
  try {
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'codex-cli/0.1',
      'Accept': 'application/json',
      'originator': 'codex_cli_rs'
    };
    if (accountId) headers['ChatGPT-Account-Id'] = accountId;
    const result = await httpGet('https://chatgpt.com/backend-api/wham/usage', headers);
    const data = parseJsonBody(result.body);
    return { raw: data, provider: 'codex', statusCode: result.statusCode };
  } catch (err) {
    return { error: err.message, provider: 'codex' };
  }
}

function isCodexCredential(tool, entry = {}) {
  if (tool === 'codex') return true;
  if (tool !== 'omp' && tool !== 'opencode') return false;
  return isCodexOAuthProvider(entry.providerId || entry.secrets?.providerId);
}

function credentialExpiresAt(entry = {}) {
  const explicit = Number(entry.expiresAt || entry.secrets?.expiresAt || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const { decodeJwtPayload } = require('../server/services/oauth-utils');
  for (const token of [entry.secrets?.accessToken, entry.secrets?.idToken]) {
    const exp = Number(decodeJwtPayload(token)?.exp || 0);
    if (Number.isFinite(exp) && exp > 0) return exp * 1000;
  }
  return null;
}

async function refreshCodexCredential(entry) {
  const refreshToken = String(entry?.secrets?.refreshToken || '').trim();
  if (!refreshToken) return { entry, refreshed: false };
  const existing = codexRefreshPromises.get(entry.id);
  if (existing) return existing;

  const promise = (async () => {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CODEX_OAUTH_CLIENT_ID
    }).toString();
    const result = await httpPost(CODEX_OAUTH_TOKEN_URL, form, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    });
    const payload = parseJsonBody(result.body) || {};
    if (result.statusCode < 200 || result.statusCode >= 300 || !payload.access_token) {
      return { entry, refreshed: false };
    }

    const accessToken = String(payload.access_token).trim();
    const nextRefreshToken = String(payload.refresh_token || refreshToken).trim();
    const idToken = String(payload.id_token || entry.secrets.idToken || '').trim();
    const accountId = extractCodexAccountId(idToken, accessToken)
      || entry.accountId
      || entry.secrets.accountId
      || '';
    const expiresIn = Number(payload.expires_in || 0);
    const expiresAt = expiresIn > 0
      ? Date.now() + expiresIn * 1000
      : credentialExpiresAt({ secrets: { accessToken, idToken } });
    const lastRefresh = new Date().toISOString();

    const store = readStore();
    const toolStore = getToolStore(store, entry.tool);
    const stored = toolStore.credentials.find(item => item.id === entry.id);
    if (!stored) return { entry, refreshed: false };
    stored.accountId = accountId || stored.accountId || '';
    stored.expiresAt = expiresAt || stored.expiresAt || null;
    stored.updatedAt = Date.now();
    stored.secrets = {
      ...stored.secrets,
      accessToken,
      refreshToken: nextRefreshToken,
      idToken,
      accountId: accountId || stored.secrets.accountId || '',
      expiresAt: expiresAt || stored.secrets.expiresAt || null,
      lastRefresh,
      primaryToken: accessToken
    };
    writeStore(store);

    if (entry.tool === 'codex' && typeof updateCodexOAuthTokens === 'function') {
      try {
        updateCodexOAuthTokens({
          authMode: stored.secrets.authMode,
          accessToken,
          refreshToken: nextRefreshToken,
          idToken,
          accountId,
          lastRefresh
        });
      } catch {
        // The credential store is sufficient for quota lookup; native sync is best-effort.
      }
    }

    if (entry.tool === 'omp' && typeof applyOAuthCredential === 'function') {
      try {
        applyOAuthCredential('omp', {
          providerId: stored.providerId || stored.secrets.providerId,
          credentialType: stored.secrets.credentialType || 'oauth',
          accessToken,
          refreshToken: nextRefreshToken,
          expiresAt,
          accountId,
          accountEmail: stored.accountEmail || stored.secrets.accountEmail || '',
          identityKey: stored.identityKey || stored.secrets.identityKey || accountId,
          primaryToken: accessToken
        });
      } catch {
        // Quota lookup can still use the refreshed app credential if native sync is unavailable.
      }
    }

    return { entry: stored, refreshed: true };
  })().catch(() => ({ entry, refreshed: false }));
  codexRefreshPromises.set(entry.id, promise);
  try {
    return await promise;
  } finally {
    codexRefreshPromises.delete(entry.id);
  }
}

async function ensureFreshCodexCredential(entry) {
  const expiresAt = credentialExpiresAt(entry);
  if (expiresAt && expiresAt - Date.now() > CODEX_REFRESH_SKEW_MS) {
    return { entry, refreshed: false };
  }
  return refreshCodexCredential(entry);
}

async function fetchGeminiUsage(accessToken) {
  try {
    const body = JSON.stringify({
      metadata: {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI'
      }
    });
    const result = await httpPost('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', body, {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'google-api-nodejs-client/9.15.1',
      'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
      'Client-Metadata': '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}'
    });
    const loadData = parseJsonBody(result.body) || {};
    if (result.statusCode < 200 || result.statusCode >= 300) {
      return { raw: loadData, provider: 'gemini', statusCode: result.statusCode };
    }

    const project = typeof loadData.cloudaicompanionProject === 'string'
      ? loadData.cloudaicompanionProject
      : loadData.cloudaicompanionProject?.id || '';
    const quotaResult = await httpPost(
      'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
      JSON.stringify(project ? { project } : {}),
      {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'google-api-nodejs-client/9.15.1',
        'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
        'Client-Metadata': '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}'
      }
    );
    return {
      raw: parseJsonBody(quotaResult.body),
      provider: 'gemini',
      statusCode: quotaResult.statusCode
    };
  } catch (err) {
    return { error: err.message, provider: 'gemini' };
  }
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const percent = number >= 0 && number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, percent));
}

function normalizeResetAt(value, resetAfterSeconds) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric < 1e12 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const afterSeconds = Number(resetAfterSeconds);
  if (Number.isFinite(afterSeconds) && afterSeconds >= 0) {
    return new Date(Date.now() + afterSeconds * 1000).toISOString();
  }
  return null;
}

function normalizeWindow(window, label, id = '') {
  if (!window || typeof window !== 'object') return null;
  const usedPercent = clampPercent(window.used_percent ?? window.usedPercent ?? window.utilization);
  const remainingPercent = clampPercent(
    window.remaining_percent
      ?? window.remainingPercent
      ?? window.remaining_fraction
      ?? window.remainingFraction
  );
  if (usedPercent === null && remainingPercent === null) return null;
  const normalizedUsedPercent = usedPercent === null ? 100 - remainingPercent : usedPercent;
  const normalizedRemainingPercent = remainingPercent === null ? 100 - usedPercent : remainingPercent;
  return {
    ...(id ? { id } : {}),
    label,
    remainingPercent: Math.max(0, Math.min(100, normalizedRemainingPercent)),
    usedPercent: Math.max(0, Math.min(100, normalizedUsedPercent)),
    resetsAt: normalizeResetAt(
      window.resets_at
        ?? window.resetsAt
        ?? window.reset_at
        ?? window.resetAt
        ?? window.reset_time
        ?? window.resetTime,
      window.reset_after_seconds ?? window.resetAfterSeconds
    )
  };
}

function normalizeGeminiQuota(value) {
  const buckets = Array.isArray(value?.buckets) ? value.buckets : [];
  const windows = buckets.map((bucket, index) => {
    const remainingPercent = clampPercent(bucket?.remainingFraction ?? bucket?.remaining_fraction);
    if (remainingPercent === null) return null;
    const modelId = String(bucket?.modelId || bucket?.model_id || '').trim();
    return {
      id: `gemini:${modelId || index}`,
      label: modelId || 'Gemini',
      remainingPercent,
      usedPercent: Math.max(0, Math.min(100, 100 - remainingPercent)),
      resetsAt: normalizeResetAt(bucket?.resetTime || bucket?.reset_time),
      scope: modelId ? { modelId } : null
    };
  }).filter(Boolean);
  return windows.length ? { status: 'available', windows } : null;
}

function normalizeOAuthQuota(tool, raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  if (tool === 'gemini') {
    const geminiQuota = normalizeGeminiQuota(value);
    if (geminiQuota) return { quota: geminiQuota, status: 'available' };
  }

  let primary = normalizeWindow(value.five_hour || value.fiveHour, '5h', 'primary');
  let secondary = normalizeWindow(value.seven_day || value.sevenDay, '7d', 'secondary');
  const rateLimit = value.rate_limit || value.rateLimit;
  if (rateLimit) {
    primary = primary || normalizeWindow(rateLimit.primary_window || rateLimit.primaryWindow, '5h', 'primary');
    secondary = secondary || normalizeWindow(rateLimit.secondary_window || rateLimit.secondaryWindow, '7d', 'secondary');
  }

  const additional = [];
  const additionalLimits = Array.isArray(value.additional_rate_limits)
    ? value.additional_rate_limits
    : Array.isArray(value.additionalRateLimits) ? value.additionalRateLimits : [];
  additionalLimits.forEach((limit, index) => {
    const additionalRateLimit = limit?.rate_limit || limit?.rateLimit || limit;
    const name = String(
      limit?.limit_name || limit?.limitName || limit?.metered_feature || limit?.meteredFeature || '附加额度'
    ).trim();
    const additionalPrimary = normalizeWindow(
      additionalRateLimit?.primary_window || additionalRateLimit?.primaryWindow,
      `${name} 5h`,
      `additional:${index}:primary`
    );
    const additionalSecondary = normalizeWindow(
      additionalRateLimit?.secondary_window || additionalRateLimit?.secondaryWindow,
      `${name} 7d`,
      `additional:${index}:secondary`
    );
    if (additionalPrimary) additional.push(additionalPrimary);
    if (additionalSecondary) additional.push(additionalSecondary);
  });

  if (!primary && !secondary && !additional.length) {
    return { quota: null, status: 'unsupported', warning: `${tool}: provider did not return usable quota windows` };
  }
  return {
    quota: {
      status: 'available',
      primary,
      secondary,
      additional,
      windows: [primary, secondary, ...additional].filter(Boolean)
    },
    status: 'available'
  };
}

async function fetchCredentialUsage(tool, credentialId) {
  let entry = findStoredCredential(tool, credentialId);
  let secrets = entry.secrets || {};
  let codexRefreshed = false;
  if (isCodexCredential(tool, entry)) {
    const refreshed = await ensureFreshCodexCredential(entry);
    entry = refreshed.entry;
    secrets = entry.secrets || {};
    codexRefreshed = refreshed.refreshed;
  }
  let accessToken = secrets.accessToken || secrets.primaryToken || '';
  if (!accessToken) return { error: '无有效 token' };

  let response;
  switch (tool) {
    case 'claude':
      response = await fetchClaudeUsage(accessToken);
      break;
    case 'codex':
      response = await fetchCodexUsage(
        accessToken,
        extractCodexAccountId(secrets.idToken, accessToken) || entry.accountId || secrets.accountId
      );
      break;
    case 'gemini':
      response = await fetchGeminiUsage(accessToken);
      break;
    case 'omp': {
      const providerId = String(entry.providerId || secrets.providerId || '').toLowerCase();
      response = providerId.includes('claude') || providerId.includes('anthropic')
        ? await fetchClaudeUsage(accessToken)
        : providerId.includes('gemini') || providerId.includes('google')
          ? await fetchGeminiUsage(accessToken)
          : await fetchCodexUsage(accessToken, extractCodexAccountId(accessToken) || entry.accountId || secrets.accountId);
      break;
    }
    case 'opencode': {
      const providerId = entry.providerId || secrets.providerId || '';
      response = isCodexOAuthProvider(providerId)
        ? await fetchCodexUsage(accessToken, extractCodexAccountId(secrets.idToken, accessToken) || entry.accountId || secrets.accountId)
        : { raw: null, provider: 'opencode', statusCode: 200 };
      break;
    }
    default:
      return { quota: null, status: 'unsupported', error: `不支持的工具: ${tool}` };
  }
  if (response?.error) return { quota: null, status: 'unavailable', error: response.error };
  if (response?.statusCode === 401 || response?.statusCode === 403) {
    if (isCodexCredential(tool, entry) && !codexRefreshed) {
      const refreshed = await refreshCodexCredential(entry);
      if (refreshed.refreshed) {
        entry = refreshed.entry;
        secrets = entry.secrets || {};
        accessToken = secrets.accessToken || secrets.primaryToken || '';
        response = await fetchCodexUsage(
          accessToken,
          extractCodexAccountId(secrets.idToken, accessToken) || entry.accountId || secrets.accountId
        );
        if (response?.error) return { quota: null, status: 'unavailable', error: response.error };
        if (response?.statusCode !== 401 && response?.statusCode !== 403) {
          return normalizeOAuthQuota(tool, response?.raw);
        }
      }
    }
    return { quota: null, status: 'unauthorized', error: '上游 OAuth 授权已失效' };
  }
  return normalizeOAuthQuota(tool, response?.raw);
}

module.exports = {
  SUPPORTED_TOOLS,
  syncLocalCredential,
  restoreStoredOmpOAuthCredentials,
  normalizeOAuthQuota,
  fetchCredentialUsage,
  extractCodexAccountId,
  normalizeResetAt,
  normalizeWindow
};
