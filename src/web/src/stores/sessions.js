import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getProjects, saveProjectOrder as saveProjectOrderApi, deleteProject as deleteProjectApi } from '../api/projects'
import {
  getSessions,
  setAlias as setAliasApi,
  deleteAlias as deleteAliasApi,
  deleteSession as deleteSessionApi,
  deleteSessions as deleteSessionsApi,
  forkSession as forkSessionApi,
  saveSessionOrder as saveSessionOrderApi
} from '../api/sessions'

const PROJECTS_CACHE_TTL = 30 * 1000
const SESSIONS_CACHE_TTL = 20 * 1000
const projectsCache = new Map()
const sessionsCache = new Map()
const projectRefreshTimers = new Map()
const sessionRefreshTimers = new Map()

function getProjectCacheKey(channel) {
  return channel
}

function getSessionCacheKey(channel, projectName) {
  return `${channel}:${projectName}`
}

function getCachedProjects(channel) {
  const entry = projectsCache.get(getProjectCacheKey(channel))
  if (!entry) return null
  if ((Date.now() - entry.timestamp) > PROJECTS_CACHE_TTL) {
    projectsCache.delete(getProjectCacheKey(channel))
    return null
  }
  return entry.payload
}

function setCachedProjects(channel, payload) {
  projectsCache.set(getProjectCacheKey(channel), {
    timestamp: Date.now(),
    payload
  })
}

function invalidateProjectsCache(channel) {
  if (channel) {
    projectsCache.delete(getProjectCacheKey(channel))
  } else {
    projectsCache.clear()
  }
}

function getCachedSessions(channel, projectName) {
  const key = getSessionCacheKey(channel, projectName)
  const entry = sessionsCache.get(key)
  if (!entry) return null
  if ((Date.now() - entry.timestamp) > SESSIONS_CACHE_TTL) {
    sessionsCache.delete(key)
    return null
  }
  return entry.payload
}

function setCachedSessions(channel, projectName, payload) {
  sessionsCache.set(getSessionCacheKey(channel, projectName), {
    timestamp: Date.now(),
    payload
  })
}

function invalidateSessionsCache(channel, projectName) {
  if (projectName) {
    sessionsCache.delete(getSessionCacheKey(channel, projectName))
    return
  }
  // remove all sessions for channel
  Array.from(sessionsCache.keys())
    .filter(key => key.startsWith(`${channel}:`))
    .forEach(key => sessionsCache.delete(key))
}

