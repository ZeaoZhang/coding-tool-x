<template>
  <div class="skill-card" :class="{ installed: skill.installed }" @click="emit('click', skill)">
    <div class="card-main">
      <div class="card-header">
        <div class="skill-name">{{ skill.name }}</div>
        <div class="skill-badges">
          <n-tag v-if="skill.installed" type="success" size="tiny" :bordered="false">
            已安装
          </n-tag>
          <n-tag v-if="skill.repoOwner" type="info" size="tiny" :bordered="false">
            {{ skill.repoOwner }}
          </n-tag>
        </div>
      </div>

      <div class="skill-desc" v-if="skill.description">
        {{ truncateDesc(skill.description) }}
      </div>

      <div class="skill-meta">
        <span class="meta-item" v-if="skill.directory">
          <n-icon size="12"><FolderOutline /></n-icon>
          {{ skill.directory }}
        </span>
        <a
          v-if="skill.readmeUrl"
          :href="skill.readmeUrl"
          target="_blank"
          class="meta-link"
          @click.stop
        >
          <n-icon size="12"><OpenOutline /></n-icon>
          GitHub
        </a>
      </div>
    </div>

    <div class="card-actions">
      <n-button
        v-if="skill.installed"
        size="tiny"
        tertiary
        type="error"
        :loading="props.uninstalling"
        :disabled="props.uninstalling"
        @click.stop="handleUninstall"
      >
        卸载
      </n-button>
      <n-button
        v-else
        size="tiny"
        type="primary"
        :loading="props.installing"
        :disabled="!skill.repoOwner || props.installing"
        @click.stop="handleInstall"
      >
        安装
      </n-button>
    </div>
  </div>
</template>

<script setup>
import { NButton, NTag, NIcon } from 'naive-ui'
import { FolderOutline, OpenOutline } from '@vicons/ionicons5'

const props = defineProps({
  skill: {
    type: Object,
    required: true
  },
  installing: {
    type: Boolean,
    default: false
  },
  uninstalling: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['install', 'uninstall', 'click'])

function truncateDesc(desc) {
  if (!desc) return ''
  return desc.length > 100 ? desc.slice(0, 100) + '...' : desc
}

function handleInstall() {
  emit('install', props.skill)
}

function handleUninstall() {
  emit('uninstall', props.skill)
}
</script>

<style scoped>
.skill-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  transition: all 0.15s ease;
  cursor: pointer;
}

.skill-card:hover {
  border-color: #18a058;
  background: var(--bg-tertiary);
  box-shadow: 0 4px 12px rgba(24, 160, 88, 0.1);
}

.skill-card.installed {
  border-left: 3px solid #18a058;
}

.card-main {
  flex: 1;
  min-width: 0;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.skill-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.skill-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.meta-link {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-tertiary);
  text-decoration: none;
  transition: color 0.15s;
}

.meta-link:hover {
  color: #18a058;
}

.card-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

/* ========== 响应式样式 ========== */

/* 小屏幕 (640px - 768px) */
@media (max-width: 768px) {
  .skill-card {
    padding: 10px 12px;
    gap: 10px;
  }

  .skill-name {
    font-size: 12px;
  }

  .skill-desc {
    font-size: 11px;
    -webkit-line-clamp: 3;
  }

  .skill-meta {
    font-size: 10px;
    gap: 8px;
  }
}

/* 移动端 (< 640px) */
@media (max-width: 640px) {
  .skill-card {
    flex-direction: column;
    align-items: stretch;
    padding: 8px 10px;
    gap: 8px;
  }

  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 4px;
  }

  .skill-badges {
    align-self: flex-start;
  }

  .skill-desc {
    margin-bottom: 6px;
    font-size: 11px;
  }

  .skill-meta {
    justify-content: flex-start;
  }

  .card-actions {
    justify-content: center;
  }
}

/* 超小屏幕 (< 480px) */
@media (max-width: 480px) {
  .skill-card {
    padding: 6px 8px;
  }

  .skill-name {
    font-size: 11px;
  }

  .skill-desc {
    font-size: 10px;
    line-height: 1.4;
  }

  .skill-meta {
    font-size: 9px;
    gap: 6px;
  }

  .card-actions :deep(.n-button) {
    font-size: 10px;
    height: 24px;
  }
}
</style>
