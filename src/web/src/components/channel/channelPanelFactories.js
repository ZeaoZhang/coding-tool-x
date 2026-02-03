import {
  getChannels as fetchClaudeChannels,
  createChannel as createClaudeChannel,
  updateChannel as updateClaudeChannel,
  deleteChannel as deleteClaudeChannel,
  applyChannelToSettings,
  resetChannelHealth,
  testClaudeChannelSpeed,
  testCodexChannelSpeed,
  testGeminiChannelSpeed,
  fetchChannelModels
} from '../../api/channels'
import { claudePresets, presetCategories, getPresetById } from '../../config/claudePresets'
import {
  getCodexChannels,
  createCodexChannel,
  updateCodexChannel,
  deleteCodexChannel,
  applyCodexChannelToSettings,
  resetCodexChannelHealth
} from '../../api/channels'
import {
  getGeminiChannels,
  createGeminiChannel,
  updateGeminiChannel,
  deleteGeminiChannel,
  resetGeminiChannelHealth
} from '../../api/channels'

const URL_REQUIRE_HTTP = /^https?:\/\//i
const PROVIDER_KEY_PATTERN = /^[a-z0-9-]+$/i

function normalizeConcurrency(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.round(num)
}

function normalizeWeight(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 1) return 1
  return Math.min(100, Math.round(num))
}

function validateRequired(label, value) {
  if (value === null || value === undefined || value === '') {
    return `${label}不能为空`
  }
}

function validateHttpUrl(label, value, { required } = {}) {
  if (!value) {
    return required ? `${label}不能为空` : ''
  }
  if (!URL_REQUIRE_HTTP.test(value)) {
    return `${label}必须以 http:// 或 https:// 开头`
  }
  try {
    new URL(value)
  } catch (err) {
    return `${label}不是合法的链接`
  }
  return ''
}

function validateProviderKey(value) {
  if (!value) {
    return 'Provider Key 不能为空'
  }
  if (!PROVIDER_KEY_PATTERN.test(value)) {
    return '字母、数字、短横线组合，例如 openai'
  }
  return ''
}

const baseSections = {
  schedule: [
    {
      key: 'maxConcurrency',
      label: '最大并发',
      type: 'number',
      placeholder: '留空表示不限',
      clearable: true,
      validate: (value) => {
        if (value === null || value === undefined || value === '') return ''
        const num = Number(value)
        if (!Number.isFinite(num) || num <= 0) return '并发需为大于 0 的数字'
        if (num > 100) return '并发最多 100'
        return ''
      }
    },
    {
      key: 'weight',
      label: '调度权重',
      type: 'number',
      placeholder: '默认 1',
      min: 1,
      max: 100,
      validate: (value) => {
        const num = Number(value)
        if (!Number.isFinite(num) || num < 1) return '调度权重至少为 1'
        return ''
      }
    },
    {
      key: 'enabled',
      label: '渠道状态',
      type: 'switch',
      checkedText: '启用',
      uncheckedText: '停用'
    }
  ]
}

