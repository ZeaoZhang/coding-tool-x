import { SPEED_TEST_API_TIMEOUT_MS, client } from './client'

// Claude channels
export async function getChannels() {
  const response = await client.get('/channels')
  return response.data
}

export async function getCurrentChannel() {
  const response = await client.get('/channels/current')
  return response.data
}

export async function syncCurrentClaudeChannel() {
  const response = await client.post('/channels/sync-current')
  return response.data
}

export async function createChannel(name, baseUrl, apiKey, websiteUrl, extra = {}) {
  const payload = {
    name,
    baseUrl,
    apiKey,
    websiteUrl,
    ...extra
  }
  const response = await client.post('/channels', payload)
  return response.data
}

export async function updateChannel(id, updates) {
  const response = await client.put(`/channels/${id}`, updates)
  return response.data
}

export async function deleteChannel(id) {
  const response = await client.delete(`/channels/${id}`)
  return response.data
}

export async function applyChannelToSettings(id) {
  const response = await client.post(`/channels/${id}/apply-to-settings`)
  return response.data
}

export async function resetChannelHealth(id) {
  const response = await client.post(`/channels/${id}/reset-health`)
  return response.data
}

export async function getBestChannelForRestore() {
  const response = await client.get('/channels/best-for-restore')
  return response.data
}

export async function saveChannelOrder(order) {
  const response = await client.post('/channels/order', { order })
  return response.data
}

export async function getChannelBalances(source) {
  const response = await client.get('/channel-balances', { params: { source } })
  return response.data
}

export async function refreshChannelBalance(source, channelId) {
  const response = await client.post(`/channel-balances/${source}/${channelId}/refresh`)
  return response.data
}

// Codex channels
export async function getCodexChannels() {
  const response = await client.get('/codex/channels')
  return response.data
}

export async function getEnabledCodexChannels() {
  const response = await client.get('/codex/channels/enabled')
  return response.data
}

export async function syncCurrentCodexChannel() {
  const response = await client.post('/codex/channels/sync-current')
  return response.data
}

export async function createCodexChannel(name, providerKey, baseUrl, apiKey, websiteUrl, extra = {}) {
  const response = await client.post('/codex/channels', {
    name,
    providerKey,
    baseUrl,
    apiKey,
    websiteUrl,
    ...extra
  })
  return response.data
}

export async function updateCodexChannel(channelId, updates) {
  const response = await client.put(`/codex/channels/${channelId}`, updates)
  return response.data
}

export async function deleteCodexChannel(channelId) {
  const response = await client.delete(`/codex/channels/${channelId}`)
  return response.data
}

export async function saveCodexChannelOrder(order) {
  const response = await client.post('/codex/channels/order', { order })
  return response.data
}

export async function applyCodexChannelToSettings(channelId) {
  const response = await client.post(`/codex/channels/${channelId}/apply-to-settings`)
  return response.data
}

export async function resetCodexChannelHealth(channelId) {
  const response = await client.post(`/codex/channels/${channelId}/reset-health`)
  return response.data
}

// Gemini channels
export async function getGeminiChannels() {
  const response = await client.get('/gemini/channels')
  return response.data
}

export async function getEnabledGeminiChannels() {
  const response = await client.get('/gemini/channels/enabled')
  return response.data
}

export async function syncCurrentGeminiChannel() {
  const response = await client.post('/gemini/channels/sync-current')
  return response.data
}

export async function createGeminiChannel(name, baseUrl, apiKey, model, websiteUrl, extra = {}) {
  const response = await client.post('/gemini/channels', {
    name,
    baseUrl,
    apiKey,
    model,
    websiteUrl,
    ...extra
  })
  return response.data
}

export async function getChannelPoolStatus() {
  const response = await client.get('/channels/pool/status')
  return response.data
}

export async function updateGeminiChannel(channelId, updates) {
  const response = await client.put(`/gemini/channels/${channelId}`, updates)
  return response.data
}

export async function deleteGeminiChannel(channelId) {
  const response = await client.delete(`/gemini/channels/${channelId}`)
  return response.data
}

export async function saveGeminiChannelOrder(order) {
  const response = await client.post('/gemini/channels/order', { order })
  return response.data
}

export async function resetGeminiChannelHealth(channelId) {
  const response = await client.post(`/gemini/channels/${channelId}/reset-health`)
  return response.data
}

// ========== 速度测试 API ==========

/**
 * 测试单个 Claude 渠道速度
 */
export async function testClaudeChannelSpeed(channelId, timeout = 20000) {
  const response = await client.post(`/channels/${channelId}/speed-test`, { timeout })
  return response.data
}

