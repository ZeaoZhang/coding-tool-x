const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { PATHS } = require('../../config/paths');
const { loadUIConfig } = require('./ui-config');

const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const QUOTA_UNIT = 500000;
const VELOERA_QUOTA_UNIT = 1000000;
const VALID_SOURCES = new Set(['claude', 'codex', 'gemini', 'opencode']);
const GATEWAY_PATH_SEGMENTS = new Set(['openai', 'anthropic', 'claude', 'gemini', 'codex']);
const HUB_PLATFORMS = new Set(['new-api', 'one-api', 'one-hub', 'done-hub', 'veloera', 'anyrouter', 'aihubmix']);
const UNSUPPORTED_BALANCE_PLATFORMS = new Set(['dashscope', 'modelscope']);

const balanceCache = new Map();
const balanceStrategyCache = new Map();
let strategyCacheLoaded = false;

function getStrategyCacheFilePath() {
  return PATHS.channelBalanceStrategies
    || path.join(PATHS.storage || path.dirname(PATHS.channelModels), 'cache', 'channel-balance-strategies.json');
}

function loadPersistedStrategyCache() {
  if (strategyCacheLoaded) return;
  strategyCacheLoaded = true;

  try {
    const filePath = getStrategyCacheFilePath();
    if (!fs.existsSync(filePath)) return;
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const entries = payload && typeof payload === 'object' ? payload.entries : null;
    if (!entries || typeof entries !== 'object') return;
    Object.entries(entries).forEach(([key, value]) => {
      const strategy = value?.strategy && typeof value.strategy === 'object' ? value.strategy : null;
      if (strategy?.type) {
        balanceStrategyCache.set(key, strategy);
      }
    });
  } catch {
    // A corrupt strategy cache should only cost a fresh probe, not break balance display.
  }
}

function writePersistedStrategyCache() {
  try {
    const filePath = getStrategyCacheFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const entries = {};
    balanceStrategyCache.forEach((strategy, key) => {
      if (strategy?.type) {
        entries[key] = {
          strategy,
          updatedAt: nowIso()
        };
      }
    });
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, entries }, null, 2), 'utf8');
  } catch {
    // Persisting the optimization is best-effort; in-memory cache still works.
  }
}

function rememberBalanceStrategy(key, strategy) {
  if (!key || !strategy?.type) return;
  loadPersistedStrategyCache();
  balanceStrategyCache.set(key, strategy);
  writePersistedStrategyCache();
}

