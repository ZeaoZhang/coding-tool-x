<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="配置同步"
    :bordered="false"
    :closable="true"
    style="width: 700px; max-width: 90vw;"
    @close="handleClose"
  >
    <n-steps :current="currentStep" size="small" style="margin-bottom: 24px;">
      <n-step title="选择源" />
      <n-step title="选择配置" />
      <n-step title="确认同步" />
    </n-steps>

    <!-- 步骤 1：选择源和目标 -->
    <div v-if="currentStep === 1" class="step-content">
      <n-form label-placement="top">
        <n-form-item label="同步源">
          <n-radio-group v-model:value="syncOptions.source">
            <n-space>
              <n-radio value="global">
                <n-space align="center">
                  <n-icon><ServerOutline /></n-icon>
                  全局配置 (~/.claude/)
                </n-space>
              </n-radio>
              <n-radio value="workspace" :disabled="!projectPath">
                <n-space align="center">
                  <n-icon><FolderOutline /></n-icon>
                  工作区配置 (.claude/)
                </n-space>
              </n-radio>
            </n-space>
          </n-radio-group>
        </n-form-item>

        <n-form-item label="同步目标">
          <n-radio-group v-model:value="syncOptions.target">
            <n-space>
              <n-radio value="global" :disabled="syncOptions.source === 'global'">
                <n-space align="center">
                  <n-icon><ServerOutline /></n-icon>
                  全局配置
                </n-space>
              </n-radio>
              <n-radio value="workspace" :disabled="!projectPath || syncOptions.source === 'workspace'">
                <n-space align="center">
                  <n-icon><FolderOutline /></n-icon>
                  工作区配置
                </n-space>
              </n-radio>
            </n-space>
          </n-radio-group>
        </n-form-item>

        <n-form-item label="配置类型">
          <n-checkbox-group v-model:value="syncOptions.configTypes">
            <n-space>
              <n-checkbox value="skills" :disabled="syncOptions.target === 'workspace'">
                Skills
              </n-checkbox>
              <n-checkbox value="rules">Rules</n-checkbox>
              <n-checkbox value="agents">Agents</n-checkbox>
              <n-checkbox value="commands">Commands</n-checkbox>
            </n-space>
          </n-checkbox-group>
        </n-form-item>
      </n-form>
    </div>

    <!-- 步骤 2：选择配置项 -->
    <div v-if="currentStep === 2" class="step-content">
      <n-spin :show="loading">
        <div v-if="!loading && availableConfigs">
          <!-- Skills -->
          <n-collapse v-if="syncOptions.configTypes.includes('skills') && availableConfigs.skills?.length" default-expanded-names="skills">
            <n-collapse-item title="Skills" name="skills">
              <template #header-extra>
                <n-badge :value="selectedItems.skills?.length || 0" :max="99" />
              </template>
              <n-checkbox-group v-model:value="selectedItems.skills">
                <n-space vertical>
                  <n-checkbox 
                    v-for="item in availableConfigs.skills" 
                    :key="item.directory"
                    :value="item"
                  >
                    <span class="config-item-name">{{ item.name }}</span>
                    <span class="config-item-desc">{{ item.description }}</span>
                    <n-tag size="small" type="info">{{ item.files }} 文件</n-tag>
                  </n-checkbox>
                </n-space>
              </n-checkbox-group>
            </n-collapse-item>
          </n-collapse>

          <!-- Rules -->
          <n-collapse v-if="syncOptions.configTypes.includes('rules') && availableConfigs.rules?.length" default-expanded-names="rules">
            <n-collapse-item title="Rules" name="rules">
              <template #header-extra>
                <n-badge :value="selectedItems.rules?.length || 0" :max="99" />
              </template>
              <n-checkbox-group v-model:value="selectedItems.rules">
                <n-space vertical>
                  <n-checkbox 
                    v-for="item in availableConfigs.rules" 
                    :key="item.path"
                    :value="item"
                  >
                    <span class="config-item-name">{{ item.name }}</span>
                    <span class="config-item-path">{{ item.path }}</span>
                  </n-checkbox>
                </n-space>
              </n-checkbox-group>
            </n-collapse-item>
          </n-collapse>

          <!-- Agents -->
          <n-collapse v-if="syncOptions.configTypes.includes('agents') && availableConfigs.agents?.length" default-expanded-names="agents">
            <n-collapse-item title="Agents" name="agents">
              <template #header-extra>
                <n-badge :value="selectedItems.agents?.length || 0" :max="99" />
              </template>
              <n-checkbox-group v-model:value="selectedItems.agents">
                <n-space vertical>
                  <n-checkbox 
                    v-for="item in availableConfigs.agents" 
                    :key="item.path"
                    :value="item"
                  >
                    <span class="config-item-name">{{ item.name }}</span>
                    <span class="config-item-path">{{ item.path }}</span>
                  </n-checkbox>
                </n-space>
              </n-checkbox-group>
            </n-collapse-item>
          </n-collapse>

          <!-- Commands -->
          <n-collapse v-if="syncOptions.configTypes.includes('commands') && availableConfigs.commands?.length" default-expanded-names="commands">
            <n-collapse-item title="Commands" name="commands">
              <template #header-extra>
                <n-badge :value="selectedItems.commands?.length || 0" :max="99" />
              </template>
              <n-checkbox-group v-model:value="selectedItems.commands">
                <n-space vertical>
                  <n-checkbox 
                    v-for="item in availableConfigs.commands" 
                    :key="item.path"
                    :value="item"
                  >
                    <span class="config-item-name">{{ item.name }}</span>
                    <span class="config-item-path">{{ item.path }}</span>
                  </n-checkbox>
                </n-space>
              </n-checkbox-group>
            </n-collapse-item>
          </n-collapse>

          <n-empty v-if="totalSelected === 0" description="没有可同步的配置项" />
        </div>
      </n-spin>
    </div>

    <!-- 步骤 3：确认同步 -->
    <div v-if="currentStep === 3" class="step-content">
      <n-spin :show="loading">
        <div v-if="preview">
          <n-alert v-if="preview.errors?.length" type="error" title="错误" style="margin-bottom: 16px;">
            <ul>
              <li v-for="err in preview.errors" :key="err">{{ err }}</li>
            </ul>
          </n-alert>

          <n-card v-if="preview.willCreate?.length" size="small" title="将创建" style="margin-bottom: 12px;">
            <n-space vertical size="small">
              <div v-for="item in preview.willCreate" :key="item.targetPath" class="preview-item">
                <n-tag size="small" type="success">{{ item.type }}</n-tag>
                <span>{{ item.name }}</span>
              </div>
            </n-space>
          </n-card>

          <n-card v-if="preview.willOverwrite?.length" size="small" title="将覆盖" style="margin-bottom: 12px;">
            <n-space vertical size="small">
              <div v-for="item in preview.willOverwrite" :key="item.targetPath" class="preview-item">
                <n-tag size="small" type="warning">{{ item.type }}</n-tag>
                <span>{{ item.name }}</span>
              </div>
            </n-space>
          </n-card>

          <n-form-item label="覆盖选项" v-if="preview.willOverwrite?.length">
            <n-checkbox v-model:checked="syncOptions.overwrite">
              覆盖已存在的配置
            </n-checkbox>
          </n-form-item>
        </div>
      </n-spin>
    </div>

    <template #footer>
      <div class="modal-footer">
        <n-button @click="handleClose">取消</n-button>
        <n-button v-if="currentStep > 1" @click="prevStep">上一步</n-button>
        <n-button 
          v-if="currentStep < 3" 
          type="primary" 
          :disabled="!canNext"
          @click="nextStep"
        >
          下一步
        </n-button>
        <n-button 
          v-if="currentStep === 3" 
          type="primary" 
          :loading="syncing"
          :disabled="!canSync"
          @click="handleSync"
        >
          开始同步
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { 
  NModal, NSteps, NStep, NForm, NFormItem, NRadioGroup, NRadio,
  NCheckboxGroup, NCheckbox, NSpace, NIcon, NCollapse, NCollapseItem,
  NBadge, NTag, NCard, NAlert, NButton, NSpin, NEmpty
} from 'naive-ui'
import { ServerOutline, FolderOutline } from '@vicons/ionicons5'
import { getAvailableConfigs, previewSync, executeSync } from '../api/config-sync'
import message from '../utils/message'