/**
 * 获取渠道可用模型列表
 */
export async function fetchChannelModels(channelId, channelType = 'claude') {
  const requestConfig = channelType
    ? { params: { type: channelType } }
    : undefined
  const response = await client.get(`/channels/${channelId}/models`, requestConfig)
  return response.data
}

/**
 * 测试所有 Claude 渠道速度
 */
export async function testAllClaudeChannelsSpeed(timeout = 20000, { signal } = {}) {
  // 使用更长的 axios 超时时间，因为要等待所有渠道测试完成
  const response = await client.post('/channels/speed-test-all', { timeout }, {
    timeout: SPEED_TEST_API_TIMEOUT_MS,
    signal
  })
  return response.data
}

/**
 * 测试单个 Codex 渠道速度
 */
export async function testCodexChannelSpeed(channelId, timeout = 20000) {
  const response = await client.post(`/codex/channels/${channelId}/speed-test`, { timeout })
  return response.data
}

/**
 * 测试所有 Codex 渠道速度
 */
export async function testAllCodexChannelsSpeed(timeout = 20000, { signal } = {}) {
  // 使用更长的 axios 超时时间，因为要等待所有渠道测试完成
  const response = await client.post('/codex/channels/speed-test-all', { timeout }, {
    timeout: SPEED_TEST_API_TIMEOUT_MS,
    signal
  })
  return response.data
}

/**
 * 测试单个 Gemini 渠道速度
 */
export async function testGeminiChannelSpeed(channelId, timeout = 20000) {
  const response = await client.post(`/gemini/channels/${channelId}/speed-test`, { timeout })
  return response.data
}

/**
 * 测试所有 Gemini 渠道速度
 */
export async function testAllGeminiChannelsSpeed(timeout = 20000, { signal } = {}) {
  // 使用更长的 axios 超时时间，因为要等待所有渠道测试完成
  const response = await client.post('/gemini/channels/speed-test-all', { timeout }, {
    timeout: SPEED_TEST_API_TIMEOUT_MS,
    signal
  })
  return response.data
}

/**
 * 获取 Codex 渠道可用模型列表
 */
export async function fetchCodexChannelModels(channelId) {
  const response = await client.get(`/codex/channels/${channelId}/models`)
  return response.data
}

/**
 * 获取 Gemini 渠道可用模型列表
 */
export async function fetchGeminiChannelModels(channelId) {
  const response = await client.get(`/gemini/channels/${channelId}/models`)
  return response.data
}

// ============================================
// OpenCode Channel APIs
// ============================================

export async function getOpenCodeChannels() {
  const response = await client.get('/opencode/channels')
  return response.data
}

export async function getEnabledOpenCodeChannels() {
  const data = await getOpenCodeChannels()
  return {
    channels: (data.channels || []).filter(ch => ch.enabled !== false)
  }
}

export async function syncCurrentOpenCodeChannel() {
  const response = await client.post('/opencode/channels/sync-current')
  return response.data
}

export async function createOpenCodeChannel(name, baseUrl, apiKey, extra = {}) {
  const response = await client.post('/opencode/channels', {
    name,
    baseUrl,
    apiKey,
    wireApi: extra.wireApi || 'openai',
    gatewaySourceType: extra.gatewaySourceType || 'codex',
    enabled: extra.enabled !== false,
    weight: extra.weight || 1,
    maxConcurrency: extra.maxConcurrency || null,
    model: extra.model || null,
    modelRedirects: extra.modelRedirects || [],
    speedTestModel: extra.speedTestModel || null,
    presetId: extra.presetId || null,
    websiteUrl: extra.websiteUrl || ''
  })
  return response.data
}

export async function updateOpenCodeChannel(channelId, updates) {
  const response = await client.put(`/opencode/channels/${channelId}`, updates)
  return response.data
}

export async function deleteOpenCodeChannel(channelId) {
  const response = await client.delete(`/opencode/channels/${channelId}`)
  return response.data
}

export async function saveOpenCodeChannelOrder(order) {
  const response = await client.post('/opencode/channels/order', { order })
  return response.data
}

export async function resetOpenCodeChannelHealth(channelId) {
  const response = await client.post(`/opencode/channels/${channelId}/reset-health`)
  return response.data
}

export async function testOpenCodeChannelSpeed(channelId, timeout = 20000) {
  const response = await client.post(`/opencode/channels/${channelId}/speed-test`, { timeout })
  return response.data
}

