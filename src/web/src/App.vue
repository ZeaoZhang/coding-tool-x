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
        primaryColorHover: '#1db165',
        primaryColorPressed: '#0c7a43',
        fontFamily: '"SF Pro Display", "SF Pro Text", "Segoe UI Variable Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        fontFamilyMono: '"SF Mono", "JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
        borderRadius: '16px',
        borderRadiusSmall: '12px',
        bodyColor: '#091217',
        cardColor: '#111b20',
        modalColor: '#111b20',
        popoverColor: '#111b20',
        tableColor: '#111b20',
        inputColor: '#162329',
        codeColor: '#0f1a1f',
        tabColor: '#111b20',
        actionColor: '#162329',
        tableHeaderColor: '#162329',
        hoverColor: 'rgba(255, 255, 255, 0.08)',
        pressedColor: 'rgba(255, 255, 255, 0.12)',
        borderColor: '#22343b',
        dividerColor: '#22343b',
      },
      Drawer: {
        color: '#111b20',
        headerColor: '#111b20',
        footerColor: '#111b20',
      },
      Modal: {
        color: '#111b20',
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.42)',
      },
      Card: {
        color: '#111b20',
        borderColor: '#22343b',
      },
      Popover: {
        color: '#111b20',
        textColor: '#edf5f4',
        boxShadow: '0 20px 48px rgba(0, 0, 0, 0.34)',
      },
      Tooltip: {
        color: '#111b20',
        textColor: '#edf5f4',
        boxShadow: '0 20px 48px rgba(0, 0, 0, 0.34)',
      },
      Dialog: {
        color: '#111b20',
      },
      Button: {
        borderRadiusMedium: '12px',
      },
      Input: {
        borderRadius: '12px',
      }
    }
  } else {
    return {
      common: {
        primaryColor: '#18a058',
        primaryColorHover: '#1db165',
        primaryColorPressed: '#0c7a43',
        fontFamily: '"SF Pro Display", "SF Pro Text", "Segoe UI Variable Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        fontFamilyMono: '"SF Mono", "JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
        borderRadius: '16px',
        borderRadiusSmall: '12px',
        bodyColor: '#f4f7f8',
        cardColor: '#ffffff',
        modalColor: '#ffffff',
        popoverColor: '#ffffff',
        tableColor: '#ffffff',
        inputColor: '#f7faf8',
        codeColor: '#edf3f1',
        tabColor: '#ffffff',
        actionColor: '#f7faf8',
        tableHeaderColor: '#edf3f1',
        hoverColor: 'rgba(24, 160, 88, 0.08)',
        pressedColor: 'rgba(24, 160, 88, 0.12)',
        borderColor: '#d8e1de',
        dividerColor: '#d8e1de',
      },
      Modal: {
        color: '#ffffff',
        boxShadow: '0 24px 64px rgba(15, 23, 29, 0.16)',
      },
      Card: {
        color: '#ffffff',
        borderColor: '#d8e1de',
      },
      Popover: {
        color: '#ffffff',
        textColor: '#122025',
        boxShadow: '0 18px 42px rgba(15, 23, 29, 0.12)',
      },
      Tooltip: {
        color: 'rgba(18, 32, 37, 0.94)',
        textColor: '#f7faf8',
        boxShadow: '0 18px 42px rgba(15, 23, 29, 0.18)',
      },
      Drawer: {
        color: '#ffffff',
        headerColor: '#ffffff',
        footerColor: '#ffffff',
      },
      Button: {
        borderRadiusMedium: '12px',
      },
      Input: {
        borderRadius: '12px',
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
  --bg-primary: #ffffff;
  --bg-secondary: #f4f7f8;
  --bg-tertiary: #edf3f1;
  --bg-elevated: #ffffff;
  --bg-overlay: rgba(255, 255, 255, 0.92);

  --text-primary: #122025;
  --text-secondary: #58717d;
  --text-tertiary: #738995;
  --text-quaternary: #95a7af;

  --border-primary: #d8e1de;
  --border-secondary: #c3d0cb;

  --hover-bg: rgba(24, 160, 88, 0.08);
  --active-bg: rgba(24, 160, 88, 0.12);

  --shadow-sm: 0 8px 20px rgba(15, 23, 29, 0.06);
  --shadow-md: 0 18px 42px rgba(15, 23, 29, 0.10);
  --shadow-lg: 0 30px 70px rgba(15, 23, 29, 0.14);

  --gradient-header: linear-gradient(135deg, #f8fbfc 0%, #eef6f3 52%, #e9f7f1 100%);
  --gradient-bg: linear-gradient(180deg, #f4f7f8 0%, #eef4f2 100%);
  --gradient-card: linear-gradient(145deg, rgba(255, 255, 255, 0.98) 0%, rgba(247, 250, 248, 0.98) 100%);

  --primary-color: #18a058;
}

[data-theme="dark"] {
  --bg-primary: #091217;
  --bg-secondary: #111b20;
  --bg-tertiary: #0f1a1f;
  --bg-elevated: #162329;
  --bg-overlay: rgba(17, 27, 32, 0.94);

  --text-primary: #edf5f4;
  --text-secondary: #a9bfbb;
  --text-tertiary: #8fa5a1;
  --text-quaternary: #718784;

  --border-primary: #22343b;
  --border-secondary: #2b424a;

  --hover-bg: rgba(255, 255, 255, 0.08);
  --active-bg: rgba(255, 255, 255, 0.12);

  --shadow-sm: 0 10px 24px rgba(0, 0, 0, 0.24);
  --shadow-md: 0 22px 52px rgba(0, 0, 0, 0.30);
  --shadow-lg: 0 36px 76px rgba(0, 0, 0, 0.36);

  --gradient-header: linear-gradient(135deg, #111b20 0%, #152229 52%, #12262b 100%);
  --gradient-bg: linear-gradient(180deg, #091217 0%, #0d171c 100%);
  --gradient-card: linear-gradient(145deg, rgba(17, 27, 32, 0.98) 0%, rgba(13, 22, 27, 0.98) 100%);

  --primary-color: #18a058;
}

body {
  margin: 0;
  padding: 0;
  font-family: "SF Pro Display", "SF Pro Text", "Segoe UI Variable Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
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
  scrollbar-color: rgba(24, 160, 88, 0.28) transparent;
}

*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

*::-webkit-scrollbar-track {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  background-color: rgba(24, 160, 88, 0.28);
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