const props = defineProps({
  visible: Boolean,
  projectPath: String
})

const emit = defineEmits(['update:visible', 'synced'])

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

// 步骤控制
const currentStep = ref(1)
const loading = ref(false)
const syncing = ref(false)

// 同步选项
const syncOptions = ref({
  source: 'global',
  target: 'workspace',
  configTypes: ['rules', 'agents', 'commands'],
  overwrite: false
})

// 可用配置
const availableConfigs = ref(null)

// 选中的项目
const selectedItems = ref({
  skills: [],
  rules: [],
  agents: [],
  commands: []
})

// 预览结果
const preview = ref(null)

// 计算选中数量
const totalSelected = computed(() => {
  return (selectedItems.value.skills?.length || 0) +
         (selectedItems.value.rules?.length || 0) +
         (selectedItems.value.agents?.length || 0) +
         (selectedItems.value.commands?.length || 0)
})

// 是否可以下一步
const canNext = computed(() => {
  if (currentStep.value === 1) {
    return syncOptions.value.source && 
           syncOptions.value.target && 
           syncOptions.value.source !== syncOptions.value.target &&
           syncOptions.value.configTypes.length > 0
  }
  if (currentStep.value === 2) {
    return totalSelected.value > 0
  }
  return false
})

// 是否可以同步
const canSync = computed(() => {
  return preview.value && 
         (preview.value.willCreate?.length || 
          (preview.value.willOverwrite?.length && syncOptions.value.overwrite)) &&
         !preview.value.errors?.length
})