function forgetBalanceStrategy(key) {
  loadPersistedStrategyCache();
  if (balanceStrategyCache.delete(key)) {
    writePersistedStrategyCache();
  }
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function stripBearer(value) {
  const token = String(value || '').trim();
  return token.toLowerCase().startsWith('bearer ') ? token.slice(7).trim() : token;
}

function resolveBalanceToken(channel = {}) {
  return stripBearer(
    channel.balanceToken
    || channel.balanceApiKey
    || channel.balanceAuthToken
    || channel.apiKey
    || channel.token
    || channel.authToken
    || ''
  );
}

function resolveBalanceUserId(channel = {}) {
  const raw = channel.balanceUserId
    ?? channel.platformUserId
    ?? channel.newApiUserId
    ?? null;
  const parsed = parseFiniteNumber(raw);
  if (parsed == null || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function buildUserIdHeaders(userId) {
  if (!userId) return {};
  const value = String(userId);
  return {
    'New-Api-User': value,
    'Veloera-User': value,
    'voapi-user': value,
    'User-id': value,
    'Rix-Api-User': value,
    'neo-api-user': value
  };
}

function buildAuthHeaders(token, extra = {}) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${stripBearer(token)}`,
    ...extra
  };
}

function hasDedicatedBalanceToken(channel = {}) {
  return !!String(
    channel.balanceToken
    || channel.balanceApiKey
    || channel.balanceAuthToken
    || ''
  ).trim();
}

function buildCookieCandidates(token) {
  const raw = stripBearer(token);
  if (!raw) return [];

  const candidates = [];
  const normalized = raw.replace(/^cookie:\s*/i, '').trim();
  if (!normalized) return [];
  if (normalized.includes('=')) {
    candidates.push(normalized);
  }
  candidates.push(`session=${normalized}`);
  candidates.push(`token=${normalized}`);
  return Array.from(new Set(candidates));
}

function shouldTryCookieAuth(token, channel = {}, hintedPlatform = null) {
  const raw = stripBearer(token);
  if (!raw) return false;
  return hasDedicatedBalanceToken(channel)
    || raw.includes('=')
    || (hintedPlatform === 'anyrouter' && !isLikelyModelApiKey(raw));
}

function isLikelyModelApiKey(token) {
  return /^sk-[a-z0-9]/i.test(stripBearer(token));
}

function isLikelyOpenRouterApiKey(token) {
  return /^sk-or-/i.test(stripBearer(token));
}

function parseFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function roundMoney(value) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 1000000) / 1000000;
}

function normalizeQuotaUnit(value, fallback = QUOTA_UNIT) {
  const parsed = parseFiniteNumber(value);
  return parsed != null && parsed > 0 ? parsed : fallback;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return '';
  return `$${value.toFixed(2)}`;
}

function makeHiddenSnapshot(platform = null, { stale = false, updatedAt = nowIso() } = {}) {
  return {
    visible: false,
    platform,
    updatedAt,
    stale
  };
}

function makeVisibleSnapshot(platform, input, { stale = false, updatedAt = nowIso() } = {}) {
  const remaining = parseFiniteNumber(input.remaining);
  const monthlyRemaining = parseFiniteNumber(input.monthlyRemaining);
  if (remaining == null && monthlyRemaining == null) {
    return makeHiddenSnapshot(platform, { stale, updatedAt });
  }

  const labelValue = remaining != null ? remaining : monthlyRemaining;
  const labelPrefix = remaining != null ? '余额' : '月余';
  const snapshot = {
    visible: true,
    platform,
    label: `${labelPrefix} ${formatMoney(labelValue)}`,
    updatedAt,
    stale
  };

  if (remaining != null) snapshot.remaining = roundMoney(remaining);
  const used = parseFiniteNumber(input.used);
  if (used != null) snapshot.used = roundMoney(used);
  const total = parseFiniteNumber(input.total);
  if (total != null) snapshot.total = roundMoney(total);
  if (monthlyRemaining != null) snapshot.monthlyRemaining = roundMoney(monthlyRemaining);
  return snapshot;
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }

  parsed.hash = '';
  parsed.search = '';
  let pathname = parsed.pathname || '/';
  pathname = pathname.replace(/\/+$/, '') || '/';
  const lower = pathname.toLowerCase();
  const suffixes = [
    '/v1/chat/completions',
    '/v1/responses',
    '/v1/messages',
    '/v1beta/models',
    '/chat/completions',
    '/responses',
    '/messages',
    '/v1beta',
    '/v1'
  ];

  for (const suffix of suffixes) {
    if (lower === suffix || lower.endsWith(suffix)) {
      pathname = pathname.slice(0, pathname.length - suffix.length) || '/';
      break;
    }
  }

  parsed.pathname = pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

function buildBaseCandidates(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return [];

  const candidates = [normalized];
  try {
    const parsed = new URL(normalized);
    const origin = parsed.origin;
    if (origin && !candidates.includes(origin)) {
      candidates.push(origin);
    }
  } catch {}
  return candidates;
}

function joinUrl(baseUrl, endpoint) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const path = String(endpoint || '').startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${path}`;
}

function requestJson(url, {
  method = 'GET',
  headers = {},
  body,
  timeoutMs = REQUEST_TIMEOUT_MS,
  redirectCount = 0
} = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const requestBody = body === undefined
      ? null
      : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    const requestHeaders = { ...headers };
    if (requestBody != null && !Object.keys(requestHeaders).some(key => key.toLowerCase() === 'content-length')) {
      requestHeaders['Content-Length'] = Buffer.byteLength(requestBody);
    }

    const req = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: requestHeaders
    }, (res) => {
      const chunks = [];
      let total = 0;

      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('response too large'));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let payload = null;
        let parseError = null;
        if (raw) {
          try {
            payload = JSON.parse(raw);
          } catch (error) {
            parseError = error;
          }
        }
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 3) {
          try {
            const nextUrl = new URL(res.headers.location, parsed).toString();
            resolve(requestJson(nextUrl, {
              method: res.statusCode === 303 ? 'GET' : method,
              headers,
              body: res.statusCode === 303 ? undefined : body,
              timeoutMs,
              redirectCount: redirectCount + 1
            }));
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(`HTTP ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.payload = payload;
          reject(error);
          return;
        }
        if (parseError) {
          reject(parseError);
          return;
        }
        resolve(payload);
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('request timeout'));
    });
    req.on('error', reject);
    if (requestBody != null) {
      req.write(requestBody);
    }
    req.end();
  });
}

async function tryRequestJson(url, options) {
  try {
    return await requestJson(url, options);
  } catch (error) {
    if (error?.payload && typeof error.payload === 'object') {
      return error.payload;
    }
    return null;
  }
}

function detectPlatformByUrlHint(...values) {
  const value = values.map(item => String(item || '')).join(' ').toLowerCase();
  if (value.includes('88code') || value.includes('88-code') || value.includes('rainapp.top')) return '88code';
  if (value.includes('openrouter.ai') || value.includes('openrouter')) return 'openrouter';
  if (value.includes('aihubmix')) return 'aihubmix';
  if (value.includes('dashscope') || value.includes('dashscope.aliyuncs.com') || value.includes('compatible-mode')) return 'dashscope';
  if (value.includes('modelscope') || value.includes('api-inference.modelscope.cn')) return 'modelscope';
  if (value.includes('siliconflow') || value.includes('siliconflow.cn')) return 'siliconflow';
  if (value.includes('sub2api')) return 'sub2api';
  if (value.includes('anyrouter')) return 'anyrouter';
  if (value.includes('donehub') || value.includes('done-hub')) return 'done-hub';
  if (value.includes('onehub') || value.includes('one-hub')) return 'one-hub';
  if (value.includes('veloera')) return 'veloera';
  if (value.includes('oneapi') || value.includes('one-api')) return 'one-api';
  if (value.includes('newapi') || value.includes('new-api')) return 'new-api';
  return null;
}

function resolveStatusPlatform(payload, hintedPlatform = null) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const systemName = typeof data?.system_name === 'string'
    ? data.system_name.toLowerCase()
    : '';
  const version = typeof data?.version === 'string'
    ? data.version.toLowerCase()
    : '';
  if (payload.success !== true && !systemName && !version) return null;

  if (hintedPlatform === 'aihubmix' || systemName.includes('aihubmix')) return 'aihubmix';
  if (hintedPlatform === 'anyrouter') return 'anyrouter';
  if (hintedPlatform === 'done-hub') return 'done-hub';
  if (hintedPlatform === 'one-hub') return 'one-hub';
  if (systemName.includes('veloera') || version.includes('veloera')) return 'veloera';
  if (systemName) return hintedPlatform === 'one-api' ? 'one-api' : 'new-api';
  return hintedPlatform || 'one-api';
}

function extractSub2ApiData(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.code === 'number') {
    if (payload.code !== 0 || payload.data === undefined) return null;
    return payload.data;
  }
  if (payload.data && typeof payload.data === 'object') return payload.data;
  return payload;
}

function isSub2ApiUsagePayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const mode = typeof payload.mode === 'string' ? payload.mode.trim().toLowerCase() : '';
  if (!['quota_limited', 'unrestricted'].includes(mode)) return false;
  return Object.prototype.hasOwnProperty.call(payload, 'remaining')
    || Object.prototype.hasOwnProperty.call(payload, 'balance')
    || (payload.quota && typeof payload.quota === 'object')
    || (payload.subscription && typeof payload.subscription === 'object')
    || (payload.usage && typeof payload.usage === 'object');
}

function extractUserSelfData(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!data || typeof data !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(data, 'quota')) return null;
  return data;
}

function buildHubBalanceSnapshot(platform, payload) {
  const data = extractUserSelfData(payload);
  if (!data) return makeHiddenSnapshot(platform);

  const unit = platform === 'veloera'
    ? VELOERA_QUOTA_UNIT
    : normalizeQuotaUnit(data.quota_per_unit || data.quotaPerUnit);
  const quotaRaw = parseFiniteNumber(data.quota);
  const usedRaw = parseFiniteNumber(data.used_quota);
  if (quotaRaw == null) return makeHiddenSnapshot(platform);

  const quota = quotaRaw / unit;
  const used = (usedRaw || 0) / unit;
  let remaining;
  let total;

  if (platform === 'new-api' || platform === 'anyrouter' || platform === 'done-hub' || platform === 'aihubmix') {
    remaining = quota;
    total = quota + used;
  } else {
    remaining = quota - used;
    total = quota;
  }

  return makeVisibleSnapshot(platform, {
    remaining,
    used,
    total
  });
}

function extractNewApiTokenUsageData(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!data || typeof data !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(data, 'total_available')) return null;
  return data;
}

function buildNewApiTokenUsageSnapshot(payload, { quotaUnit = QUOTA_UNIT } = {}) {
  const data = extractNewApiTokenUsageData(payload);
  if (!data) return makeHiddenSnapshot('new-api');

  const availableRaw = parseFiniteNumber(data.total_available);
  if (availableRaw == null) return makeHiddenSnapshot('new-api');
  const totalRaw = parseFiniteNumber(data.total_granted);
  const usedRaw = parseFiniteNumber(data.total_used);
  const unit = normalizeQuotaUnit(data.quota_per_unit || data.quotaPerUnit || quotaUnit);

  const remaining = Math.max(0, availableRaw / unit);
  return makeVisibleSnapshot('new-api', {
    remaining,
    used: usedRaw != null ? usedRaw / unit : undefined,
    total: totalRaw != null ? totalRaw / unit : undefined
  });
}

function extractOpenRouterData(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  return data && typeof data === 'object' ? data : null;
}

function buildOpenRouterKeySnapshot(payload) {
  const data = extractOpenRouterData(payload);
  if (!data) return makeHiddenSnapshot('openrouter');

  const limitRemaining = parseFiniteNumber(data.limit_remaining ?? data.limitRemaining);
  const limit = parseFiniteNumber(data.limit);
  const usage = parseFiniteNumber(data.usage);
  if (limitRemaining != null) {
    return makeVisibleSnapshot('openrouter', {
      remaining: Math.max(0, limitRemaining),
      used: usage,
      total: limit
    });
  }

  if (limit != null && usage != null) {
    return makeVisibleSnapshot('openrouter', {
      remaining: Math.max(0, limit - usage),
      used: usage,
      total: limit
    });
  }

  return makeHiddenSnapshot('openrouter');
}

function buildOpenRouterCreditsSnapshot(payload) {
  const data = extractOpenRouterData(payload);
  if (!data) return makeHiddenSnapshot('openrouter');

  const totalCredits = parseFiniteNumber(data.total_credits ?? data.totalCredits);
  const totalUsage = parseFiniteNumber(data.total_usage ?? data.totalUsage);
  if (totalCredits == null || totalUsage == null) {
    return makeHiddenSnapshot('openrouter');
  }

  return makeVisibleSnapshot('openrouter', {
    remaining: Math.max(0, totalCredits - totalUsage),
    used: totalUsage,
    total: totalCredits
  });
}

function buildSiliconFlowUserInfoSnapshot(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!data || typeof data !== 'object') return makeHiddenSnapshot('siliconflow');

  const remaining = parseFiniteNumber(data.balance);
  if (remaining == null) return makeHiddenSnapshot('siliconflow');
  const chargeBalance = parseFiniteNumber(data.chargeBalance);
  const totalBalance = parseFiniteNumber(data.totalBalance);
  return makeVisibleSnapshot('siliconflow', {
    remaining,
    used: totalBalance != null ? Math.max(0, totalBalance - remaining) : undefined,
    total: totalBalance ?? chargeBalance ?? remaining
  });
}

function extractQuotaUnitFromStatus(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  return normalizeQuotaUnit(data?.quota_per_unit || data?.quotaPerUnit, null);
}

function parseSubscriptionItems(payload) {
  const data = extractSub2ApiData(payload);
  const candidates = [
    data?.subscriptions,
    data?.items,
    data?.data,
    payload?.subscriptions,
    payload?.items,
    Array.isArray(data) ? data : null
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function readMoneyField(item, ...keys) {
  for (const key of keys) {
    const value = parseFiniteNumber(item?.[key]);
    if (value != null) return value;
  }
  return null;
}

async function fetchSub2ApiSubscriptionSummary(baseUrl, headers) {
  const endpoints = ['/api/v1/subscriptions/summary', '/api/v1/subscriptions/active'];
  for (const endpoint of endpoints) {
    const payload = await tryRequestJson(joinUrl(baseUrl, endpoint), { headers });
    if (!payload) continue;
    const items = parseSubscriptionItems(payload);
    if (!items.length) continue;

    let monthlyRemaining = 0;
    let hasMonthlyLimit = false;
    for (const item of items) {
      const used = readMoneyField(item, 'monthlyUsedUsd', 'monthly_used_usd', 'monthly_used', 'used_monthly_usd') || 0;
      const limit = readMoneyField(item, 'monthlyLimitUsd', 'monthly_limit_usd', 'monthly_limit', 'limit_monthly_usd');
      if (limit == null) continue;
      hasMonthlyLimit = true;
      monthlyRemaining += Math.max(0, limit - used);
    }

    if (hasMonthlyLimit) {
      return { monthlyRemaining };
    }
  }
  return {};
}

function readSub2ApiMonthlyRemaining(subscription) {
  if (!subscription || typeof subscription !== 'object') return null;
  const used = readMoneyField(subscription, 'monthlyUsedUsd', 'monthly_usage_usd', 'monthly_used_usd', 'monthly_used', 'used_monthly_usd') || 0;
  const limit = readMoneyField(subscription, 'monthlyLimitUsd', 'monthly_limit_usd', 'monthly_limit', 'limit_monthly_usd');
  if (limit == null) return null;
  return Math.max(0, limit - used);
}

function nonNegativeMoney(value) {
  const parsed = parseFiniteNumber(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function buildSub2ApiUsageSnapshot(payload) {
  if (!isSub2ApiUsagePayload(payload)) return makeHiddenSnapshot('sub2api');
  if (payload.isValid === false) return makeHiddenSnapshot('sub2api');

  const quota = payload.quota && typeof payload.quota === 'object' ? payload.quota : null;
  if (quota) {
    const remaining = nonNegativeMoney(quota.remaining) ?? nonNegativeMoney(payload.remaining);
    if (remaining != null) {
      return makeVisibleSnapshot('sub2api', {
        remaining,
        used: readMoneyField(quota, 'used', 'quota_used', 'used_usd'),
        total: readMoneyField(quota, 'limit', 'quota', 'total')
      });
    }
  }

  const remaining = nonNegativeMoney(payload.balance) ?? nonNegativeMoney(payload.remaining);
  const monthlyRemaining = readSub2ApiMonthlyRemaining(payload.subscription);
  return makeVisibleSnapshot('sub2api', {
    remaining,
    monthlyRemaining
  });
}

function addUnique(list, value) {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

function toOriginApiBase(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}/api`;
  } catch {
    return '';
  }
}

function toPathApiBase(value) {
  try {
    const normalized = normalizeBaseUrl(value);
    if (!normalized) return '';
    return normalized.toLowerCase().endsWith('/api') ? normalized : joinUrl(normalized, '/api');
  } catch {
    return '';
  }
}

function toOpenRouterApiBase(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    parsed.hash = '';
    parsed.search = '';
    const origin = parsed.origin;
    const host = parsed.hostname.toLowerCase();
    const pathname = (parsed.pathname || '').replace(/\/+$/, '');
    const lower = pathname.toLowerCase();

    if (!pathname || pathname === '/') {
      return `${origin}/api/v1`;
    }
    if (lower.endsWith('/api/v1')) {
      return `${origin}${pathname}`;
    }
    if (lower.endsWith('/api')) {
      return `${origin}${pathname}/v1`;
    }
    if (lower.endsWith('/v1')) {
      const parent = pathname.slice(0, -3).replace(/\/+$/, '');
      if (!parent || parent === '') return `${origin}/api/v1`;
      if (parent.toLowerCase().endsWith('/api')) return `${origin}${parent}/v1`;
      return `${origin}${parent}/api/v1`;
    }
    if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) {
      return `${origin}/api/v1`;
    }
    return `${origin}${pathname}/api/v1`;
  } catch {
    return '';
  }
}

