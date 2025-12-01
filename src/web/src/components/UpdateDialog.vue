<template>
  <div class="update-dialog-content">
    <!-- 版本信息卡片 -->
    <div class="version-card">
      <div class="version-item">
        <div class="version-label">当前版本</div>
        <div class="version-number">{{ currentVersion }}</div>
      </div>
      <div class="arrow">➜</div>
      <div class="version-item">
        <div class="version-label">最新版本</div>
        <div class="version-number">{{ latestVersion }}</div>
      </div>
    </div>

    <!-- 更新日志（Markdown 格式） -->
    <div v-if="changelog" class="changelog-section">
      <div class="changelog-title">📋 更新内容</div>
      <div class="changelog-content" v-html="parseMarkdown(changelog)"></div>
    </div>

    <!-- 获取失败时显示链接 -->
    <div v-else class="changelog-fallback">
      <div class="fallback-icon">📄</div>
      <div class="fallback-text">
        <a :href="changelogUrl" target="_blank" class="changelog-link">
          查看完整更新日志 →
        </a>
      </div>
    </div>

    <!-- 更新方法 -->
    <div class="action-section">
      <div class="action-title">🚀 如何更新</div>

      <!-- 手动更新提示 -->
      <div class="manual-update-hint">
        <div class="update-command">
          <span class="command-label">在终端运行：</span>
          <code class="command-code">ct update</code>
        </div>
        <div class="update-note">更新完成后请重启服务</div>
      </div>

      <button class="btn btn-secondary" @click="openNpmPage">
        📖 查看 npm 详情
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  currentVersion: {
    type: String,
    required: true
  },
  latestVersion: {
    type: String,
    required: true
  },
  changelog: {
    type: [String, Object],
    default: null
  }
})

const changelogUrl = computed(() => {
  return 'https://github.com/CooperJiang/coding-tool/blob/main/CHANGELOG.md'
})

function openNpmPage() {
  window.open('https://www.npmjs.com/package/coding-tool', '_blank')
}

/**
 * 简单的 Markdown 到 HTML 转换
 * 支持：标题、列表、加粗、斜体、链接
 */
function parseMarkdown(content) {
  if (!content) return ''

  let html = String(content)

  // 移除版本标题（## [x.x.x] - ...）
  html = html.replace(/## \[\d+\.\d+\.\d+\].*?\n/g, '')

  // 转换二级标题为带样式的标题（### xxx）
  html = html.replace(/### (.*?)\n/g, (match, title) => {
    const titles = {
      'Added': { icon: '✨', color: '#18a058' },
      'Improved': { icon: '⚡', color: '#3b82f6' },
      'Fixed': { icon: '🐛', color: '#f59e0b' }
    }
    const key = title.trim()
    const style = titles[key] || { icon: '📌', color: '#666' }
    return `<div class="md-section-title" style="color: ${style.color}">${style.icon} ${key}</div>`
  })

  // 转换列表项
  html = html.replace(/^- (.*?)$/gm, '<div class="md-list-item">• $1</div>')

  // 转换加粗文本
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

  // 转换斜体文本
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')

  // 转换链接
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" class="md-link">$1</a>')

  // 转换代码
  html = html.replace(/`(.*?)`/g, '<code class="md-code">$1</code>')

  // 分行符
  html = html.replace(/\n\n/g, '</p><p>')
  html = html.replace(/\n/g, '<br>')

  // 移除多余的空行
  html = html.replace(/(<br>)+/g, '<br>')
  html = html.replace(/^<br>|<br>$/g, '')

  return html
}
</script>

<style scoped>
.update-dialog-content {
  line-height: 1.8;
  color: var(--text-primary);
  max-height: 60vh;
  overflow-y: auto;
}

/* 版本信息卡片 */
.version-card {
  margin-bottom: 16px;
  padding: 12px 14px;
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.08) 0%, rgba(24, 160, 88, 0.04) 100%);
  border: 1px solid rgba(24, 160, 88, 0.2);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.version-item {
  flex: 1;
  text-align: center;
}

.version-label {
  font-size: 10px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  font-weight: 600;
}

.version-number {
  font-size: 16px;
  font-weight: 800;
  font-family: monospace;
}

.version-card .version-item:first-child .version-number {
  color: var(--text-secondary);
}

.version-card .version-item:last-child .version-number {
  color: #18a058;
}

.arrow {
  display: flex;
  align-items: center;
  color: #18a058;
  font-size: 20px;
  font-weight: 700;
}

/* 更新日志部分 */
.changelog-section {
  margin-bottom: 20px;
}

.changelog-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.changelog-content {
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-secondary);
}

/* 获取失败时的 fallback */
.changelog-fallback {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  margin-bottom: 20px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.04) 100%);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
}

.fallback-icon {
  font-size: 24px;
}

.fallback-text {
  flex: 1;
}

.changelog-link {
  color: #3b82f6;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s ease;
}

.changelog-link:hover {
  color: #2563eb;
  text-decoration: underline;
}

/* Markdown 内容样式 */
.changelog-content :deep(.md-section-title) {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 8px;
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 6px;
  border-left: 3px solid;
}

.changelog-content :deep(.md-section-title:first-child) {
  margin-top: 0;
}

.changelog-content :deep(.md-list-item) {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-left: 4px;
  margin-bottom: 4px;
}

.changelog-content :deep(.md-list-item:last-child) {
  margin-bottom: 0;
}

.changelog-content :deep(.md-code) {
  background: var(--bg-primary);
  color: #18a058;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
  font-weight: 600;
  margin: 0 4px;
}

.changelog-content :deep(.md-link) {
  color: #18a058;
  text-decoration: none;
  font-weight: 600;
  border-bottom: 1px solid rgba(24, 160, 88, 0.3);
  transition: all 0.2s ease;
}

.changelog-content :deep(.md-link:hover) {
  border-bottom-color: #18a058;
  opacity: 0.8;
}

.changelog-content :deep(strong) {
  font-weight: 700;
  color: var(--text-primary);
}

.changelog-content :deep(em) {
  font-style: italic;
  color: var(--text-secondary);
}

.changelog-content :deep(br) {
  display: block;
  content: '';
  height: 0;
  margin: 0;
}

/* 操作按钮部分 */
.action-section {
  margin-top: 20px;
}

.action-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 10px;
}

/* 手动更新提示 */
.manual-update-hint {
  padding: 14px 16px;
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.08) 0%, rgba(24, 160, 88, 0.04) 100%);
  border: 1px solid rgba(24, 160, 88, 0.2);
  border-radius: 8px;
  margin-bottom: 12px;
}

.update-command {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.command-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.command-code {
  background: var(--bg-primary);
  color: #18a058;
  padding: 4px 10px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
  font-weight: 700;
  border: 1px solid rgba(24, 160, 88, 0.2);
}

.update-note {
  font-size: 11px;
  color: var(--text-tertiary);
}

.btn {
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
  outline: none;
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border-primary);
}

.btn-secondary:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
  border-color: rgba(24, 160, 88, 0.3);
}

.btn-secondary:active {
  transform: translateY(0.5px);
}
</style>
