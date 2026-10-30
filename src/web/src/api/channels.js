import { client, normalizePlatformKey } from './client'
import {
  callPlatformRoute,
  clearPlatformRouteCache,
  getPlatformRouteUrl
} from './platforms'

export { callPlatformRoute, clearPlatformRouteCache, getPlatformRouteUrl }

function channelOperation(platform, operation, options) {
  return callPlatformRoute(platform, 'channels', operation, options)
}

export function getPlatformChannels(platform) {
  return channelOperation(platform, 'list')
}

export function createPlatformChannel(platform, payload) {
  return channelOperation(platform, 'create', { body: payload })
}

export function updatePlatformChannel(platform, channelId, payload) {
  return channelOperation(platform, 'update', {
    pathParams: { channelId },
    body: payload
  })
}

export function deletePlatformChannel(platform, channelId) {
  return channelOperation(platform, 'remove', { pathParams: { channelId } })
}

export function getDshChannels() {
  return getPlatformChannels('dsh')
}

export function createDshChannel(payload) {
  return createPlatformChannel('dsh', payload)
}

export function updateDshChannel(channelId, payload) {
  return updatePlatformChannel('dsh', channelId, payload)
}

export function deleteDshChannel(channelId) {
  return deletePlatformChannel('dsh', channelId)
}

export function syncCurrentDshChannel() {
  return channelOperation('dsh', 'sync')
}

export function applyDshChannelToSettings(channelId) {
  return channelOperation('dsh', 'applyToSettings', { pathParams: { channelId } })
}

export function testDshChannelSpeed(channelId, timeout = 20000) {
  return channelOperation('dsh', 'speedTest', { pathParams: { channelId }, body: { timeout } })
}

export function fetchDshChannelModels(channelId, { forceRefresh = false } = {}) {
  return channelOperation('dsh', 'models', {
    pathParams: { channelId },
    query: forceRefresh ? { forceRefresh: 'true' } : undefined
  })
}

export function fetchDshModelsFromConfig({ baseUrl, apiKey, providerApi } = {}, { forceRefresh = false } = {}) {
  return channelOperation('dsh', 'modelsFromConfig', {
    body: { baseUrl, apiKey, providerApi, forceRefresh }
  })
}

export function getChannelAuth(platform, channelId = '') {
  return channelOperation(platform, 'getAuth', { query: channelId ? { channelId } : undefined })
}

export function syncLocalChannelAuth(platform, channelId = '') {
  return channelOperation(platform, 'syncLocalAuth', { body: channelId ? { channelId } : {} })
}

export function fetchChannelAuthQuota(platform, channelId, refresh = false) {
  return channelOperation(platform, 'getAuthQuota', {
    pathParams: { channelId },
    query: refresh ? { refresh: 'true' } : undefined
  })
}

function matchesChannelAuthCandidate(channel, candidate, candidates) {
  const ref = channel?.authRef || {}
  const candidateRef = candidate?.authRef || {}
  if (ref.credentialId && candidateRef.credentialId && ref.credentialId === candidateRef.credentialId) return true
  if ((ref.accountId || ref.identityKey) && (candidateRef.accountId || candidateRef.identityKey)) {
    const sameProvider = !ref.providerId || !candidateRef.providerId || ref.providerId === candidateRef.providerId
    if (sameProvider && (ref.accountId || ref.identityKey) === (candidateRef.accountId || candidateRef.identityKey)) return true
  }
  if (ref.accountEmail && candidateRef.accountEmail && ref.accountEmail === candidateRef.accountEmail) return true

  const hasReference = Boolean(ref.credentialId || ref.providerId || ref.accountId || ref.identityKey || ref.accountEmail)
  const providerId = ref.providerId || channel?.oauthProviderId || channel?.providerKey || ''
  const sameProviderCandidates = providerId
    ? candidates.filter(item => (item?.authRef?.providerId || item?.providerId) === providerId)
    : []
  if (sameProviderCandidates.length === 1 && sameProviderCandidates[0] === candidate) return true
  return !hasReference && candidates.length === 1 && candidates[0] === candidate
}

