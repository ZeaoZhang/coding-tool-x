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

const SESSIONS_CACHE_TTL = 20 * 1000
const sessionsCache = new Map()
const projectRefreshTimers = new Map()
const sessionRefreshTimers = new Map()
const PROJECT_REFRESH_DELAYS_MS = [1500, 3500, 7000, 12000]
const SESSION_REFRESH_DELAYS_MS = [2500, 5000, 10000, 15000]
const SNAPSHOT_REFRESH_MAX_WAIT_MS = 185000
const projectRefreshStartedAt = new Map()
const sessionRefreshStartedAt = new Map()


function getSessionCacheKey(channel, projectName) {
  return `${channel}:${projectName}`
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

function clearRefreshTimer(timerMap, key) {
  const timer = timerMap.get(key)
  if (!timer) return
  clearTimeout(timer)
  timerMap.delete(key)
}

function clearRefreshCycle(timerMap, startedAtMap, key) {
  clearRefreshTimer(timerMap, key)
  startedAtMap.delete(key)
}

function scheduleRefreshTimer(timerMap, startedAtMap, key, delays, attempt, callback, onTimeout) {
  clearRefreshTimer(timerMap, key)
  const startedAt = startedAtMap.get(key) || Date.now()
  startedAtMap.set(key, startedAt)
  const remainingMs = SNAPSHOT_REFRESH_MAX_WAIT_MS - (Date.now() - startedAt)
  if (remainingMs <= 0) {
    startedAtMap.delete(key)
    onTimeout?.()
    return
  }
  const delay = Math.min(delays[Math.min(attempt, delays.length - 1)], remainingMs)
  const timer = setTimeout(() => {
    timerMap.delete(key)
    callback()
  }, delay)
  timerMap.set(key, timer)
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
  const projectsRefreshing = computed(() => Boolean(projectsMeta.value?.refreshing))
  const sessionsRefreshing = computed(() => Boolean(sessionsMeta.value?.refreshing))
  const projectsUsingFallback = computed(() => Boolean(projectsMeta.value?.fallback || projectsMeta.value?.stale))
  const sessionsUsingFallback = computed(() => Boolean(sessionsMeta.value?.fallback || sessionsMeta.value?.stale))
  const projectsPending = computed(() => Boolean(
    projectsMeta.value?.refreshing
    && projectsMeta.value?.fallback
    && projects.value.length === 0
  ))
  const sessionsPending = computed(() => Boolean(
    sessionsMeta.value?.refreshing
    && sessionsMeta.value?.fallback
    && sessions.value.length === 0
  ))

  function syncSessionsCache() {
    if (!currentProject.value) return
    totalSize.value = sessions.value.reduce((sum, session) => sum + (Number(session.size) || 0), 0)
    setCachedSessions(currentChannel.value, currentProject.value, {
      sessions: sessions.value,
      aliases: aliases.value,
      totalSize: totalSize.value,
      projectInfo: currentProjectInfo.value,
      meta: sessionsMeta.value
    })
  }

  // Actions
  function setChannel(channel) {
    if (currentChannel.value === channel) return
    const previousChannel = currentChannel.value
    clearProjectRefreshTimer(previousChannel)
    projectRefreshStartedAt.delete(previousChannel)
    Array.from(sessionRefreshTimers.keys())
      .filter(key => key.startsWith(`${previousChannel}:`))
      .forEach(key => clearRefreshCycle(sessionRefreshTimers, sessionRefreshStartedAt, key))
    currentChannel.value = channel
    projects.value = []
    currentProject.value = null
    projectsMeta.value = null
    sessions.value = []
    aliases.value = {}
    totalSize.value = 0
    currentProjectInfo.value = null
    sessionsMeta.value = null
    error.value = null
  }

  function clearProjectRefreshTimer(channel) {
    clearRefreshTimer(projectRefreshTimers, channel)
  }

  function clearProjectRefreshCycle(channel) {
    clearRefreshCycle(projectRefreshTimers, projectRefreshStartedAt, channel)
  }

  function scheduleProjectRefresh(channel, attempt = 0) {
    scheduleRefreshTimer(projectRefreshTimers, projectRefreshStartedAt, channel, PROJECT_REFRESH_DELAYS_MS, attempt, () => {
      if (currentChannel.value === channel) {
        fetchProjects({ force: true, silent: true, pollAttempt: attempt + 1 }).catch(() => {})
      }
    }, () => {
      if (currentChannel.value !== channel) return
      projectsMeta.value = {
        ...(projectsMeta.value || {}),
        refreshing: false,
        stale: true,
        error: projectsMeta.value?.error || '项目列表生成超时，请重试'
      }
      error.value = projectsMeta.value.error
    })
  }

  function clearSessionRefreshTimer(channel, projectName) {
    const key = getSessionCacheKey(channel, projectName)
    clearRefreshTimer(sessionRefreshTimers, key)
  }

  function clearSessionRefreshCycle(channel, projectName) {
    clearRefreshCycle(sessionRefreshTimers, sessionRefreshStartedAt, getSessionCacheKey(channel, projectName))
  }

  function scheduleSessionRefresh(channel, projectName, attempt = 0) {
    const key = getSessionCacheKey(channel, projectName)
    scheduleRefreshTimer(sessionRefreshTimers, sessionRefreshStartedAt, key, SESSION_REFRESH_DELAYS_MS, attempt, () => {
      if (currentChannel.value === channel && currentProject.value === projectName) {
        fetchSessions(projectName, { force: true, silent: true, pollAttempt: attempt + 1 }).catch(() => {})
      }
    }, () => {
      if (currentChannel.value !== channel || currentProject.value !== projectName) return
      sessionsMeta.value = {
        ...(sessionsMeta.value || {}),
        refreshing: false,
        stale: true,
        error: sessionsMeta.value?.error || '会话列表生成超时，请重试'
      }
      error.value = sessionsMeta.value.error
    })
  }

  async function fetchProjects({ force = false, silent = false, pollAttempt = 0, fresh = false } = {}) {
    if (!silent) loading.value = true
    error.value = null
    try {

      const channel = currentChannel.value
      const data = await getProjects(channel, { fresh: force || fresh })
      if (currentChannel.value !== channel) return
      const nextProjects = Array.isArray(data.projects) ? data.projects : []
      const shouldApplyProjects = nextProjects.length > 0 || projects.value.length === 0 || data.meta?.fallback !== true
      projectsMeta.value = data.meta || null
      if (data.meta?.error) {
        error.value = data.meta.error
      }

      if (shouldApplyProjects) {
        projects.value = nextProjects
        currentProject.value = data.currentProject || (nextProjects[0]?.name || null)
        if (data.meta?.fallback !== true) {
          invalidateSessionsCache(channel)
        }
      }

      if (data.meta?.refreshing) {
        scheduleProjectRefresh(channel, pollAttempt)
      } else {
        clearProjectRefreshCycle(channel)
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
      const channel = currentChannel.value
      if (currentProject.value !== projectName && !getCachedSessions(channel, projectName)) {
        sessions.value = []
        aliases.value = {}
        totalSize.value = 0
        currentProjectInfo.value = null
        sessionsMeta.value = null
      }

      if (!force) {
        const cached = getCachedSessions(channel, projectName)
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

      currentProject.value = projectName
      const data = await getSessions(projectName, channel, { fresh })
      if (currentChannel.value !== channel || currentProject.value !== projectName) return
      const nextSessions = Array.isArray(data.sessions) ? data.sessions : []
      const shouldApplySessions = nextSessions.length > 0 || sessions.value.length === 0 || data.meta?.fallback !== true
      sessionsMeta.value = data.meta || null
      if (data.meta?.error) {
        error.value = data.meta.error
      }
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
        clearSessionRefreshCycle(channel, projectName)
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

  async function retryProjects() {
    clearProjectRefreshCycle(currentChannel.value)
    return fetchProjects({
      force: true,
      fresh: Boolean(projectsMeta.value?.error)
    })
  }

  async function retrySessions(projectName = currentProject.value) {
    if (!projectName) return
    clearSessionRefreshCycle(currentChannel.value, projectName)
    return fetchSessions(projectName, {
      force: true,
      fresh: Boolean(sessionsMeta.value?.error)
    })
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
        projectInfo: currentProjectInfo.value,
        meta: sessionsMeta.value
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
    projectsRefreshing,
    sessionsRefreshing,
    projectsUsingFallback,
    sessionsUsingFallback,
    projectsPending,
    sessionsPending,
    setChannel,
    fetchProjects,
    fetchSessions,
    retryProjects,
    retrySessions,
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