function buildOpenRouterApiBaseCandidates(baseUrl, channel = {}) {
  const candidates = [];
  const inputs = [
    channel.balanceBaseUrl,
    channel.websiteUrl,
    channel.baseUrl,
    baseUrl
  ].filter(Boolean);

  for (const input of inputs) {
    addUnique(candidates, toOpenRouterApiBase(input));
  }
  return candidates;
}

function buildSiliconFlowApiBaseCandidates(baseUrl, channel = {}) {
  const candidates = [];
  const inputs = [
    channel.balanceBaseUrl,
    channel.websiteUrl,
    channel.baseUrl,
    baseUrl
  ].filter(Boolean);

  for (const input of inputs) {
    try {
      const parsed = new URL(input);
      const origin = parsed.origin;
      const pathname = (parsed.pathname || '').replace(/\/+$/, '');
      const lower = pathname.toLowerCase();
      if (lower.endsWith('/v1')) {
        addUnique(candidates, `${origin}${pathname}`);
      } else {
        addUnique(candidates, `${origin}/v1`);
      }
    } catch {}
  }
  return candidates;
}

function hasGatewayPathSegment(value) {
  try {
    const parsed = new URL(normalizeBaseUrl(value));
    return parsed.pathname
      .split('/')
      .filter(Boolean)
      .some(segment => GATEWAY_PATH_SEGMENTS.has(segment.toLowerCase()));
  } catch {
    return false;
  }
}

