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
    modalWidth: 520,
    formLabelWidth: 95,
    showApplyButton: false,
    formSections: [
      { title: '基本信息', fields: commonChannelSchema.endpoint },
      { title: '认证', fields: commonChannelSchema.auth },
      { title: '调度配置', fields: commonChannelSchema.schedule }
    ],
    api,
    getInitialForm: () => ({
      name: '',
      baseUrl: '',
      websiteUrl: '',
      apiKey: '',
      authMode: 'api_key',
      maxConcurrency: null,
      weight: 1,
      enabled: true
    }),
    validateForm: () => ({}),
    normalizeForm: form => ({ ...form }),
    getFormTitle: editing => editing ? `编辑 ${label} 渠道` : `添加 ${label} 渠道`,
    getChannelTitle: channel => channel?.name || label,
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
