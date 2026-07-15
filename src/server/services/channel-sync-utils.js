const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS, ensureStorageDirMigrated } = require('../../config/paths');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  return raw.replace(/\/+$/, '').toLowerCase();
}

function isLocalProxyBaseUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = normalizeLower(parsed.hostname).replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return raw.includes('127.0.0.1') || raw.includes('localhost');
  }
}

function isProxyCredential(value) {
  const raw = normalizeString(value);
  return raw === 'PROXY_KEY' || raw === 'CC_PROXY_KEY';
}

function parseEnvReference(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  let match = raw.match(/^\$\{?([A-Z_][A-Z0-9_]*)\}?$/);
  if (match) return match[1];
  match = raw.match(/^env:([A-Z_][A-Z0-9_]*)$/i);
  if (match) return match[1].toUpperCase();
  match = raw.match(/^process\.env\.([A-Z_][A-Z0-9_]*)$/);
  if (match) return match[1];
  if (/^[A-Z_][A-Z0-9_]*$/.test(raw) && /(?:API|KEY|TOKEN|SECRET|AUTH)/.test(raw)) {
    return raw;
  }
  return '';
}

function resolveApiKeyValue(value, env = process.env) {
  const raw = normalizeString(value);
  if (!raw || isProxyCredential(raw)) {
    return { value: '', source: '', envName: '' };
  }

  const envName = parseEnvReference(raw);
  if (envName) {
    const envValue = normalizeString(env?.[envName]);
    if (isProxyCredential(envValue)) {
      return { value: '', source: 'proxy-env', envName };
    }
    return {
      value: envValue,
      source: envValue ? 'env' : 'env-missing',
      envName
    };
  }

  return { value: raw, source: 'config', envName: '' };
}

function readActiveChannelId(platform) {
  try {
    ensureStorageDirMigrated?.();
    const filePath = PATHS.activeChannel?.[platform];
    if (!filePath || !fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data?.activeChannelId || null;
  } catch {
    return null;
  }
}

function selectLatestEnabledChannel(channels = []) {
  const enabledChannels = (Array.isArray(channels) ? channels : [])
    .filter(channel => channel && channel.enabled !== false);
  if (enabledChannels.length === 0) return null;
  return enabledChannels.reduce((latest, current) => {
    const latestTs = Number(latest?.updatedAt || latest?.createdAt || 0);
    const currentTs = Number(current?.updatedAt || current?.createdAt || 0);
    return currentTs > latestTs ? current : latest;
  }, enabledChannels[0]);
}

function resolveExistingActiveChannel(platform, channels = []) {
  const allChannels = Array.isArray(channels) ? channels : [];
  const activeChannelId = readActiveChannelId(platform);
  if (activeChannelId) {
    const matched = allChannels.find(channel => channel.id === activeChannelId);
    if (matched) return matched;
  }
  return selectLatestEnabledChannel(allChannels)
    || allChannels.find(channel => channel.enabled !== false)
    || allChannels[0]
    || null;
}

function secretHash(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function channelIdentity(channel = {}) {
  return {
    id: normalizeString(channel.id),
    providerKey: normalizeLower(channel.providerKey || channel.provider),
    baseUrl: normalizeUrl(channel.baseUrl),
    apiKeyHash: secretHash(channel.apiKey || channel.key),
    model: normalizeLower(channel.model),
    name: normalizeLower(channel.name)
  };
}

function defaultFindExistingChannel(channels = [], candidate = {}, options = {}) {
  const target = channelIdentity(candidate);
  const candidateId = normalizeString(candidate.id);
  if (candidateId) {
    const byId = channels.find(channel => channel.id === candidateId);
    if (byId) return byId;
  }

  const matchers = Array.isArray(options.matchers) ? options.matchers : [];
  for (const matcher of matchers) {
    const matched = channels.find(channel => matcher(channel, candidate));
    if (matched) return matched;
  }

  if (target.providerKey) {
    const byProvider = channels.find(channel => channelIdentity(channel).providerKey === target.providerKey);
    if (byProvider) return byProvider;
  }

  if (target.baseUrl && target.apiKeyHash) {
    const byUrlAndKey = channels.find((channel) => {
      const identity = channelIdentity(channel);
      return identity.baseUrl === target.baseUrl && identity.apiKeyHash === target.apiKeyHash;
    });
    if (byUrlAndKey) return byUrlAndKey;
  }

  if (target.baseUrl && target.model) {
    const byUrlAndModel = channels.find((channel) => {
      const identity = channelIdentity(channel);
      return identity.baseUrl === target.baseUrl && identity.model === target.model;
    });
    if (byUrlAndModel) return byUrlAndModel;
  }

  if (target.baseUrl) {
    return channels.find(channel => channelIdentity(channel).baseUrl === target.baseUrl) || null;
  }

  return null;
}

function shouldPreserveField(field, existing, candidate) {
  if (field === 'name') {
    return normalizeString(existing?.name) && normalizeLower(existing.name) !== 'default';
  }
  return Object.prototype.hasOwnProperty.call(existing || {}, field)
    && !Object.prototype.hasOwnProperty.call(candidate || {}, field);
}

function mergeSyncedChannel(existing, candidate, options = {}) {
  const preserveFields = options.preserveFields || [
    'id',
    'createdAt',
    'name',
    'enabled',
    'weight',
    'maxConcurrency',
    'balanceToken',
    'balanceUserId'
  ];

  const merged = {
    ...existing,
    ...candidate,
    id: existing.id,
    createdAt: existing.createdAt || candidate.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  for (const field of preserveFields) {
    if (shouldPreserveField(field, existing, candidate)) {
      merged[field] = existing[field];
    }
  }

  return merged;
}

function stableComparableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableComparableValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = stableComparableValue(value[key]);
      return acc;
    }, {});
}