function build88CodeApiBaseCandidates(baseUrl, channel = {}) {
  const candidates = [];
  const inputs = [
    channel.balanceBaseUrl,
    channel.websiteUrl,
    channel.baseUrl,
    baseUrl
  ].filter(Boolean);

  for (const input of inputs) {
    const originApiBase = toOriginApiBase(input);
    const pathApiBase = toPathApiBase(input);
    if (hasGatewayPathSegment(input)) {
      addUnique(candidates, originApiBase);
      addUnique(candidates, pathApiBase);
    } else {
      addUnique(candidates, pathApiBase);
      addUnique(candidates, originApiBase);
    }
  }
  return candidates;
}

function get88CodeApiBaseFromStrategy(strategy = {}) {
  return strategy.apiBase || strategy.baseUrl;
}

function get88CodeRequestBody(channel = {}) {
  const model = String(
    channel.model
    || channel.speedTestModel
    || channel.defaultModel
    || ''
  ).trim();
  return model ? { model } : {};
}

function extract88CodeData(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(payload, 'data')) return null;
  return payload.data;
}

function normalize88CodeSubscription(subscription = {}) {
  const plan = subscription.subscriptionPlan && typeof subscription.subscriptionPlan === 'object'
    ? subscription.subscriptionPlan
    : {};
  const creditLimit = parseFiniteNumber(subscription.creditLimit)
    ?? parseFiniteNumber(plan.creditLimit)
    ?? 0;
  return {
    id: parseFiniteNumber(subscription.id) ?? 0,
    planName: String(subscription.subscriptionPlanName || subscription.subscriptionName || plan.subscriptionName || ''),
    status: String(subscription.subscriptionStatus || subscription.status || ''),
    isActive: subscription.isActive === true,
    remainingDays: parseFiniteNumber(subscription.remainingDays) ?? 0,
    creditLimit,
    currentCredits: parseFiniteNumber(subscription.currentCredits) ?? 0
  };
}

