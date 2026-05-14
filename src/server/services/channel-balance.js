const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { loadUIConfig } = require('./ui-config');

const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const QUOTA_UNIT = 500000;
const VELOERA_QUOTA_UNIT = 1000000;
const VALID_SOURCES = new Set(['claude', 'codex', 'gemini', 'opencode']);

const balanceCache = new Map();

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function stripBearer(value) {
  const token = String(value || '').trim();
  return token.toLowerCase().startsWith('bearer ') ? token.slice(7).trim() : token;
}

function buildAuthHeaders(token, extra = {}) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${stripBearer(token)}`,
    ...extra
  };
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

function requestJson(url, { headers = {}, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers
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
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(`HTTP ${res.statusCode}`);
          error.statusCode = res.statusCode;
          reject(error);
          return;
        }
        try {
          resolve(raw ? JSON.parse(raw) : null);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('request timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function tryRequestJson(url, options) {
  try {
    return await requestJson(url, options);
  } catch {
    return null;
  }
}

function detectPlatformByUrlHint(baseUrl) {
  const value = String(baseUrl || '').toLowerCase();
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
  if (!payload || payload.success !== true) return null;
  const systemName = typeof payload?.data?.system_name === 'string'
    ? payload.data.system_name.toLowerCase()
    : '';
  const version = typeof payload?.data?.version === 'string'
    ? payload.data.version.toLowerCase()
    : '';

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

async function detectPlatform(baseUrl, token, hintedPlatform = null) {
  const headers = buildAuthHeaders(token);

  if (hintedPlatform === 'sub2api') {
    return 'sub2api';
  }

  const status = await tryRequestJson(joinUrl(baseUrl, '/api/status'), { headers: { Accept: 'application/json' } });
  const statusPlatform = resolveStatusPlatform(status, hintedPlatform);
  if (statusPlatform) return statusPlatform;

  const sub2Payload = await tryRequestJson(joinUrl(baseUrl, '/api/v1/auth/me'), { headers });
  const sub2Data = extractSub2ApiData(sub2Payload);
  if (sub2Data && Object.prototype.hasOwnProperty.call(sub2Data, 'balance')) {
    return 'sub2api';
  }

  return hintedPlatform;
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

  const unit = platform === 'veloera' ? VELOERA_QUOTA_UNIT : QUOTA_UNIT;
  const quotaRaw = parseFiniteNumber(data.quota);
  const usedRaw = parseFiniteNumber(data.used_quota);
  if (quotaRaw == null) return makeHiddenSnapshot(platform);

  const quota = quotaRaw / unit;
  const used = (usedRaw || 0) / unit;
  let remaining;
  let total;

  if (platform === 'new-api' || platform === 'anyrouter' || platform === 'done-hub') {
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

async function fetchSub2ApiBalance(baseUrl, token) {
  const headers = buildAuthHeaders(token);
  const payload = await requestJson(joinUrl(baseUrl, '/api/v1/auth/me'), { headers });
  const data = extractSub2ApiData(payload);
  const balance = parseFiniteNumber(data?.balance);
  if (balance == null) return makeHiddenSnapshot('sub2api');

  const summary = await fetchSub2ApiSubscriptionSummary(baseUrl, headers);
  return makeVisibleSnapshot('sub2api', {
    remaining: balance,
    used: 0,
    total: balance,
    monthlyRemaining: summary.monthlyRemaining
  });
}

async function fetchHubBalance(baseUrl, token, platform) {
  const headers = buildAuthHeaders(token);
  const payload = await requestJson(joinUrl(baseUrl, '/api/user/self'), { headers });
  return buildHubBalanceSnapshot(platform, payload);
}

async function fetchBalanceFromBase(baseUrl, channel) {
  const token = stripBearer(channel.apiKey || channel.token || channel.authToken || '');
  if (!baseUrl || !token) return makeHiddenSnapshot();

  const hintedPlatform = detectPlatformByUrlHint(channel.baseUrl || baseUrl);
  const platform = await detectPlatform(baseUrl, token, hintedPlatform);
  if (!platform) return makeHiddenSnapshot();

  if (platform === 'sub2api') {
    return fetchSub2ApiBalance(baseUrl, token);
  }

  if (['new-api', 'one-api', 'one-hub', 'done-hub', 'veloera', 'anyrouter'].includes(platform)) {
    return fetchHubBalance(baseUrl, token, platform);
  }

  return makeHiddenSnapshot(platform);
}

function buildCacheKey(source, channel) {
  const token = stripBearer(channel.apiKey || channel.token || channel.authToken || '');
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
  if (!bases.length || !stripBearer(channel.apiKey || channel.token || channel.authToken || '')) {
    return makeHiddenSnapshot(null, { updatedAt: nowIso(currentTime) });
  }

  let lastSnapshot = null;
  for (const baseUrl of bases) {
    try {
      const snapshot = await fetchBalanceFromBase(baseUrl, channel);
      if (snapshot?.visible) {
        balanceCache.set(key, {
          snapshot,
          expiresAt: currentTime + CACHE_TTL_MS
        });
        return snapshot;
      }
      lastSnapshot = snapshot || lastSnapshot;
    } catch {
      // Try the next normalized base candidate.
    }
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

  const channels = getChannelsForSource(normalizedSource);
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

  const channels = getChannelsForSource(normalizedSource);
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
}

module.exports = {
  getChannelBalances,
  refreshChannelBalance,
  _test: {
    clearBalanceCache,
    normalizeBaseUrl,
    buildBaseCandidates,
    buildHubBalanceSnapshot,
    detectPlatformByUrlHint,
    resolveStatusPlatform,
    refreshChannelBalanceSnapshot,
    makeVisibleSnapshot,
    requestJson
  }
};
