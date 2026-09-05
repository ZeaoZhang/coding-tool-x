'use strict';

const manifests = [
  require('./manifests/claude.json'),
  require('./manifests/codex.json'),
  require('./manifests/gemini.json'),
  require('./manifests/omp.json')
];
const { readAllNativeOAuth } = require('./native-oauth-adapters');
const oauthStore = require('./oauth-credentials-service');
const { getOmpAuthProviderSnapshot } = require('./drivers/omp/auth-providers');

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
  const candidates = [];
  for (const provider of snapshot.providers || []) {
    if (provider.loggedIn !== true) continue;
    for (const account of provider.accounts || [{}]) {
      const ref = safeRef({
        providerId: provider.id,
        accountId: account.id || account.accountId,
        identityKey: account.identityKey,
        accountEmail: account.email || account.accountEmail
      });
      if (!ref.accountId && !ref.identityKey && (provider.accounts || []).length > 1) continue;
      candidates.push({
        id: `omp:${provider.id}:${ref.accountId || ref.identityKey || 'account'}`,
        tool: 'omp',
        authMode: 'oauth',
        authRef: ref,
        authSource: 'synced-local',
        authStatus: ref.accountId || ref.identityKey ? 'available' : 'ambiguous',
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
  claude: { scan: () => scanNative('claude'), quota: (ref) => oauthStore.fetchCredentialUsage('claude', ref.credentialId) },
  codex: { scan: () => scanNative('codex'), quota: (ref) => oauthStore.fetchCredentialUsage('codex', ref.credentialId) },
  gemini: { scan: () => scanNative('gemini'), quota: (ref) => oauthStore.fetchCredentialUsage('gemini', ref.credentialId) },
  omp: { scan: scanOmp, quota: async () => ({ status: 'unavailable', error: 'OMP native OAuth quota is unavailable' }) }
});

const manifestByKey = new Map(manifests.map(manifest => [manifest.key, manifest]));
const keyByAdapter = new Map(Object.entries(adapters).map(([key]) => [key, key]));

function getChannelAuthAdapter(platform) {
  const manifest = manifestByKey.get(String(platform || '').trim().toLowerCase());
  const adapterId = manifest?.auth?.oauth?.adapter;
  const adapter = adapterId ? adapters[adapterId] : null;
  if (!adapter) return null;
  return {
    ...adapter,
    platform: manifest.key,
    adapterId,
    policy: manifest.auth.oauth.policy,
    quotaId: manifest.auth.oauth.quota || null,
    channelServicePath: `./drivers/${manifest.key}/channels-implementation`
  };
}

function listChannelAuthPlatforms() {
  return [...keyByAdapter.keys()].filter(platform => getChannelAuthAdapter(platform));
}

module.exports = { getChannelAuthAdapter, listChannelAuthPlatforms, safeRef };
