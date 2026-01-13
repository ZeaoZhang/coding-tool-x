<template>
  <n-modal
    v-model:show="showModal"
    :mask-closable="false"
    preset="card"
    title="会话格式转换"
    style="width: 700px;"
  >
    <n-space vertical size="large">
      <!-- 源会话信息 -->
      <div>
        <h4 style="margin-bottom: 12px;">源会话</h4>
        <n-card size="small">
          <n-space vertical size="small">
            <div style="display: flex; align-items: center; gap: 8px;">
              <n-tag :type="getFormatTagType(sourceType)" :bordered="false">
                {{ getFormatName(sourceType) }}
              </n-tag>
              <span style="font-weight: 500;">{{ sessionId }}</span>
            </div>
            <div v-if="preview" style="font-size: 13px; color: #666;">
              <div>工作目录: {{ preview.cwd }}</div>
              <div v-if="preview.gitBranch">Git 分支: {{ preview.gitBranch }}</div>
              <div>消息数量: {{ preview.messageCount }}</div>
              <div>开始时间: {{ formatTime(preview.startTime) }}</div>
            </div>
          </n-space>
        </n-card>
      </div>

      <!-- 目标格式选择 -->
      <div>
        <h4 style="margin-bottom: 12px;">目标格式</h4>
        <n-select
          v-model:value="targetType"
          :options="targetFormatOptions"
          placeholder="选择目标格式"
          size="large"
        />
      </div>

      <!-- 高级选项 -->
      <n-collapse>
        <n-collapse-item title="高级选项" name="advanced">
          <n-space vertical size="medium">
            <n-form-item label="目标项目路径（可选）">
              <n-input
                v-model:value="targetProject"
                placeholder="留空则使用源会话的工作目录"
              />
            </n-form-item>
            <n-checkbox v-model:checked="preserveTimestamps">
              保留原始时间戳
            </n-checkbox>
          </n-space>
        </n-collapse-item>
      </n-collapse>

      <!-- 预览消息 -->
      <div v-if="preview && preview.messages && preview.messages.length > 0">
        <h4 style="margin-bottom: 12px;">消息预览（前 5 条）</h4>
        <n-card size="small" style="max-height: 300px; overflow-y: auto;">
          <n-space vertical size="small">
            <div
              v-for="(msg, idx) in preview.messages"
              :key="idx"
              class="message-preview"
            >
              <n-tag
                :type="msg.role === 'user' ? 'info' : msg.role === 'assistant' ? 'success' : 'default'"
                size="small"
                :bordered="false"
              >
                {{ msg.role }}
              </n-tag>
              <span style="margin-left: 8px; font-size: 12px; color: #999;">
                {{ formatTime(msg.timestamp) }}
              </span>
              <div style="margin-top: 4px; font-size: 13px; color: #333; white-space: pre-wrap;">
                {{ truncateText(msg.content, 150) }}
              </div>
            </div>
          </n-space>
        </n-card>
      </div>
    </n-space>

    <!-- Footer Actions -->
    <template #footer>
      <n-space justify="end">
        <n-button @click="handleClose">取消</n-button>
        <n-button
          type="primary"
          :loading="converting"
          :disabled="!targetType"
          @click="handleConvert"
        >
          {{ converting ? '转换中...' : '开始转换' }}
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import {
  NModal,
  NCard,
  NSpace,
  NTag,
  NSelect,
  NButton,
  NCollapse,
  NCollapseItem,
  NFormItem,
  NInput,
  NCheckbox,
  useMessage
} from 'naive-ui';
import { getFormats, previewConvert, convertSession } from '../api/convert';

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  sourceType: {
    type: String,
    required: true,
    validator: (value) => ['claude', 'codex', 'gemini'].includes(value)
  },
  sessionId: {
    type: String,
    required: true
  }
});

const emit = defineEmits(['update:show', 'success', 'close']);

const message = useMessage();

const showModal = computed({
  get: () => props.show,
  set: (value) => emit('update:show', value)
});

// State
const targetType = ref('');
const targetProject = ref('');
const preserveTimestamps = ref(true);
const preview = ref(null);
const converting = ref(false);
const formats = ref([]);

// 获取格式列表
getFormats().then(data => {
  formats.value = data.formats || [];
});

// 目标格式选项（排除源格式）
const targetFormatOptions = computed(() => {
  return formats.value
    .filter(f => f.id !== props.sourceType)
    .map(f => ({
      label: `${f.name} (${f.description})`,
      value: f.id
    }));
});

// 加载预览
watch(() => props.show, async (show) => {
  if (show) {
    try {
      const result = await previewConvert({
        sourceType: props.sourceType,
        sessionId: props.sessionId
      });
      preview.value = result.preview;
    } catch (error) {
      console.error('Failed to load preview:', error);
      message.error('加载预览失败: ' + error.message);
    }
  }
});

// 获取格式名称
function getFormatName(type) {
  const format = formats.value.find(f => f.id === type);
  return format ? format.name : type;
}

// 获取格式标签类型
function getFormatTagType(type) {
  const map = {
    claude: 'info',
    codex: 'success',
    gemini: 'warning'
  };
  return map[type] || 'default';
}

// 格式化时间
function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// 截断文本
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// 执行转换
async function handleConvert() {
  if (!targetType.value) {
    message.warning('请选择目标格式');
    return;
  }

  converting.value = true;

  try {
    const result = await convertSession({
      sourceType: props.sourceType,
      targetType: targetType.value,
      sessionId: props.sessionId,
      options: {
        targetProject: targetProject.value || undefined,
        preserveTimestamps: preserveTimestamps.value
      }
    });

    if (result.success) {
      message.success(`转换成功！已生成 ${result.messageCount} 条消息`);
      emit('success', result);
      handleClose();
    } else {
      message.error('转换失败: ' + (result.error || '未知错误'));
    }
  } catch (error) {
    console.error('Conversion error:', error);
    message.error('转换失败: ' + error.message);
  } finally {
    converting.value = false;
  }
}

// 关闭对话框
function handleClose() {
  showModal.value = false;
  targetType.value = '';
  targetProject.value = '';
  preserveTimestamps.value = true;
  preview.value = null;
  emit('close');
}
</script>

<style scoped>
.message-preview {
  padding: 8px;
  border-left: 3px solid #e0e0e0;
  background: #f9f9f9;
  border-radius: 4px;
}

h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #333;
}
</style>
