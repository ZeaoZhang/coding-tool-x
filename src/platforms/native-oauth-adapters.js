const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const toml = require('toml');
const { writeTomlFile } = require('../utils/native-config-patcher');
const pathsModule = require('../config/paths');
const DEFAULT_NATIVE_PATHS = pathsModule.NATIVE_PATHS;
const DEFAULT_PATHS = pathsModule.PATHS;
let NATIVE_PATHS = DEFAULT_NATIVE_PATHS;
let PATHS = DEFAULT_PATHS;
const claudeSettingsManager = require('./drivers/claude/native-config-implementation');
const codexSettingsManager = require('./drivers/codex/native-config-implementation');
const geminiSettingsManager = require('./drivers/gemini/native-config-implementation');
const { syncCodexUserEnvironment } = require('./drivers/codex/env-manager');
const nativeKeychain = require('../server/services/native-keychain');
const { maskToken, decodeJwtPayload, removeFileIfExists, sha256 } = require('../server/services/oauth-utils');

const SUPPORTED_TOOLS = ['claude', 'codex', 'gemini', 'omp', 'opencode'];
const GEMINI_MAIN_ACCOUNT_KEY = 'main-account';
const GEMINI_KEYCHAIN_SERVICE = 'gemini-cli-oauth';
const CODEX_KEYCHAIN_SERVICE = 'Codex Auth';

function configure({ pathContext } = {}) {
  if (!pathContext?.customized) {
    NATIVE_PATHS = DEFAULT_NATIVE_PATHS;
    PATHS = DEFAULT_PATHS;
    return;
  }

  const platform = String(pathContext.platform || '').trim().toLowerCase();
  const native = pathContext.native && typeof pathContext.native === 'object'
    ? pathContext.native
    : {};
  const state = pathContext.state && typeof pathContext.state === 'object'
    ? pathContext.state
    : {};
  NATIVE_PATHS = {
    ...DEFAULT_NATIVE_PATHS,
    ...(platform ? { [platform]: { ...(DEFAULT_NATIVE_PATHS[platform] || {}), ...native } } : {})
  };
  PATHS = {
    ...DEFAULT_PATHS,
    channels: {
      ...(DEFAULT_PATHS.channels || {}),
      ...(platform && state.channels ? { [platform]: state.channels } : {})
    }
  };
}

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
  ensureDir(path.dirname(NATIVE_PATHS.claude.settings));
  claudeSettingsManager.writeSettings(settings);
}
function clearClaudeChannelConfig(managedProxyUrls = []) {
  if (!claudeSettingsManager.settingsExists()) return;
  const settings = claudeSettingsManager.readSettings();
  if (settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env)) {
    [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL'
    ].forEach((key) => {
      delete settings.env[key];
    });
    const managedProxies = new Set((Array.isArray(managedProxyUrls) ? managedProxyUrls : [])
      .map(value => String(value || '').trim()).filter(Boolean));
    ['HTTP_PROXY', 'HTTPS_PROXY'].forEach((key) => {
      if (managedProxies.has(String(settings.env[key] || '').trim())) delete settings.env[key];
    });
    if (Object.keys(settings.env).length === 0) delete settings.env;
  }
  delete settings.apiKeyHelper;
  ensureDir(path.dirname(NATIVE_PATHS.claude.settings));
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
  const { getProxyStatus } = require('./drivers/claude/proxy-implementation');
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

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

