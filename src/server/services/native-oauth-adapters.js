const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;
const { NATIVE_PATHS, PATHS } = require('../../config/paths');
const claudeSettingsManager = require('./settings-manager');
const codexSettingsManager = require('./codex-settings-manager');
const geminiSettingsManager = require('./gemini-settings-manager');
const opencodeSettingsManager = require('./opencode-settings-manager');
const { syncCodexUserEnvironment } = require('./codex-env-manager');
const nativeKeychain = require('./native-keychain');
const { maskToken, decodeJwtPayload, removeFileIfExists, sha256 } = require('./oauth-utils');

const SUPPORTED_TOOLS = ['claude', 'codex', 'gemini', 'opencode', 'omp'];
const GEMINI_MAIN_ACCOUNT_KEY = 'main-account';
const GEMINI_KEYCHAIN_SERVICE = 'gemini-cli-oauth';
const CODEX_KEYCHAIN_SERVICE = 'Codex Auth';

function ensureDir(dirPath) {
  if (!dirPath) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFileMode(filePath, mode = 0o600) {
  if (process.platform === 'win32') {
    return;
  }
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // ignore chmod failures
  }
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  ensureFileMode(filePath);
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function fingerprintFor(tool, value) {
  return sha256(`${tool}:${value || ''}`);
}

function loadChannelsFile(tool) {
  const filePath = PATHS.channels?.[tool];
  const payload = readJsonFile(filePath, { channels: [] });
  return Array.isArray(payload?.channels) ? payload.channels : [];
}

function buildNativeSummary(data = {}) {
  return {
    providerId: data.providerId || '',
    accountId: data.accountId || '',
    accountEmail: data.accountEmail || '',
    expiresAt: data.expiresAt || null,
    storage: data.storage || '',
    tokenPreview: maskToken(data.primaryToken || data.accessToken || ''),
    lastRefresh: data.lastRefresh || null
  };
}

function parseClaudeOAuthPayload(raw) {
  const parsed = raw?.claudeAiOauth && typeof raw.claudeAiOauth === 'object'
    ? raw.claudeAiOauth
    : raw;

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const accessToken = String(
    parsed.accessToken
      || parsed.access_token
      || parsed.authToken
      || parsed.token
      || ''
  ).trim();

  if (!accessToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken: String(parsed.refreshToken || parsed.refresh_token || '').trim() || '',
    expiresAt: Number(parsed.expiresAt || parsed.expiryDate || parsed.expiry_date || 0) || null,
    primaryToken: accessToken
  };
}

function getClaudeKeychainServiceName() {
  const oauthSuffix = process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL ? '-custom-oauth' : '';
  const customConfigDir = process.env.CLAUDE_CONFIG_DIR ? NATIVE_PATHS.claude.dir : '';
  const suffix = customConfigDir ? `-${sha256(customConfigDir).slice(0, 8)}` : '';
  return `Claude Code${oauthSuffix}-credentials${suffix}`;
}

function getClaudeKeychainAccountName() {
  return process.env.USER || os.userInfo().username;
}

function readClaudeNativeOAuth() {
  const keychainRaw = nativeKeychain.isSupported()
    ? nativeKeychain.getPassword(getClaudeKeychainServiceName(), getClaudeKeychainAccountName())
    : null;
  if (keychainRaw) {
    const parsed = parseClaudeOAuthPayload(readJsonFileFromString(keychainRaw));
    if (parsed) {
      return { ...parsed, storage: 'keychain' };
    }
  }

  const filePayload = readJsonFile(NATIVE_PATHS.claude.credentials, null);
  const parsedFile = parseClaudeOAuthPayload(filePayload);
  if (parsedFile) {
    return { ...parsedFile, storage: 'file' };
  }

  return null;
}

function clearClaudeOAuth() {
  if (nativeKeychain.isSupported()) {
    nativeKeychain.deletePassword(getClaudeKeychainServiceName(), getClaudeKeychainAccountName());
  }
  removeFileIfExists(NATIVE_PATHS.claude.credentials);

  let settings = {};
  try {
    settings = claudeSettingsManager.settingsExists()
      ? claudeSettingsManager.readSettings()
      : {};
  } catch {
    settings = {};
  }

  settings.env = settings.env || {};
  delete settings.env.ANTHROPIC_AUTH_TOKEN;
  delete settings.env.CLAUDE_CODE_OAUTH_TOKEN;
  claudeSettingsManager.writeSettings(settings);
}

function applyClaudeOAuth(credential) {
  clearClaudeOAuth();

  let settings = {};
  try {
    settings = claudeSettingsManager.settingsExists()
      ? claudeSettingsManager.readSettings()
      : {};
  } catch {
    settings = {};
  }

  settings.env = settings.env || {};
  delete settings.env.ANTHROPIC_API_KEY;
  delete settings.env.ANTHROPIC_BASE_URL;
  delete settings.env.ANTHROPIC_MODEL;
  delete settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  delete settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  delete settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  // 不删除 HTTP_PROXY / HTTPS_PROXY / NO_PROXY，这些是与 OAuth 无关的通用网络配置
  delete settings.apiKeyHelper;

  const wrappedPayload = {
    claudeAiOauth: {
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken || undefined,
      expiresAt: credential.expiresAt || undefined
    }
  };

  const rawPayload = JSON.stringify(wrappedPayload);
  const wroteKeychain = nativeKeychain.isSupported()
    ? nativeKeychain.setPassword(getClaudeKeychainServiceName(), getClaudeKeychainAccountName(), rawPayload)
    : false;

  if (!wroteKeychain) {
    writeJsonFile(NATIVE_PATHS.claude.credentials, wrappedPayload);
  }

  claudeSettingsManager.writeSettings(settings);
  return { storage: wroteKeychain ? 'keychain' : 'file' };
}

function inspectClaudeState() {
  const { getProxyStatus } = require('../proxy-server');
  const proxyStatus = getProxyStatus();
  const nativeOAuth = readClaudeNativeOAuth();

  let channelConfigured = false;
  try {
    const settings = claudeSettingsManager.settingsExists()
      ? claudeSettingsManager.readSettings()
      : {};
    const env = settings?.env || {};
    channelConfigured = Boolean(
      String(env.ANTHROPIC_API_KEY || '').trim()
      || String(env.ANTHROPIC_BASE_URL || '').trim()
      || String(settings.apiKeyHelper || '').trim()
    );
  } catch {
    channelConfigured = false;
  }

  return {
    tool: 'claude',
    mode: proxyStatus.running ? 'proxy' : (channelConfigured ? 'channel' : (nativeOAuth ? 'oauth' : 'idle')),
    proxyRunning: proxyStatus.running,
    oauthPresent: Boolean(nativeOAuth),
    channelConfigured,
    nativeCredential: nativeOAuth ? buildNativeSummary(nativeOAuth) : null
  };
}

function readJsonFileFromString(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getCodexKeychainAccount() {
  const codexHome = NATIVE_PATHS.codex.dir;
  const resolvedPath = fs.existsSync(codexHome)
    ? fs.realpathSync.native(codexHome)
    : path.resolve(codexHome);
  return `cli|${sha256(resolvedPath).slice(0, 16)}`;
}

function parseCodexAuthPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const auth = raw.tokens ? raw : {
    auth_mode: 'chatgpt',
    tokens: raw
  };

  const tokens = auth.tokens && typeof auth.tokens === 'object' ? auth.tokens : null;
  if (!tokens || !tokens.access_token) {
    return null;
  }

  const idTokenPayload = decodeJwtPayload(tokens.id_token);
  const accessTokenPayload = decodeJwtPayload(tokens.access_token);
  const exp = Number(idTokenPayload?.exp || accessTokenPayload?.exp || 0) || null;
  return {
    authMode: String(auth.auth_mode || 'chatgpt').trim() || 'chatgpt',
    accessToken: String(tokens.access_token || '').trim(),
    refreshToken: String(tokens.refresh_token || '').trim() || '',
    idToken: String(tokens.id_token || '').trim() || '',
    accountId: String(tokens.account_id || '').trim() || '',
    accountEmail: String(idTokenPayload?.email || '').trim() || '',
    expiresAt: exp ? exp * 1000 : null,
    lastRefresh: auth.last_refresh || null,
    primaryToken: String(tokens.access_token || '').trim()
  };
}

function readCodexKeychainAuth() {
  const raw = nativeKeychain.isSupported()
    ? nativeKeychain.getPassword(CODEX_KEYCHAIN_SERVICE, getCodexKeychainAccount())
    : null;
  if (!raw) {
    return null;
  }
  const parsed = parseCodexAuthPayload(readJsonFileFromString(raw));
  return parsed ? { ...parsed, storage: 'keychain' } : null;
}

function readCodexFileAuth() {
  const payload = readJsonFile(NATIVE_PATHS.codex.auth, null);
  const parsed = parseCodexAuthPayload(payload);
  return parsed ? { ...parsed, storage: 'auth-file' } : null;
}

function readCodexNativeOAuth() {
  return readCodexKeychainAuth() || readCodexFileAuth();
}

function clearCodexOAuth() {
  if (nativeKeychain.isSupported()) {
    nativeKeychain.deletePassword(CODEX_KEYCHAIN_SERVICE, getCodexKeychainAccount());
  }

  let auth = {};
  try {
    auth = codexSettingsManager.readAuth();
  } catch {
    auth = {};
  }
  delete auth.tokens;
  delete auth.auth_mode;
  delete auth.last_refresh;
  codexSettingsManager.writeAuth(auth);
}

function removeCodexChannelEnvVars() {
  syncCodexUserEnvironment({}, { replace: true });
}

function clearCodexChannelConfig() {
  removeCodexChannelEnvVars();

  const configPath = NATIVE_PATHS.codex.config;
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = toml.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      config = {};
    }
  }

  const managedProviderKeys = new Set(['cc-proxy']);
  loadChannelsFile('codex').forEach((channel) => {
    if (channel?.providerKey) {
      managedProviderKeys.add(channel.providerKey);
    }
  });

  if (config.model_provider && managedProviderKeys.has(config.model_provider)) {
    delete config.model_provider;
  }

  if (config.model_providers && typeof config.model_providers === 'object') {
    Object.keys(config.model_providers).forEach((providerKey) => {
      if (managedProviderKeys.has(providerKey)) {
        delete config.model_providers[providerKey];
      }
    });
    if (Object.keys(config.model_providers).length === 0) {
      delete config.model_providers;
    }
  }

  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, tomlStringify(config), 'utf8');
}

