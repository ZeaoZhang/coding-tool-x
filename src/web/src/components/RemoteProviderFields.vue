<script setup>
import { computed } from 'vue'
import { NInput, NSelect } from 'naive-ui'

const props = defineProps({
  provider: {
    type: Object,
    required: true
  },
  definition: {
    type: Object,
    default: null
  }
})

const fields = computed(() => (
  Array.isArray(props.definition?.fields) ? props.definition.fields : []
))

function isVisible(field) {
  const condition = field?.visibleWhen
  if (!condition || typeof condition !== 'object') return true
  return props.provider?.config?.[condition.key] === condition.equals
}

function inputType(field) {
  return field.type === 'secret' ? 'password' : 'text'
}
</script>

<template>
  <div class="remote-provider-fields">
    <div
      v-for="field in fields"
      v-show="isVisible(field)"
      :key="field.key"
      class="remote-field"
      :class="{ 'remote-field-wide': field.wide === true }"
    >
      <span class="remote-field-label">{{ field.label }}</span>
      <n-select
        v-if="field.type === 'select'"
        v-model:value="provider.config[field.key]"
        size="small"
        :options="field.options || []"
        :placeholder="field.placeholder"
      />
      <n-input
        v-else
        v-model:value="provider.config[field.key]"
        size="small"
        :type="inputType(field)"
        :show-password-on="field.type === 'secret' ? 'click' : undefined"
        :placeholder="field.placeholder"
      />
    </div>
  </div>
</template>

<style scoped>
.remote-provider-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.remote-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.remote-field-wide {
  grid-column: 1 / -1;
}

.remote-field-label {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
}

@media (max-width: 600px) {
  .remote-provider-fields {
    grid-template-columns: 1fr;
  }
}
</style>
