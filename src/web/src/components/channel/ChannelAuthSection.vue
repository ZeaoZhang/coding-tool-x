<template>
  <div class="channel-auth-section">
    <div class="oauth-content">
      <n-button size="small" type="primary" :loading="loading" @click="sync">同步本地 OAuth</n-button>
      <n-alert v-if="warning" type="warning" :show-icon="false">{{ warning }}</n-alert>
      <n-radio-group v-if="candidates.length" :value="selectedKey" @update:value="select">
        <n-space vertical>
          <n-radio v-for="candidate in candidates" :key="candidate.id" :value="candidateKey(candidate)">
            {{ candidate.providerId || platform }} / {{ candidate.accountEmail || candidate.accountId || candidate.authRef?.identityKey || '本地账户' }}
          </n-radio>
        </n-space>
      </n-radio-group>
      <div v-if="authMeta?.channel" class="oauth-meta">
        {{ authMeta.channel.authRef?.providerId || platform }} · {{ authMeta.channel.authRef?.accountEmail || authMeta.channel.authRef?.accountId || '已同步' }}
      </div>
      <div v-if="quota" class="oauth-quota">
        <span v-for="window in [quota.primary, quota.secondary]" :key="window?.label || 'missing-window'">
          {{ window?.label || '—' }}: {{ window ? `${window.remainingPercent}%` : '—' }}
        </span>
        <n-button text size="tiny" @click="refreshQuota">刷新额度</n-button>
      </div>
    </div>
  </div>
</template>
<script setup>
import { computed, toRef } from 'vue'
import { NAlert, NButton, NRadio, NRadioGroup, NSpace } from 'naive-ui'
import { useChannelAuth } from '../../composables/useChannelAuth'

const props = defineProps({ platform: String, channelId: String, formData: Object, authMeta: Object })
const emit = defineEmits(['update-auth'])
function candidateKey(candidate) {
  const ref = candidate.authRef || candidate
  return `${ref.credentialId || ref.providerId}:${ref.accountId || ref.identityKey || ref.accountEmail || 'account'}`
}
const selectedKey = computed(() => candidateKey({ authRef: props.formData.authRef }))
const { loading, candidates, warning, quota, sync, refreshQuota } = useChannelAuth(toRef(props, 'platform'), toRef(props, 'channelId'))

function select(key) {
  const candidate = candidates.value.find(item => candidateKey(item) === key)
  if (candidate) emit('update-auth', candidate)
}
</script>
<style scoped>
.channel-auth-section { display: grid; gap: 10px; width: 100%; }
.oauth-content, .oauth-quota { display: grid; gap: 8px; }
.oauth-meta { color: var(--text-color-3); }
.oauth-quota { grid-template-columns: repeat(3, auto); align-items: center; }
</style>