function get88CodeBillingPriority(planName) {
  const normalized = String(planName || '').trim().toUpperCase();
  if (normalized === 'FREE') return 3;
  if (normalized === 'PAYGO') return 2;
  return 1;
}

function select88CodeSubscription(subscriptions = []) {
  const active = subscriptions
    .map(normalize88CodeSubscription)
    .filter(subscription => subscription.isActive)
    .filter(subscription => !subscription.status || subscription.status === '活跃中' || subscription.remainingDays > 0)
    .sort((left, right) => {
      const priorityDiff = get88CodeBillingPriority(left.planName) - get88CodeBillingPriority(right.planName);
      if (priorityDiff !== 0) return priorityDiff;
      return left.id - right.id;
    });

  return active.find(subscription => (
    subscription.planName.toUpperCase() !== 'FREE'
      && subscription.creditLimit > 0
      && subscription.currentCredits < subscription.creditLimit
  ))
    || active.find(subscription => (
      subscription.planName.toUpperCase() !== 'FREE'
        && subscription.currentCredits > 0
    ))
    || null;
}

function hasOnly88CodeFreeSubscription(entities = []) {
  const active = Array.isArray(entities)
    ? entities.filter(item => item?.isActive === true)
    : [];
  if (!active.length) return false;
  return !active.some((item) => {
    const name = String(item.subscriptionName || item.subscriptionPlanName || '').toUpperCase();
    return name && name !== 'FREE' && name !== 'PAYGO';
  });
}

function build88CodeBalanceSnapshotFromValues(values = {}) {
  const remainingRaw = parseFiniteNumber(values.currentCredits);
  const totalRaw = parseFiniteNumber(values.creditLimit);
  if (remainingRaw == null && totalRaw == null) {
    return makeHiddenSnapshot('88code');
  }

  const remaining = Math.max(0, remainingRaw ?? 0);
  const total = totalRaw != null && totalRaw > 0 ? totalRaw : undefined;
  const used = total != null ? Math.max(0, total - remaining) : undefined;
  return makeVisibleSnapshot('88code', {
    remaining,
    used,
    total
  });
}

function build88CodeUsageSnapshot(data) {
  if (!data || typeof data !== 'object') return makeHiddenSnapshot('88code');
  const entities = Array.isArray(data.subscriptionEntityList) ? data.subscriptionEntityList : [];
  const activeEntity = entities
    .filter(item => item?.isActive === true)
    .filter(item => String(item.subscriptionName || '').toUpperCase() !== 'FREE')
    .find((item) => {
      const total = parseFiniteNumber(item.creditLimit);
      const remaining = parseFiniteNumber(item.currentCredits);
      return total != null && remaining != null && remaining < total;
    });

  const selected = activeEntity || data;
  return build88CodeBalanceSnapshotFromValues({
    creditLimit: selected.creditLimit,
    currentCredits: selected.currentCredits
  });
}

function is88CodeUsageDataValid(data) {
  if (!data || typeof data !== 'object') return false;
  const creditLimit = parseFiniteNumber(data.creditLimit) ?? 0;
  const entities = Array.isArray(data.subscriptionEntityList) ? data.subscriptionEntityList : [];
  return creditLimit > 0 || entities.length > 0;
}

function build88CodeSubscriptionSnapshot(payload) {
  const data = extract88CodeData(payload);
  const subscriptions = Array.isArray(data) ? data : [];
  const selected = select88CodeSubscription(subscriptions);
  if (!selected) return makeHiddenSnapshot('88code');
  return build88CodeBalanceSnapshotFromValues({
    creditLimit: selected.creditLimit,
    currentCredits: selected.currentCredits
  });
}

async function post88CodeJson(url, token, channel) {
  return requestJson(url, {
    method: 'POST',
    headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
    body: get88CodeRequestBody(channel)
  });
}

async function run88CodeUsageStrategy(strategy, token, channel = {}) {
  const apiBase = get88CodeApiBaseFromStrategy(strategy);
  const payload = await post88CodeJson(joinUrl(apiBase, '/usage'), token, channel);
  const usageData = extract88CodeData(payload);
  if (!is88CodeUsageDataValid(usageData)) return makeHiddenSnapshot('88code');
  const snapshot = build88CodeUsageSnapshot(usageData);
  if (
    snapshot.visible
    && !hasOnly88CodeFreeSubscription(usageData.subscriptionEntityList)
    && Number(snapshot.remaining || 0) > 0
  ) {
    return snapshot;
  }
  return makeHiddenSnapshot('88code');
}

async function run88CodeSubscriptionStrategy(strategy, token, channel = {}) {
  const apiBase = get88CodeApiBaseFromStrategy(strategy);
  const payload = await post88CodeJson(joinUrl(apiBase, '/subscription'), token, channel);
  return build88CodeSubscriptionSnapshot(payload);
}

