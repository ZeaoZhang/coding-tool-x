const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('../config/paths');
const {
  inspectTool,
  SUPPORTED_TOOLS,
  fingerprintFor,
  readAllNativeOAuth
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

async function fetchClaudeUsage(accessToken) {
  try {
    const result = await httpGet('https://api.anthropic.com/api/oauth/usage', {
      'Authorization': `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'anthropic-version': '2023-06-01',
      'User-Agent': 'claude-cli/1.0'
    });
    const data = JSON.parse(result.body);
    return { raw: data, provider: 'claude', statusCode: result.statusCode };
  } catch (err) {
    return { error: err.message, provider: 'claude' };
  }
}

async function fetchCodexUsage(accessToken) {
  // Codex uses JWT id_token; decode it to extract user info directly
  try {
    const { decodeJwtPayload } = require('../server/services/oauth-utils');
    const payload = decodeJwtPayload(accessToken);
    if (payload && (payload.email || payload.sub)) {
      return {
        raw: {
          email: payload.email || '',
          accountId: payload.sub || '',
          name: payload.name || ''
        },
        provider: 'codex',
        statusCode: 200
      };
    }
  } catch (_) {
    // fall through to API call
  }
  try {
    const result = await httpGet('https://api.openai.com/v1/me', {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'openai-node/4.0.0'
    });
    const data = JSON.parse(result.body);
    return { raw: data, provider: 'codex', statusCode: result.statusCode };
  } catch (err) {
    return { error: err.message, provider: 'codex' };
  }
}

async function fetchGeminiUsage(accessToken) {
  try {
    const body = JSON.stringify({
      metadata: {
        ideType: 'ANTIGRAVITY',
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
    const data = JSON.parse(result.body);
    return { raw: data, provider: 'gemini', statusCode: result.statusCode };
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

function normalizeWindow(window, label) {
  if (!window || typeof window !== 'object') return null;
  const usedPercent = clampPercent(window.used_percent ?? window.utilization);
  if (usedPercent === null) return null;
  return {
    label,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    usedPercent,
    resetsAt: window.reset_at || window.resetAt || null
  };
}

function normalizeOAuthQuota(tool, raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  let primary = normalizeWindow(value.five_hour || value.fiveHour, '5h');
  let secondary = normalizeWindow(value.seven_day || value.sevenDay, '7d');
  const rateLimit = value.rate_limit || value.rateLimit;
  if (rateLimit) {
    primary = primary || normalizeWindow(rateLimit.primary_window || rateLimit.primaryWindow, '5h');
    secondary = secondary || normalizeWindow(rateLimit.secondary_window || rateLimit.secondaryWindow, '7d');
  }
  if (!primary && !secondary) {
    return { quota: null, status: 'unsupported', warning: `${tool}: provider did not return 5h/7d quota windows` };
  }
  return { quota: { status: 'available', primary, secondary }, status: 'available' };
}

async function fetchCredentialUsage(tool, credentialId) {
  const entry = findStoredCredential(tool, credentialId);
  const secrets = entry.secrets || {};
  const accessToken = secrets.accessToken || secrets.primaryToken || '';
  if (!accessToken) return { error: '无有效 token' };

  let response;
  switch (tool) {
    case 'claude':
      response = await fetchClaudeUsage(accessToken);
      break;
    case 'codex':
      response = await fetchCodexUsage(secrets.idToken || accessToken);
      break;
    case 'gemini':
      response = await fetchGeminiUsage(accessToken);
      break;
    case 'omp': {
      const providerId = entry.providerId || secrets.providerId || '';
      response = providerId.includes('claude') || providerId.includes('anthropic')
        ? await fetchClaudeUsage(accessToken)
        : providerId.includes('gemini') || providerId.includes('google')
          ? await fetchGeminiUsage(accessToken)
          : await fetchCodexUsage(accessToken);
      break;
    }
    default:
      return { quota: null, status: 'unsupported', error: `不支持的工具: ${tool}` };
  }
  if (response?.error) return { quota: null, status: 'unavailable', error: response.error };
  if (response?.statusCode === 401 || response?.statusCode === 403) {
    return { quota: null, status: 'unauthorized', error: '上游 OAuth 授权已失效' };
  }
  return normalizeOAuthQuota(tool, response?.raw);
}

module.exports = {
  SUPPORTED_TOOLS,
  syncLocalCredential,
  normalizeOAuthQuota,
  fetchCredentialUsage
};