function applyCodexOAuth(credential) {
  clearCodexOAuth();
  clearCodexChannelConfig();

  const authPayload = {
    auth_mode: credential.authMode || 'chatgpt',
    tokens: {
      access_token: credential.accessToken,
      refresh_token: credential.refreshToken || '',
      id_token: credential.idToken || '',
      account_id: credential.accountId || ''
    },
    last_refresh: credential.lastRefresh || new Date().toISOString()
  };

  writeJsonFile(NATIVE_PATHS.codex.auth, authPayload);
  const wroteKeychain = nativeKeychain.isSupported()
    ? nativeKeychain.setPassword(CODEX_KEYCHAIN_SERVICE, getCodexKeychainAccount(), JSON.stringify(authPayload))
    : false;
  return { storage: wroteKeychain ? 'auth-file+keychain' : 'auth-file' };
}

function inspectCodexState() {
  const { getCodexProxyStatus } = require('../codex-proxy-server');
  const proxyStatus = getCodexProxyStatus();
  const nativeOAuth = readCodexNativeOAuth();

  let channelConfigured = false;
  try {
    const config = codexSettingsManager.readConfig();
    channelConfigured = Boolean(
      (config?.model_provider && config.model_provider !== 'cc-proxy')
      || (config?.model_providers && Object.keys(config.model_providers).length > 0)
    );
  } catch {
    channelConfigured = false;
  }

  return {
    tool: 'codex',
    mode: proxyStatus.running ? 'proxy' : (channelConfigured ? 'channel' : (nativeOAuth ? 'oauth' : 'idle')),
    proxyRunning: proxyStatus.running,
    oauthPresent: Boolean(nativeOAuth),
    channelConfigured,
    nativeCredential: nativeOAuth ? buildNativeSummary(nativeOAuth) : null
  };
}