const channelPanelFactories = {
  claude: () => ({
    type: 'claude',
    displayName: 'Claude',
    schedulerSource: 'claude',
    storageKeys: {
      localCollapse: 'claudeChannelCollapse',
      collapseConfigKey: 'claude',
      orderConfigKey: 'claude'
    },
    emptyDescription: '暂无渠道',
    showEmptyAction: false,
    emptyActionText: '',
    modalWidth: 520,
    formLabelWidth: 95,
    showApplyButton: true,
    presets: claudePresets,
    presetCategories,
    getPresetById,
    formSections: [
      {
        title: '供应商预设',
        fields: [
          {
            key: 'presetId',
            label: '选择预设',
            type: 'preset',
            placeholder: '选择供应商预设'
          }
        ]
      },
      {
        title: '基本信息',
        fields: [
          { key: 'name', label: '渠道名称', type: 'text', required: true, placeholder: '输入渠道名称' },
          {
            key: 'baseUrl',
            label: '接口地址',
            type: 'text',
            required: true,
            placeholder: 'https://api.example.com',
            validate: (value) => validateHttpUrl('接口地址', value, { required: true })
          },
          {
            key: 'apiKey',
            label: '接口密钥',
            type: 'password',
            required: true,
            placeholder: 'sk-...'
          },
          {
            key: 'websiteUrl',
            label: '官网链接',
            type: 'text',
            placeholder: 'https://（选填）',
            validate: (value) => validateHttpUrl('官网链接', value, { required: false })
          },
          {
            key: 'speedTestModel',
            label: '测速模型',
            type: 'select',
            placeholder: '选择用于测速的模型（留空则自动检测）',
            description: '指定用于速度测试的模型，留空则使用自动检测'
          }
        ]
      },
      {
        title: '模型重定向',
        description: '仅在代理开启时生效，将请求的模型重定向到指定模型',
        collapsible: true,
        showWhen: (form) => form.presetId === 'official',
        fields: [
          {
            key: 'modelRedirects',
            type: 'model-redirect',
            fullWidth: true
          }
        ]
      },
      {
        title: '模型配置',
        description: '代理关闭时：模型映射（写入 settings.json）；代理开启时：模型重定向（如 opus → sonnet 节省 token）',
        collapsible: true,
        showWhen: (form) => form.presetId && form.presetId !== 'official',
        fields: [
          {
            key: 'modelConfig.model',
            label: '主模型',
            type: 'autocomplete',
            placeholder: '如 glm-4.6'
          },
          {
            key: 'modelConfig.haikuModel',
            label: 'Haiku 模型',
            type: 'autocomplete',
            placeholder: '如 glm-4.5-air'
          },
          {
            key: 'modelConfig.sonnetModel',
            label: 'Sonnet 模型',
            type: 'autocomplete',
            placeholder: '如 glm-4.6'
          },
          {
            key: 'modelConfig.opusModel',
            label: 'Opus 模型',
            type: 'autocomplete',
            placeholder: '如 glm-4.6'
          }
        ]
      },
      {
        title: '调度配置',
        fields: baseSections.schedule
      },
      {
        title: '网络代理',
        description: '部分渠道可能需要代理才能访问',
        collapsible: true,
        fields: [
          {
            key: 'proxyUrl',
            label: '代理地址',
            type: 'text',
            placeholder: 'http://127.0.0.1:7890（选填）'
          }
        ]
      }
    ],
    getInitialForm: () => ({
      presetId: 'official',
      name: 'Claude 官方',
      baseUrl: 'https://api.anthropic.com',
      apiKey: '',
      websiteUrl: 'https://www.anthropic.com',
      speedTestModel: '',
      modelConfig: {
        model: '',
        haikuModel: '',
        sonnetModel: '',
        opusModel: ''
      },
      modelRedirects: [],
      proxyUrl: '',
      maxConcurrency: null,
      weight: 1,
      enabled: true,
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null
    }),
    mapChannelToForm: (channel) => ({
      presetId: channel.presetId || 'official',
      name: channel.name || '',
      baseUrl: channel.baseUrl || '',
      apiKey: channel.apiKey || '',
      websiteUrl: channel.websiteUrl || '',
      speedTestModel: channel.speedTestModel || '',
      modelConfig: {
        model: channel.modelConfig?.model || '',
        haikuModel: channel.modelConfig?.haikuModel || '',
        sonnetModel: channel.modelConfig?.sonnetModel || '',
        opusModel: channel.modelConfig?.opusModel || ''
      },
      modelRedirects: channel.modelRedirects || [],
      proxyUrl: channel.proxyUrl || '',
      maxConcurrency: channel.maxConcurrency ?? null,
      weight: channel.weight || 1,
      enabled: channel.enabled !== false,
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null
    }),
    onPresetChange: (presetId, form) => {
      const preset = getPresetById(presetId)
      if (!preset) return form

      const newForm = { ...form, presetId }
      newForm.name = preset.name
      newForm.baseUrl = preset.baseUrl
      newForm.websiteUrl = preset.websiteUrl || ''

      if (preset.env) {
        newForm.modelConfig = {
          model: preset.env.ANTHROPIC_MODEL || '',
          haikuModel: preset.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
          sonnetModel: preset.env.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
          opusModel: preset.env.ANTHROPIC_DEFAULT_OPUS_MODEL || ''
        }
      }

      return newForm
    },
    fetchModelsForChannel: async (channelId, form) => {
      form.modelsFetching = true
      form.modelsFetchError = null
      form.modelsFetchErrorHint = null
      try {
        const result = await fetchChannelModels(channelId, 'claude')
        if (result.supported) {
          form.availableModels = result.models.map(m => ({
            label: m,
            value: m
          }))

          // Show info message if using fallback default model
          if (result.fallbackUsed && result.models.length > 0) {
            form.modelsFetchError = result.error || '无法自动获取模型列表（API 端点受保护）'
            form.modelsFetchErrorHint = result.errorHint || '建议手动输入模型名称，例如：claude-sonnet-4-5、claude-3-5-haiku-20241022、claude-3-opus-20240229'
          }
        } else {
          form.modelsFetchError = result.error || '该供应商不支持模型列表接口'
          form.modelsFetchErrorHint = result.errorHint
        }
      } catch (error) {
        // Try to extract error details from response
        const errorData = error.response?.data
        if (errorData) {
          form.modelsFetchError = errorData.error || error.message || '获取模型列表失败'
          form.modelsFetchErrorHint = errorData.errorHint
        } else {
          form.modelsFetchError = error.message || '获取模型列表失败'
        }
      } finally {
        form.modelsFetching = false
      }
    },
    testFn: testClaudeChannelSpeed,
    api: {
      fetch: async () => {
        const data = await fetchClaudeChannels()
        return data.channels || []
      },
      create: async (form) => {
        await createClaudeChannel(
          form.name,
          form.baseUrl,
          form.apiKey,
          form.websiteUrl || undefined,
          {
            maxConcurrency: normalizeConcurrency(form.maxConcurrency),
            weight: normalizeWeight(form.weight),
            enabled: form.enabled,
            presetId: form.presetId,
            modelConfig: form.modelConfig,
            modelRedirects: form.modelRedirects || [],
            proxyUrl: form.proxyUrl || '',
            speedTestModel: form.speedTestModel || null
          }
        )
      },
      update: async (channel, form) => {
        await updateClaudeChannel(channel.id, {
          name: form.name,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          websiteUrl: form.websiteUrl,
          maxConcurrency: normalizeConcurrency(form.maxConcurrency),
          weight: normalizeWeight(form.weight),
          enabled: form.enabled,
          presetId: form.presetId,
          modelConfig: form.modelConfig,
          modelRedirects: form.modelRedirects || [],
          proxyUrl: form.proxyUrl || '',
          speedTestModel: form.speedTestModel || null
        })
      },
      toggle: async (channel, enabled) => {
        await updateClaudeChannel(channel.id, { enabled })
      },
      remove: deleteClaudeChannel,
      applyToSettings: async (channel) => {
        return applyChannelToSettings(channel.id)
      },
      resetHealth: async (channel) => {
        return resetChannelHealth(channel.id)
      }
    },
    getHeaderTags: (channel, helpers) => {
      const tags = []
      if (channel.health?.status === 'frozen') {
        tags.push({ text: helpers.formatFreeze(channel.health.freezeRemaining), type: 'error' })
      } else if (channel.health?.status === 'checking') {
        tags.push({ text: '检测中', type: 'warning' })
      }
      if (channel.enabled === false) {
        tags.push({ text: '未启用', type: 'default' })
      }
      return tags
    },
    buildInfoRows: (channel, helpers) => {
      const rows = [
        { label: 'URL', value: channel.baseUrl },
        {
          label: 'Key',
          value: helpers.maskApiKey(channel.apiKey),
          mono: true,
          action: channel.health?.status !== 'healthy'
            ? () => helpers.handleResetHealth(channel)
            : null,
          actionLabel: '重置状态'
        }
      ]
      return rows
    }
  }),
  codex: () => ({
    type: 'codex',
    displayName: 'Codex',
    schedulerSource: 'codex',
    storageKeys: {
      localCollapse: 'codexChannelCollapse',
      collapseConfigKey: 'codex',
      orderConfigKey: 'codex'
    },
    emptyDescription: '暂无渠道',
    showEmptyAction: true,
    emptyActionText: '添加 Codex 渠道',
    modalWidth: 600,
    formLabelWidth: 90,
    showApplyButton: true,
    formSections: [
      {
        title: '基本信息',
        fields: [
          { key: 'name', label: '渠道名称', type: 'text', required: true, placeholder: '显示名称' },
          {
            key: 'providerKey',
            label: 'Provider Key',
            type: 'text',
            required: true,
            placeholder: '英文标识，如 openai',
            disabledOnEdit: true,
            validate: validateProviderKey
          },
          {
            key: 'baseUrl',
            label: 'Base URL',
            type: 'text',
            required: true,
            placeholder: 'https://api.example.com',
            validate: (value) => validateHttpUrl('Base URL', value, { required: true })
          },
          {
            key: 'apiKey',
            label: 'API Key',
            type: 'password',
            required: true,
            placeholder: 'sk-...'
          },
          {
            key: 'websiteUrl',
            label: '官网链接',
            type: 'text',
            placeholder: 'https://（选填）',
            validate: (value) => validateHttpUrl('官网链接', value, { required: false })
          }
        ]
      },
      {
        title: '模型重定向',
        description: '仅在代理开启时生效，将请求的模型重定向到指定模型',
        collapsible: true,
        fields: [
          {
            key: 'modelRedirects',
            type: 'model-redirect',
            fullWidth: true
          }
        ]
      },
      {
        title: '调度配置',
        fields: baseSections.schedule
      }
    ],
    getInitialForm: () => ({
      name: '',
      providerKey: '',
      baseUrl: '',
      apiKey: '',
      websiteUrl: '',
      modelRedirects: [],
      maxConcurrency: null,
      weight: 1,
      enabled: true
    }),
    mapChannelToForm: (channel) => ({
      name: channel.name || '',
      providerKey: channel.providerKey || '',
      baseUrl: channel.baseUrl || '',
      apiKey: channel.apiKey || '',
      websiteUrl: channel.websiteUrl || '',
      modelRedirects: channel.modelRedirects || [],
      maxConcurrency: channel.maxConcurrency ?? null,
      weight: channel.weight || 1,
      enabled: channel.enabled !== false
    }),
    testFn: testCodexChannelSpeed,
    api: {
      fetch: async () => {
        const data = await getCodexChannels()
        return data.channels || []
      },
      create: async (form) => {
        await createCodexChannel(
          form.name,
          form.providerKey,
          form.baseUrl,
          form.apiKey,
          form.websiteUrl || '',
          {
            maxConcurrency: normalizeConcurrency(form.maxConcurrency),
            weight: normalizeWeight(form.weight),
            enabled: form.enabled,
            modelRedirects: form.modelRedirects || []
          }
        )
      },
      update: async (channel, form) => {
        await updateCodexChannel(channel.id, {
          name: form.name,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          websiteUrl: form.websiteUrl,
          maxConcurrency: normalizeConcurrency(form.maxConcurrency),
          weight: normalizeWeight(form.weight),
          enabled: form.enabled,
          modelRedirects: form.modelRedirects || []
        })
      },
      toggle: async (channel, enabled) => updateCodexChannel(channel.id, { enabled }),
      remove: deleteCodexChannel,
      applyToSettings: async (channel) => {
        return applyCodexChannelToSettings(channel.id)
      },
      resetHealth: async (channel) => {
        return resetCodexChannelHealth(channel.id)
      }
    },
    getHeaderTags: (channel, helpers) => {
      const tags = []
      if (channel.health?.status === 'frozen') {
        tags.push({ text: helpers.formatFreeze(channel.health.freezeRemaining), type: 'error' })
      } else if (channel.health?.status === 'checking') {
        tags.push({ text: '检测中', type: 'warning' })
      }
      if (channel.enabled === false) {
        tags.push({ text: '已禁用', type: 'default' })
      }
      return tags
    },
    buildInfoRows: (channel, helpers) => ([
      { label: 'Provider', value: channel.providerKey, mono: true },
      { label: 'URL', value: channel.baseUrl },
      {
        label: 'Key',
        value: helpers.maskApiKey(channel.apiKey),
        mono: true,
        action: channel.health?.status !== 'healthy'
          ? () => helpers.handleResetHealth(channel)
          : null,
        actionLabel: '重置状态'
      }
    ])
  }),
  gemini: () => ({
    type: 'gemini',
    displayName: 'Gemini',
    schedulerSource: 'gemini',
    storageKeys: {
      localCollapse: 'geminiChannelCollapse',
      collapseConfigKey: 'gemini',
      orderConfigKey: 'gemini'
    },
    emptyDescription: '暂无渠道',
    showEmptyAction: true,
    emptyActionText: '添加 Gemini 渠道',
    modalWidth: 520,
    formLabelWidth: 90,
    showApplyButton: false,
    formSections: [
      {
        title: '基本信息',
        fields: [
          { key: 'name', label: '渠道名称', type: 'text', required: true, placeholder: '显示名称' },
          { key: 'model', label: 'Model', type: 'text', required: true, placeholder: '例如 gemini-2.5-pro' },
          {
            key: 'baseUrl',
            label: 'Base URL',
            type: 'text',
            required: true,
            placeholder: 'https://generativelanguage.googleapis.com/v1beta',
            validate: (value) => validateHttpUrl('Base URL', value, { required: true })
          },
          {
            key: 'apiKey',
            label: 'API Key',
            type: 'password',
            required: true,
            placeholder: 'AIza...'
          },
          {
            key: 'websiteUrl',
            label: '官网链接',
            type: 'text',
            placeholder: 'https://（选填）',
            validate: (value) => validateHttpUrl('官网链接', value, { required: false })
          }
        ]
      },
      {
        title: '模型重定向',
        description: '仅在代理开启时生效，将请求的模型重定向到指定模型',
        collapsible: true,
        fields: [
          {
            key: 'modelRedirects',
            type: 'model-redirect',
            fullWidth: true
          }
        ]
      },
      {
        title: '调度配置',
        fields: baseSections.schedule
      }
    ],
    getInitialForm: () => ({
      name: '',
      model: '',
      baseUrl: '',
      apiKey: '',
      websiteUrl: '',
      modelRedirects: [],
      maxConcurrency: null,
      weight: 1,
      enabled: true
    }),
    mapChannelToForm: (channel) => ({
      name: channel.name || '',
      model: channel.model || '',
      baseUrl: channel.baseUrl || '',
      apiKey: channel.apiKey || '',
      websiteUrl: channel.websiteUrl || '',
      modelRedirects: channel.modelRedirects || [],
      maxConcurrency: channel.maxConcurrency ?? null,
      weight: channel.weight || 1,
      enabled: channel.enabled !== false
    }),
    testFn: testGeminiChannelSpeed,
    api: {
      fetch: async () => {
        const data = await getGeminiChannels()
        return data.channels || []
      },
      create: async (form) => {
        await createGeminiChannel(
          form.name,
          form.baseUrl,
          form.apiKey,
          form.model,
          form.websiteUrl || '',
          {
            maxConcurrency: normalizeConcurrency(form.maxConcurrency),
            weight: normalizeWeight(form.weight),
            enabled: form.enabled,
            modelRedirects: form.modelRedirects || []
          }
        )
      },
      update: async (channel, form) => {
        await updateGeminiChannel(channel.id, {
          name: form.name,
          model: form.model,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          websiteUrl: form.websiteUrl,
          maxConcurrency: normalizeConcurrency(form.maxConcurrency),
          weight: normalizeWeight(form.weight),
          enabled: form.enabled,
          modelRedirects: form.modelRedirects || []
        })
      },
      toggle: async (channel, enabled) => updateGeminiChannel(channel.id, { enabled }),
      remove: deleteGeminiChannel,
      resetHealth: async (channel) => {
        return resetGeminiChannelHealth(channel.id)
      }
    },
    getHeaderTags: (channel, helpers) => {
      const tags = []
      if (channel.health?.status === 'frozen') {
        tags.push({ text: helpers.formatFreeze(channel.health.freezeRemaining), type: 'error' })
      } else if (channel.health?.status === 'checking') {
        tags.push({ text: '检测中', type: 'warning' })
      }
      if (channel.enabled === false) {
        tags.push({ text: '已禁用', type: 'default' })
      }
      return tags
    },
    buildInfoRows: (channel, helpers) => ([
      { label: 'Model', value: channel.model, mono: true },
      { label: 'URL', value: channel.baseUrl },
      {
        label: 'Key',
        value: helpers.maskApiKey(channel.apiKey),
        mono: true,
        action: channel.health?.status !== 'healthy'
          ? () => helpers.handleResetHealth(channel)
          : null,
        actionLabel: '重置状态'
      }
    ])
  })
}

export default channelPanelFactories