export async function testAllOpenCodeChannelsSpeed(timeout = 20000, { signal } = {}) {
  // 使用更长的 axios 超时时间，因为要等待所有渠道测试完成
  const response = await client.post('/opencode/channels/speed-test-all', { timeout }, {
    timeout: SPEED_TEST_API_TIMEOUT_MS,
    signal
  })
  return response.data
}

export async function fetchOpenCodeChannelModels(channelId, { forceRefresh = false } = {}) {
  const response = await client.get(`/opencode/channels/${channelId}/models`, {
    params: forceRefresh ? { forceRefresh: 'true' } : {}
  })
  return response.data
}

export async function probeOpenCodeChannelModels({ baseUrl, apiKey, gatewaySourceType }) {
  const response = await client.post('/opencode/channels/probe-models', { baseUrl, apiKey, gatewaySourceType })
  return response.data
}

// OpenCode Proxy APIs
export async function getOpenCodeProxyStatus() {
  const response = await client.get('/opencode/proxy/status')
  return response.data
}

export async function startOpenCodeProxy() {
  const response = await client.post('/opencode/proxy/start')
  return response.data
}

export async function stopOpenCodeProxy() {
  const response = await client.post('/opencode/proxy/stop')
  return response.data
}

// ============================================
// OMP Channel APIs
// ============================================

export async function getOmpChannels() {
  const response = await client.get('/omp/channels')
  return response.data
}

export async function getEnabledOmpChannels() {
  const data = await getOmpChannels()
  return {
    ...data,
    channels: (data.channels || []).filter(ch => ch.enabled !== false)
  }
}

export async function syncCurrentOmpChannel() {
  const response = await client.post('/omp/channels/sync-current')
  return response.data
}

export async function createOmpChannel(name, baseUrl, apiKey, extra = {}) {
  const response = await client.post('/omp/channels', {
    name,
    baseUrl,
    apiKey,
    wireApi: extra.wireApi || 'openai',
    providerApi: extra.providerApi || extra.wireApi || 'openai-completions',
    providerKey: extra.providerKey || '',
    authMode: extra.authMode || 'api_key',
    oauthProviderId: extra.oauthProviderId || '',
    gatewaySourceType: extra.gatewaySourceType || 'openai_compatible',
    enabled: extra.enabled !== false,
    weight: extra.weight || 1,
    maxConcurrency: extra.maxConcurrency || null,
    model: extra.model || null,
    modelRedirects: extra.modelRedirects || [],
    allowedModels: extra.allowedModels || [],
    speedTestModel: extra.speedTestModel || null,
    presetId: extra.presetId || null,
    websiteUrl: extra.websiteUrl || '',
    balanceToken: extra.balanceToken || '',
    balanceUserId: extra.balanceUserId || null
  })
  return response.data
}

export async function updateOmpChannel(channelId, updates) {
  const response = await client.put(`/omp/channels/${channelId}`, updates)
  return response.data
}

export async function deleteOmpChannel(channelId) {
  const response = await client.delete(`/omp/channels/${channelId}`)
  return response.data
}

export async function saveOmpChannelOrder(order) {
  const response = await client.post('/omp/channels/order', { order })
  return response.data
}

export async function resetOmpChannelHealth(channelId) {
  const response = await client.post(`/omp/channels/${channelId}/reset-health`)
  return response.data
}

export async function testOmpChannelSpeed(channelId, timeout = 20000) {
  const response = await client.post(`/omp/channels/${channelId}/speed-test`, { timeout })
  return response.data
}

export async function testAllOmpChannelsSpeed(timeout = 20000, { signal } = {}) {
  const response = await client.post('/omp/channels/speed-test-all', { timeout }, {
    timeout: SPEED_TEST_API_TIMEOUT_MS,
    signal
  })
  return response.data
}

export async function fetchOmpChannelModels(channelId, { forceRefresh = false } = {}) {
  const response = await client.get(`/omp/channels/${channelId}/models`, {
    params: forceRefresh ? { forceRefresh: 'true' } : {}
  })
  return response.data
}

export async function probeOmpChannelModels(config) {
  const response = await client.post('/omp/channels/probe-models', config)
  return response.data
}

export async function getOmpAuthProviders({ forceRefresh = false } = {}) {
  const response = await client.get('/omp/config/auth-providers', {
    params: forceRefresh ? { forceRefresh: 'true' } : {}
  })
  return response.data
}

export async function getOmpProxyStatus() {
  const response = await client.get('/omp/proxy/status')
  return response.data
}

export async function startOmpProxy() {
  const response = await client.post('/omp/proxy/start')
  return response.data
}

export async function stopOmpProxy() {
  const response = await client.post('/omp/proxy/stop')
  return response.data
}
