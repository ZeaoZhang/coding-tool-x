<template>
  <section class="channel-routing-summary" aria-label="模型路由与渠道并发">
    <div class="summary-header">
      <strong>模型路由与渠道并发</strong>
      <span>同一渠道的并发额度由其所有模型共享</span>
    </div>

    <div v-if="unsupportedChannels.length" class="summary-warning">
      未纳入动态切换：
      {{ unsupportedChannels.map(channel => `${channel.name || channel.id}（${reasonText(channel.reason)}）`).join('、') }}
    </div>
    <div v-if="groups.length === 0" class="summary-empty">
      当前没有可用于动态切换的渠道组。请启用兼容渠道并填写相同路由组。
    </div>
    <div v-for="group in groups" :key="`${group.providerKey}:${group.providerApi}:${group.routingGroup}`" class="routing-group">
      <div class="group-heading">
        <span>{{ group.providerKey }} · {{ group.routingGroup }}</span>
        <span class="group-api">{{ group.providerApi }}</span>
      </div>

      <div v-if="group.models?.length" class="model-routes">
        <div v-for="model in group.models" :key="model.id" class="model-route">
          <span class="model-name">{{ model.id }}</span>
          <div class="route-channels">
            <span
              v-for="channel in resolveModelChannels(group, model)"
              :key="channel.id"
              class="route-channel"
            >
              <span>{{ channel.name }}</span>
              <small>{{ concurrencyText(channel) }}</small>
            </span>
            <span v-if="resolveChannels(group, model.channelIds).length === 0" class="route-empty">暂无可用渠道</span>
          </div>
        </div>
        <div v-if="group.unrestrictedChannelIds?.length" class="model-route unrestricted-route">
          <span class="model-name">未列出的模型</span>
          <div class="route-channels">
            <span
              v-for="channel in resolveChannels(group, group.unrestrictedChannelIds)"
              :key="channel.id"
              class="route-channel"
            >
              <span>{{ channel.name }}</span>
              <small>{{ concurrencyText(channel) }}</small>
            </span>
          </div>
        </div>
      </div>
      <div v-else class="model-route">
        <span class="model-name">所有模型</span>
        <div class="route-channels">
          <span
            v-for="channel in resolveChannels(group, group.unrestrictedChannelIds)"
            :key="channel.id"
            class="route-channel"
          >
            <span>{{ channel.name }}</span>
            <small>{{ concurrencyText(channel) }}</small>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  summary: { type: Object, default: () => ({ groups: [] }) },
  channels: { type: Array, default: () => [] },
  getChannelInflight: { type: Function, required: true }
})

const groups = computed(() => Array.isArray(props.summary?.groups) ? props.summary.groups : [])
const unsupportedChannels = computed(() => Array.isArray(props.summary?.unsupportedChannels)
  ? props.summary.unsupportedChannels
  : [])
const channelsById = computed(() => new Map(props.channels.map(channel => [channel.id, channel])))

function resolveChannels(group, channelIds = []) {
  return [...new Set(channelIds || [])].map((id) => {
    const configured = channelsById.value.get(id)
    const fallback = group.channels?.find(channel => channel.id === id)
    return configured || fallback || { id, name: id, maxConcurrency: null }
  })
}

function resolveModelChannels(group, model) {
  return resolveChannels(group, [...(model?.channelIds || []), ...(group?.unrestrictedChannelIds || [])])
}

function reasonText(reason) {
  return {
    'unsupported-provider-api': '不支持的 API 协议',
    'oauth-auth-gateway-unavailable': 'OAuth 网关未就绪',
    'incompatible-routing-group': '路由组配置不兼容'
  }[reason] || '暂不可用'
}

function concurrencyText(channel) {
  const inflight = Number(props.getChannelInflight(channel.id)) || 0
  const maximum = Number(channel.maxConcurrency)
  return `并发 ${inflight}/${Number.isFinite(maximum) && maximum > 0 ? maximum : '不限'}`
}
</script>

<style scoped>
.channel-routing-summary {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--n-border-color, #e0e0e6);
  border-radius: 8px;
  background: var(--n-color-embedded, rgba(127, 127, 127, 0.035));
}

.summary-header,
.group-heading,
.route-channels {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.summary-header {
  justify-content: space-between;
  margin-bottom: 10px;
}

.summary-header > span,
.group-api,
.route-channel small,
.summary-empty,
.summary-warning,
.route-empty {
  color: var(--n-text-color-3, #888);
  font-size: 12px;
}

.summary-warning {
  margin-bottom: 8px;
  color: var(--n-warning-color, #d99000);
}

.routing-group + .routing-group {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--n-border-color, #e0e0e6);
}

.group-heading {
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}

.model-route {
  display: grid;
  grid-template-columns: minmax(120px, 190px) 1fr;
  align-items: start;
  gap: 10px;
  padding: 5px 0;
}

.model-name {
  padding-top: 4px;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.route-channel {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 8px;
  border-radius: 5px;
  background: var(--n-color, #fff);
  font-size: 12px;
}

@media (max-width: 700px) {
  .model-route {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