function deriveGeminiEncryptionKey() {
  const salt = `${os.hostname()}-${os.userInfo().username}-gemini-cli`;
  return crypto.scryptSync(GEMINI_KEYCHAIN_SERVICE, salt, 32);
}

function encryptGeminiPayload(value) {
  const key = deriveGeminiEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptGeminiPayload(value) {
  const parts = String(value || '').split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const key = deriveGeminiEncryptionKey();
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function parseGeminiCredential(raw, googleAccounts = null) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const credential = raw.token && typeof raw.token === 'object'
    ? raw
    : raw.access_token
      ? {
          serverName: GEMINI_MAIN_ACCOUNT_KEY,
          token: {
            accessToken: raw.access_token,
            refreshToken: raw.refresh_token || '',
            tokenType: raw.token_type || 'Bearer',
            scope: raw.scope || '',
            expiresAt: raw.expiry_date || null
          },
          updatedAt: Date.now()
        }
      : null;

  if (!credential?.token?.accessToken) {
    return null;
  }

  return {
    accessToken: String(credential.token.accessToken || '').trim(),
    refreshToken: String(credential.token.refreshToken || '').trim() || '',
    tokenType: String(credential.token.tokenType || 'Bearer').trim() || 'Bearer',
    scope: String(credential.token.scope || '').trim() || '',
    expiresAt: Number(credential.token.expiresAt || 0) || null,
    accountEmail: String(googleAccounts?.active || '').trim() || '',
    primaryToken: String(credential.token.accessToken || '').trim()
  };
}

function readGeminiEncryptedCredential() {
  try {
    if (!fs.existsSync(NATIVE_PATHS.gemini.oauthCredentialsEncrypted)) {
      return null;
    }
    const encrypted = fs.readFileSync(NATIVE_PATHS.gemini.oauthCredentialsEncrypted, 'utf8');
    const decrypted = decryptGeminiPayload(encrypted);
    const payload = JSON.parse(decrypted);
    const googleAccounts = readJsonFile(NATIVE_PATHS.gemini.googleAccounts, null);
    return parseGeminiCredential(payload[GEMINI_MAIN_ACCOUNT_KEY], googleAccounts)
      || parseGeminiCredential(payload, googleAccounts);
  } catch {
    return null;
  }
}

function readGeminiKeychainCredential() {
  const raw = nativeKeychain.isSupported()
    ? nativeKeychain.getPassword(GEMINI_KEYCHAIN_SERVICE, GEMINI_MAIN_ACCOUNT_KEY)
    : null;
  if (!raw) {
    return null;
  }

  const googleAccounts = readJsonFile(NATIVE_PATHS.gemini.googleAccounts, null);
  const parsed = parseGeminiCredential(readJsonFileFromString(raw), googleAccounts);
  return parsed ? { ...parsed, storage: 'keychain' } : null;
}

function readGeminiLegacyCredential() {
  const payload = readJsonFile(NATIVE_PATHS.gemini.oauthCredentialsLegacy, null);
  const googleAccounts = readJsonFile(NATIVE_PATHS.gemini.googleAccounts, null);
  const parsed = parseGeminiCredential(payload, googleAccounts);
  return parsed ? { ...parsed, storage: 'legacy-file' } : null;
}

function readGeminiNativeOAuth() {
  const keychain = readGeminiKeychainCredential();
  if (keychain) {
    return keychain;
  }

  const encrypted = readGeminiEncryptedCredential();
  if (encrypted) {
    return { ...encrypted, storage: 'encrypted-file' };
  }
  return readGeminiLegacyCredential();
}

function clearGeminiOAuth() {
  if (nativeKeychain.isSupported()) {
    nativeKeychain.deletePassword(GEMINI_KEYCHAIN_SERVICE, GEMINI_MAIN_ACCOUNT_KEY);
  }
  removeFileIfExists(NATIVE_PATHS.gemini.oauthCredentialsEncrypted);
  removeFileIfExists(NATIVE_PATHS.gemini.oauthCredentialsLegacy);

  const googleAccounts = readJsonFile(NATIVE_PATHS.gemini.googleAccounts, null);
  if (googleAccounts && typeof googleAccounts === 'object') {
    googleAccounts.active = null;
    writeJsonFile(NATIVE_PATHS.gemini.googleAccounts, googleAccounts);
  }
}

function clearGeminiChannelConfig() {
  const env = geminiSettingsManager.configExists()
    ? geminiSettingsManager.readEnv()
    : {};
  delete env.GOOGLE_GEMINI_BASE_URL;
  delete env.GEMINI_API_KEY;
  delete env.GEMINI_MODEL;
  geminiSettingsManager.writeEnv(env);
}

function applyGeminiOAuth(credential) {
  clearGeminiOAuth();
  clearGeminiChannelConfig();

  const payload = {
    [GEMINI_MAIN_ACCOUNT_KEY]: {
      serverName: GEMINI_MAIN_ACCOUNT_KEY,
      token: {
        accessToken: credential.accessToken,
        refreshToken: credential.refreshToken || undefined,
        tokenType: credential.tokenType || 'Bearer',
        scope: credential.scope || undefined,
        expiresAt: credential.expiresAt || undefined
      },
      updatedAt: Date.now()
    }
  };

  ensureDir(path.dirname(NATIVE_PATHS.gemini.oauthCredentialsEncrypted));
  fs.writeFileSync(
    NATIVE_PATHS.gemini.oauthCredentialsEncrypted,
    encryptGeminiPayload(JSON.stringify(payload, null, 2)),
    'utf8'
  );
  ensureFileMode(NATIVE_PATHS.gemini.oauthCredentialsEncrypted);
  const wroteKeychain = nativeKeychain.isSupported()
    ? nativeKeychain.setPassword(
        GEMINI_KEYCHAIN_SERVICE,
        GEMINI_MAIN_ACCOUNT_KEY,
        JSON.stringify(payload[GEMINI_MAIN_ACCOUNT_KEY])
      )
    : false;

  const settings = geminiSettingsManager.settingsExists()
    ? geminiSettingsManager.readSettings()
    : {};
  settings.security = settings.security || {};
  settings.security.auth = settings.security.auth || {};
  settings.security.auth.selectedType = 'oauth-personal';
  geminiSettingsManager.writeSettings(settings);

  if (credential.accountEmail) {
    writeJsonFile(NATIVE_PATHS.gemini.googleAccounts, {
      active: credential.accountEmail,
      old: []
    });
  }

  return { storage: wroteKeychain ? 'encrypted-file+keychain' : 'encrypted-file' };
}

function inspectGeminiState() {
  const { getGeminiProxyStatus } = require('../gemini-proxy-server');
  const proxyStatus = getGeminiProxyStatus();
  const nativeOAuth = readGeminiNativeOAuth();

  let channelConfigured = false;
  try {
    const env = geminiSettingsManager.configExists()
      ? geminiSettingsManager.readEnv()
      : {};
    const settings = geminiSettingsManager.settingsExists()
      ? geminiSettingsManager.readSettings()
      : {};
    channelConfigured = Boolean(
      String(env.GOOGLE_GEMINI_BASE_URL || '').trim()
      || String(env.GEMINI_API_KEY || '').trim()
      || settings?.security?.auth?.selectedType === 'gemini-api-key'
    );
  } catch {
    channelConfigured = false;
  }

  return {
    tool: 'gemini',
    mode: proxyStatus.running ? 'proxy' : (channelConfigured ? 'channel' : (nativeOAuth ? 'oauth' : 'idle')),
    proxyRunning: proxyStatus.running,
    oauthPresent: Boolean(nativeOAuth),
    channelConfigured,
    nativeCredential: nativeOAuth ? buildNativeSummary(nativeOAuth) : null
  };
}

function parseOpenCodeOAuthPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  if (raw.type === 'oauth' || raw.access) {
    return parseOpenCodeOAuthEntry(raw.providerId, raw);
  }

  if (raw.openai && typeof raw.openai === 'object') {
    return parseOpenCodeOAuthEntry('openai', raw.openai);
  }

  for (const [providerId, value] of Object.entries(raw)) {
    const parsed = parseOpenCodeOAuthEntry(providerId, value);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function parseOpenCodeOAuthEntry(providerId, target) {
  const normalizedProviderId = String(providerId || 'openai').trim() || 'openai';

  if (!target || target.type !== 'oauth' || !target.access) {
    return null;
  }

  return {
    providerId: normalizedProviderId,
    accessToken: String(target.access || '').trim(),
    refreshToken: String(target.refresh || '').trim() || '',
    expiresAt: Number(target.expires || 0) || null,
    accountId: String(target.accountId || '').trim() || '',
    enterpriseUrl: String(target.enterpriseUrl || '').trim() || '',
    primaryToken: String(target.access || '').trim()
  };
}

function getActiveOpenCodeProviderId() {
  try {
    const configPath = opencodeSettingsManager.selectConfigPath();
    if (!configPath || !fs.existsSync(configPath)) {
      return '';
    }

    const config = opencodeSettingsManager.readConfig(configPath);
    const modelRef = String(config?.model || '').trim();
    if (modelRef.includes('/')) {
      return modelRef.split('/')[0].trim();
    }

    const providerIds = config?.provider && typeof config.provider === 'object'
      ? Object.keys(config.provider).filter(Boolean)
      : [];
    return providerIds.length === 1 ? providerIds[0] : '';
  } catch {
    return '';
  }
}

function readAllOpenCodeNativeOAuth() {
  const payload = readJsonFile(NATIVE_PATHS.opencode.auth, null);
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const activeProviderId = getActiveOpenCodeProviderId();
  const credentials = Object.entries(payload)
    .map(([providerId, value]) => parseOpenCodeOAuthEntry(providerId, value))
    .filter(Boolean)
    .map((entry) => ({ ...entry, storage: 'auth-file' }));

  if (!activeProviderId || credentials.length <= 1) {
    return credentials;
  }

  return credentials.sort((left, right) => {
    if (left.providerId === activeProviderId) return -1;
    if (right.providerId === activeProviderId) return 1;
    return left.providerId.localeCompare(right.providerId);
  });
}

function readOpenCodeNativeOAuth() {
  return readAllOpenCodeNativeOAuth()[0] || null;
}

function clearOpenCodeOAuth() {
  const payload = readJsonFile(NATIVE_PATHS.opencode.auth, {});
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const removedProviderIds = [];
  Object.keys(payload).forEach((providerId) => {
    if (payload[providerId]?.type === 'oauth') {
      removedProviderIds.push(providerId);
      delete payload[providerId];
    }
  });

  if (Object.keys(payload).length === 0) {
    removeFileIfExists(NATIVE_PATHS.opencode.auth);
  } else {
    writeJsonFile(NATIVE_PATHS.opencode.auth, payload);
  }

  syncOpenCodeConfigAfterOAuthRemoval(removedProviderIds);
}

function disableOpenCodeOAuthCredential(credential = {}) {
  const providerId = String(credential.providerId || '').trim();
  const accessToken = String(credential.accessToken || credential.primaryToken || '').trim();
  const payload = readJsonFile(NATIVE_PATHS.opencode.auth, {});
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const removedProviderIds = [];
  Object.keys(payload).forEach((key) => {
    const target = payload[key];
    if (!target || target.type !== 'oauth') {
      return;
    }

    const providerMatched = providerId && key === providerId;
    const tokenMatched = accessToken && String(target.access || '').trim() === accessToken;
    if (providerMatched || tokenMatched) {
      removedProviderIds.push(key);
      delete payload[key];
    }
  });

  if (Object.keys(payload).length === 0) {
    removeFileIfExists(NATIVE_PATHS.opencode.auth);
  } else {
    writeJsonFile(NATIVE_PATHS.opencode.auth, payload);
  }

  syncOpenCodeConfigAfterOAuthRemoval(removedProviderIds);
}

function isManagedOpenCodeProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    return false;
  }

  if (provider.__ctx_managed__ === true) {
    return true;
  }

  const apiKey = String(provider?.options?.apiKey || '').trim();
  const baseUrl = String(provider?.options?.baseURL || '').trim();
  return apiKey === 'PROXY_KEY' && (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost'));
}

function isProxyBackedOpenCodeProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    return false;
  }

  const apiKey = String(provider?.options?.apiKey || '').trim();
  const baseUrl = String(provider?.options?.baseURL || '').trim();
  return apiKey === 'PROXY_KEY' && (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost'));
}

function isMeaningfulOpenCodeProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    return false;
  }

  if (provider.__ctx_managed__ === true) {
    return true;
  }

  if (typeof provider.npm === 'string' && provider.npm.trim()) {
    return true;
  }

  if (typeof provider.name === 'string' && provider.name.trim()) {
    return true;
  }

  if (provider.options && typeof provider.options === 'object' && Object.keys(provider.options).length > 0) {
    return true;
  }

  if (provider.models && typeof provider.models === 'object' && Object.keys(provider.models).length > 0) {
    return true;
  }

  return false;
}

function clearOpenCodeManagedModelSelection(config) {
  const modelRef = String(config?.model || '').trim();
  if (!modelRef || !modelRef.includes('/')) {
    return;
  }

  const providerId = modelRef.split('/')[0].trim();
  if (!providerId) {
    return;
  }

  const provider = config?.provider?.[providerId];
  if (isManagedOpenCodeProvider(provider)) {
    delete config.model;
  }
}

function getConfiguredOpenCodeProviderId(config) {
  const modelRef = String(config?.model || '').trim();
  if (modelRef.includes('/')) {
    return modelRef.split('/')[0].trim();
  }

  const providerIds = config?.provider && typeof config.provider === 'object'
    ? Object.keys(config.provider).filter(Boolean)
    : [];
  return providerIds.length === 1 ? providerIds[0] : '';
}

