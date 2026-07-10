const { spawnSync } = require('child_process');
const ompConfig = require('./omp-config');

const COMMAND_TIMEOUT_MS = 5000;
const TOKEN_LIST_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 15000;

const LOGIN_PROVIDER_IDS = new Set([
  'openai-codex',
  'openai-codex-device',
  'anthropic',
  'github-copilot',
  'cursor',
  'devin',
  'google-antigravity',
  'google-gemini-cli',
  'xai-oauth',
  'gitlab-duo',
  'gitlab-duo-agent',
  'alibaba-coding-plan',
  'zhipu-coding-plan',
  'kimi-code',
  'zai',
  'qwen-portal',
  'minimax-code',
  'minimax-code-cn',
  'perplexity'
]);

const ACCOUNT_CHECK_PROVIDER_IDS = new Set([
  'openai-codex',
  'openai-codex-device',
  'anthropic',
  'google-gemini-cli',
  'github-copilot'
]);

const PROVIDER_ALIASES = {
  codex: 'openai-codex',
  openai: 'openai-codex',
  'openai-codex': 'openai-codex',
  'openai-codex-device': 'openai-codex-device',
  claude: 'anthropic',
  anthropic: 'anthropic',
  gemini: 'google-gemini-cli',
  'gemini-cli': 'google-gemini-cli',
  'google-gemini-cli': 'google-gemini-cli',
  copilot: 'github-copilot',
  'github-copilot': 'github-copilot'
};

let snapshotCache = {};

function normalizeProviderId(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveProviderAlias(value = '') {
  const id = normalizeProviderId(value);
  return PROVIDER_ALIASES[id] || id;
}

function normalizeCommandOutput(value) {
  if (value === undefined || value === null) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function sanitizeIdentity(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => {
      const [name, domain] = email.split('@');
      if (!name || !domain) return '***';
      const visible = name.length <= 2 ? `${name[0] || '*'}***` : `${name.slice(0, 2)}***${name.slice(-1)}`;
      return `${visible}@${domain}`;
    })
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/nvapi-[A-Za-z0-9_-]{8,}/g, 'nvapi-***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g, 'jwt.***')
    .replace(/[A-Za-z0-9_=-]{32,}/g, '***');
}

function runCommand(command, args = [], options = {}) {
  const runner = options.commandRunner || spawnSync;
  const result = runner(command, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env || {})
    },
    timeout: options.timeout || COMMAND_TIMEOUT_MS
  });
  if (typeof result === 'string' || Buffer.isBuffer(result)) {
    return { status: 0, stdout: normalizeCommandOutput(result), stderr: '' };
  }
  return result || { status: 0, stdout: '', stderr: '' };
}

function parseJsonCommand(command, args, options = {}) {
  const result = runCommand(command, args, options);
  const status = result.status === undefined || result.status === null ? 0 : result.status;
  const stdout = normalizeCommandOutput(result.stdout).trim();
  const stderr = normalizeCommandOutput(result.stderr).trim();
  if (result.error) {
    return { ok: false, status, error: result.error.message, stderr };
  }
  if (!stdout) {
    return { ok: status === 0, status, value: null, stderr };
  }
  try {
    return { ok: status === 0, status, value: JSON.parse(stdout), stderr };
  } catch (error) {
    return { ok: false, status, error: error.message, stderr };
  }
}

function parseAccountLine(line = '', index) {
  const sanitized = sanitizeIdentity(line)
    .replace(/^\s*[-*]\s*/, '')
    .replace(/^\s*\[?\d+\]?\s*[:.)-]?\s*/, '')
    .trim();
  if (!sanitized || /^no oauth accounts found/i.test(sanitized)) return null;
  return {
    index: index + 1,
    identity: sanitized
  };
}

function listProviderAccounts(command, providerId, options = {}) {
  const result = runCommand(command, ['token', providerId, '--list'], {
    ...options,
    timeout: options.tokenListTimeout || TOKEN_LIST_TIMEOUT_MS
  });
  const status = result.status === undefined || result.status === null ? 0 : result.status;
  const stdout = normalizeCommandOutput(result.stdout);
  const stderr = normalizeCommandOutput(result.stderr);
  const combined = `${stdout}\n${stderr}`;

  if (result.error) {
    return { checked: true, loggedIn: false, accountCount: 0, accounts: [], error: result.error.message };
  }

  const accounts = stdout
    .split(/\r?\n/)
    .map((line, index) => parseAccountLine(line, index))
    .filter(Boolean);

  const noAccounts = /no oauth accounts found/i.test(combined);
  return {
    checked: true,
    loggedIn: accounts.length > 0,
    accountCount: accounts.length,
    accounts,
    error: status !== 0 && !noAccounts && accounts.length === 0
      ? sanitizeIdentity(stderr || stdout || `exit code ${status}`)
      : null
  };
}