function buildBalanceProbeStrategies(baseUrl, channel = {}, token = '') {
  const hintedPlatform = detectPlatformByUrlHint(
    channel.providerKey,
    channel.name,
    channel.websiteUrl,
    channel.baseUrl || baseUrl
  );
  const strategies = [];
  const seen = new Set();
  const add = (strategy) => {
    const key = JSON.stringify(strategy);
    if (!seen.has(key)) {
      seen.add(key);
      strategies.push(strategy);
    }
  };
  const addSub2ApiStrategies = () => {
    if (isLikelyModelApiKey(token)) {
      add({ type: 'sub2api-usage', baseUrl });
    } else {
      add({ type: 'sub2api-auth', baseUrl });
      add({ type: 'sub2api-usage', baseUrl });
    }
  };
  const addHubStrategy = () => {
    add({
      type: 'hub-user-self',
      baseUrl,
      platform: HUB_PLATFORMS.has(hintedPlatform) ? hintedPlatform : null,
      hintedPlatform,
      userId: resolveBalanceUserId(channel),
      allowCookieAuth: shouldTryCookieAuth(token, channel, hintedPlatform)
    });
  };
  const addNewApiTokenUsageStrategy = () => {
    add({ type: 'new-api-token-usage', baseUrl });
  };
  const addNewApiTokenUsageWithStatusStrategy = () => {
    add({ type: 'new-api-token-usage-status', baseUrl });
  };
  const add88CodeStrategies = () => {
    for (const apiBase of build88CodeApiBaseCandidates(baseUrl, channel)) {
      add({ type: '88code-usage', baseUrl, apiBase });
      add({ type: '88code-subscription', baseUrl, apiBase });
    }
  };
  const addOpenRouterStrategies = () => {
    for (const apiBase of buildOpenRouterApiBaseCandidates(baseUrl, channel)) {
      add({ type: 'openrouter-key', baseUrl, apiBase, endpoint: '/key' });
      add({ type: 'openrouter-key', baseUrl, apiBase, endpoint: '/auth/key' });
      add({ type: 'openrouter-credits', baseUrl, apiBase });
    }
  };
  const addSiliconFlowStrategies = () => {
    for (const apiBase of buildSiliconFlowApiBaseCandidates(baseUrl, channel)) {
      add({ type: 'siliconflow-user-info', baseUrl, apiBase });
    }
  };

  if (UNSUPPORTED_BALANCE_PLATFORMS.has(hintedPlatform)) {
    add({ type: 'unsupported-balance', platform: hintedPlatform, baseUrl });
    return strategies;
  }

  if (hintedPlatform === 'siliconflow') {
    addSiliconFlowStrategies();
    return strategies;
  }

  if (hintedPlatform === '88code') {
    add88CodeStrategies();
    addSub2ApiStrategies();
    addHubStrategy();
    return strategies;
  }

  if (hintedPlatform === 'openrouter' || isLikelyOpenRouterApiKey(token)) {
    addOpenRouterStrategies();
    addSub2ApiStrategies();
    addNewApiTokenUsageWithStatusStrategy();
    addHubStrategy();
    return strategies;
  }

  if (hintedPlatform === 'sub2api') {
    addSub2ApiStrategies();
    addNewApiTokenUsageWithStatusStrategy();
    addHubStrategy();
    return strategies;
  }

  if (HUB_PLATFORMS.has(hintedPlatform)) {
    if (hintedPlatform === 'new-api') {
      addNewApiTokenUsageWithStatusStrategy();
    }
    addHubStrategy();
    addSub2ApiStrategies();
    return strategies;
  }

  if (isLikelyModelApiKey(token)) {
    addSub2ApiStrategies();
    addNewApiTokenUsageWithStatusStrategy();
    addHubStrategy();
  } else {
    addHubStrategy();
    addNewApiTokenUsageWithStatusStrategy();
    addSub2ApiStrategies();
  }
  return strategies;
}

async function runSub2ApiAuthStrategy(strategy, token) {
  const headers = buildAuthHeaders(token);
  const payload = await tryRequestJson(joinUrl(strategy.baseUrl, '/api/v1/auth/me'), { headers });
  const data = extractSub2ApiData(payload);
  const balance = parseFiniteNumber(data?.balance);
  if (balance == null) return makeHiddenSnapshot('sub2api');

  const summary = await fetchSub2ApiSubscriptionSummary(strategy.baseUrl, headers);
  return makeVisibleSnapshot('sub2api', {
    remaining: balance,
    used: 0,
    total: balance,
    monthlyRemaining: summary.monthlyRemaining
  });
}

async function runSub2ApiUsageStrategy(strategy, token) {
  const payload = await tryRequestJson(joinUrl(strategy.baseUrl, '/v1/usage'), {
    headers: buildAuthHeaders(token)
  });
  return buildSub2ApiUsageSnapshot(payload);
}

async function fetchHubUserSelfWithCookie(baseUrl, token, platform, quotaUnit, userId) {
  for (const cookie of buildCookieCandidates(token)) {
    const payload = await tryRequestJson(joinUrl(baseUrl, '/api/user/self'), {
      headers: {
        Accept: 'application/json',
        Cookie: cookie,
        ...buildUserIdHeaders(userId)
      }
    });
    const snapshot = buildHubBalanceSnapshot(platform, {
      ...payload,
      data: payload?.data && typeof payload.data === 'object'
        ? { ...payload.data, quota_per_unit: quotaUnit || payload.data.quota_per_unit }
        : payload?.data
    });
    if (snapshot.visible) return snapshot;
  }
  return makeHiddenSnapshot(platform);
}