function buildOpenCodeModelRef(providerId, provider) {
  if (!providerId || !provider || typeof provider !== 'object') {
    return '';
  }

  const modelIds = provider.models && typeof provider.models === 'object'
    ? Object.keys(provider.models).filter(Boolean)
    : [];

  if (modelIds.length === 0) {
    return '';
  }

  return `${providerId}/${modelIds[0]}`;
}

function pickFallbackOpenCodeModel(config, excludedProviderIds = new Set()) {
  const providers = config?.provider && typeof config.provider === 'object'
    ? Object.entries(config.provider)
    : [];

  for (const [providerId, provider] of providers) {
    if (excludedProviderIds.has(providerId)) {
      continue;
    }

    const modelRef = buildOpenCodeModelRef(providerId, provider);
    if (modelRef) {
      return modelRef;
    }
  }

  return '';
}

function syncOpenCodeConfigAfterOAuthRemoval(removedProviderIds = []) {
  const removedIds = new Set((removedProviderIds || []).filter(Boolean));
  if (removedIds.size === 0) {
    return;
  }

  const configPath = opencodeSettingsManager.selectConfigPath();
  if (!configPath || !fs.existsSync(configPath)) {
    return;
  }

  let config = {};
  try {
    config = opencodeSettingsManager.readConfig(configPath);
  } catch {
    return;
  }

  config = config && typeof config === 'object' ? config : {};
  config.provider = config.provider && typeof config.provider === 'object' ? config.provider : {};

  let changed = false;
  for (const providerId of removedIds) {
    const provider = config.provider[providerId];
    if (provider && !isMeaningfulOpenCodeProvider(provider)) {
      delete config.provider[providerId];
      changed = true;
    }
  }

  const activeProviderId = getConfiguredOpenCodeProviderId(config);
  if (activeProviderId && removedIds.has(activeProviderId)) {
    const activeProvider = config.provider[activeProviderId];
    if (!isMeaningfulOpenCodeProvider(activeProvider)) {
      const fallbackModel = pickFallbackOpenCodeModel(config, removedIds);
      if (fallbackModel) {
        config.model = fallbackModel;
      } else {
        delete config.model;
      }
      changed = true;
    }
  }

  if (Object.keys(config.provider).length === 0) {
    delete config.provider;
    changed = true;
  }

  if (changed) {
    opencodeSettingsManager.writeConfig(configPath, config);
  }
}

