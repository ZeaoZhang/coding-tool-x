'use strict';

const { getChannelAuthAdapter, listChannelAuthPlatforms, safeRef } = require('./channel-auth-registry');

const quotaCache = new Map();
const QUOTA_TTL_MS = 5 * 60 * 1000;

function getAdapter(platform) {
  const adapter = getChannelAuthAdapter(platform);
  if (!adapter) throw new Error(`Unsupported channel auth platform: ${platform}`);
  return adapter;
}

function matchChannel(channel, candidate) {
  if (!channel || channel.authMode !== 'oauth') return false;
  const ref = safeRef(channel.authRef);
  const next = safeRef(candidate.authRef);
  if (ref.credentialId && next.credentialId) return ref.credentialId === next.credentialId;
  if (ref.providerId && next.providerId && (ref.accountId || ref.identityKey) && (next.accountId || next.identityKey)) {
    return ref.providerId === next.providerId
      && (ref.accountId || ref.identityKey) === (next.accountId || next.identityKey);
  }
  return false;
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
  const ref = safeRef(channel.authRef);
  const cacheKey = `${adapter.adapterId}:${ref.credentialId || ref.providerId}:${ref.accountId || ref.identityKey}`;
  const cached = quotaCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.checkedAtMs < QUOTA_TTL_MS) return cached.value;
  try {
    const usage = await adapter.quota(ref);
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
  matchChannel
};
