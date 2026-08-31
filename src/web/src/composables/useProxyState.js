import { computed } from 'vue'
import { useGlobalStore } from '../stores/global'
import { useEnabledCliPlatforms } from './useEnabledCliPlatforms'

/**
 * Compatibility composable backed by the keyed global platform state.
 * New callers should use useGlobalState directly.
 */
export function useProxyState() {
  const store = useGlobalStore()
  const { enabledPlatforms } = useEnabledCliPlatforms()
  const proxyPlatforms = computed(() => enabledPlatforms.value.filter(platform => (
    platform.capabilities?.proxy === true
  )))

  async function checkStatus(platform) {
    await store.initializeState()
    return store.getProxyState(platform)?.value || null
  }

  async function checkAllStatus() {
    await store.initializeState()
    return Object.fromEntries(proxyPlatforms.value.map(platform => [
      platform.key,
      store.getProxyState(platform.key)?.value || {}
    ]))
  }

  async function toggleProxy(platform, value) {
    return value
      ? store.startProxy(platform)
      : store.stopProxy(platform)
  }

  function initialize() {
    store.connectWebSocket()
    return store.initializeState()
  }

  function cleanup() {
    // WebSocket lifecycle is owned by the global store singleton.
  }

  return {
    proxyStateByPlatform: store.proxyStateByPlatform,
    proxyPlatforms,
    getProxyState: store.getProxyState,
    checkStatus,
    checkAllStatus,
    toggleProxy,
    initialize,
    cleanup
  }
}