function comparableChannel(channel = {}) {
  const copy = { ...channel };
  delete copy.updatedAt;
  delete copy.health;
  delete copy.websiteUrl;
  return JSON.stringify(stableComparableValue(copy));
}

function sanitizeChannel(channel) {
  if (!channel) return null;
  const sanitized = {
    id: channel.id,
    name: channel.name,
    baseUrl: channel.baseUrl,
    enabled: channel.enabled !== false
  };
  if (channel.providerKey) sanitized.providerKey = channel.providerKey;
  if (channel.model) sanitized.model = channel.model;
  if (channel.credentialSource) sanitized.credentialSource = channel.credentialSource;
  return sanitized;
}

function createSkippedResult(toolType, warning, channel = null) {
  return {
    success: true,
    toolType,
    added: 0,
    updated: 0,
    skipped: 1,
    channels: channel ? [sanitizeChannel(channel)] : [],
    warnings: warning ? [warning] : []
  };
}

function upsertSyncedChannels({
  toolType,
  loadChannels,
  saveChannels,
  applyDefaults,
  candidates,
  matchers,
  preserveFields
}) {
  const data = loadChannels();
  const channels = Array.isArray(data?.channels) ? [...data.channels] : [];
  const result = {
    success: true,
    toolType,
    added: 0,
    updated: 0,
    skipped: 0,
    channels: [],
    warnings: []
  };

  let changed = false;
  for (const rawCandidate of candidates || []) {
    const candidate = rawCandidate || {};
    if (candidate.warning) {
      result.warnings.push(candidate.warning);
    }
    if (candidate.skip) {
      result.skipped += 1;
      if (candidate.channel) result.channels.push(sanitizeChannel(candidate.channel));
      continue;
    }
    if (!normalizeString(candidate.baseUrl)) {
      result.skipped += 1;
      result.warnings.push(`${toolType}: missing baseUrl, skipped current channel sync`);
      continue;
    }
    if (!normalizeString(candidate.apiKey)) {
      result.skipped += 1;
      result.warnings.push(`${toolType}: missing API key or OAuth-only config, skipped current channel sync`);
      continue;
    }

    const normalizedCandidate = applyDefaults ? applyDefaults(candidate) : candidate;
    const existing = defaultFindExistingChannel(channels, normalizedCandidate, { matchers });
    if (existing) {
      const merged = applyDefaults
        ? applyDefaults(mergeSyncedChannel(existing, normalizedCandidate, { preserveFields }))
        : mergeSyncedChannel(existing, normalizedCandidate, { preserveFields });
      if (comparableChannel(existing) === comparableChannel(merged)) {
        result.skipped += 1;
        result.channels.push(sanitizeChannel(existing));
        continue;
      }
      const index = channels.findIndex(channel => channel.id === existing.id);
      channels[index] = merged;
      changed = true;
      result.updated += 1;
      result.channels.push(sanitizeChannel(merged));
      continue;
    }

    const now = Date.now();
    const created = applyDefaults ? applyDefaults({
      id: candidate.id || crypto.randomUUID(),
      enabled: candidate.enabled !== false,
      weight: candidate.weight || 1,
      maxConcurrency: candidate.maxConcurrency || null,
      ...normalizedCandidate,
      createdAt: now,
      updatedAt: now
    }) : {
      id: candidate.id || crypto.randomUUID(),
      enabled: candidate.enabled !== false,
      weight: candidate.weight || 1,
      maxConcurrency: candidate.maxConcurrency || null,
      ...normalizedCandidate,
      createdAt: now,
      updatedAt: now
    };
    channels.push(created);
    changed = true;
    result.added += 1;
    result.channels.push(sanitizeChannel(created));
  }

  if (changed) {
    const dir = path.dirname(loadChannels.filePath || '');
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    saveChannels({ ...data, channels });
  }

  result.warnings = [...new Set(result.warnings.filter(Boolean))];
  return result;
}

module.exports = {
  createSkippedResult,
  defaultFindExistingChannel,
  isLocalProxyBaseUrl,
  isProxyCredential,
  normalizeLower,
  normalizeString,
  normalizeUrl,
  readActiveChannelId,
  resolveApiKeyValue,
  resolveExistingActiveChannel,
  sanitizeChannel,
  secretHash,
  selectLatestEnabledChannel,
  upsertSyncedChannels
};
