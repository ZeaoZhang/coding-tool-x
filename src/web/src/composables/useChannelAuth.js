import { ref, unref } from 'vue'
import { syncLocalChannelAuth, fetchChannelAuthQuota } from '../api/channels'

export function useChannelAuth(platform, channelId = '') {
  const loading = ref(false)
  const candidates = ref([])
  const warning = ref('')
  const quota = ref(null)

  async function sync() {
    loading.value = true
    warning.value = ''
    try {
      const result = await syncLocalChannelAuth(unref(platform), unref(channelId))
      candidates.value = result.candidates || []
      warning.value = (result.warnings || []).join(' ')
      return result
    } catch (error) {
      warning.value = error?.response?.data?.error || error.message || '同步本地 OAuth 失败'
      throw error
    } finally {
      loading.value = false
    }
  }

  async function refreshQuota(refresh = true) {
    const id = unref(channelId)
    if (!id) return null
    const result = await fetchChannelAuthQuota(unref(platform), id, refresh)
    quota.value = result.quota || null
    if (result.warning) warning.value = result.warning
    return result
  }

  return { loading, candidates, warning, quota, sync, refreshQuota }
}

export default useChannelAuth
