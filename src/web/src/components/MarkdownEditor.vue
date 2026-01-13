<template>
  <div class="markdown-editor" :class="{ 'is-editing': isEditing, 'is-empty': !modelValue }">
    <!-- 编辑模式 -->
    <div v-if="isEditing" class="editor-container">
      <n-input
        ref="inputRef"
        :value="modelValue"
        type="textarea"
        :rows="rows"
        :placeholder="placeholder"
        :disabled="disabled"
        @update:value="$emit('update:modelValue', $event)"
        @blur="handleBlur"
        @keydown.esc="handleEscape"
      />
      <div class="editor-hint">
        <span>按 Esc 退出编辑 | 支持 Markdown 格式</span>
      </div>
    </div>

    <!-- 预览模式 -->
    <div
      v-else
      class="preview-container"
      :style="{ minHeight: minHeight + 'px' }"
      @dblclick="enterEditMode"
    >
      <div v-if="modelValue" class="markdown-content" v-html="renderedHtml"></div>
      <div v-else class="placeholder-text">{{ placeholder || '双击编辑...' }}</div>
      <div class="preview-hint">
        <n-icon size="12"><CreateOutline /></n-icon>
        <span>双击编辑</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { NInput, NIcon } from 'naive-ui'
import { CreateOutline } from '@vicons/ionicons5'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: '输入内容，支持 Markdown 格式...'
  },
  rows: {
    type: Number,
    default: 10
  },
  minHeight: {
    type: Number,
    default: 150
  },
  disabled: {
    type: Boolean,
    default: false
  },
  // 是否默认进入编辑模式（用于新建场景）
  defaultEditing: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'edit', 'blur'])

const isEditing = ref(props.defaultEditing)
const inputRef = ref(null)

// 初始化 Markdown 渲染器
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return '<pre class="hljs"><code>' +
               hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
               '</code></pre>'
      } catch (__) {}
    }
    return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>'
  }
})

// 计算渲染后的 HTML
const renderedHtml = computed(() => {
  return md.render(props.modelValue || '')
})

// 进入编辑模式
function enterEditMode() {
  if (props.disabled) return
  isEditing.value = true
  emit('edit')
  nextTick(() => {
    inputRef.value?.focus()
  })
}

// 退出编辑模式
function exitEditMode() {
  isEditing.value = false
  emit('blur')
}

// 处理失焦
function handleBlur() {
  // 延迟退出，避免点击其他元素时立即退出
  setTimeout(() => {
    exitEditMode()
  }, 150)
}

// 处理 Esc 键
function handleEscape() {
  exitEditMode()
}

// 监听 defaultEditing 变化
watch(() => props.defaultEditing, (val) => {
  if (val && !isEditing.value) {
    enterEditMode()
  }
})

// 暴露方法给父组件
defineExpose({
  enterEditMode,
  exitEditMode,
  isEditing
})
</script>

<style scoped>
.markdown-editor {
  width: 100%;
  position: relative;
}

/* 编辑容器 */
.editor-container {
  position: relative;
}

.editor-hint {
  position: absolute;
  bottom: 8px;
  right: 12px;
  font-size: 11px;
  color: var(--text-tertiary, #999);
  pointer-events: none;
  opacity: 0.7;
}

/* 预览容器 */
.preview-container {
  position: relative;
  padding: 12px 16px;
  border: 1px solid var(--border-color, #e0e0e6);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--bg-color, #fff);
  overflow: auto;
  max-height: 400px;
}

.preview-container:hover {
  border-color: var(--primary-color, #18a058);
  background: var(--bg-hover, #fafafa);
}

.preview-hint {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary, #999);
  opacity: 0;
  transition: opacity 0.2s ease;
  background: var(--bg-color, #fff);
  padding: 2px 6px;
  border-radius: 4px;
}

.preview-container:hover .preview-hint {
  opacity: 1;
}

.placeholder-text {
  color: var(--text-tertiary, #999);
  font-style: italic;
}

/* Markdown 内容样式 */
.markdown-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #333);
}

.markdown-content :deep(h1) {
  font-size: 1.75em;
  font-weight: 600;
  margin: 0.5em 0 0.3em;
  padding-bottom: 0.2em;
  border-bottom: 1px solid var(--border-color, #eaecef);
}

.markdown-content :deep(h2) {
  font-size: 1.4em;
  font-weight: 600;
  margin: 0.5em 0 0.3em;
  padding-bottom: 0.2em;
  border-bottom: 1px solid var(--border-color, #eaecef);
}

.markdown-content :deep(h3) {
  font-size: 1.2em;
  font-weight: 600;
  margin: 0.5em 0 0.3em;
}

.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  font-size: 1em;
  font-weight: 600;
  margin: 0.5em 0 0.3em;
}

.markdown-content :deep(p) {
  margin: 0.5em 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.markdown-content :deep(li) {
  margin: 0.2em 0;
}

.markdown-content :deep(blockquote) {
  margin: 0.5em 0;
  padding: 0 1em;
  color: var(--text-secondary, #6a737d);
  border-left: 0.25em solid var(--primary-color, #18a058);
}

.markdown-content :deep(code) {
  padding: 0.2em 0.4em;
  margin: 0;
  font-size: 85%;
  background-color: var(--bg-tertiary, rgba(27, 31, 35, 0.05));
  border-radius: 3px;
  font-family: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
}

.markdown-content :deep(pre) {
  padding: 12px 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: var(--bg-tertiary, #f6f8fa);
  border-radius: 6px;
  margin: 0.5em 0;
}

.markdown-content :deep(pre code) {
  padding: 0;
  background-color: transparent;
  font-size: 100%;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5em 0;
}

.markdown-content :deep(table th),
.markdown-content :deep(table td) {
  padding: 6px 12px;
  border: 1px solid var(--border-color, #dfe2e5);
}

.markdown-content :deep(table th) {
  font-weight: 600;
  background-color: var(--bg-tertiary, #f6f8fa);
}

.markdown-content :deep(a) {
  color: var(--primary-color, #18a058);
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(img) {
  max-width: 100%;
  border-radius: 4px;
}

.markdown-content :deep(hr) {
  height: 0.2em;
  padding: 0;
  margin: 1em 0;
  background-color: var(--border-color, #e1e4e8);
  border: 0;
}

/* 空状态样式 */
.markdown-editor.is-empty .preview-container {
  border-style: dashed;
}

/* 暗色模式支持 */
@media (prefers-color-scheme: dark) {
  .preview-container {
    border-color: #3b434b;
    background: #1e1e1e;
  }

  .preview-container:hover {
    background: #252525;
  }

  .markdown-content {
    color: #e6edf3;
  }

  .markdown-content :deep(h1),
  .markdown-content :deep(h2) {
    border-bottom-color: #30363d;
  }

  .markdown-content :deep(blockquote) {
    color: #8b949e;
  }

  .markdown-content :deep(code) {
    background-color: rgba(110, 118, 129, 0.4);
  }

  .markdown-content :deep(pre) {
    background-color: #161b22;
  }

  .markdown-content :deep(table th),
  .markdown-content :deep(table td) {
    border-color: #30363d;
  }

  .markdown-content :deep(table th) {
    background-color: #161b22;
  }
}
</style>
