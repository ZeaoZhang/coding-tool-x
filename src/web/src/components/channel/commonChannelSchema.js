export const commonChannelSchema = Object.freeze({
  endpoint: Object.freeze([
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: true },
    { key: 'websiteUrl', label: '官网链接', type: 'text', required: false }
  ]),
  auth: Object.freeze([
    { key: 'authMode', label: '认证方式', type: 'select', options: ['api_key', 'none'] },
    { key: 'apiKey', label: 'API Key', type: 'password', required: false }
  ]),
  schedule: Object.freeze([
    { key: 'maxConcurrency', label: '最大并发', type: 'number', required: false },
    { key: 'weight', label: '调度权重', type: 'number', min: 1, max: 100 },
    { key: 'enabled', label: '渠道状态', type: 'switch', default: true }
  ])
})

function createGenericChannelForm() {
  return {
    name: '',
    baseUrl: '',
    websiteUrl: '',
    apiKey: '',
    authMode: 'api_key',
    maxConcurrency: null,
    weight: 1,
    enabled: true
  }
}

export function createGenericChannelPanel(manifest = {}, api = {}) {
  const key = String(manifest.key || '').trim().toLowerCase()
  const label = String(manifest.label || manifest.title || key).trim()
  return {
    type: key,
    displayName: label,
    schedulerSource: key,
    storageKeys: {
      localCollapse: `${key}ChannelCollapse`,
      collapseConfigKey: key,
      orderConfigKey: key
    },
    emptyDescription: '暂无渠道',
    showEmptyAction: true,
    emptyActionText: '添加渠道',
    addTitle: `添加 ${label} 渠道`,
    editTitle: `编辑 ${label} 渠道`,
    modalWidth: 520,
    formLabelWidth: 95,
    showApplyButton: false,
    formSections: [
      { title: '基本信息', fields: commonChannelSchema.endpoint },
      { title: '认证', fields: commonChannelSchema.auth },
      { title: '调度配置', fields: commonChannelSchema.schedule }
    ],
    api,
    getInitialForm: createGenericChannelForm,
    mapChannelToForm: channel => ({
      ...createGenericChannelForm(),
      ...(channel || {})
    }),
    normalizeForm: form => ({ ...form }),
    getFormTitle: editing => editing ? `编辑 ${label} 渠道` : `添加 ${label} 渠道`,
    getChannelTitle: channel => channel?.name || label,
    getHeaderTags: (channel, helpers = {}) => {
      if (channel.health?.status === 'frozen') {
        return [{
          text: typeof helpers.formatFreeze === 'function'
            ? helpers.formatFreeze(channel.health.freezeRemaining)
            : '已冻结',
          type: 'error'
        }]
      }
      if (channel.health?.status === 'checking') {
        return [{ text: '检测中', type: 'warning' }]
      }
      return []
    },
    buildInfoRows: (channel, helpers = {}) => ([
      { label: 'URL', value: channel.baseUrl, mono: true },
      {
        label: 'Key',
        value: channel.apiKey
          ? (typeof helpers.maskApiKey === 'function' ? helpers.maskApiKey(channel.apiKey) : '已设置')
          : (channel.authMode === 'none' ? '无需认证' : '未设置'),
        mono: true,
        action: channel.health?.status && channel.health.status !== 'healthy'
          && typeof helpers.handleResetHealth === 'function'
          ? () => helpers.handleResetHealth(channel)
          : null,
        actionLabel: '重置状态'
      }
    ]),
    fetch: api.fetch,
    create: api.create,
    update: api.update,
    remove: api.remove
  }
}

export function validateCommonChannel(value = {}) {
  const errors = {}
  if (!String(value.baseUrl || '').trim()) errors.baseUrl = 'Base URL 不能为空'
  return errors
}