// 监听源变化，自动设置目标
watch(() => syncOptions.value.source, (source) => {
  if (source === 'global') {
    syncOptions.value.target = 'workspace'
  } else {
    syncOptions.value.target = 'global'
  }
})

// 下一步
async function nextStep() {
  if (currentStep.value === 1) {
    // 加载可用配置
    await loadAvailableConfigs()
    if (availableConfigs.value) {
      currentStep.value = 2
    }
  } else if (currentStep.value === 2) {
    // 加载预览
    await loadPreview()
    if (preview.value) {
      currentStep.value = 3
    }
  }
}

// 上一步
function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

// 加载可用配置
async function loadAvailableConfigs() {
  loading.value = true
  try {
    const result = await getAvailableConfigs(
      syncOptions.value.source, 
      props.projectPath
    )
    if (result.success) {
      availableConfigs.value = result.configs
    } else {
      message.error(result.message || '获取配置失败')
    }
  } catch (err) {
    message.error('获取配置失败: ' + (err.response?.data?.message || err.message))
  } finally {
    loading.value = false
  }
}

// 加载预览
async function loadPreview() {
  loading.value = true
  try {
    const result = await previewSync({
      source: syncOptions.value.source,
      target: syncOptions.value.target,
      configTypes: syncOptions.value.configTypes,
      projectPath: props.projectPath,
      selectedItems: selectedItems.value
    })
    if (result.success) {
      preview.value = result.preview
    } else {
      message.error(result.message || '预览失败')
    }
  } catch (err) {
    message.error('预览失败: ' + (err.response?.data?.message || err.message))
  } finally {
    loading.value = false
  }
}

// 执行同步
async function handleSync() {
  syncing.value = true
  try {
    const result = await executeSync({
      source: syncOptions.value.source,
      target: syncOptions.value.target,
      configTypes: syncOptions.value.configTypes,
      projectPath: props.projectPath,
      selectedItems: selectedItems.value,
      overwrite: syncOptions.value.overwrite
    })
    
    if (result.success) {
      const { success, failed, skipped } = result.result
      
      if (success.length > 0) {
        message.success(`成功同步 ${success.length} 项配置`)
      }
      if (failed.length > 0) {
        message.warning(`${failed.length} 项同步失败`)
      }
      if (skipped.length > 0) {
        message.info(`${skipped.length} 项已跳过（已存在）`)
      }
      
      emit('synced')
      handleClose()
    } else {
      message.error(result.message || '同步失败')
    }
  } catch (err) {
    message.error('同步失败: ' + (err.response?.data?.message || err.message))
  } finally {
    syncing.value = false
  }
}

// 关闭弹窗
function handleClose() {
  emit('update:visible', false)
}

// 重置状态
watch(() => props.visible, (val) => {
  if (!val) {
    currentStep.value = 1
    availableConfigs.value = null
    preview.value = null
    selectedItems.value = {
      skills: [],
      rules: [],
      agents: [],
      commands: []
    }
    syncOptions.value = {
      source: 'global',
      target: 'workspace',
      configTypes: ['rules', 'agents', 'commands'],
      overwrite: false
    }
  }
})
</script>

<style scoped>
.step-content {
  min-height: 300px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.config-item-name {
  font-weight: 500;
  margin-right: 8px;
}

.config-item-desc {
  color: var(--n-text-color-3);
  font-size: 12px;
  margin-right: 8px;
}

.config-item-path {
  color: var(--n-text-color-3);
  font-size: 12px;
  font-family: monospace;
}

.preview-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
