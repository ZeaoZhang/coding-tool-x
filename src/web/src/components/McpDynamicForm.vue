<template>
  <div class="dynamic-form" :class="{ 'nested-form': depth > 0 }">
    <!-- Depth limit warning -->
    <n-alert
      v-if="depth >= maxDepth"
      type="warning"
      :bordered="false"
      class="depth-warning"
    >
      嵌套层级已达上限（{{ maxDepth }} 层），无法继续展开
    </n-alert>

    <template v-else>
      <div
        v-for="key in propertyKeys"
        :key="key"
        class="field"
      >
        <label class="field-label">
          {{ key }}
          <span v-if="isRequired(key)" class="required">*</span>
          <n-tooltip v-if="getDescription(key)" trigger="hover">
            <template #trigger>
              <n-icon :size="14" class="field-tip-icon">
                <InformationCircleOutline />
              </n-icon>
            </template>
            {{ getDescription(key) }}
          </n-tooltip>
        </label>

        <!-- string with enum => n-select -->
        <n-select
          v-if="resolveType(key) === 'string' && hasEnum(key)"
          :value="modelValue[key]"
          :options="getEnumOptions(key)"
          :placeholder="getPlaceholder(key)"
          clearable
          @update:value="updateField(key, $event)"
        />

        <!-- string => n-input -->
        <n-input
          v-else-if="resolveType(key) === 'string'"
          :value="modelValue[key] ?? ''"
          :placeholder="getPlaceholder(key)"
          clearable
          @update:value="updateField(key, $event)"
        />

        <!-- number / integer => n-input-number -->
        <n-input-number
          v-else-if="resolveType(key) === 'number' || resolveType(key) === 'integer'"
          :value="modelValue[key]"
          :placeholder="getPlaceholder(key)"
          :precision="resolveType(key) === 'integer' ? 0 : undefined"
          clearable
          style="width: 100%"
          @update:value="updateField(key, $event)"
        />

        <!-- boolean => n-switch -->
        <n-switch
          v-else-if="resolveType(key) === 'boolean'"
          :value="!!modelValue[key]"
          @update:value="updateField(key, $event)"
        />

        <!-- array => n-dynamic-input -->
        <n-dynamic-input
          v-else-if="resolveType(key) === 'array'"
          :value="modelValue[key] || []"
          :placeholder="getPlaceholder(key)"
          :min="0"
          @update:value="updateField(key, $event)"
        />

        <!-- object => recursive McpDynamicForm -->
        <McpDynamicForm
          v-else-if="resolveType(key) === 'object' && getNestedSchema(key)"
          :schema="getNestedSchema(key)"
          :model-value="modelValue[key] || {}"
          :depth="depth + 1"
          :max-depth="maxDepth"
          @update:model-value="updateField(key, $event)"
        />

        <!-- fallback => n-input (text) -->
        <n-input
          v-else
          :value="modelValue[key] != null ? String(modelValue[key]) : ''"
          :placeholder="getPlaceholder(key)"
          clearable
          @update:value="updateField(key, $event)"
        />
      </div>

      <!-- Empty state -->
      <div v-if="propertyKeys.length === 0" class="empty-schema">
        <n-text depth="3">无可配置属性</n-text>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue'
import {
  NInput, NInputNumber, NSwitch, NSelect,
  NDynamicInput, NTooltip, NIcon, NAlert, NText
} from 'naive-ui'
import { InformationCircleOutline } from '@vicons/ionicons5'

const props = defineProps({
  schema: {
    type: Object,
    default: () => ({})
  },
  modelValue: {
    type: Object,
    default: () => ({})
  },
  depth: {
    type: Number,
    default: 0
  },
  maxDepth: {
    type: Number,
    default: 3
  }
})

const emit = defineEmits(['update:modelValue'])

// --- Computed ---

const properties = computed(() => props.schema?.properties || {})
const requiredFields = computed(() => props.schema?.required || [])
const propertyKeys = computed(() => Object.keys(properties.value))

// --- Schema introspection helpers ---

/**
 * Resolve the primary type from a JSON Schema property definition.
 * Handles nullable types like ["string", "null"] and missing type fields.
 */
function resolveType(key) {
  const prop = properties.value[key]
  if (!prop) return 'string'

  const rawType = prop.type
  if (!rawType) {
    // If no type is given but enum exists, treat as string enum
    if (prop.enum) return 'string'
    // If properties exist, treat as object
    if (prop.properties) return 'object'
    return 'string'
  }

  // Handle nullable types: ["string", "null"] => "string"
  if (Array.isArray(rawType)) {
    const nonNull = rawType.filter(t => t !== 'null')
    return nonNull.length > 0 ? nonNull[0] : 'string'
  }

  return rawType
}

function isRequired(key) {
  return requiredFields.value.includes(key)
}

function getDescription(key) {
  return properties.value[key]?.description || ''
}

function hasEnum(key) {
  const prop = properties.value[key]
  return Array.isArray(prop?.enum) && prop.enum.length > 0
}

function getEnumOptions(key) {
  const prop = properties.value[key]
  if (!Array.isArray(prop?.enum)) return []
  return prop.enum.map(val => ({
    label: String(val),
    value: val
  }))
}

function getPlaceholder(key) {
  const prop = properties.value[key]
  if (prop?.description) return prop.description
  if (prop?.default != null) return `默认: ${prop.default}`
  return `请输入 ${key}`
}

function getNestedSchema(key) {
  const prop = properties.value[key]
  if (!prop) return null
  // Must have at least a properties map or additionalProperties to recurse
  if (prop.properties || prop.additionalProperties) return prop
  return null
}

// --- Data flow ---

/**
 * Populate default values from schema on mount.
 * Only sets defaults for keys that are not already present in modelValue.
 */
function applyDefaults() {
  const defaults = {}
  let hasNewDefaults = false

  for (const key of propertyKeys.value) {
    const prop = properties.value[key]
    if (prop?.default != null && props.modelValue[key] === undefined) {
      defaults[key] = prop.default
      hasNewDefaults = true
    }
  }

  if (hasNewDefaults) {
    emit('update:modelValue', { ...props.modelValue, ...defaults })
  }
}

// Apply defaults when schema or keys change
watch(
  () => [props.schema, propertyKeys.value],
  () => { applyDefaults() },
  { immediate: true, deep: true }
)

/**
 * Emit a partial update -- merges the changed field into the existing model.
 */
function updateField(key, value) {
  emit('update:modelValue', {
    ...props.modelValue,
    [key]: value
  })
}
</script>

<style scoped>
.dynamic-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.nested-form {
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--bg-secondary, rgba(0, 0, 0, 0.02));
  border: 1px solid var(--border-primary, rgba(0, 0, 0, 0.08));
}

[data-theme="dark"] .nested-form {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.09);
}

/* Field layout - matches McpFormDrawer pattern */
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.required {
  color: #f56c6c;
}

.field-tip-icon {
  color: var(--text-tertiary, #999);
  cursor: help;
  margin-left: 2px;
  vertical-align: middle;
}

.field-tip-icon:hover {
  color: #18a058;
}

/* Depth warning */
.depth-warning {
  margin: 4px 0;
}

/* Empty state */
.empty-schema {
  text-align: center;
  padding: 12px 0;
}

/* Naive UI overrides */
:deep(.n-dynamic-input) {
  width: 100%;
}

:deep(.n-input-number) {
  width: 100%;
}

:deep(.n-switch) {
  flex-shrink: 0;
}
</style>
