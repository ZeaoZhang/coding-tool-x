<template>
  <div class="panel-card">
    <div class="panel-header">
      <n-icon :size="20" color="#18a058">
        <PowerOutline />
      </n-icon>
      <h3 class="panel-title">Proxy Management</h3>
    </div>

    <div class="proxy-list">
      <div
        v-for="platform in proxyPlatforms"
        :key="platform.key"
        class="proxy-item"
      >
        <div class="proxy-header">
          <div class="proxy-info">
            <div class="proxy-name">
              <div class="status-dot" :class="{ active: isRunning(platform) }"></div>
              <span>{{ platform.label || platform.title || platform.key }} Proxy</span>
              <n-tag v-if="getFrozenCount(platform.key) > 0" size="tiny" type="error" :bordered="false">
                {{ getFrozenCount(platform.key) }} 冻结
              </n-tag>
            </div>
            <div class="proxy-meta">
              <n-text depth="3" style="font-size: 12px;">
                Port: {{ getPort(platform.key) }}
              </n-text>
            </div>
          </div>
          <n-switch
            :value="isRunning(platform)"
            @update:value="value => toggleProxy(platform, value)"
            :loading="isLoading(platform.key)"
            size="small"
          />
        </div>
        <div v-if="isRunning(platform) && getActiveChannel(platform.key)" class="proxy-active">
          <n-text depth="3" style="font-size: 12px;">
            Active: {{ getActiveChannel(platform.key) }}
          </n-text>
        </div>
      </div>
      <n-text v-if="proxyPlatforms.length === 0" depth="3">
        当前没有可管理的代理
      </n-text>
    </div>
  </div>
</template>

<script setup>
import { reactive, computed, onMounted } from 'vue'
import { NSwitch, NText, NIcon, NTag, useMessage } from 'naive-ui'
import { PowerOutline } from '@vicons/ionicons5'
import axios from 'axios'
import { useGlobalState } from '../../composables/useGlobalState'
import { useEnabledCliPlatforms } from '../../composables/useEnabledCliPlatforms'

const message = useMessage()
const { getProxyState, getSchedulerState, startProxy, stopProxy } = useGlobalState()
const { byCapability } = useEnabledCliPlatforms()
const proxyPlatforms = computed(() => byCapability('proxy'))
const loadingByPlatform = reactive({})
const portsByPlatform = reactive({
  claude: 20088,
  codex: 20089,
  gemini: 20090,
  opencode: 20091,
  omp: 20092
})

function getProxy(platform) {
  return getProxyState(platform)?.value || {}
}

function isRunning(platform) {
  return getProxy(platform.key).running === true
}

function isLoading(platform) {
  return loadingByPlatform[platform] === true
}

function getActiveChannel(platform) {
  const channel = getProxy(platform).activeChannel
  if (!channel) return ''
  return typeof channel === 'string' ? channel : channel.name || ''
}

function getPort(platform) {
  return getProxy(platform).port || portsByPlatform[platform] || '—'
}

function getFrozenCount(platform) {
  const state = getSchedulerState(platform)
  if (!state?.channels?.length) return 0
  return state.channels.filter(channel => channel.health?.status === 'frozen').length
}

async function loadConfig() {
  try {
    const response = await axios.get('/api/config/advanced')
    const ports = response.data?.ports || {}
    const legacyPorts = {
      claude: ports.proxy,
      codex: ports.codexProxy,
      gemini: ports.geminiProxy,
      opencode: ports.opencodeProxy,
      omp: ports.ompProxy
    }
    Object.entries(legacyPorts).forEach(([platform, port]) => {
      if (port) portsByPlatform[platform] = port
    })
  } catch (error) {
    console.error('Failed to load config:', error)
  }
}

async function toggleProxy(platform, value) {
  const key = platform.key
  loadingByPlatform[key] = true
  try {
    if (value) {
      const result = await startProxy(key)
      message.success(`${platform.label || key} Proxy started`)
      if (result.envHint && key === 'codex') {
        message.warning(result.envHint.message, {
          duration: 10000,
          closable: true
        })
      }
    } else {
      await stopProxy(key, { refreshChannelsDrawer: true })
      message.success(`${platform.label || key} Proxy stopped`)
    }
  } catch (error) {
    message.error(error.response?.data?.error || error.message || '操作失败')
  } finally {
    loadingByPlatform[key] = false
  }
}

onMounted(() => {
  loadConfig()
})
</script>

<style scoped>
.panel-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  padding: 20px;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.proxy-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.proxy-item {
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 12px;
  transition: all 0.2s ease;
}

.proxy-item:hover {
  border-color: #18a058;
}

.proxy-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.proxy-info {
  flex: 1;
}

.proxy-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-secondary);
  transition: all 0.3s ease;
}

.status-dot.active {
  background: #18a058;
  box-shadow: 0 0 8px rgba(24, 160, 88, 0.5);
}

.proxy-meta {
  display: flex;
  gap: 8px;
}

.proxy-active {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-primary);
}
</style>
