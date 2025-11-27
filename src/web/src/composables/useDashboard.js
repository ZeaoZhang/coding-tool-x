import { storeToRefs } from 'pinia'
import { useDashboardStore } from '../stores/dashboard'

export function useDashboard() {
  const store = useDashboardStore()
  const {
    dashboardData,
    isLoading,
    isLoaded
  } = storeToRefs(store)

  return {
    dashboardData,
    isLoading,
    isLoaded,
    loadDashboard: store.loadDashboard,
    enableAutoRefresh: store.enableAutoRefresh,
    disableAutoRefresh: store.disableAutoRefresh,
    refreshChannels: store.refreshChannels,
    refreshProxyStatus: store.refreshProxyStatus,
    refreshStats: store.refreshStats
  }
}