function extractTokenMetadata(...tokens) {
  const payloads = tokens
    .filter(Boolean)
    .map(token => decodeJwtPayload(token))
    .filter(payload => payload && typeof payload === 'object');
  const payload = payloads.find(item => (
    item.chatgpt_account_id
      || item['https://api.openai.com/auth.chatgpt_account_id']
      || item['https://api.openai.com/auth']?.chatgpt_account_id
      || item.email
  )) || payloads[0] || {};
  const auth = payload['https://api.openai.com/auth'] || {};
  const profile = payload['https://api.openai.com/profile'] || {};
  const accountId = firstString(
    payload.chatgpt_account_id,
    payload['https://api.openai.com/auth.chatgpt_account_id'],
    auth.chatgpt_account_id,
    payload.account_id,
    payload.organizations?.[0]?.id
  );
  const accountEmail = firstString(
    payload.email,
    profile.email,
    auth.email
  );
  const exp = Number(payload.exp || 0);
  return {
    accountId,
    accountEmail,
    expiresAt: Number.isFinite(exp) && exp > 0 ? exp * 1000 : null
  };
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
  const tokenMetadata = extractTokenMetadata(tokens.id_token, tokens.access_token);
  // The id token can expire before the access token. Use the newest usable
  // expiry so a still-valid access token is not unnecessarily refreshed.
  const exp = Math.max(
    Number(idTokenPayload?.exp || 0),
    Number(accessTokenPayload?.exp || 0)
  ) || null;
  const accountId = tokens.account_id
    || idTokenPayload?.chatgpt_account_id
    || accessTokenPayload?.chatgpt_account_id
    || idTokenPayload?.['https://api.openai.com/auth.chatgpt_account_id']
    || accessTokenPayload?.['https://api.openai.com/auth.chatgpt_account_id']
    || idTokenPayload?.['https://api.openai.com/auth']?.chatgpt_account_id
    || accessTokenPayload?.['https://api.openai.com/auth']?.chatgpt_account_id
    || idTokenPayload?.organizations?.[0]?.id
    || accessTokenPayload?.organizations?.[0]?.id
    || '';
  return {
    authMode: String(auth.auth_mode || 'chatgpt').trim() || 'chatgpt',
    accessToken: String(tokens.access_token || '').trim(),
    refreshToken: String(tokens.refresh_token || '').trim() || '',
    idToken: String(tokens.id_token || '').trim() || '',
    accountId: String(accountId).trim(),
    accountEmail: tokenMetadata.accountEmail,
    expiresAt: exp ? exp * 1000 : tokenMetadata.expiresAt,
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
  const keychain = readCodexKeychainAuth();
  const file = readCodexFileAuth();
  if (!keychain) return file;
  if (!file) return keychain;

  const recency = (credential) => {
    const lastRefresh = Date.parse(credential.lastRefresh || '') || 0;
    const expiresAt = Number(credential.expiresAt || 0);
    return lastRefresh || (Number.isFinite(expiresAt) ? expiresAt : 0);
  };

  // Codex stores the same auth payload in the keychain and auth.json. When
  // they diverge, prefer the copy refreshed most recently instead of blindly
  // selecting a stale keychain entry.
  return recency(file) > recency(keychain) ? file : keychain;
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
  const configPath = NATIVE_PATHS.codex.config;
  if (!fs.existsSync(configPath)) {
    removeCodexChannelEnvVars();
    return;
  }
  let config = {};
  try {
    config = toml.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse existing Codex config.toml: ${error.message}`);
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

  writeTomlFile(configPath, config, { atomic: true });
  removeCodexChannelEnvVars();
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

// Refreshing an OAuth token must not clear the user's configured channels.
// `applyCodexOAuth` is intentionally broader because it switches the active
// auth mode; this helper only replaces the rotating token pair in place.
function updateCodexOAuthTokens(credential = {}) {
  const current = readCodexNativeOAuth();
  const currentAuth = (() => {
    try {
      return codexSettingsManager.readAuth() || {};
    } catch {
      return {};
    }
  })();
  const currentTokens = currentAuth.tokens && typeof currentAuth.tokens === 'object'
    ? currentAuth.tokens
    : {};
  const authPayload = {
    ...currentAuth,
    auth_mode: credential.authMode || current?.authMode || currentAuth.auth_mode || 'chatgpt',
    tokens: {
      ...currentTokens,
      access_token: credential.accessToken || current?.accessToken || currentTokens.access_token || '',
      refresh_token: credential.refreshToken || current?.refreshToken || currentTokens.refresh_token || '',
      id_token: credential.idToken || current?.idToken || currentTokens.id_token || '',
      account_id: credential.accountId || current?.accountId || currentTokens.account_id || ''
    },
    last_refresh: credential.lastRefresh || new Date().toISOString()
  };

  if (!authPayload.tokens.access_token) {
    throw new Error('Codex OAuth access token is missing');
  }

  writeJsonFile(NATIVE_PATHS.codex.auth, authPayload);
  const wroteKeychain = nativeKeychain.isSupported()
    ? nativeKeychain.setPassword(CODEX_KEYCHAIN_SERVICE, getCodexKeychainAccount(), JSON.stringify(authPayload))
    : false;
  return { storage: wroteKeychain ? 'auth-file+keychain' : 'auth-file' };
}

function inspectCodexState() {
  const { getCodexProxyStatus } = require('./drivers/codex/proxy-implementation');
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
  ensureDir(path.dirname(NATIVE_PATHS.gemini.env));
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
  const { getGeminiProxyStatus } = require('./drivers/gemini/proxy-implementation');
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


function resolveOmpRuntime() {
  try {
    const ompConfig = require('./drivers/omp/config');
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
    timeout: options.timeout || 10000,
    windowsHide: true
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
    const { getOmpAuthProviderSnapshot } = require('./drivers/omp/auth-providers');
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
  const storedOAuth = readOmpOAuthCredentialsFromDb();
  const snapshot = getOmpAuthSnapshot({ forceRefresh: true });
  if (!snapshot?.available || !Array.isArray(snapshot.providers)) return storedOAuth;

  const snapshotCredentials = snapshot.providers
    .filter(provider => provider?.loggedIn || Number(provider?.accountCount || 0) > 0)
    .flatMap((provider) => {
      const accounts = Array.isArray(provider.accounts) ? provider.accounts : [];
      const providerCredentials = storedOAuth.filter(item => item.providerId === provider.id);
      return accounts.map((account, index) => {
        const accountId = String(account.index || account.id || account.accountId || '').trim();
        const accountEmail = String(account.identity || account.email || account.accountEmail || '').trim();
        const stored = providerCredentials.find(item => (
          (item.accountId && item.accountId === accountId)
            || (item.accountEmail && item.accountEmail === accountEmail)
        )) || providerCredentials[index] || null;
        return {
          providerId: provider.id,
          accountId: stored?.accountId || accountId,
          accountEmail: stored?.accountEmail || accountEmail,
          identityKey: stored?.identityKey || '',
          accessToken: stored?.accessToken || '',
          refreshToken: stored?.refreshToken || '',
          expiresAt: stored?.expiresAt || null,
          storage: stored?.storage || 'auth-broker',
          primaryToken: stored?.primaryToken || ''
        };
      });
    });
  return snapshotCredentials.length > 0 ? snapshotCredentials : storedOAuth;
}

function getOmpAgentDatabasePath() {
  const agentDir = NATIVE_PATHS.omp?.dir;
  return agentDir ? path.join(agentDir, 'agent.db') : '';
}

function readSqliteRows(databasePath, sql) {
  if (!databasePath || !fs.existsSync(databasePath)) return [];
  try {
    const output = execFileSync('sqlite3', ['-json', databasePath, sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseOAuthCredentialData(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeCredentialExpiry(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

function readOmpOAuthCredentialsFromDb() {
  const rows = readSqliteRows(
    getOmpAgentDatabasePath(),
    "select provider, credential_type, data, identity_key, disabled_cause from auth_credentials where credential_type = 'oauth' order by updated_at desc"
  );
  return rows.map(row => {
    if (row?.disabled_cause) return null;
    const data = parseOAuthCredentialData(row?.data) || {};
    const accessToken = firstString(data.access, data.accessToken, data.access_token, data.token);
    if (!accessToken) return null;
    const tokenMetadata = extractTokenMetadata(accessToken, data.id_token, data.idToken);
    const identityKey = firstString(data.identityKey, data.identity_key, row?.identity_key);
    const identityAccountId = identityKey.match(/(?:^|[|:])org:([^|]+)/)?.[1] || '';
    return {
      providerId: firstString(row?.provider),
      accountId: firstString(data.accountId, data.account_id, data.orgId, data.org_id, tokenMetadata.accountId, identityAccountId),
      accountEmail: firstString(data.accountEmail, data.account_email, data.email, tokenMetadata.accountEmail),
      identityKey,
      accessToken,
      refreshToken: firstString(data.refresh, data.refreshToken, data.refresh_token),
      expiresAt: normalizeCredentialExpiry(data.expires || data.expiresAt || data.expires_at) || tokenMetadata.expiresAt,
      storage: 'auth-broker',
      primaryToken: accessToken
    };
  }).filter(Boolean);
}

function normalizeOpenCodeProviderId(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('openai') || text.includes('codex')) return 'openai-codex';
  try {
    return new URL(text).hostname.replace(/^www\./, '') || text;
  } catch {
    return text || 'opencode';
  }
}

function parseOpenCodeCredential(row = {}, storage = 'opencode') {
  const accessToken = firstString(row.accessToken, row.access_token, row.access, row.token);
  if (!accessToken) return null;
  const tokenMetadata = extractTokenMetadata(accessToken, row.idToken, row.id_token);
  const providerId = normalizeOpenCodeProviderId(row.providerId || row.provider || row.url);
  return {
    providerId,
    accountId: firstString(row.accountId, row.account_id, tokenMetadata.accountId),
    accountEmail: firstString(row.accountEmail, row.account_email, row.email, tokenMetadata.accountEmail),
    identityKey: firstString(row.identityKey, row.identity_key),
    accessToken,
    idToken: firstString(row.idToken, row.id_token),
    refreshToken: firstString(row.refreshToken, row.refresh_token, row.refresh),
    expiresAt: normalizeCredentialExpiry(row.expiresAt || row.expires_at || row.token_expiry) || tokenMetadata.expiresAt,
    storage,
    primaryToken: accessToken
  };
}

function readOpenCodeAuthFile() {
  const filePath = NATIVE_PATHS.opencode?.auth;
  const payload = filePath ? readJsonFile(filePath, null) : null;
  if (!payload || typeof payload !== 'object') return [];
  const entries = payload.access_token || payload.accessToken || payload.access
    ? [{ ...payload }]
    : Object.entries(payload).map(([providerId, value]) => ({
      ...(value && typeof value === 'object' ? value : {}),
      providerId
    }));
  return entries.map(entry => parseOpenCodeCredential(entry, 'opencode-auth-file')).filter(Boolean);
}

function readOpenCodeDatabaseCredentials() {
  const dataDir = NATIVE_PATHS.opencode?.data;
  if (!dataDir || !fs.existsSync(dataDir)) return [];
  const databases = fs.readdirSync(dataDir)
    .filter(name => /^opencode-.*\.db$/i.test(name) || /^opencode\.db$/i.test(name))
    .map(name => path.join(dataDir, name))
    .filter(filePath => {
      try { return fs.statSync(filePath).isFile(); } catch { return false; }
    })
    .sort((left, right) => {
      try { return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs; } catch { return 0; }
    });
  const rows = [];
  for (const databasePath of databases) {
    rows.push(...readSqliteRows(
      databasePath,
      'select email, url, access_token, refresh_token, token_expiry from account'
    ));
    rows.push(...readSqliteRows(
      databasePath,
      'select email, url, access_token, refresh_token, token_expiry from control_account'
    ));
  }
  return rows.map(row => parseOpenCodeCredential(row, 'opencode-sqlite')).filter(Boolean);
}

function readAllOpenCodeNativeOAuth() {
  const entries = [...readOpenCodeAuthFile(), ...readOpenCodeDatabaseCredentials()];
  const seen = new Set();
  return entries.filter(entry => {
    const key = `${entry.providerId}:${entry.accountId || entry.accountEmail || entry.primaryToken}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readOpenCodeNativeOAuth() {
  return readAllOpenCodeNativeOAuth()[0] || null;
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
    require('./drivers/omp/auth-providers').clearOmpAuthProviderCache();
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
    require('./drivers/omp/auth-providers').clearOmpAuthProviderCache();
  } catch {
    // cache invalidation is best-effort
  }
}

function buildOmpImportPayload(credential = {}) {
  if (credential.importPayload && typeof credential.importPayload === 'object') {
    return credential.importPayload;
  }

  const access = String(credential.accessToken || credential.primaryToken || '').trim();
  const refresh = String(credential.refreshToken || '').trim();
  const expiresAt = Number(credential.expiresAt || 0);
  const expired = Number.isFinite(expiresAt) && expiresAt > 0
    ? new Date(expiresAt).toISOString()
    : undefined;
  if (!access) {
    return null;
  }

  return {
    provider: credential.providerId,
    type: credential.credentialType || 'oauth',
    credential_type: credential.credentialType || 'oauth',
    // OMP keeps a logged-out credential row in the broker database. Explicitly
    // marking the imported row active is required to revive a token after a
    // restart or token rotation.
    disabled: false,
    identity_key: credential.identityKey || credential.accountId || credential.accountEmail || undefined,
    access_token: access,
    refresh_token: refresh,
    expired,
    account_id: credential.accountId || undefined,
    email: credential.accountEmail || undefined,
    data: {
      access,
      refresh,
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
    if (/no importable credentials|missing access_token|cannot parse expired|^skip\b/im.test(result.stdout)) {
      throw new Error(`OMP auth-broker import rejected the credential: ${result.stdout.trim()}`);
    }
    try {
      require('./drivers/omp/auth-providers').clearOmpAuthProviderCache();
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
  const { getOmpProxyStatus } = require('./drivers/omp/proxy-implementation');
  const { isManagedOmpProvidersActive } = require('./drivers/omp/native-config-implementation');
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

function inspectOpenCodeState() {
  let proxyRunning = false;
  try {
    proxyRunning = Boolean(require('./drivers/opencode/proxy-implementation').getOpenCodeProxyStatus()?.running);
  } catch {
    proxyRunning = false;
  }
  const nativeCredentials = readAllOpenCodeNativeOAuth();
  return {
    tool: 'opencode',
    mode: proxyRunning ? 'proxy' : (nativeCredentials.length > 0 ? 'oauth' : 'idle'),
    proxyRunning,
    oauthPresent: nativeCredentials.length > 0,
    channelConfigured: false,
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
    case 'omp':
      return inspectOmpState();
    case 'opencode':
      return inspectOpenCodeState();
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
    case 'omp':
      return readOmpNativeOAuth();
    case 'opencode':
      return readOpenCodeNativeOAuth();
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
    case 'omp':
      return readAllOmpNativeOAuth();
    case 'opencode':
      return readAllOpenCodeNativeOAuth();
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
    case 'omp':
      return applyOmpOAuth(credential);
    default:
      throw new Error(`Unsupported OAuth tool: ${tool}`);
  }
}

module.exports = {
  SUPPORTED_TOOLS,
  configure,
  fingerprintFor,
  inspectTool,
  readNativeOAuth,
  readAllNativeOAuth,
  clearClaudeChannelConfig,
  clearGeminiChannelConfig,
  clearCodexChannelConfig,
  updateCodexOAuthTokens,
  clearNativeOAuth,
  disableNativeOAuthCredential,
  applyOAuthCredential
};