async function runHubUserSelfStrategy(strategy, token) {
  const userId = strategy.userId || null;
  const headers = buildAuthHeaders(token, buildUserIdHeaders(userId));
  let platform = strategy.platform;
  let quotaUnit = null;
  if (!HUB_PLATFORMS.has(platform)) {
    const status = await tryRequestJson(joinUrl(strategy.baseUrl, '/api/status'), { headers: { Accept: 'application/json' } });
    platform = resolveStatusPlatform(status, strategy.hintedPlatform);
    quotaUnit = extractQuotaUnitFromStatus(status);
  }
  if (!HUB_PLATFORMS.has(platform)) return { snapshot: makeHiddenSnapshot(platform), strategy };

  let snapshot = makeHiddenSnapshot(platform);
  try {
    const payload = await requestJson(joinUrl(strategy.baseUrl, '/api/user/self'), { headers });
    snapshot = buildHubBalanceSnapshot(platform, {
      ...payload,
      data: payload?.data && typeof payload.data === 'object'
        ? { ...payload.data, quota_per_unit: quotaUnit || payload.data.quota_per_unit }
        : payload?.data
    });
  } catch (error) {
    if (!strategy.allowCookieAuth) throw error;
  }
  if (!snapshot.visible && strategy.allowCookieAuth) {
    snapshot = await fetchHubUserSelfWithCookie(strategy.baseUrl, token, platform, quotaUnit, userId);
  }
  return {
    snapshot,
    strategy: {
      ...strategy,
      platform,
      quotaUnit: quotaUnit || strategy.quotaUnit
    }
  };
}

async function runNewApiTokenUsageStrategy(strategy, token) {
  const payload = await requestJson(joinUrl(strategy.baseUrl, '/api/usage/token'), {
    headers: buildAuthHeaders(token)
  });
  return buildNewApiTokenUsageSnapshot(payload, { quotaUnit: strategy.quotaUnit || QUOTA_UNIT });
}

async function runNewApiTokenUsageWithStatusStrategy(strategy, token) {
  const status = await tryRequestJson(joinUrl(strategy.baseUrl, '/api/status'), {
    headers: { Accept: 'application/json' }
  });
  const quotaUnit = extractQuotaUnitFromStatus(status) || QUOTA_UNIT;
  const snapshot = await runNewApiTokenUsageStrategy({ ...strategy, quotaUnit }, token);
  return {
    snapshot,
    strategy: {
      ...strategy,
      quotaUnit
    }
  };
}

async function runOpenRouterKeyStrategy(strategy, token) {
  const payload = await requestJson(joinUrl(strategy.apiBase || strategy.baseUrl, strategy.endpoint || '/key'), {
    headers: buildAuthHeaders(token)
  });
  return buildOpenRouterKeySnapshot(payload);
}

async function runOpenRouterCreditsStrategy(strategy, token) {
  const payload = await requestJson(joinUrl(strategy.apiBase || strategy.baseUrl, '/credits'), {
    headers: buildAuthHeaders(token)
  });
  return buildOpenRouterCreditsSnapshot(payload);
}

async function runSiliconFlowUserInfoStrategy(strategy, token) {
  const payload = await requestJson(joinUrl(strategy.apiBase || strategy.baseUrl, '/user/info'), {
    headers: buildAuthHeaders(token)
  });
  return buildSiliconFlowUserInfoSnapshot(payload);
}

async function runBalanceStrategy(strategy, token, channel = {}) {
  if (!strategy || !strategy.type) {
    return { snapshot: makeHiddenSnapshot(), strategy };
  }

  if (strategy.type === '88code-usage') {
    return {
      snapshot: await run88CodeUsageStrategy(strategy, token, channel),
      strategy
    };
  }
  if (strategy.type === '88code-subscription') {
    return {
      snapshot: await run88CodeSubscriptionStrategy(strategy, token, channel),
      strategy
    };
  }
  if (strategy.type === 'sub2api-auth') {
    return {
      snapshot: await runSub2ApiAuthStrategy(strategy, token),
      strategy
    };
  }
  if (strategy.type === 'sub2api-usage') {
    return {
      snapshot: await runSub2ApiUsageStrategy(strategy, token),
      strategy
    };
  }
  if (strategy.type === 'hub-user-self') {
    return runHubUserSelfStrategy(strategy, token);
  }
  if (strategy.type === 'new-api-token-usage') {
    return {
      snapshot: await runNewApiTokenUsageStrategy(strategy, token),
      strategy
    };
  }
  if (strategy.type === 'new-api-token-usage-status') {
    return runNewApiTokenUsageWithStatusStrategy(strategy, token);
  }
  if (strategy.type === 'openrouter-key') {
    return {
      snapshot: await runOpenRouterKeyStrategy(strategy, token),
      strategy
    };
  }
  if (strategy.type === 'openrouter-credits') {
    return {
      snapshot: await runOpenRouterCreditsStrategy(strategy, token),
      strategy
    };
  }
  if (strategy.type === 'unsupported-balance') {
    return {
      snapshot: makeHiddenSnapshot(strategy.platform),
      strategy
    };
  }
  if (strategy.type === 'siliconflow-user-info') {
    return {
      snapshot: await runSiliconFlowUserInfoStrategy(strategy, token),
      strategy
    };
  }

  return { snapshot: makeHiddenSnapshot(), strategy };
}

async function tryBalanceStrategy(strategy, token, channel = {}) {
  try {
    const result = await runBalanceStrategy(strategy, token, channel);
    if (result?.snapshot?.visible) return result;
  } catch {
    // Probe errors are intentionally silent; unsupported balances stay hidden.
  }
  return null;
}

async function probeBalanceFromBase(baseUrl, channel, token) {
  let lastSnapshot = null;
  for (const strategy of buildBalanceProbeStrategies(baseUrl, channel, token)) {
    const result = await tryBalanceStrategy(strategy, token, channel);
    if (result) return result;
    if (!lastSnapshot) {
      lastSnapshot = makeHiddenSnapshot(
        strategy.type?.startsWith('88code') ? '88code'
          : strategy.type?.startsWith('openrouter') ? 'openrouter'
          : strategy.type?.startsWith('siliconflow') ? 'siliconflow'
          : strategy.type?.startsWith('sub2api') ? 'sub2api'
            : strategy.platform || null
      );
    }
  }
  return lastSnapshot ? { snapshot: lastSnapshot, strategy: null } : null;
}

