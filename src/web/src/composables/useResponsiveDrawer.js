import { ref, computed, onMounted, onUnmounted } from 'vue'

/**
 * 响应式抽屉宽度 Hook
 * @param {number} desktopWidth - 桌面端默认宽度
 * @param {number} tabletWidth - 平板端宽度（可选，默认等于桌面端）
 * @returns {object} { drawerWidth, isMobile }
 */
export function useResponsiveDrawer(desktopWidth = 520, tabletWidth = null) {
  const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)

  const updateWidth = () => {
    windowWidth.value = window.innerWidth
  }

  onMounted(() => {
    window.addEventListener('resize', updateWidth)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', updateWidth)
  })

  const isMobile = computed(() => windowWidth.value < 640)
  const isTablet = computed(() => windowWidth.value >= 640 && windowWidth.value < 1024)

  const drawerWidth = computed(() => {
    // 移动端：全屏宽度
    if (windowWidth.value < 640) {
      return '100%'
    }
    // 小屏幕：使用屏幕宽度的 90%，但不超过默认宽度
    if (windowWidth.value < 768) {
      return Math.min(windowWidth.value * 0.95, desktopWidth)
    }
    // 平板端：使用平板宽度或默认宽度
    if (windowWidth.value < 1024) {
      const width = tabletWidth || desktopWidth
      return Math.min(windowWidth.value * 0.85, width)
    }
    // 桌面端：使用默认宽度
    return desktopWidth
  })

  return {
    drawerWidth,
    isMobile,
    isTablet,
    windowWidth
  }
}
