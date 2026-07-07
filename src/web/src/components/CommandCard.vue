<template>
  <div class="command-card asset-card" :class="{ 'is-project': command.scope === 'project', 'is-managed': registryInfo }" @click="emit('click', command)">
    <div class="asset-card-main">
      <div class="asset-card-top">
        <div class="asset-card-title-stack">
          <div class="asset-card-title-row">
            <span class="asset-status-dot" :class="{ active: registryInfo?.enabled || command.scope === 'project' }"></span>
            <span class="asset-name mono">/{{ command.name }}</span>
          </div>
          <div class="asset-tags">
            <n-tag :type="command.scope === 'user' ? 'info' : 'success'" size="tiny" :bordered="false">
              {{ command.scope === 'user' ? '用户级' : '项目级' }}
            </n-tag>
            <n-tag v-if="registryInfo" type="success" size="tiny" :bordered="false">托管</n-tag>
            <n-tag v-if="command.namespace" type="warning" size="tiny" :bordered="false">
              {{ command.namespace }}
            </n-tag>
          </div>
        </div>
      </div>

      <div class="asset-description" v-if="command.description">
        {{ truncateDesc(command.description) }}
      </div>

      <div class="asset-meta">
        <span class="asset-meta-item" v-if="command.allowedTools">
          <n-icon size="12"><HammerOutline /></n-icon>
          {{ command.allowedTools }}
        </span>
        <span class="asset-meta-item" v-if="command.argumentHint">
          <n-icon size="12"><CodeOutline /></n-icon>
          {{ command.argumentHint }}
        </span>
      </div>
    </div>

    <div class="asset-card-actions">
      <!-- 注册表管理模式 -->
      <template v-if="registryInfo">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-switch
              :value="registryInfo.enabled"
              size="small"
              :loading="toggling"
              @update:value="emit('toggle-enabled', command, $event)"
              @click.stop
            />
          </template>
          {{ registryInfo.enabled ? '已启用' : '已禁用' }}
        </n-tooltip>
        <div class="asset-platform-strip">
          <n-tooltip trigger="hover">
            <template #trigger>
              <span
                class="asset-platform-icon"
                :class="{ active: registryInfo.platforms?.claude }"
                @click.stop="emit('toggle-platform', command, 'claude', !registryInfo.platforms?.claude)"
              >
                <n-icon size="14"><LogoApple /></n-icon>
              </span>
            </template>
            Claude Code {{ registryInfo.platforms?.claude ? '已启用' : '未启用' }}
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <span
                class="asset-platform-icon"
                :class="{ active: registryInfo.platforms?.codex }"
                @click.stop="emit('toggle-platform', command, 'codex', !registryInfo.platforms?.codex)"
              >
                <n-icon size="14"><TerminalOutline /></n-icon>
              </span>
            </template>
            Codex CLI {{ registryInfo.platforms?.codex ? '已启用' : '未启用' }}
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <span
                class="asset-platform-icon"
                :class="{ active: registryInfo.platforms?.gemini }"
                @click.stop="emit('toggle-platform', command, 'gemini', !registryInfo.platforms?.gemini)"
              >
                <n-icon size="14"><SparklesOutline /></n-icon>
              </span>
            </template>
            Gemini CLI {{ registryInfo.platforms?.gemini ? '已启用' : '未启用' }}
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <span
                class="asset-platform-icon"
                :class="{ active: registryInfo.platforms?.opencode }"
                @click.stop="emit('toggle-platform', command, 'opencode', !registryInfo.platforms?.opencode)"
              >
                <n-icon size="14"><CodeSlashOutline /></n-icon>
              </span>
            </template>
            OpenCode {{ registryInfo.platforms?.opencode ? '已启用' : '未启用' }}
          </n-tooltip>
          <n-tooltip trigger="hover">
            <template #trigger>
              <span
                class="asset-platform-icon"
                :class="{ active: registryInfo.platforms?.pi }"
                @click.stop="emit('toggle-platform', command, 'pi', !registryInfo.platforms?.pi)"
              >
                <n-icon size="14"><PlanetOutline /></n-icon>
              </span>
            </template>
            OMP {{ registryInfo.platforms?.pi ? '已启用' : '未启用' }}
          </n-tooltip>
        </div>
      </template>
      <!-- 原有模式 -->
      <template v-else>
        <n-button
          size="tiny"
          tertiary
          @click.stop="emit('edit', command)"
        >
          编辑
        </n-button>
        <n-button
          size="tiny"
          tertiary
          type="error"
          :loading="props.deleting"
          @click.stop="emit('delete', command)"
        >
          删除
        </n-button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { NButton, NTag, NIcon, NSwitch, NTooltip } from 'naive-ui'
import { HammerOutline, CodeOutline, LogoApple, TerminalOutline, CodeSlashOutline, SparklesOutline, PlanetOutline } from '@vicons/ionicons5'

const props = defineProps({
  command: {
    type: Object,
    required: true
  },
  deleting: {
    type: Boolean,
    default: false
  },
  registryInfo: {
    type: Object,
    default: null
  },
  toggling: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click', 'edit', 'delete', 'toggle-enabled', 'toggle-platform'])

function truncateDesc(desc) {
  if (!desc) return ''
  return desc.length > 80 ? desc.slice(0, 80) + '...' : desc
}
</script>

<style scoped>
.asset-meta-item {
  max-width: 150px;
}
</style>