function isLikelyLoginProvider(provider = {}) {
  const id = normalizeProviderId(provider.id);
  const name = String(provider.name || '').toLowerCase();
  return LOGIN_PROVIDER_IDS.has(id)
    || id.includes('oauth')
    || id.includes('codex')
    || id.includes('copilot')
    || id.includes('gemini-cli')
    || name.includes('subscription')
    || name.includes('coding plan')
    || name.includes('token plan')
    || name.includes('claude pro')
    || name.includes('chatgpt plus')
    || name.includes('chatgpt pro');
}

function normalizeProvider(provider = {}) {
  const id = normalizeProviderId(provider.id);
  return {
    id,
    name: String(provider.name || provider.id || id),
    loginCapable: isLikelyLoginProvider(provider)
  };
}

function buildEmptySnapshot(runtime, reason) {
  return {
    available: false,
    reason,
    runtime,
    brokerStatus: null,
    gatewayStatus: null,
    providers: [],
    supportedProviders: [],
    aliases: { ...PROVIDER_ALIASES },
    checkedAt: new Date().toISOString()
  };
}

function getOmpAuthProviderSnapshot(options = {}) {
  const now = Date.now();
  const cacheKey = options.accountCheck === false
    ? (options.includeStatus === false ? 'metadata' : 'metadata-status')
    : 'full';
  const cached = snapshotCache[cacheKey];
  if (!options.forceRefresh && cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const env = options.env || process.env;
  const runtime = options.runtime || ompConfig.resolveOmpRuntime(env, options.runtimeOptions || {});
  if (!runtime || runtime.runtime !== 'omp' || !runtime.installed) {
    const value = buildEmptySnapshot(runtime || null, 'omp-not-available');
    snapshotCache[cacheKey] = { loadedAt: now, value };
    return value;
  }

  const command = runtime.command;
  const listResult = parseJsonCommand(command, ['auth-broker', 'list', '--json'], options);
  if (!listResult.ok || !Array.isArray(listResult.value)) {
    const value = buildEmptySnapshot(runtime, listResult.error || listResult.stderr || 'auth-provider-list-failed');
    snapshotCache[cacheKey] = { loadedAt: now, value };
    return value;
  }

  const supportedProviders = listResult.value
    .map(normalizeProvider)
    .filter(provider => provider.id);
  const loginProviders = supportedProviders
    .filter(provider => provider.loginCapable)
    .map(provider => {
      if (options.accountCheck === false || !ACCOUNT_CHECK_PROVIDER_IDS.has(provider.id)) {
        return {
          ...provider,
          checked: false,
          loggedIn: null,
          accountCount: null,
          accounts: [],
          error: null
        };
      }
      return {
        ...provider,
        ...listProviderAccounts(command, provider.id, options)
      };
    });

  const brokerStatus = options.includeStatus === false
    ? { value: null }
    : parseJsonCommand(command, ['auth-broker', 'status', '--json'], options);
  const gatewayStatus = options.includeStatus === false
    ? { value: null }
    : parseJsonCommand(command, ['auth-gateway', 'status', '--json'], options);

  const value = {
    available: true,
    runtime,
    brokerStatus: brokerStatus.value || null,
    gatewayStatus: gatewayStatus.value || null,
    providers: loginProviders,
    supportedProviders,
    aliases: { ...PROVIDER_ALIASES },
    checkedAt: new Date().toISOString()
  };
  snapshotCache[cacheKey] = { loadedAt: now, value };
  return value;
}

function findAuthProviderForKey(providerKey, snapshot) {
  const resolved = resolveProviderAlias(providerKey);
  const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
  return providers.find(provider => provider.id === resolved) || null;
}

function clearOmpAuthProviderCache() {
  snapshotCache = {};
}

module.exports = {
  LOGIN_PROVIDER_IDS,
  ACCOUNT_CHECK_PROVIDER_IDS,
  clearOmpAuthProviderCache,
  findAuthProviderForKey,
  getOmpAuthProviderSnapshot,
  normalizeProviderId,
  resolveProviderAlias,
  sanitizeIdentity
};
