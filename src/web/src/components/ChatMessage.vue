<template>
  <div class="chat-message" :class="[`message-${message.type}`]">
    <div class="message-header">
      <template v-if="message.type === 'assistant'">
        <n-icon :size="16" :component="RobotIcon" class="role-icon" />
        <span class="message-role">AI</span>
        <span v-if="message.model" class="message-model">{{ message.model }}</span>
        <span class="message-time">{{ message.timestamp ? formatTime(message.timestamp) : '' }}</span>
        <span class="spacer"></span>
        <span class="copy-btn" @click="copyContent" title="复制">
          <n-icon :size="14" :component="CopyIcon" />
        </span>
      </template>
      <template v-else>
        <span class="copy-btn" @click="copyContent" title="复制">
          <n-icon :size="14" :component="CopyIcon" />
        </span>
        <span class="spacer"></span>
        <span class="message-time">{{ message.timestamp ? formatTime(message.timestamp) : '' }}</span>
        <span class="message-role">用户</span>
        <n-icon :size="16" :component="PersonIcon" class="role-icon" />
      </template>
    </div>
    <div class="message-content" :class="{ collapsed: !expanded && isLongContent }">
      <!-- User message: plain text or array content -->
      <div v-if="message.type === 'user'" class="user-content">
        <template v-if="typeof message.content === 'string'">
          {{ expanded ? message.content : truncatedContent }}
        </template>
        <template v-else-if="Array.isArray(message.content)">
          <div v-for="(item, index) in message.content" :key="index" class="content-item">
            <div v-if="item.type === 'text'">{{ item.text }}</div>
            <div v-else-if="item.type === 'image'" class="image-item">
              <template v-if="getImageSrc(item)">
                <img :src="getImageSrc(item)" alt="会话图片" loading="lazy" />
              </template>
              <template v-else>
                <n-icon :size="20" :component="ImageIcon" />
                <span>图片内容</span>
              </template>
            </div>
          </div>
        </template>
      </div>
      <!-- Assistant message: Markdown rendered -->
      <div v-else-if="message.type === 'assistant'" class="assistant-content markdown-body" v-html="expanded ? renderedMarkdown : truncatedMarkdown"></div>
    </div>
    <!-- Expand button -->
    <div v-if="isLongContent" class="expand-btn" @click="expanded = !expanded">
      {{ expanded ? '收起' : '展开全部' }}
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { NIcon } from 'naive-ui'
import { Person as PersonIcon, Chatbubbles as RobotIcon, Image as ImageIcon, Copy as CopyIcon } from '@vicons/ionicons5'
import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'

// Import commonly used languages
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import typescript from 'highlight.js/lib/languages/typescript'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'

// Register languages
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('css', css)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

// Expand/collapse state
const expanded = ref(false)
const MAX_LENGTH = 500

// Check if content is long
const isLongContent = computed(() => {
  const content = props.message.content
  if (typeof content === 'string') {
    return content.length > MAX_LENGTH
  }
  return false
})

// Truncated content for user messages
const truncatedContent = computed(() => {
  const content = props.message.content
  if (typeof content === 'string' && content.length > MAX_LENGTH) {
    return content.substring(0, MAX_LENGTH) + '...'
  }
  return content
})

// Configure marked
marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value
      } catch (err) {
        console.error('Highlight error:', err)
      }
    }
    return hljs.highlightAuto(code).value
  },
  breaks: true,
  gfm: true
})

// Render markdown (full)
const renderedMarkdown = computed(() => {
  if (props.message.type === 'assistant' && props.message.content) {
    try {
      return marked.parse(props.message.content)
    } catch (err) {
      console.error('Markdown parse error:', err)
      return props.message.content
    }
  }
  return ''
})

// Render markdown (truncated)
const truncatedMarkdown = computed(() => {
  if (props.message.type === 'assistant' && props.message.content) {
    try {
      const content = props.message.content
      const truncated = content.length > MAX_LENGTH
        ? content.substring(0, MAX_LENGTH) + '...'
        : content
      return marked.parse(truncated)
    } catch (err) {
      return props.message.content.substring(0, MAX_LENGTH) + '...'
    }
  }
  return ''
})

// Format timestamp
function formatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

// Copy content
function copyContent() {
  const text = typeof props.message.content === 'string'
    ? props.message.content
    : JSON.stringify(props.message.content)
  navigator.clipboard.writeText(text)
}

function getImageSrc(item) {
  if (!item) return null
  if (item.source?.type === 'base64' && item.source?.data) {
    const mediaType = item.source.media_type || 'image/png'
    return `data:${mediaType};base64,${item.source.data}`
  }
  if (item.source?.type === 'url' && item.source?.url) {
    return item.source.url
  }
  if (item.url) {
    return item.url
  }
  return null
}
</script>

<style scoped>
.chat-message {
  width: 100%;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 8px;
  box-sizing: border-box;
}