function applyOpenCodeOAuth(credential) {
  const providerId = String(credential.providerId || 'openai').trim() || 'openai';
  const payload = readJsonFile(NATIVE_PATHS.opencode.auth, {});
  payload[providerId] = {
    type: 'oauth',
    access: credential.accessToken,
    refresh: credential.refreshToken || '',
    expires: credential.expiresAt || null,
    accountId: credential.accountId || undefined,
    enterpriseUrl: credential.enterpriseUrl || undefined
  };
  writeJsonFile(NATIVE_PATHS.opencode.auth, payload);

  const configPath = opencodeSettingsManager.selectConfigPath();
  const config = fs.existsSync(configPath)
    ? opencodeSettingsManager.readConfig(configPath)
    : {};
  config.provider = config.provider && typeof config.provider === 'object' ? config.provider : {};
  config.provider[providerId] = config.provider[providerId] && typeof config.provider[providerId] === 'object'
    ? config.provider[providerId]
    : {};
  // Preserve existing ctx-managed API providers for OpenCode coexistence, but
  // drop the active managed selection so OAuth-backed providers become available.
  clearOpenCodeManagedModelSelection(config);
  opencodeSettingsManager.writeConfig(configPath, config);

  return { storage: 'auth-file' };
}

function inspectOpenCodeState() {
  const { getOpenCodeProxyStatus } = require('../opencode-proxy-server');
  const proxyStatus = getOpenCodeProxyStatus();
  const nativeOAuth = readOpenCodeNativeOAuth();

  let channelConfigured = false;
  try {
    const configPath = opencodeSettingsManager.selectConfigPath();
    const config = fs.existsSync(configPath)
      ? opencodeSettingsManager.readConfig(configPath)
      : {};
    const providers = config?.provider && typeof config.provider === 'object'
      ? Object.values(config.provider)
      : [];
    channelConfigured = providers.some(provider => (
      isMeaningfulOpenCodeProvider(provider) && !isProxyBackedOpenCodeProvider(provider)
    ));
  } catch {
    channelConfigured = false;
  }

  return {
    tool: 'opencode',
    mode: proxyStatus.running
      ? 'proxy'
      : (nativeOAuth && channelConfigured
          ? 'mixed'
          : (nativeOAuth ? 'oauth' : (channelConfigured ? 'channel' : 'idle'))),
    proxyRunning: proxyStatus.running,
    oauthPresent: Boolean(nativeOAuth),
    channelConfigured,
    nativeCredential: nativeOAuth ? buildNativeSummary(nativeOAuth) : null
  };
}

