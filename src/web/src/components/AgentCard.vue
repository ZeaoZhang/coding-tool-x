<template>
  <div class="agent-card asset-card" :class="{ 'is-project': agent.scope === 'project', 'is-managed': registryInfo }" @click="emit('click', agent)">
    <div class="asset-card-main">
      <div class="asset-card-top">
        <div class="asset-card-title-stack">
          <div class="asset-card-title-row">
            <span class="asset-status-dot" :class="{ active: registryInfo?.enabled || agent.scope === 'project' }"></span>
            <span class="asset-name">{{ agent.name }}</span>
          </div>
          <div class="asset-tags">
            <n-tag :type="agent.scope === 'user' ? 'info' : 'success'" size="tiny" :bordered="false">
              {{ agent.scope === 'user' ? '用户级' : '项目级' }}
            </n-tag>
            <n-tag v-if="registryInfo" type="success" size="tiny" :bordered="false">托管</n-tag>
            <n-tag v-if="agent.model" type="warning" size="tiny" :bordered="false">
              {{ agent.model }}
            </n-tag>
          </div>
        </div>
      </div>

      <div class="asset-description" v-if="agent.description">
        {{ truncateDesc(agent.description) }}
      </div>

      <div class="asset-meta">
        <span class="asset-meta-item" v-if="agent.tools">
          <n-icon size="12"><HammerOutline /></n-icon>
          {{ truncateTools(agent.tools) }}
        </span>
        <span class="asset-meta-item" v-if="agent.permissionMode">
          <n-icon size="12"><ShieldOutline /></n-icon>
          {{ agent.permissionMode }}
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
              @update:value="emit('toggle-enabled', agent, $event)"
              @click.stop
            />
          </template>
          {{ registryInfo.enabled ? '已启用' : '已禁用' }}
        </n-tooltip>
        <div class="asset-platform-strip">
          <n-tooltip v-for="platform in managedPlatforms" :key="platform.key" trigger="hover">
            <template #trigger>
              <span
                class="asset-platform-icon"
                :class="{ active: registryInfo.platforms?.[platform.key] }"
                @click.stop="emit('toggle-platform', agent, platform.key, !registryInfo.platforms?.[platform.key])"
              >
                <n-icon size="14"><component :is="platform.icon" /></n-icon>
              </span>
            </template>
            {{ platform.label || platform.title || platform.key }}
            {{ registryInfo.platforms?.[platform.key] ? '已启用' : '未启用' }}
          </n-tooltip>
        </div>
      </template>
      <!-- 原有模式 -->
      <template v-else>
        <n-button
          size="tiny"
          tertiary
          @click.stop="emit('edit', agent)"
        >
          编辑
        </n-button>
        <n-button
          size="tiny"
          tertiary
          type="error"
          :loading="props.deleting"
          @click.stop="emit('delete', agent)"
        >
          删除
        </n-button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { NButton, NTag, NIcon, NSwitch, NTooltip } from 'naive-ui'
import { HammerOutline, ShieldOutline } from '@vicons/ionicons5'
import { useEnabledCliPlatforms } from '../composables/useEnabledCliPlatforms'

const props = defineProps({
  agent: {
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
const { byCapability } = useEnabledCliPlatforms()
const managedPlatforms = computed(() => byCapability('agents'))

function truncateDesc(desc) {
  if (!desc) return ''
  return desc.length > 80 ? desc.slice(0, 80) + '...' : desc
}

function truncateTools(tools) {
  if (!tools) return ''
  return tools.length > 30 ? tools.slice(0, 30) + '...' : tools
}
</script>

<style scoped>
.asset-meta-item {
  max-width: 150px;
}
</style>
