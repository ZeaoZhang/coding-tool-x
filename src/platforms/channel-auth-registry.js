'use strict';

const { readAllNativeOAuth } = require('./native-oauth-adapters');
const oauthStore = require('./oauth-credentials-service');
const { getOmpAuthProviderSnapshot } = require('./drivers/omp/auth-providers');

function getRegistry() {
  return require('./registry').createPlatformRegistry();
}

function safeRef(value = {}) {
  return {
    credentialId: String(value.credentialId || '').trim(),
    providerId: String(value.providerId || '').trim(),
    accountId: String(value.accountId || '').trim(),
    identityKey: String(value.identityKey || '').trim(),
    accountEmail: String(value.accountEmail || '').trim()
  };
}

function nativeCandidate(adapter, metadata, credential) {
  const ref = safeRef({
    credentialId: credential?.id,
    providerId: metadata.providerId || credential?.providerId,
    accountId: metadata.accountId || credential?.accountId,
    identityKey: metadata.identityKey,
    accountEmail: metadata.accountEmail || credential?.accountEmail
  });
  return {
    id: ref.credentialId || `${adapter}:${ref.accountId || ref.identityKey || ref.accountEmail || ref.providerId}`,
    tool: adapter,
    authMode: 'oauth',
    authRef: ref,
    authSource: 'synced-local',
    authStatus: 'available',
    providerId: ref.providerId,
    accountId: ref.accountId,
    accountEmail: ref.accountEmail,
    expiresAt: credential?.expiresAt || metadata.expiresAt || null,
    lastSyncAt: credential?.updatedAt || new Date().toISOString()
  };
}

function scanNative(adapter) {
  const native = readAllNativeOAuth(adapter) || [];
  const synced = native.length ? oauthStore.syncLocalCredential(adapter) : null;
  const credentials = synced?.credentials || [];
  const candidates = native.map((metadata, index) => nativeCandidate(adapter, metadata, credentials[index]));
  return {
    candidates,
    nativeState: {
      available: candidates.length > 0,
      candidateCount: candidates.length,
      checkedAt: new Date().toISOString()
    },
    warnings: candidates.length ? [] : [`${adapter}: unavailable: no local OAuth credential`]
  };
}

function scanOmp() {
  const snapshot = getOmpAuthProviderSnapshot({ forceRefresh: true, accountCheck: true });
  const hasAccounts = (snapshot.providers || []).some(provider => (
    provider.loggedIn === true && Array.isArray(provider.accounts) && provider.accounts.length > 0
  ));
  let synced = null;
  if (hasAccounts) {
    try {
      synced = oauthStore.syncLocalCredential('omp');
    } catch {
      synced = null;
    }
  }
  const credentials = synced?.credentials || [];
  const candidates = [];
  for (const provider of snapshot.providers || []) {
    if (provider.loggedIn !== true || !Array.isArray(provider.accounts) || provider.accounts.length === 0) continue;
    for (const account of provider.accounts) {
      const accountId = account.id || account.accountId || account.index;
      const accountEmail = account.email || account.accountEmail || account.identity;
      const identityKey = account.identityKey || accountEmail || accountId;
      const credential = credentials.find(item => (
        item.providerId === provider.id
        && (item.accountId === String(accountId || '') || item.accountEmail === String(accountEmail || ''))
      ));
      const ref = safeRef({
        credentialId: credential?.id,
        providerId: provider.id,
        accountId,
        identityKey,
        accountEmail
      });
      if (!ref.accountId && !ref.identityKey && (provider.accounts || []).length > 1) continue;
      candidates.push({
        id: credential?.id || `omp:${provider.id}:${ref.accountId || ref.identityKey || 'account'}`,
        tool: 'omp',
        authMode: 'oauth',
        authRef: ref,
        authSource: 'synced-local',
        authStatus: ref.accountId || ref.identityKey ? 'available' : 'ambiguous',
        oauthProviderId: provider.id,
        providerId: provider.id,
        accountId: ref.accountId,
        accountEmail: ref.accountEmail
      });
    }
  }
  return {
    candidates,
    nativeState: { available: snapshot.available === true, providers: snapshot.providers || [], checkedAt: snapshot.checkedAt },
    warnings: candidates.length ? [] : [snapshot.reason || 'omp: unavailable: no logged-in local provider']
  };
}

const adapters = Object.freeze({
  claude: {
    scan: () => scanNative('claude'),
    quota: (ref) => oauthStore.fetchCredentialUsage('claude', ref.credentialId),
    channelServicePath: './drivers/claude/channels-implementation'
  },
  codex: {
    scan: () => scanNative('codex'),
    quota: (ref) => oauthStore.fetchCredentialUsage('codex', ref.credentialId),
    channelServicePath: './drivers/codex/channels-implementation'
  },
  gemini: {
    scan: () => scanNative('gemini'),
    quota: (ref) => oauthStore.fetchCredentialUsage('gemini', ref.credentialId),
    channelServicePath: './drivers/gemini/channels-implementation'
  },
  omp: {
    scan: scanOmp,
    quota: async () => ({ status: 'unavailable', error: 'OMP native OAuth quota is unavailable' }),
    channelServicePath: './drivers/omp/channels-implementation'
  }
});

function getOAuthManifests() {
  return getRegistry().list({ enabledOnly: false }).filter(manifest => (
    manifest.auth?.oauth?.adapter && adapters[manifest.auth.oauth.adapter]
  ));
}
function getChannelAuthAdapter(platform) {
  const key = String(platform || '').trim().toLowerCase();
  const manifest = getOAuthManifests().find(item => item.key === key);
  const adapterId = manifest?.auth?.oauth?.adapter;
  const adapter = adapterId ? adapters[adapterId] : null;
  if (!adapter) return null;
  return {
    ...adapter,
    platform: manifest.key,
    adapterId,
    policy: manifest.auth.oauth.policy,
    quotaId: manifest.auth.oauth.quota || null
  };
}

function listChannelAuthPlatforms() {
  return getOAuthManifests().map(manifest => manifest.key);
}


module.exports = { getChannelAuthAdapter, listChannelAuthPlatforms, safeRef };