function resolveOmpRuntime() {
  try {
    const ompConfig = require('./omp-config');
    const runtime = ompConfig.resolveOmpRuntime(process.env, {});
    return runtime && runtime.runtime === 'omp' && runtime.installed ? runtime : null;
  } catch {
    return null;
  }
}

function runOmpCommand(args = [], options = {}) {
  const runtime = options.runtime || resolveOmpRuntime();
  if (!runtime) {
    return { ok: false, status: 127, stdout: '', stderr: 'OMP CLI not installed' };
  }

  const result = spawnSync(runtime.command, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env || {})
    },
    timeout: options.timeout || 10000
  });
  const status = result?.status === undefined || result?.status === null ? 0 : result.status;
  return {
    ok: !result?.error && status === 0,
    status,
    stdout: String(result?.stdout || ''),
    stderr: String(result?.stderr || ''),
    error: result?.error || null,
    command: runtime.command
  };
}

function getOmpAuthSnapshot(options = {}) {
  try {
    const { getOmpAuthProviderSnapshot } = require('./omp-auth-providers');
    return getOmpAuthProviderSnapshot({
      accountCheck: true,
      includeStatus: false,
      ...options
    });
  } catch {
    return null;
  }
}

function readAllOmpNativeOAuth() {
  const snapshot = getOmpAuthSnapshot({ forceRefresh: true });
  if (!snapshot?.available || !Array.isArray(snapshot.providers)) {
    return [];
  }

  return snapshot.providers
    .filter(provider => provider?.loggedIn || Number(provider?.accountCount || 0) > 0)
    .flatMap((provider) => {
      const accounts = Array.isArray(provider.accounts) && provider.accounts.length > 0
        ? provider.accounts
        : [{ index: 1, identity: '' }];
      return accounts.map((account) => ({
        providerId: provider.id,
        accountId: String(account.index || '').trim(),
        accountEmail: String(account.identity || '').trim(),
        storage: 'auth-broker',
        primaryToken: ''
      }));
    });
}

function readOmpNativeOAuth() {
  return readAllOmpNativeOAuth()[0] || null;
}

function clearOmpOAuth() {
  const credentials = readAllOmpNativeOAuth();
  const providerIds = [...new Set(credentials.map(item => item.providerId).filter(Boolean))];
  providerIds.forEach((providerId) => {
    runOmpCommand(['auth-broker', 'logout', providerId], { timeout: 10000 });
  });
  try {
    require('./omp-auth-providers').clearOmpAuthProviderCache();
  } catch {
    // cache invalidation is best-effort
  }
}

function disableOmpOAuthCredential(credential = {}) {
  const providerId = String(credential.providerId || '').trim();
  if (!providerId) {
    clearOmpOAuth();
    return;
  }
  runOmpCommand(['auth-broker', 'logout', providerId], { timeout: 10000 });
  try {
    require('./omp-auth-providers').clearOmpAuthProviderCache();
  } catch {
    // cache invalidation is best-effort
  }
}

function buildOmpImportPayload(credential = {}) {
  if (credential.importPayload && typeof credential.importPayload === 'object') {
    return credential.importPayload;
  }

  const access = String(credential.accessToken || credential.primaryToken || '').trim();
  if (!access) {
    return null;
  }

  return {
    provider: credential.providerId,
    credential_type: credential.credentialType || 'oauth',
    identity_key: credential.identityKey || credential.accountId || credential.accountEmail || undefined,
    data: {
      access,
      refresh: credential.refreshToken || '',
      expires: credential.expiresAt || null,
      accountId: credential.accountId || undefined,
      accountEmail: credential.accountEmail || undefined
    }
  };
}

function hasOmpNativeCredential(providerId) {
  return readAllOmpNativeOAuth().some((entry) => (
    !providerId || entry.providerId === providerId
  ));
}

