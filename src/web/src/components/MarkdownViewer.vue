<template>
  <div class="markdown-viewer" v-html="renderedHtml"></div>
</template>

<script setup>
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';

const props = defineProps({
  content: {
    type: String,
    default: ''
  }
});

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
               '</code></pre>';
      } catch (__) {}
    }
    return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
  }
});

// 计算渲染后的 HTML
const renderedHtml = computed(() => {
  return md.render(props.content || '');
});
</script>

<style scoped>
.markdown-viewer {
  font-size: 14px;
  line-height: 1.6;
  color: #333;
}

.markdown-viewer :deep(h1) {
  font-size: 2em;
  font-weight: 600;
  margin: 0.67em 0;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #eaecef;
}

.markdown-viewer :deep(h2) {
  font-size: 1.5em;
  font-weight: 600;
  margin: 0.75em 0 0.5em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #eaecef;
}

.markdown-viewer :deep(h3) {
  font-size: 1.25em;
  font-weight: 600;
  margin: 0.8em 0 0.5em;
}

.markdown-viewer :deep(h4) {
  font-size: 1em;
  font-weight: 600;
  margin: 0.8em 0 0.5em;
}

.markdown-viewer :deep(h5),
.markdown-viewer :deep(h6) {
  font-size: 0.875em;
  font-weight: 600;
  margin: 0.8em 0 0.5em;
}

.markdown-viewer :deep(p) {
  margin: 0.8em 0;
}

.markdown-viewer :deep(ul),
.markdown-viewer :deep(ol) {
  padding-left: 2em;
  margin: 0.8em 0;
}

.markdown-viewer :deep(li) {
  margin: 0.25em 0;
}

.markdown-viewer :deep(blockquote) {
  margin: 1em 0;
  padding: 0 1em;
  color: #6a737d;
  border-left: 0.25em solid #dfe2e5;
}

.markdown-viewer :deep(code) {
  padding: 0.2em 0.4em;
  margin: 0;
  font-size: 85%;
  background-color: rgba(27, 31, 35, 0.05);
  border-radius: 3px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

.markdown-viewer :deep(pre) {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: #f6f8fa;
  border-radius: 6px;
  margin: 1em 0;
}

.markdown-viewer :deep(pre code) {
  padding: 0;
  background-color: transparent;
  font-size: 100%;
}

.markdown-viewer :deep(table) {
  border-collapse: collapse;
  border-spacing: 0;
  width: 100%;
  margin: 1em 0;
}

.markdown-viewer :deep(table th),
.markdown-viewer :deep(table td) {
  padding: 6px 13px;
  border: 1px solid #dfe2e5;
}

.markdown-viewer :deep(table th) {
  font-weight: 600;
  background-color: #f6f8fa;
}

.markdown-viewer :deep(table tr:nth-child(2n)) {
  background-color: #f6f8fa;
}

.markdown-viewer :deep(a) {
  color: #0366d6;
  text-decoration: none;
}

.markdown-viewer :deep(a:hover) {
  text-decoration: underline;
}

.markdown-viewer :deep(img) {
  max-width: 100%;
  box-sizing: content-box;
  background-color: #fff;
  border: 1px solid #dfe2e5;
  border-radius: 3px;
  margin: 0.5em 0;
}

.markdown-viewer :deep(hr) {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: #e1e4e8;
  border: 0;
}

/* 暗色模式支持 */
@media (prefers-color-scheme: dark) {
  .markdown-viewer {
    color: #e6edf3;
  }

  .markdown-viewer :deep(h1),
  .markdown-viewer :deep(h2) {
    border-bottom-color: #30363d;
  }

  .markdown-viewer :deep(blockquote) {
    color: #8b949e;
    border-left-color: #3b434b;
  }

  .markdown-viewer :deep(code) {
    background-color: rgba(110, 118, 129, 0.4);
  }

  .markdown-viewer :deep(pre) {
    background-color: #161b22;
  }

  .markdown-viewer :deep(table th),
  .markdown-viewer :deep(table td) {
    border-color: #30363d;
  }

  .markdown-viewer :deep(table th) {
    background-color: #161b22;
  }

  .markdown-viewer :deep(table tr:nth-child(2n)) {
    background-color: #0d1117;
  }

  .markdown-viewer :deep(a) {
    color: #58a6ff;
  }

  .markdown-viewer :deep(img) {
    background-color: #0d1117;
    border-color: #30363d;
  }

  .markdown-viewer :deep(hr) {
    background-color: #21262d;
  }
}
</style>