export const useSessionsStore = defineStore('sessions', () => {
  const projects = ref([])
  const currentProject = ref(null)
  const currentProjectInfo = ref(null)
  const projectsMeta = ref(null)
  const sessionsMeta = ref(null)
  const sessions = ref([])
  const aliases = ref({})
  const totalSize = ref(0)
  const loading = ref(false)
  const error = ref(null)
  const currentChannel = ref('claude') // 当前渠道

  // Computed
  const sessionsWithAlias = computed(() => {
    return sessions.value.map(session => ({
      ...session,
      alias: aliases.value[session.sessionId] || null
    }))
  })

  function syncSessionsCache() {
    if (!currentProject.value) return
    totalSize.value = sessions.value.reduce((sum, session) => sum + (Number(session.size) || 0), 0)
    setCachedSessions(currentChannel.value, currentProject.value, {
      sessions: sessions.value,
      aliases: aliases.value,
      totalSize: totalSize.value,
      projectInfo: currentProjectInfo.value
    })
  }

  // Actions
  function setChannel(channel) {
    currentChannel.value = channel
  }

  function clearProjectRefreshTimer(channel) {
    const timer = projectRefreshTimers.get(channel)
    if (timer) {
      clearTimeout(timer)
      projectRefreshTimers.delete(channel)
    }
  }

  function scheduleProjectRefresh(channel, attempt = 0) {
    if (attempt >= 3) return
    clearProjectRefreshTimer(channel)
    const delay = 600 + attempt * 700
    const timer = setTimeout(() => {
      projectRefreshTimers.delete(channel)
      if (currentChannel.value === channel) {
        fetchProjects({ force: true, silent: true, pollAttempt: attempt + 1 }).catch(() => {})
      }
    }, delay)
    projectRefreshTimers.set(channel, timer)
  }

  function clearSessionRefreshTimer(channel, projectName) {
    const key = getSessionCacheKey(channel, projectName)
    const timer = sessionRefreshTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      sessionRefreshTimers.delete(key)
    }
  }

  function scheduleSessionRefresh(channel, projectName, attempt = 0) {
    if (attempt >= 3) return
    clearSessionRefreshTimer(channel, projectName)
    const delay = 1200 + attempt * 1400
    const key = getSessionCacheKey(channel, projectName)
    const timer = setTimeout(() => {
      sessionRefreshTimers.delete(key)
      if (currentChannel.value === channel && currentProject.value === projectName) {
        fetchSessions(projectName, { force: true, silent: true, pollAttempt: attempt + 1 }).catch(() => {})
      }
    }, delay)
    sessionRefreshTimers.set(key, timer)
  }

  async function fetchProjects({ force = false, silent = false, pollAttempt = 0, fresh = false } = {}) {
    if (!silent) loading.value = true
    error.value = null
    try {
      if (!force) {
        const cached = getCachedProjects(currentChannel.value)
        if (cached) {
          projects.value = cached.projects || []
          currentProject.value = cached.currentProject || (cached.projects?.[0]?.name || null)
          projectsMeta.value = cached.meta || null
          if (!silent) loading.value = false
          return
        }
      }

      const channel = currentChannel.value
      const data = await getProjects(channel, { fresh })
      const nextProjects = Array.isArray(data.projects) ? data.projects : []
      const shouldApplyProjects = nextProjects.length > 0 || projects.value.length === 0 || data.meta?.fallback !== true
      projectsMeta.value = data.meta || null

      if (shouldApplyProjects) {
        projects.value = nextProjects
        currentProject.value = data.currentProject || (nextProjects[0]?.name || null)
        if (data.meta?.fallback !== true) {
          setCachedProjects(channel, {
            projects: nextProjects,
            currentProject: currentProject.value,
            meta: data.meta || null
          })
          invalidateSessionsCache(channel)
        }
      }

      if (data.meta?.refreshing) {
        scheduleProjectRefresh(channel, pollAttempt)
      } else {
        clearProjectRefreshTimer(channel)
      }
    } catch (err) {
      error.value = err.message
    } finally {
      if (!silent) loading.value = false
    }
  }

  async function fetchSessions(projectName, { force = false, silent = false, pollAttempt = 0, fresh = false } = {}) {
    if (!silent) loading.value = true
    error.value = null
    try {
      if (!force) {
        const cached = getCachedSessions(currentChannel.value, projectName)
        if (cached) {
          sessions.value = cached.sessions || []
          aliases.value = cached.aliases || {}
          totalSize.value = cached.totalSize || 0
          currentProject.value = projectName
          currentProjectInfo.value = cached.projectInfo || null
          sessionsMeta.value = cached.meta || null
          if (!silent) loading.value = false
          return
        }
      }

      const channel = currentChannel.value
      const data = await getSessions(projectName, channel, { fresh })
      const nextSessions = Array.isArray(data.sessions) ? data.sessions : []
      const shouldApplySessions = nextSessions.length > 0 || sessions.value.length === 0 || data.meta?.fallback !== true
      sessionsMeta.value = data.meta || null
      currentProject.value = projectName

      if (shouldApplySessions) {
        sessions.value = nextSessions
        aliases.value = data.aliases || {}
        totalSize.value = data.totalSize || 0
        currentProjectInfo.value = data.projectInfo || null

        if (data.meta?.fallback !== true) {
          setCachedSessions(channel, projectName, {
            sessions: nextSessions,
            aliases: data.aliases || {},
            totalSize: data.totalSize || 0,
            projectInfo: data.projectInfo || null,
            meta: data.meta || null
          })
        }
      }

      if (data.meta?.refreshing) {
        scheduleSessionRefresh(channel, projectName, pollAttempt)
      } else {
        clearSessionRefreshTimer(channel, projectName)
      }
    } catch (err) {
      error.value = err.message
    } finally {
      if (!silent) loading.value = false
    }
  }

  async function setAlias(sessionId, alias) {
    try {
      await setAliasApi(sessionId, alias)
      aliases.value[sessionId] = alias
    } catch (err) {
      error.value = err.message
      throw err
    }
  }

  async function deleteAlias(sessionId) {
    try {
      await deleteAliasApi(sessionId)
      delete aliases.value[sessionId]
    } catch (err) {
      error.value = err.message
      throw err
    }
  }

  async function deleteSession(sessionId) {
    try {
      await deleteSessionApi(currentProject.value, sessionId, currentChannel.value)
      sessions.value = sessions.value.filter(s => s.sessionId !== sessionId)
      if (aliases.value[sessionId]) {
        delete aliases.value[sessionId]
      }
      syncSessionsCache()
    } catch (err) {
      error.value = err.message
      throw err
    }
  }

  async function deleteSessions(sessionIds = []) {
    const uniqueSessionIds = Array.from(new Set((sessionIds || []).filter(Boolean)))

    if (uniqueSessionIds.length === 0) {
      return {
        deletedSessionIds: [],
        failed: []
      }
    }

    let deletedSessionIds = []
    let failed = []

    try {
      const result = await deleteSessionsApi(currentProject.value, uniqueSessionIds, currentChannel.value)
      deletedSessionIds = Array.isArray(result?.deletedSessionIds) ? result.deletedSessionIds : []
      failed = Array.isArray(result?.failed)
        ? result.failed.map(item => ({
            sessionId: item.sessionId,
            error: new Error(item.error || '删除失败')
          }))
        : []
    } catch (err) {
      error.value = err.message
      throw err
    }

    if (deletedSessionIds.length > 0) {
      const deletedSet = new Set(deletedSessionIds)
      sessions.value = sessions.value.filter(session => !deletedSet.has(session.sessionId))
      Object.keys(aliases.value).forEach((sessionId) => {
        if (deletedSet.has(sessionId)) {
          delete aliases.value[sessionId]
        }
      })
      syncSessionsCache()
    }

    if (failed.length > 0 && deletedSessionIds.length === 0) {
      error.value = failed[0].error.message
    }

    return {
      deletedSessionIds,
      failed
    }
  }

  async function forkSession(sessionId, options = {}) {
    try {
      const data = await forkSessionApi(currentProject.value, sessionId, currentChannel.value, options)
      await fetchSessions(currentProject.value, { force: true, fresh: true })
      return data.newSessionId
    } catch (err) {
      error.value = err.message
      throw err
    }
  }

  async function saveProjectOrder(order) {
    try {
      await saveProjectOrderApi(order, currentChannel.value)
      // Reorder local projects array
      const orderedProjects = order.map(name =>
        projects.value.find(p => p.name === name)
      ).filter(Boolean)
      // Add any new projects not in order
      const remaining = projects.value.filter(p => !order.includes(p.name))
      projects.value = [...orderedProjects, ...remaining]
      setCachedProjects(currentChannel.value, {
        projects: projects.value,
        currentProject: currentProject.value
      })
    } catch (err) {
      error.value = err.message
      throw err
    }
  }

  async function deleteProject(projectName) {
    try {
      await deleteProjectApi(projectName, currentChannel.value)
      projects.value = projects.value.filter(p => p.name !== projectName)
      if (currentProject.value === projectName) {
        currentProject.value = null
      }
      invalidateProjectsCache(currentChannel.value)
      invalidateSessionsCache(currentChannel.value, projectName)
    } catch (err) {
      error.value = err.message
      throw err
    }
  }

  async function saveSessionOrder(order) {
    try {
      await saveSessionOrderApi(currentProject.value, order, currentChannel.value)
      // Reorder local sessions array
      const orderedSessions = order.map(sessionId =>
        sessions.value.find(s => s.sessionId === sessionId)
      ).filter(Boolean)
      // Add any new sessions not in order
      const remaining = sessions.value.filter(s => !order.includes(s.sessionId))
      sessions.value = [...orderedSessions, ...remaining]
      setCachedSessions(currentChannel.value, currentProject.value, {
        sessions: sessions.value,
        aliases: aliases.value,
        totalSize: totalSize.value,
        projectInfo: currentProjectInfo.value
      })
    } catch (err) {
      error.value = err.message
      throw err
    }
  }

  return {
    projects,
    currentProject,
    currentProjectInfo,
    projectsMeta,
    sessionsMeta,
    sessions,
    aliases,
    totalSize,
    loading,
    error,
    currentChannel,
    sessionsWithAlias,
    setChannel,
    fetchProjects,
    fetchSessions,
    setAlias,
    deleteAlias,
    deleteSession,
    deleteSessions,
    forkSession,
    saveProjectOrder,
    saveSessionOrder,
    deleteProject
  }
})