.message-user {
  background: linear-gradient(135deg, #667eea08 0%, #764ba208 100%);
  border: 1px solid #667eea20;
}

.message-assistant {
  background: linear-gradient(135deg, #18a05808 0%, #0ea5e908 100%);
  border: 1px solid #18a05820;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.message-user .message-header {
  justify-content: flex-end;
}

.message-assistant .message-header {
  justify-content: flex-start;
}

.role-icon {
  color: var(--n-text-color-3);
}

.message-role {
  font-weight: 600;
  font-size: 12px;
  color: var(--n-text-color-2);
}

.message-model {
  font-size: 10px;
  color: var(--n-text-color-3);
  font-weight: 400;
  padding: 1px 5px;
  background: var(--n-color-embedded);
  border-radius: 3px;
}

.message-time {
  font-size: 11px;
  color: var(--n-text-color-3);
}

.spacer {
  flex: 1;
}

.copy-btn {
  opacity: 0;
  cursor: pointer;
  color: var(--n-text-color-3);
  transition: all 0.2s;
  padding: 2px;
}

.chat-message:hover .copy-btn {
  opacity: 1;
}

.copy-btn:hover {
  color: var(--n-text-color);
}

.message-content {
  font-size: 13px;
  line-height: 1.5;
  color: var(--n-text-color);
  overflow-x: hidden;
  word-break: break-word;
}

.user-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.content-item {
  margin-bottom: 8px;
}

.image-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--n-color-embedded);
  border-radius: 4px;
  color: var(--n-text-color-2);
  font-size: 12px;
}

.image-item img {
  max-width: 100%;
  border-radius: 6px;
  display: block;
}

/* Markdown styles */
.markdown-body {
  font-size: 13px;
  line-height: 1.5;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin-top: 8px;
  margin-bottom: 4px;
  font-weight: 600;
  line-height: 1.3;
}

.markdown-body :deep(h1:first-child),
.markdown-body :deep(h2:first-child),
.markdown-body :deep(h3:first-child) {
  margin-top: 0;
}

.markdown-body :deep(h1) { font-size: 1.5em; }
.markdown-body :deep(h2) { font-size: 1.3em; }
.markdown-body :deep(h3) { font-size: 1.15em; }
.markdown-body :deep(h4) { font-size: 1.05em; }

.markdown-body :deep(p) {
  margin-bottom: 6px;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(code) {
  padding: 2px 6px;
  background: var(--n-code-color);
  border-radius: 3px;
  font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
  font-size: 0.9em;
}

.markdown-body :deep(pre) {
  margin: 6px 0;
  padding: 8px;
  background: var(--n-code-color);
  border-radius: 6px;
  overflow-x: auto;
  max-width: 100%;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: none;
  font-size: 12px;
  line-height: 1.5;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin-bottom: 6px;
  padding-left: 18px;
}

.markdown-body :deep(li) {
  margin-bottom: 2px;
}

.markdown-body :deep(blockquote) {
  margin: 6px 0;
  padding: 4px 10px;
  border-left: 4px solid var(--n-border-color);
  background: var(--n-color-embedded);
  color: var(--n-text-color-2);
}

.markdown-body :deep(a) {
  color: var(--n-color-target);
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
}

.markdown-body :deep(table th),
.markdown-body :deep(table td) {
  padding: 8px 12px;
  border: 1px solid var(--n-border-color);
}

.markdown-body :deep(table th) {
  background: var(--n-color-embedded);
  font-weight: 600;
}

.markdown-body :deep(hr) {
  margin: 12px 0;
  border: none;
  border-top: 1px solid var(--n-border-color);
}

/* Code highlighting (basic theme) */
.markdown-body :deep(.hljs) {
  color: var(--n-text-color);
  background: var(--n-code-color);
}

.markdown-body :deep(.hljs-keyword),
.markdown-body :deep(.hljs-selector-tag),
.markdown-body :deep(.hljs-literal),
.markdown-body :deep(.hljs-section),
.markdown-body :deep(.hljs-link) {
  color: #c678dd;
}

.markdown-body :deep(.hljs-string),
.markdown-body :deep(.hljs-attr),
.markdown-body :deep(.hljs-template-variable),
.markdown-body :deep(.hljs-addition) {
  color: #98c379;
}

.markdown-body :deep(.hljs-number),
.markdown-body :deep(.hljs-symbol),
.markdown-body :deep(.hljs-bullet),
.markdown-body :deep(.hljs-meta) {
  color: #d19a66;
}

.markdown-body :deep(.hljs-title),
.markdown-body :deep(.hljs-section),
.markdown-body :deep(.hljs-class .hljs-title) {
  color: #e5c07b;
}

.markdown-body :deep(.hljs-function),
.markdown-body :deep(.hljs-built_in) {
  color: #61afef;
}

.markdown-body :deep(.hljs-comment),
.markdown-body :deep(.hljs-quote),
.markdown-body :deep(.hljs-deletion) {
  color: #5c6370;
  font-style: italic;
}

/* Expand/collapse */
.message-content.collapsed {
  max-height: 200px;
  overflow: hidden;
  position: relative;
}

.message-content.collapsed::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 50px;
  background: linear-gradient(transparent, var(--n-color));
  pointer-events: none;
}

.expand-btn {
  margin-top: 8px;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--n-primary-color);
  cursor: pointer;
  text-align: center;
  border-radius: 4px;
  transition: background 0.2s;
}

.expand-btn:hover {
  background: var(--n-color-embedded);
}
</style>