function buildCacheKey(source, channel) {
  const token = resolveBalanceToken(channel);
  const tokenHash = token
    ? crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
    : 'no-token';
  return [
    source,
    channel.id || channel.name || 'unknown',
    normalizeBaseUrl(channel.baseUrl || ''),
    tokenHash
  ].join(':');
}

async function refreshChannelBalanceSnapshot(source, channel, options = {}) {
  const force = options.force === true;
  const currentTime = options.now || Date.now();
  const key = buildCacheKey(source, channel);
  const cached = balanceCache.get(key);

  if (!force && cached && cached.expiresAt > currentTime) {
    return cached.snapshot;
  }

  const bases = buildBaseCandidates(channel.baseUrl);
  if (!bases.length || !resolveBalanceToken(channel)) {
    return makeHiddenSnapshot(null, { updatedAt: nowIso(currentTime) });
  }

  let lastSnapshot = null;
  const token = resolveBalanceToken(channel);
  loadPersistedStrategyCache();
  const cachedStrategy = balanceStrategyCache.get(key);
  if (cachedStrategy) {
    const strategyResult = await tryBalanceStrategy(cachedStrategy, token, channel);
    if (strategyResult?.snapshot?.visible) {
      rememberBalanceStrategy(key, strategyResult.strategy);
      balanceCache.set(key, {
        snapshot: strategyResult.snapshot,
        expiresAt: currentTime + CACHE_TTL_MS
      });
      return strategyResult.snapshot;
    }
    forgetBalanceStrategy(key);
  }

  for (const baseUrl of bases) {
    const result = await probeBalanceFromBase(baseUrl, channel, token);
    if (result?.snapshot?.visible) {
      rememberBalanceStrategy(key, result.strategy);
      balanceCache.set(key, {
        snapshot: result.snapshot,
        expiresAt: currentTime + CACHE_TTL_MS
      });
      return result.snapshot;
    }
    lastSnapshot = result?.snapshot || makeHiddenSnapshot(null, { updatedAt: nowIso(currentTime) });
  }

  if (cached?.snapshot?.visible) {
    const staleSnapshot = {
      ...cached.snapshot,
      stale: true
    };
    balanceCache.set(key, {
      snapshot: staleSnapshot,
      expiresAt: currentTime + CACHE_TTL_MS
    });
    return staleSnapshot;
  }

  return lastSnapshot || makeHiddenSnapshot(null, { updatedAt: nowIso(currentTime) });
}

function getChannelsForSource(source) {
  if (source === 'claude') {
    return require('./channels').getAllChannels() || [];
  }
  if (source === 'codex') {
    return require('./codex-channels').getChannels().channels || [];
  }
  if (source === 'gemini') {
    return require('./gemini-channels').getChannels().channels || [];
  }
  if (source === 'opencode') {
    return require('./opencode-channels').getChannels().channels || [];
  }
  return [];
}

function getEnabledBalanceChannels(source) {
  return getChannelsForSource(source).filter(channel => channel?.enabled !== false);
}

function isBalanceDisplayEnabled() {
  try {
    return loadUIConfig().channelBalance?.showRemaining === true;
  } catch {
    return false;
  }
}

function validateSource(source) {
  const normalized = String(source || '').trim().toLowerCase();
  if (!VALID_SOURCES.has(normalized)) {
    throw new Error('Invalid channel balance source');
  }
  return normalized;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getChannelBalances(source, options = {}) {
  const normalizedSource = validateSource(source);
  if (!isBalanceDisplayEnabled()) {
    return { enabled: false, source: normalizedSource, balances: {} };
  }

  const channels = getEnabledBalanceChannels(normalizedSource);
  const entries = await mapWithConcurrency(channels, 4, async (channel) => {
    const snapshot = await refreshChannelBalanceSnapshot(normalizedSource, channel, options);
    return [channel.id, snapshot];
  });

  return {
    enabled: true,
    source: normalizedSource,
    balances: Object.fromEntries(entries.filter(([id]) => id))
  };
}

async function refreshChannelBalance(source, channelId) {
  const normalizedSource = validateSource(source);
  if (!isBalanceDisplayEnabled()) {
    return { enabled: false, source: normalizedSource, channelId, balance: makeHiddenSnapshot() };
  }

  const channels = getEnabledBalanceChannels(normalizedSource);
  const channel = channels.find(item => String(item.id) === String(channelId));
  if (!channel) {
    const error = new Error('Channel not found');
    error.statusCode = 404;
    throw error;
  }

  const balance = await refreshChannelBalanceSnapshot(normalizedSource, channel, { force: true });
  return {
    enabled: true,
    source: normalizedSource,
    channelId,
    balance
  };
}

function clearBalanceCache() {
  balanceCache.clear();
  balanceStrategyCache.clear();
  strategyCacheLoaded = false;
}

module.exports = {
  getChannelBalances,
  refreshChannelBalance,
  _test: {
    clearBalanceCache,
    normalizeBaseUrl,
    buildBaseCandidates,
    buildHubBalanceSnapshot,
    buildNewApiTokenUsageSnapshot,
    buildOpenRouterKeySnapshot,
    buildOpenRouterCreditsSnapshot,
    buildSiliconFlowUserInfoSnapshot,
    detectPlatformByUrlHint,
    isSub2ApiUsagePayload,
    buildSub2ApiUsageSnapshot,
    resolveStatusPlatform,
    resolveBalanceToken,
    resolveBalanceUserId,
    buildCookieCandidates,
    build88CodeApiBaseCandidates,
    buildOpenRouterApiBaseCandidates,
    buildSiliconFlowApiBaseCandidates,
    build88CodeUsageSnapshot,
    build88CodeSubscriptionSnapshot,
    buildBalanceProbeStrategies,
    getEnabledBalanceChannels,
    runBalanceStrategy,
    refreshChannelBalanceSnapshot,
    makeVisibleSnapshot,
    requestJson
  }
};
