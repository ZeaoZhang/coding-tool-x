<template>
  <n-config-provider :theme="theme" :theme-overrides="themeOverrides">
    <n-dialog-provider>
      <n-message-provider>
        <Layout />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme } from 'naive-ui'
import Layout from './components/Layout.vue'
import { useTheme } from './composables/useTheme'

// 使用主题 composable
const { isDark, loadTheme } = useTheme()

// 动态主题配置
const theme = computed(() => isDark.value ? darkTheme : null)

// Theme customization (适配亮色和暗色)
const themeOverrides = computed(() => {
  if (isDark.value) {
    return {
      common: {
        primaryColor: '#18a058',
        primaryColorHover: '#36ad6a',
        primaryColorPressed: '#0c7a43',
        // 暗色主题下的背景色优化
        bodyColor: '#0f1419',
        cardColor: '#1a1f2e',
        modalColor: '#1a1f2e',
        popoverColor: '#1a1f2e',
        tableColor: '#1a1f2e',
        inputColor: '#232835',
        codeColor: '#232835',
        tabColor: '#1a1f2e',
        actionColor: '#232835',
        tableHeaderColor: '#232835',
        hoverColor: 'rgba(255, 255, 255, 0.09)',
        pressedColor: 'rgba(255, 255, 255, 0.13)',
        borderColor: '#2d3748',
        dividerColor: '#2d3748',
      },
      Drawer: {
        color: '#1a1f2e',
        headerColor: '#1a1f2e',
        footerColor: '#1a1f2e',
      },
      Modal: {
        color: '#1a1f2e',
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.6), 0 8px 32px rgba(0, 0, 0, 0.6)',
      },
      Card: {
        color: '#1a1f2e',
        borderColor: '#2d3748',
      },
      Popover: {
        color: '#1a1f2e',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
      },
      Dialog: {
        color: '#1a1f2e',
      }
    }
  } else {
    return {
      common: {
        primaryColor: '#18a058',
        primaryColorHover: '#36ad6a',
        primaryColorPressed: '#0c7a43',
      }
    }
  }
})

// 初始化时加载主题
onMounted(() => {
  loadTheme()
})
</script>

<style>
/* 全局 CSS 变量 - 亮色主题 */
:root {
  /* 背景色 */
  --bg-primary: #ffffff;
  --bg-secondary: #fafbfc;
  --bg-tertiary: #f5f6f7;
  --bg-elevated: #ffffff;
  --bg-overlay: rgba(255, 255, 255, 0.9);

  /* 文字颜色 */
  --text-primary: #1f2937;
  --text-secondary: #4b5563;
  --text-tertiary: #6b7280;
  --text-quaternary: #9ca3af;

  /* 边框颜色 */
  --border-primary: #e5e7eb;
  --border-secondary: #d1d5db;

  /* 悬停/激活状态 */
  --hover-bg: #f9fafb;
  --active-bg: #f3f4f6;

  /* 阴影 */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);

  /* 渐变 */
  --gradient-header: linear-gradient(135deg, #ffffff 0%, #f8fffe 50%, #f0fdf4 100%);
  --gradient-bg: linear-gradient(180deg, #fafbfc 0%, #f5f6f7 100%);
  --gradient-card: linear-gradient(145deg, #ffffff 0%, #fafbfc 100%);

  /* 主色 */
  --primary-color: #18a058;

  /* Terminal 相关变量 - 浅色主题 (Catppuccin Latte) */
  --terminal-bg: #eff1f5;
  --terminal-tabs-bg: #e6e9ef;
  --terminal-tab-bg: #eff1f5;
  --terminal-tab-hover: #dce0e8;
  --terminal-tab-active-border: #9ca0b0;
  --terminal-border: #ccd0da;
  --terminal-text: #4c4f69;
  --terminal-text-muted: #6c6f85;
  --terminal-overlay-bg: rgba(239, 241, 245, 0.9);
  --terminal-scrollbar: rgba(64, 160, 43, 0.3);
  --terminal-scrollbar-hover: rgba(64, 160, 43, 0.5);
  --terminal-btn-hover: rgba(156, 160, 176, 0.3);
  --terminal-item-bg: rgba(220, 224, 232, 0.5);
  --terminal-item-border: rgba(204, 208, 218, 0.8);
  --terminal-item-hover: rgba(220, 224, 232, 0.8);
  --terminal-icon-bg: rgba(239, 241, 245, 0.8);
}

/* 全局 CSS 变量 - 暗色主题 */
[data-theme="dark"] {
  /* 背景色 - 优化为更加统一和美观的深蓝灰色调 */
  --bg-primary: #0f1419;
  --bg-secondary: #1a1f2e;
  --bg-tertiary: #13171f;
  --bg-elevated: #232835;
  --bg-overlay: rgba(26, 31, 46, 0.95);

  /* 文字颜色 */
  --text-primary: #e6edf3;
  --text-secondary: #adbac7;
  --text-tertiary: #909dab;
  --text-quaternary: #768390;

  /* 边框颜色 */
  --border-primary: #2d3748;
  --border-secondary: #373e4e;

  /* 悬停/激活状态 */
  --hover-bg: rgba(255, 255, 255, 0.09);
  --active-bg: rgba(255, 255, 255, 0.13);

  /* 阴影 */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.6);

  /* 渐变 */
  --gradient-header: linear-gradient(135deg, #1a1f2e 0%, #161b28 50%, #13171f 100%);
  --gradient-bg: linear-gradient(180deg, #0f1419 0%, #13171f 100%);
  --gradient-card: linear-gradient(145deg, #1a1f2e 0%, #161b28 100%);

  /* 主色 */
  --primary-color: #18a058;

  /* Terminal 相关变量 - 深色主题 (Catppuccin Mocha) */
  --terminal-bg: #1e1e2e;
  --terminal-tabs-bg: #181825;
  --terminal-tab-bg: #1e1e2e;
  --terminal-tab-hover: #313244;
  --terminal-tab-active-border: #45475a;
  --terminal-border: #313244;
  --terminal-text: #cdd6f4;
  --terminal-text-muted: #a6adc8;
  --terminal-overlay-bg: rgba(30, 30, 46, 0.9);
  --terminal-scrollbar: rgba(166, 227, 161, 0.3);
  --terminal-scrollbar-hover: rgba(166, 227, 161, 0.5);
  --terminal-btn-hover: rgba(69, 71, 90, 0.5);
  --terminal-item-bg: rgba(69, 71, 90, 0.3);
  --terminal-item-border: rgba(69, 71, 90, 0.5);
  --terminal-item-hover: rgba(69, 71, 90, 0.5);
  --terminal-icon-bg: rgba(30, 30, 46, 0.5);
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  transition: background-color 0.3s ease, color 0.3s ease;
}

#app {
  min-height: 100vh;
  background: var(--bg-primary);
}

/* 全局滚动条样式 */
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(24, 160, 88, 0.3) transparent;
}

*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

*::-webkit-scrollbar-track {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  background-color: rgba(24, 160, 88, 0.3);
  border-radius: 3px;
  transition: background-color 0.2s ease;
}

*::-webkit-scrollbar-thumb:hover {
  background-color: rgba(24, 160, 88, 0.5);
}

/* 暗色主题下的滚动条 */
[data-theme="dark"] *::-webkit-scrollbar-thumb {
  background-color: rgba(24, 160, 88, 0.4);
}

[data-theme="dark"] *::-webkit-scrollbar-thumb:hover {
  background-color: rgba(24, 160, 88, 0.6);
}
</style>