function applyOmpOAuth(credential = {}) {
  const providerId = String(credential.providerId || '').trim();
  if (!providerId) {
    throw new Error('OMP OAuth credential requires providerId');
  }

  const payload = buildOmpImportPayload(credential);
  if (!payload) {
    if (hasOmpNativeCredential(providerId)) {
      return { storage: 'auth-broker-existing' };
    }
    throw new Error('OMP OAuth credential requires an import payload or access token');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-omp-oauth-'));
  const tempPath = path.join(tempDir, `${providerId}.json`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    ensureFileMode(tempPath);
    const result = runOmpCommand(['auth-broker', 'import', tempPath, '--provider', providerId], { timeout: 15000 });
    if (!result.ok) {
      const detail = result.stderr.trim() || result.stdout.trim() || result.error?.message || `exit code ${result.status}`;
      throw new Error(`OMP auth-broker import failed: ${detail}`);
    }
    try {
      require('./omp-auth-providers').clearOmpAuthProviderCache();
    } catch {
      // cache invalidation is best-effort
    }
    return { storage: 'auth-broker' };
  } finally {
    try {
      removeFileIfExists(tempPath);
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

function inspectOmpState() {
  const { getOmpProxyStatus } = require('../omp-proxy-server');
  const { isManagedOmpProvidersActive } = require('./omp-settings-manager');
  const proxyStatus = getOmpProxyStatus();
  const nativeCredentials = readAllOmpNativeOAuth();

  let channelConfigured = false;
  try {
    channelConfigured = Boolean(isManagedOmpProvidersActive());
  } catch {
    channelConfigured = false;
  }

  return {
    tool: 'omp',
    mode: proxyStatus.running || channelConfigured
      ? 'proxy'
      : (nativeCredentials.length > 0 ? 'oauth' : 'idle'),
    proxyRunning: Boolean(proxyStatus.running || channelConfigured),
    oauthPresent: nativeCredentials.length > 0,
    channelConfigured,
    nativeCredential: nativeCredentials[0] ? buildNativeSummary(nativeCredentials[0]) : null
  };
}

function inspectTool(tool) {
  switch (tool) {
    case 'claude':
      return inspectClaudeState();
    case 'codex':
      return inspectCodexState();
    case 'gemini':
      return inspectGeminiState();
    case 'opencode':
      return inspectOpenCodeState();
    case 'omp':
      return inspectOmpState();
    default:
      throw new Error(`Unsupported OAuth tool: ${tool}`);
  }
}

function readNativeOAuth(tool) {
  switch (tool) {
    case 'claude':
      return readClaudeNativeOAuth();
    case 'codex':
      return readCodexNativeOAuth();
    case 'gemini':
      return readGeminiNativeOAuth();
    case 'opencode':
      return readOpenCodeNativeOAuth();
    case 'omp':
      return readOmpNativeOAuth();
    default:
      throw new Error(`Unsupported OAuth tool: ${tool}`);
  }
}

function readAllNativeOAuth(tool) {
  switch (tool) {
    case 'claude': {
      const credential = readClaudeNativeOAuth();
      return credential ? [credential] : [];
    }
    case 'codex': {
      const credential = readCodexNativeOAuth();
      return credential ? [credential] : [];
    }
    case 'gemini': {
      const credential = readGeminiNativeOAuth();
      return credential ? [credential] : [];
    }
    case 'opencode':
      return readAllOpenCodeNativeOAuth();
    case 'omp':
      return readAllOmpNativeOAuth();
    default:
      throw new Error(`Unsupported OAuth tool: ${tool}`);
  }
}

function clearNativeOAuth(tool) {
  switch (tool) {
    case 'claude':
      clearClaudeOAuth();
      return;
    case 'codex':
      clearCodexOAuth();
      return;
    case 'gemini':
      clearGeminiOAuth();
      return;
    case 'opencode':
      clearOpenCodeOAuth();
      return;
    case 'omp':
      clearOmpOAuth();
      return;
    default:
      throw new Error(`Unsupported OAuth tool: ${tool}`);
  }
}

function disableNativeOAuthCredential(tool, credential = {}) {
  switch (tool) {
    case 'claude':
      clearClaudeOAuth();
      return;
    case 'codex':
      clearCodexOAuth();
      return;
    case 'gemini':
      clearGeminiOAuth();
      return;
    case 'opencode':
      disableOpenCodeOAuthCredential(credential);
      return;
    case 'omp':
      disableOmpOAuthCredential(credential);
      return;
    default:
      throw new Error(`Unsupported OAuth tool: ${tool}`);
  }
}

function applyOAuthCredential(tool, credential) {
  switch (tool) {
    case 'claude':
      return applyClaudeOAuth(credential);
    case 'codex':
      return applyCodexOAuth(credential);
    case 'gemini':
      return applyGeminiOAuth(credential);
    case 'opencode':
      return applyOpenCodeOAuth(credential);
    case 'omp':
      return applyOmpOAuth(credential);
    default:
      throw new Error(`Unsupported OAuth tool: ${tool}`);
  }
}

module.exports = {
  SUPPORTED_TOOLS,
  fingerprintFor,
  inspectTool,
  readNativeOAuth,
  readAllNativeOAuth,
  clearNativeOAuth,
  disableNativeOAuthCredential,
  applyOAuthCredential
};
