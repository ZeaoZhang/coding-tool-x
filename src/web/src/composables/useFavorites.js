import { ref, computed } from 'vue'
import api from '../api'

// 收藏列表 { claude: [], codex: [], gemini: [] }
const favorites = ref({
  claude: [],
  codex: [],
  gemini: []
})

// 加载收藏列表
async function loadFavorites() {
  try {
    const response = await api.getAllFavorites()
    if (response.success && response.favorites) {
      favorites.value = {
        claude: response.favorites.claude || [],
        codex: response.favorites.codex || [],
        gemini: response.favorites.gemini || []
      }
    }
  } catch (err) {
    console.error('Failed to load favorites:', err)
  }
}

export function useFavorites() {
  // 添加收藏
  async function addFavorite(channel, sessionData) {
    try {
      const response = await api.addFavorite(channel, sessionData)
      if (response.success) {
        // 更新本地状态
        favorites.value = response.favorites
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to add favorite:', err)
      return false
    }
  }

  // 删除收藏
  async function removeFavorite(channel, projectName, sessionId) {
    try {
      const response = await api.removeFavorite(channel, projectName, sessionId)
      if (response.success) {
        // 更新本地状态
        favorites.value = response.favorites
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to remove favorite:', err)
      return false
    }
  }

  // 检查是否已收藏
  function isFavorite(channel, projectName, sessionId) {
    if (!favorites.value[channel]) return false
    return favorites.value[channel].some(
      fav => fav.sessionId === sessionId && fav.projectName === projectName
    )
  }

  // 获取某个渠道的收藏列表
  function getFavorites(channel) {
    return favorites.value[channel] || []
  }

  // 获取所有收藏列表
  function getAllFavorites() {
    return favorites.value
  }

  // 获取收藏总数
  const totalFavorites = computed(() => {
    return (favorites.value.claude?.length || 0) +
           (favorites.value.codex?.length || 0) +
           (favorites.value.gemini?.length || 0)
  })

  // 初始化加载
  loadFavorites()

  return {
    favorites,
    addFavorite,
    removeFavorite,
    isFavorite,
    getFavorites,
    getAllFavorites,
    totalFavorites,
    loadFavorites
  }
}
