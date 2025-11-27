import { storeToRefs } from 'pinia'
import { useGlobalStore, initializeGlobalStore } from '../stores/global'

export function useGlobalState() {
  const store = useGlobalStore()
  const {
    claudeProxy,
    codexProxy,
    geminiProxy,
    claudeChannels,
    codexChannels,
    geminiChannels,
    wsConnected,
    logLimit,
    statsInterval
  } = storeToRefs(store)

  return {
    claudeProxy,
    codexProxy,
    geminiProxy,
    claudeChannels,
    codexChannels,
    geminiChannels,
    connectWebSocket: store.connectWebSocket,
    initializeState: store.initializeState,
    loadChannels: store.loadChannels,
    getProxyState: store.getProxyState,
    getChannels: store.getChannels,
    handleProxyStateUpdate: store.handleProxyStateUpdate,
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
