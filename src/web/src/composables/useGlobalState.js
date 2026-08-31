import { storeToRefs } from 'pinia'
import { useGlobalStore, initializeGlobalStore } from '../stores/global'

export function useGlobalState() {
  const store = useGlobalStore()
  const {
    proxyStateByPlatform,
    channelsByPlatform,
    schedulerStateByPlatform,
    logsBySource,
    wsConnected,
    logLimit,
    statsInterval
  } = storeToRefs(store)

  return {
    proxyStateByPlatform,
    channelsByPlatform,
    schedulerStateByPlatform,
    logsBySource,
    ensurePlatformState: store.ensurePlatformState,
    connectWebSocket: store.connectWebSocket,
    initializeState: store.initializeState,
    loadChannels: store.loadChannels,
    getProxyState: store.getProxyState,
    getChannels: store.getChannels,
    getSchedulerState: store.getSchedulerState,
    handleProxyStateUpdate: store.handleProxyStateUpdate,
    hydrateFromDashboard: store.hydrateFromDashboard,
    startProxy: store.startProxy,
    stopProxy: store.stopProxy,
    getLogs: store.getLogs,
    wsConnected,
    clearLogsState: store.clearLogsState,
    clearLogsForSource: store.clearLogsForSource,
    logLimit,
    statsInterval,
    loadAdvancedConfig: store.loadAdvancedConfig
  }
}

export function initializeGlobalState() {
  initializeGlobalStore()
}
