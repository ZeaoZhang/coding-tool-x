import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getProjects, saveProjectOrder as saveProjectOrderApi, deleteProject as deleteProjectApi } from '../api/projects'
import {
  getSessions,
  setAlias as setAliasApi,
  deleteAlias as deleteAliasApi,
  deleteSession as deleteSessionApi,
  forkSession as forkSessionApi,
  saveSessionOrder as saveSessionOrderApi
} from '../api/sessions'

const PROJECTS_CACHE_TTL = 30 * 1000
const SESSIONS_CACHE_TTL = 20 * 1000
const projectsCache = new Map()
const sessionsCache = new Map()

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

  // Actions
  function setChannel(channel) {
    currentChannel.value = channel
  }

  async function fetchProjects({ force = false } = {}) {
    loading.value = true
    error.value = null
    try {
      if (!force) {
        const cached = getCachedProjects(currentChannel.value)
        if (cached) {
          projects.value = cached.projects || []
          currentProject.value = cached.currentProject || (cached.projects?.[0]?.name || null)
          loading.value = false
          return
        }
      }

      const data = await getProjects(currentChannel.value)
      projects.value = data.projects
      currentProject.value = data.currentProject
      setCachedProjects(currentChannel.value, {
        projects: data.projects,
        currentProject: data.currentProject
      })
      invalidateSessionsCache(currentChannel.value)
    } catch (err) {
      error.value = err.message
    } finally {
      loading.value = false
    }
  }

  async function fetchSessions(projectName, { force = false } = {}) {
    loading.value = true
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
          loading.value = false
          return
        }
      }

      const data = await getSessions(projectName, currentChannel.value)
      sessions.value = data.sessions
      aliases.value = data.aliases
      totalSize.value = data.totalSize || 0
      currentProject.value = projectName
      currentProjectInfo.value = data.projectInfo
      setCachedSessions(currentChannel.value, projectName, {
        sessions: data.sessions,
        aliases: data.aliases,
        totalSize: data.totalSize,
        projectInfo: data.projectInfo
      })
    } catch (err) {
      error.value = err.message
    } finally {
      loading.value = false
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

  async function forkSession(sessionId) {
    try {
      const data = await forkSessionApi(currentProject.value, sessionId, currentChannel.value)
      await fetchSessions(currentProject.value, { force: true })
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
    forkSession,
    saveProjectOrder,
    saveSessionOrder,
    deleteProject
  }
})
