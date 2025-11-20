import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  timeout: 10000
})

const api = {
  // Get all projects
  async getProjects() {
    const response = await client.get('/projects')
    return response.data
  },

  // Get sessions for a project
  async getSessions(projectName) {
    const response = await client.get(`/sessions/${projectName}`)
    return response.data
  },

  // Set alias for a session
  async setAlias(sessionId, alias) {
    const response = await client.post('/aliases', { sessionId, alias })
    return response.data
  },

  // Delete alias
  async deleteAlias(sessionId) {
    const response = await client.delete(`/aliases/${sessionId}`)
    return response.data
  },

  // Delete session
  async deleteSession(projectName, sessionId) {
    const response = await client.delete(`/sessions/${projectName}/${sessionId}`)
    return response.data
  },

  // Fork session
  async forkSession(projectName, sessionId) {
    const response = await client.post(`/sessions/${projectName}/${sessionId}/fork`)
    return response.data
  },

  // Launch session (resume in CLI)
  async launchSession(projectName, sessionId, fork = false) {
    const response = await client.post(`/sessions/${projectName}/${sessionId}/launch`, { fork })
    return response.data
  },

  // Save project order
  async saveProjectOrder(order) {
    const response = await client.post('/projects/order', { order })
    return response.data
  },

  // Delete project
  async deleteProject(projectName) {
    const response = await client.delete(`/projects/${projectName}`)
    return response.data
  },

  // Save session order
  async saveSessionOrder(projectName, order) {
    const response = await client.post(`/sessions/${projectName}/order`, { order })
    return response.data
  },

  // Search sessions content
  async searchSessions(projectName, keyword, contextLength = 15) {
    const response = await client.get(`/sessions/${projectName}/search`, {
      params: { keyword, context: contextLength }
    })
    return response.data
  },

  // Search sessions across all projects
  async searchSessionsGlobally(keyword, contextLength = 35) {
    const response = await client.get('/sessions/search/global', {
      params: { keyword, context: contextLength }
    })
    return response.data
  },

  // Launch terminal with session
  async launchTerminal(projectName, sessionId) {
    const response = await client.post(`/sessions/${projectName}/${sessionId}/launch`)
    return response.data
  },

  // Channels management
  async getChannels() {
    const response = await client.get('/channels')
    return response.data
  },

  async getCurrentChannel() {
    const response = await client.get('/channels/current')
    return response.data
  },

  async createChannel(name, baseUrl, apiKey, websiteUrl) {
    const response = await client.post('/channels', { name, baseUrl, apiKey, websiteUrl })
    return response.data
  },

  async updateChannel(id, updates) {
    const response = await client.put(`/channels/${id}`, updates)
    return response.data
  },

  async deleteChannel(id) {
    const response = await client.delete(`/channels/${id}`)
    return response.data
  },

  async activateChannel(id) {
    const response = await client.post(`/channels/${id}/activate`)
    return response.data
  },

  // Get recent sessions across all projects
  async getRecentSessions(limit = 5) {
    const response = await client.get(`/sessions/recent/list?limit=${limit}`)
    return response.data
  },

  // Proxy management
  async getProxyStatus() {
    const response = await client.get('/proxy/status')
    return response.data
  },

  async startProxy() {
    const response = await client.post('/proxy/start')
    return response.data
  },

  async stopProxy() {
    const response = await client.post('/proxy/stop')
    return response.data
  },

  // Clear proxy logs
  async clearProxyLogs() {
    const response = await client.post('/proxy/logs/clear')
    return response.data
  }
}

export default api