function normalizeAuthExpiry(value) {
  if (value == null || value === '') return null
  const numeric = typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : NaN
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function inspectOAuthChannelAuth(platform, channelId) {
  const snapshot = await getChannelAuth(platform, channelId)
  const channel = snapshot?.channel
  if (!channel || channel.authMode !== 'oauth') {
    return {
      status: 'missing',
      level: 'failed',
      title: '未找到 OAuth 渠道',
      checkedAt: new Date().toISOString()
    }
  }

  const candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : []
  const candidate = candidates.find(item => matchesChannelAuthCandidate(channel, item, candidates))
  if (!candidate) {
    return {
      status: 'missing',
      level: 'failed',
      title: '未找到匹配的本地 OAuth 凭证',
      warning: (snapshot.warnings || []).join(' '),
      checkedAt: new Date().toISOString()
    }
  }

  let quota
  try {
    quota = await fetchChannelAuthQuota(platform, channelId, true)
  } catch (error) {
    quota = {
      status: 'unavailable',
      warning: error?.response?.data?.error || error?.message || '在线授权检查失败'
    }
  }
  let latestSnapshot = null
  if (quota.status === 'available') {
    try {
      latestSnapshot = await getChannelAuth(platform, channelId)
    } catch {
      // The live quota check is authoritative if a follow-up local scan fails.
    }
  }
  const latestCandidates = Array.isArray(latestSnapshot?.candidates) ? latestSnapshot.candidates : []
  const latestCandidate = latestCandidates.find(item => matchesChannelAuthCandidate(channel, item, latestCandidates))
  const expiry = normalizeAuthExpiry(latestCandidate?.expiresAt || candidate.expiresAt)
  const isExpired = expiry && new Date(expiry).getTime() <= Date.now()
  const quotaStatus = ['available', 'unauthorized', 'unsupported'].includes(quota.status)
    ? quota.status
    : 'unavailable'
  const status = isExpired && quotaStatus !== 'available' ? 'expired' : quotaStatus
  const statusDetails = {
    available: { level: 'success', title: 'OAuth 授权可用' },
    unauthorized: { level: 'failed', title: 'OAuth 授权已失效或过期' },
    expired: { level: 'failed', title: 'Token 已过期' },
    unsupported: { level: 'warning', title: '凭证已找到，暂时无法在线验证' },
    unavailable: { level: 'warning', title: '凭证已找到，暂时无法验证' }
  }
  const details = statusDetails[status] || statusDetails.unavailable
  return {
    status,
    ...details,
    account: candidate.accountEmail || candidate.authRef?.accountEmail || '',
    expiresAt: expiry,
    warning: quota.warning || quota.error || '',
    checkedAt: quota.checkedAt || new Date().toISOString()
  }
}

export function getChannels() {
  return getPlatformChannels('claude')
}

export function getCurrentChannel() {
  return channelOperation('claude', 'current')
}

export function syncCurrentClaudeChannel() {
  return channelOperation('claude', 'sync')
}

export function createChannel(name, baseUrl, apiKey, websiteUrl, extra = {}) {
  return createPlatformChannel('claude', { name, baseUrl, apiKey, websiteUrl, ...extra })
}

export function updateChannel(id, updates) {
  return updatePlatformChannel('claude', id, updates)
}

export function deleteChannel(id) {
  return deletePlatformChannel('claude', id)
}

export function applyChannelToSettings(id) {
  return channelOperation('claude', 'applyToSettings', { pathParams: { channelId: id } })
}

export function resetChannelHealth(id) {
  return channelOperation('claude', 'resetHealth', { pathParams: { channelId: id }, body: { channelId: id } })
}

export function getBestChannelForRestore() {
  return channelOperation('claude', 'bestForRestore')
}

export function saveChannelOrder(order) {
  return channelOperation('claude', 'order', { body: { order } })
}

export async function getChannelBalances(source) {
  const response = await client.get('/channel-balances', { params: { source } })
  return response.data
}

export async function refreshChannelBalance(source, channelId) {
  const response = await client.post(`/channel-balances/${encodeURIComponent(source)}/${encodeURIComponent(channelId)}/refresh`)
  return response.data
}

export function getCodexChannels() {
  return getPlatformChannels('codex')
}

export function getEnabledCodexChannels() {
  return channelOperation('codex', 'enabled')
}

export function syncCurrentCodexChannel() {
  return channelOperation('codex', 'sync')
}

export function createCodexChannel(name, providerKey, baseUrl, apiKey, websiteUrl, extra = {}) {
  return createPlatformChannel('codex', { name, providerKey, baseUrl, apiKey, websiteUrl, ...extra })
}

export function updateCodexChannel(channelId, updates) {
  return updatePlatformChannel('codex', channelId, updates)
}

export function deleteCodexChannel(channelId) {
  return deletePlatformChannel('codex', channelId)
}

export function saveCodexChannelOrder(order) {
  return channelOperation('codex', 'order', { body: { order } })
}

export function applyCodexChannelToSettings(channelId) {
  return channelOperation('codex', 'applyToSettings', { pathParams: { channelId } })
}

export function resetCodexChannelHealth(channelId) {
  return channelOperation('codex', 'resetHealth', { pathParams: { channelId }, body: { channelId } })
}

export function getGeminiChannels() {
  return getPlatformChannels('gemini')
}

export function getEnabledGeminiChannels() {
  return channelOperation('gemini', 'enabled')
}

export function syncCurrentGeminiChannel() {
  return channelOperation('gemini', 'sync')
}

export function createGeminiChannel(name, baseUrl, apiKey, model, websiteUrl, extra = {}) {
  return createPlatformChannel('gemini', { name, baseUrl, apiKey, model, websiteUrl, ...extra })
}

export function getChannelPoolStatus() {
  return channelOperation('claude', 'poolStatus')
}

export function updateGeminiChannel(channelId, updates) {
  return updatePlatformChannel('gemini', channelId, updates)
}

export function deleteGeminiChannel(channelId) {
  return deletePlatformChannel('gemini', channelId)
}

export function saveGeminiChannelOrder(order) {
  return channelOperation('gemini', 'order', { body: { order } })
}

export function resetGeminiChannelHealth(channelId) {
  return channelOperation('gemini', 'resetHealth', { pathParams: { channelId }, body: { channelId } })
}

export function testClaudeChannelSpeed(channelId, timeout = 20000) {
  return channelOperation('claude', 'speedTest', { pathParams: { channelId }, body: { timeout } })
}

export function fetchChannelModels(channelId, channelType = 'claude') {
  return channelOperation(channelType || 'claude', 'models', {
    pathParams: { channelId },
    query: channelType ? { type: channelType } : undefined
  })
}

export function testCodexChannelSpeed(channelId, timeout = 20000) {
  return channelOperation('codex', 'speedTest', { pathParams: { channelId }, body: { timeout } })
}

export function testGeminiChannelSpeed(channelId, timeout = 20000) {
  return channelOperation('gemini', 'speedTest', { pathParams: { channelId }, body: { timeout } })
}

export function fetchCodexChannelModels(channelId) {
  return channelOperation('codex', 'models', { pathParams: { channelId } })
}

export function fetchGeminiChannelModels(channelId) {
  return channelOperation('gemini', 'models', { pathParams: { channelId } })
}

export function getOpenCodeChannels() {
  return getPlatformChannels('opencode')
}

export async function getEnabledOpenCodeChannels() {
  const data = await getOpenCodeChannels()
  return { channels: (data.channels || []).filter(channel => channel.enabled !== false) }
}

export function syncCurrentOpenCodeChannel() {
  return channelOperation('opencode', 'sync')
}

export function createOpenCodeChannel(name, baseUrl, apiKey, extra = {}) {
  return createPlatformChannel('opencode', { name, baseUrl, apiKey, ...extra })
}

export function updateOpenCodeChannel(channelId, updates) {
  return updatePlatformChannel('opencode', channelId, updates)
}

export function deleteOpenCodeChannel(channelId) {
  return deletePlatformChannel('opencode', channelId)
}

export function saveOpenCodeChannelOrder(order) {
  return channelOperation('opencode', 'order', { body: { order } })
}

export function resetOpenCodeChannelHealth(channelId) {
  return channelOperation('opencode', 'resetHealth', { pathParams: { channelId }, body: { channelId } })
}

export function testOpenCodeChannelSpeed(channelId, timeout = 20000) {
  return channelOperation('opencode', 'speedTest', { pathParams: { channelId }, body: { timeout } })
}

export function fetchOpenCodeChannelModels(channelId, { forceRefresh = false } = {}) {
  return channelOperation('opencode', 'models', {
    pathParams: { channelId },
    query: forceRefresh ? { forceRefresh: 'true' } : undefined
  })
}

export function probeOpenCodeChannelModels({ baseUrl, apiKey, gatewaySourceType }) {
  return channelOperation('opencode', 'probeModels', { body: { baseUrl, apiKey, gatewaySourceType } })
}

export function getOpenCodeProxyStatus() {
  return callPlatformRoute('opencode', 'proxy', 'status')
}

export function startOpenCodeProxy() {
  return callPlatformRoute('opencode', 'proxy', 'start')
}

export function stopOpenCodeProxy() {
  return callPlatformRoute('opencode', 'proxy', 'stop')
}

export function getOmpChannels() {
  return getPlatformChannels('omp')
}

export async function getEnabledOmpChannels() {
  const data = await getOmpChannels()
  return {
    ...data,
    channels: (data.channels || []).filter(channel => channel.enabled !== false)
  }
}

export function syncCurrentOmpChannel() {
  return channelOperation('omp', 'sync')
}

export function createOmpChannel(name, baseUrl, apiKey, extra = {}) {
  return createPlatformChannel('omp', { name, baseUrl, apiKey, ...extra })
}

export function updateOmpChannel(channelId, updates) {
  return updatePlatformChannel('omp', channelId, updates)
}

export function deleteOmpChannel(channelId) {
  return deletePlatformChannel('omp', channelId)
}

export function saveOmpChannelOrder(order) {
  return channelOperation('omp', 'order', { body: { order } })
}

export function resetOmpChannelHealth(channelId) {
  return channelOperation('omp', 'resetHealth', { pathParams: { channelId }, body: { channelId } })
}

export function updateChannelForPlatform(platform, channelId, updates) {
  return updatePlatformChannel(platform, channelId, updates)
}

export function testOmpChannelSpeed(channelId, timeout = 20000) {
  return channelOperation('omp', 'speedTest', { pathParams: { channelId }, body: { timeout } })
}

export function fetchOmpChannelModels(channelId, { forceRefresh = false } = {}) {
  return channelOperation('omp', 'models', {
    pathParams: { channelId },
    query: forceRefresh ? { forceRefresh: 'true' } : undefined
  })
}

export function probeOmpChannelModels(config, { forceRefresh = false } = {}) {
  return channelOperation('omp', 'probeModels', {
    body: { ...config, forceRefresh }
  })
}

export function fetchOmpCatalogMetadata(providerKey, channelModels = {}, { forceRefresh = false } = {}) {
  return channelOperation('omp', 'catalogMetadata', {
    body: { providerKey, forceRefresh, ...channelModels }
  })
}

export function getOmpAuthProviders({ forceRefresh = false } = {}) {
  return callPlatformRoute('omp', 'api', 'getConfigAuthProviders', {
    query: forceRefresh ? { forceRefresh: 'true' } : undefined
  })
}

export function getOmpProxyStatus() {
  return callPlatformRoute('omp', 'proxy', 'status')
}

export function startOmpProxy() {
  return callPlatformRoute('omp', 'proxy', 'start')
}

export function stopOmpProxy() {
  return callPlatformRoute('omp', 'proxy', 'stop')
}
