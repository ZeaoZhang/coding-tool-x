const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('../config/paths');
const claudeSettingsManager = require('./drivers/claude/native-config-implementation');
const codexSettingsManager = require('./drivers/codex/native-config-implementation');
const geminiSettingsManager = require('./drivers/gemini/native-config-implementation');
const opencodeSettingsManager = require('./drivers/opencode/native-config-implementation');
const {
  SUPPORTED_TOOLS,
  fingerprintFor,
  inspectTool,
  readAllNativeOAuth,
  clearNativeOAuth,
  disableNativeOAuthCredential,
  applyOAuthCredential
} = require('./native-oauth-adapters');
const { maskToken, decodeJwtPayload, removeFileIfExists } = require('../server/services/oauth-utils');

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

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractEnvValue(text, key) {
  const pattern = new RegExp(`${key}\\s*=\\s*([^\\n\\r]+)`);
  const match = String(text || '').match(pattern);
  return match ? safeString(match[1]).replace(/^['"]|['"]$/g, '') : '';
}

function parseClaudeImport(rawText) {
  const text = safeString(rawText);
  const parsed = tryParseJson(text);
  const payload = parsed?.claudeAiOauth && typeof parsed.claudeAiOauth === 'object'
    ? parsed.claudeAiOauth
    : parsed;

  if (payload && typeof payload === 'object') {
    const accessToken = safeString(
      payload.accessToken
      || payload.access_token
      || payload.authToken
      || payload.token
    );
    if (!accessToken) {
      throw new Error('Claude OAuth 导入缺少 accessToken。');
    }
    return {
      accessToken,
      refreshToken: safeString(payload.refreshToken || payload.refresh_token),
      expiresAt: safeNumber(payload.expiresAt || payload.expiry_date || payload.expiryDate),
      primaryToken: accessToken
    };
  }

  const envToken = extractEnvValue(text, 'ANTHROPIC_AUTH_TOKEN')
    || extractEnvValue(text, 'CLAUDE_CODE_OAUTH_TOKEN');
  if (envToken) {
    return {
      accessToken: envToken,
      refreshToken: '',
      expiresAt: null,
      primaryToken: envToken
    };
  }

  if (!text.includes('\n') && !text.includes(' ')) {
    return {
      accessToken: text,
      refreshToken: '',
      expiresAt: null,
      primaryToken: text
    };
  }

  throw new Error('无法识别 Claude OAuth 导入格式。');
}

function parseCodexImport(rawText) {
  const parsed = tryParseJson(rawText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Codex OAuth 仅支持 JSON 导入。');
  }

  const authPayload = parsed.tokens ? parsed : {
    auth_mode: parsed.auth_mode || 'chatgpt',
    tokens: parsed
  };
  const tokens = authPayload.tokens && typeof authPayload.tokens === 'object'
    ? authPayload.tokens
    : null;

  if (!tokens?.access_token) {
    throw new Error('Codex OAuth 导入缺少 tokens.access_token。');
  }

  const idTokenPayload = decodeJwtPayload(tokens.id_token);
  return {
    authMode: safeString(authPayload.auth_mode || 'chatgpt') || 'chatgpt',
    accessToken: safeString(tokens.access_token),
    refreshToken: safeString(tokens.refresh_token),
    idToken: safeString(tokens.id_token),
    accountId: safeString(tokens.account_id),
    accountEmail: safeString(idTokenPayload?.email),
    lastRefresh: authPayload.last_refresh || null,
    primaryToken: safeString(tokens.access_token)
  };
}

function parseGeminiImport(rawText) {
  const parsed = tryParseJson(rawText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini OAuth 仅支持 JSON 导入。');
  }

  const payload = parsed.token && typeof parsed.token === 'object'
    ? parsed
    : parsed.access_token
      ? {
          token: {
            accessToken: parsed.access_token,
            refreshToken: parsed.refresh_token || '',
            tokenType: parsed.token_type || 'Bearer',
            scope: parsed.scope || '',
            expiresAt: parsed.expiry_date || null
          }
        }
      : null;

  if (!payload?.token?.accessToken) {
    throw new Error('Gemini OAuth 导入缺少 access_token。');
  }

  return {
    accessToken: safeString(payload.token.accessToken),
    refreshToken: safeString(payload.token.refreshToken),
    tokenType: safeString(payload.token.tokenType || 'Bearer') || 'Bearer',
    scope: safeString(payload.token.scope),
    expiresAt: safeNumber(payload.token.expiresAt),
    accountEmail: safeString(parsed.accountEmail || parsed.email),
    primaryToken: safeString(payload.token.accessToken)
  };
}

function parseOpenCodeImport(rawText) {
  const parsed = tryParseJson(rawText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('OpenCode OAuth 仅支持 JSON 导入。');
  }

  const oauthEntry = parsed.openai && typeof parsed.openai === 'object'
    ? ['openai', parsed.openai]
    : Object.entries(parsed).find(([, value]) => value && typeof value === 'object' && value.type === 'oauth')
      || [parsed.providerId || 'openai', parsed];
  const providerId = safeString(oauthEntry[0]) || 'openai';
  const payload = oauthEntry[1];
  if (payload.type !== 'oauth' && !payload.access) {
    throw new Error('OpenCode OAuth 导入缺少 access 或 openai.oauth 结构。');
  }

  return {
    providerId,
    accessToken: safeString(payload.access),
    refreshToken: safeString(payload.refresh),
    expiresAt: safeNumber(payload.expires),
    accountId: safeString(payload.accountId),
    enterpriseUrl: safeString(payload.enterpriseUrl),
    primaryToken: safeString(payload.access)
  };
}

function pickOmpCredentialEntry(parsed) {
  if (Array.isArray(parsed)) {
    return parsed.find(item => item && typeof item === 'object') || null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  if (parsed.provider || parsed.providerId || parsed.provider_id || parsed.providerKey || parsed.credential_type || parsed.data) {
    return parsed;
  }
  const entry = Object.entries(parsed).find(([, value]) => value && typeof value === 'object');
  return entry ? { provider: entry[0], ...entry[1] } : parsed;
}

function parseOmpImport(rawText) {
  const parsed = tryParseJson(rawText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('OMP OAuth 仅支持 JSON 导入。');
  }

  const entry = pickOmpCredentialEntry(parsed);
  if (!entry || typeof entry !== 'object') {
    throw new Error('OMP OAuth 导入缺少 provider。');
  }

  const data = entry.data && typeof entry.data === 'object' ? entry.data : entry;
  const providerId = safeString(
    entry.providerId
    || entry.provider_id
    || entry.providerKey
    || entry.provider
    || data.providerId
    || data.provider
  );
  if (!providerId) {
    throw new Error('OMP OAuth 导入缺少 providerId。');
  }

  const accessToken = safeString(
    data.accessToken
    || data.access_token
    || data.access
    || data.token
    || data.authToken
  );
  const credentialType = safeString(entry.credentialType || entry.credential_type || data.type || 'oauth') || 'oauth';
  if (credentialType === 'oauth' && !accessToken && !entry.data) {
    throw new Error('OMP OAuth 导入缺少 access/accessToken。');
  }

  return {
    providerId,
    credentialType,
    accessToken,
    refreshToken: safeString(data.refreshToken || data.refresh_token || data.refresh),
    expiresAt: safeNumber(data.expiresAt || data.expiry_date || data.expiryDate || data.expires),
    accountId: safeString(data.accountId || data.account_id || entry.accountId || entry.account_id),
    accountEmail: safeString(data.accountEmail || data.email || entry.accountEmail || entry.email),
    identityKey: safeString(entry.identityKey || entry.identity_key || data.identityKey || data.identity_key),
    importPayload: parsed,
    primaryToken: accessToken
  };
}

function parseCredentialInput(tool, rawText) {
  switch (tool) {
    case 'claude':
      return parseClaudeImport(rawText);
    case 'codex':
      return parseCodexImport(rawText);
    case 'gemini':
      return parseGeminiImport(rawText);
    case 'opencode':
      return parseOpenCodeImport(rawText);
    case 'omp':
      return parseOmpImport(rawText);
    default:
      throw new Error(`Unsupported OAuth tool: ${tool}`);
  }
}

function buildCredentialName(tool, metadata, providedName = '') {
  const explicit = safeString(providedName);
  if (explicit) {
    return explicit;
  }

  if ((tool === 'opencode' || tool === 'omp') && safeString(metadata.providerId)) {
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
    case 'opencode':
      return {
        accessToken: metadata.accessToken || '',
        refreshToken: metadata.refreshToken || '',
        expiresAt: metadata.expiresAt || null,
        accountId: metadata.accountId || '',
        enterpriseUrl: metadata.enterpriseUrl || '',
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
    || ((tool === 'opencode' || tool === 'omp') ? metadata.providerId : '')
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

function getAllToolSummaries() {
  const store = readStore();
  return Object.fromEntries(SUPPORTED_TOOLS.map((tool) => {
    const toolStore = getToolStore(store, tool);
    return [tool, sanitizeToolSummary(tool, toolStore)];
  }));
}

function getToolSummary(tool) {
  const store = readStore();
  const toolStore = getToolStore(store, tool);
  return sanitizeToolSummary(tool, toolStore);
}

function importCredential(tool, payload = {}) {
  assertSupportedTool(tool);
  const raw = safeString(payload.raw);
  if (!raw) {
    throw new Error('缺少导入内容。');
  }

  const metadata = parseCredentialInput(tool, raw);
  return upsertCredential(tool, metadata, {
    name: payload.name,
    source: payload.source || 'manual'
  });
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

function setDefaultCredential(tool, credentialId) {
  const store = readStore();
  const toolStore = getToolStore(store, tool);
  const target = toolStore.credentials.find((item) => item.id === credentialId);
  if (!target) {
    throw new Error('OAuth 凭证不存在。');
  }

  toolStore.defaultCredentialId = credentialId;
  writeStore(store);
  return sanitizeToolSummary(tool, toolStore);
}

function deleteCredential(tool, credentialId) {
  const store = readStore();
  const toolStore = getToolStore(store, tool);
  const nextCredentials = toolStore.credentials.filter((item) => item.id !== credentialId);
  if (nextCredentials.length === toolStore.credentials.length) {
    throw new Error('OAuth 凭证不存在。');
  }

  toolStore.credentials = nextCredentials;
  if (toolStore.defaultCredentialId === credentialId) {
    toolStore.defaultCredentialId = nextCredentials[0]?.id || null;
  }

  writeStore(store);
  return sanitizeToolSummary(tool, toolStore);
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

function cleanupManagedArtifacts(tool) {
  removeFileIfExists(PATHS.activeChannel?.[tool]);

  if (tool === 'claude') {
    claudeSettingsManager.deleteBackup?.();
    return;
  }

  if (tool === 'codex') {
    codexSettingsManager.deleteBackup?.();
    return;
  }

  if (tool === 'gemini') {
    geminiSettingsManager.deleteBackup?.();
    return;
  }

  if (tool === 'opencode') {
    opencodeSettingsManager.deleteBackup?.();
    return;
  }

  if (tool === 'omp') {
    return;
  }
}

async function stopProxyIfRunning(tool) {
  switch (tool) {
    case 'claude': {
      const { stopProxyServer } = require('./drivers/claude/proxy-implementation');
      const { getProxyStatus } = require('./drivers/claude/proxy-implementation');
      if (getProxyStatus().running) {
        await stopProxyServer();
        return true;
      }
      return false;
    }
    case 'codex': {
      const { stopCodexProxyServer, getCodexProxyStatus } = require('./drivers/codex/proxy-implementation');
      if (getCodexProxyStatus().running) {
        await stopCodexProxyServer();
        return true;
      }
      return false;
    }
    case 'gemini': {
      const { stopGeminiProxyServer, getGeminiProxyStatus } = require('./drivers/gemini/proxy-implementation');
      if (getGeminiProxyStatus().running) {
        await stopGeminiProxyServer();
        return true;
      }
      return false;
    }
    case 'opencode': {
      const { stopOpenCodeProxyServer, getOpenCodeProxyStatus } = require('./drivers/opencode/proxy-implementation');
      if (getOpenCodeProxyStatus().running) {
        await stopOpenCodeProxyServer();
        return true;
      }
      return false;
    }
    case 'omp': {
      const { stopOmpProxyServer, getOmpProxyStatus } = require('./drivers/omp/proxy-implementation');
      if (getOmpProxyStatus().running) {
        await stopOmpProxyServer();
        return true;
      }
      return false;
    }
    default:
      throw new Error(`Unsupported OAuth tool: ${tool}`);
  }
}

function disableAllChannelsForTool(tool) {
  try {
    switch (tool) {
      case 'claude': {
        const { disableAllChannels } = require('./drivers/claude/channels-implementation');
        disableAllChannels();
        break;
      }
      case 'codex': {
        const { disableAllChannels } = require('./drivers/codex/channels-implementation');
        disableAllChannels();
        break;
      }
      case 'gemini': {
        const { disableAllChannels } = require('./drivers/gemini/channels-implementation');
        disableAllChannels();
        break;
      }
      case 'opencode': {
        const { disableAllChannels } = require('./drivers/opencode/channels-implementation');
        disableAllChannels();
        break;
      }
      case 'omp': {
        const { disableAllChannels } = require('./drivers/omp/channels-implementation');
        disableAllChannels();
        break;
      }
    }
  } catch (err) {
    console.warn(`[OAuth] Failed to disable channels for ${tool}:`, err.message);
  }
}

async function applyStoredCredential(tool, credentialId) {
  const entry = findStoredCredential(tool, credentialId);
  const proxyStopped = await stopProxyIfRunning(tool);
  cleanupManagedArtifacts(tool);
  if (tool !== 'opencode' && tool !== 'omp') {
    disableAllChannelsForTool(tool);
  }
  applyOAuthCredential(tool, entry.secrets);

  // 记录最近使用时间
  const store = readStore();
  const toolStore = getToolStore(store, tool);
  const stored = toolStore.credentials.find((item) => item.id === credentialId);
  if (stored) {
    stored.lastUsedAt = Date.now();
    writeStore(store);
  }

  return {
    proxyStopped,
    credential: sanitizeCredential(entry, readStore().tools[tool]?.defaultCredentialId || null),
    toolSummary: getToolSummary(tool)
  };
}

function disableStoredCredential(tool, credentialId) {
  assertSupportedTool(tool);
  const entry = findStoredCredential(tool, credentialId);
  disableNativeOAuthCredential(tool, {
    ...(entry.secrets || {}),
    providerId: entry.providerId || entry.secrets?.providerId || '',
    accountId: entry.accountId || entry.secrets?.accountId || ''
  });

  return {
    credential: sanitizeCredential(entry, readStore().tools[tool]?.defaultCredentialId || null),
    toolSummary: getToolSummary(tool),
    nativeState: inspectTool(tool)
  };
}

function clearNativeOAuthState(tool) {
  assertSupportedTool(tool);
  clearNativeOAuth(tool);
  return inspectTool(tool);
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

async function fetchCredentialUsage(tool, credentialId) {
  const entry = findStoredCredential(tool, credentialId);
  const secrets = entry.secrets || {};
  const accessToken = secrets.accessToken || secrets.primaryToken || '';

  if (!accessToken) {
    return { error: '无有效 token' };
  }

  switch (tool) {
    case 'claude':
      return await fetchClaudeUsage(accessToken);
    case 'codex':
      return await fetchCodexUsage(secrets.idToken || accessToken);
    case 'gemini':
      return await fetchGeminiUsage(accessToken);
    case 'opencode': {
      const providerId = entry.providerId || 'openai';
      if (providerId.includes('claude') || providerId.includes('anthropic')) {
        return await fetchClaudeUsage(accessToken);
      } else if (providerId.includes('gemini') || providerId.includes('google')) {
        return await fetchGeminiUsage(accessToken);
      } else {
        return await fetchCodexUsage(accessToken);
      }
    }
    case 'omp': {
      const providerId = entry.providerId || secrets.providerId || '';
      if (providerId.includes('claude') || providerId.includes('anthropic')) {
        return await fetchClaudeUsage(accessToken);
      } else if (providerId.includes('gemini') || providerId.includes('google')) {
        return await fetchGeminiUsage(accessToken);
      } else {
        return await fetchCodexUsage(accessToken);
      }
    }
    default:
      return { error: `不支持的工具: ${tool}` };
  }
}

module.exports = {
  SUPPORTED_TOOLS,
  getAllToolSummaries,
  getToolSummary,
  importCredential,
  syncLocalCredential,
  setDefaultCredential,
  deleteCredential,
  applyStoredCredential,
  disableStoredCredential,
  clearNativeOAuthState,
  fetchCredentialUsage
};
