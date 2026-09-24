'use strict';

const { getChannelAuthAdapter, listChannelAuthPlatforms, safeRef } = require('./channel-auth-registry');

const quotaCache = new Map();
const QUOTA_TTL_MS = 60 * 1000;

function getAdapter(platform) {
  const adapter = getChannelAuthAdapter(platform);
  if (!adapter) throw new Error(`Unsupported channel auth platform: ${platform}`);
  return adapter;
}

function matchChannel(channel, candidate) {
  if (!channel || channel.authMode !== 'oauth') return false;
  const ref = safeRef(channel.authRef);
  const next = safeRef(candidate.authRef);
  if (ref.credentialId && next.credentialId && ref.credentialId === next.credentialId) return true;
  if ((ref.accountId || ref.identityKey) && (next.accountId || next.identityKey)) {
    const sameProvider = !ref.providerId || !next.providerId || ref.providerId === next.providerId;
    return sameProvider && (ref.accountId || ref.identityKey) === (next.accountId || next.identityKey);
  }
  if (ref.accountEmail && next.accountEmail) return ref.accountEmail === next.accountEmail;
  return false;
}

function resolveChannelAuthRef(adapter, channel) {
  const current = safeRef(channel?.authRef);
  let scanned;
  try {
    scanned = adapter.scan();
  } catch {
    return current;
  }

  const candidates = Array.isArray(scanned?.candidates) ? scanned.candidates : [];
  const matched = candidates.find(candidate => matchChannel(channel, candidate));
  if (matched) return safeRef(matched.authRef);

  // A channel may retain an old account ID after the local OAuth store rotates
  // credentials. When there is exactly one account for the same provider, it
  // is safe to rebind the stale reference for quota lookup.
  const soleCandidate = candidates.length === 1 ? candidates[0] : null;
  const soleRef = safeRef(soleCandidate?.authRef);
  const providerId = current.providerId || String(channel?.oauthProviderId || '').trim();
  if (soleCandidate && providerId && soleRef.providerId === providerId) {
    return soleRef;
  }

  // A channel created before OAuth credentials were synced can have no stable
  // reference. Only auto-select when the local scan found exactly one account.
  if (!current.credentialId && !current.providerId && !current.accountId
    && !current.identityKey && !current.accountEmail && soleCandidate) {
    return soleRef;
  }

  return current;
}

function getChannel(platform, channelId) {
  if (!channelId) return null;
  const adapter = getAdapter(platform);
  const service = require(adapter.channelServicePath);
  return (service.getChannels?.().channels || []).find(channel => channel.id === channelId) || null;
}

function getChannelAuth(platform, { channelId = '' } = {}) {
  const adapter = getAdapter(platform);
  const result = adapter.scan();
  return {
    channel: getChannel(platform, channelId),
    candidates: result.candidates || [],
    nativeState: result.nativeState || { available: false },
    warnings: result.warnings || []
  };
}

function syncLocalChannelAuth(platform, options = {}) {
  return getChannelAuth(platform, options);
}

async function fetchChannelAuthQuota(platform, channelId, { refresh = false } = {}) {
  const adapter = getAdapter(platform);
  const checkedAt = () => new Date().toISOString();
  const channel = getChannel(platform, channelId);
  if (!channel) return { quota: null, status: 'unavailable', checkedAt: checkedAt(), warning: 'Channel not found' };
  if (channel.authMode !== 'oauth') return { quota: null, status: 'unsupported', checkedAt: checkedAt(), warning: 'Channel is not OAuth' };
  const ref = resolveChannelAuthRef(adapter, channel);
  const cacheKey = `${adapter.adapterId}:${channelId}:${ref.credentialId || ref.providerId}:${ref.accountId || ref.identityKey || ref.accountEmail}`;
  const cached = quotaCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.checkedAtMs < QUOTA_TTL_MS) return cached.value;
  try {
    const usage = await (adapter.usage || adapter.quota)(ref);
    const result = {
      ...(usage?.quota ? usage : {
        quota: null,
        status: usage?.status || 'unavailable',
        warning: usage?.error || 'Quota unavailable'
      }),
      checkedAt: checkedAt()
    };
    quotaCache.set(cacheKey, { checkedAtMs: Date.now(), value: result });
    return result;
  } catch (error) {
    return { quota: null, status: 'unavailable', checkedAt: checkedAt(), warning: error.message };
  }
}

module.exports = {
  getChannelAuth,
  syncLocalChannelAuth,
  fetchChannelAuthQuota,
  listChannelAuthPlatforms,
  safeRef,
  matchChannel,
  resolveChannelAuthRef
};
