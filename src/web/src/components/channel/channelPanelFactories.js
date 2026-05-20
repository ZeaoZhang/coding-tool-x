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
import { codexPresets, codexPresetCategories, getCodexPresetById } from '../../config/codexPresets'
import { geminiPresets, geminiPresetCategories, getGeminiPresetById } from '../../config/geminiPresets'
import { opencodePresets, opencodePresetCategories, getOpenCodePresetById } from '../../config/opencodePresets'
import {
  getCodexChannels,
  createCodexChannel,
  updateCodexChannel,
  deleteCodexChannel,
  applyCodexChannelToSettings,
  resetCodexChannelHealth,
  fetchCodexChannelModels
} from '../../api/channels'
import {
  getGeminiChannels,
  createGeminiChannel,
  updateGeminiChannel,
  deleteGeminiChannel,
  resetGeminiChannelHealth,
  fetchGeminiChannelModels
} from '../../api/channels'
import {
  getOpenCodeChannels,
  createOpenCodeChannel,
  updateOpenCodeChannel,
  deleteOpenCodeChannel,
  resetOpenCodeChannelHealth,
  fetchOpenCodeChannelModels,
  probeOpenCodeChannelModels,
  testOpenCodeChannelSpeed
} from '../../api/channels'
import {
  getPiChannels,
  createPiChannel,
  updatePiChannel,
  deletePiChannel,
  resetPiChannelHealth,
  fetchPiChannelModels,
  probePiChannelModels,
  testPiChannelSpeed
} from '../../api/channels'
import { useDefaultModels } from '../../composables/useDefaultModels.js'

const { getAllModelsByToolType, loadDefaultModels } = useDefaultModels()

const URL_REQUIRE_HTTP = /^https?:\/\//i
const PROVIDER_KEY_PATTERN = /^[a-z0-9_-]+$/i
const MANUAL_BALANCE_CREDENTIAL_PLATFORMS = new Set(['anyrouter', 'newcli'])

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
  const normalized = String(value || '').trim()
  if (!normalized) {
    return 'Provider Key 不能为空'
  }
  if (!PROVIDER_KEY_PATTERN.test(normalized)) {
    return '只能包含字母、数字、下划线和中划线，例如 openai-official'
  }
  if (normalized.toLowerCase() === 'openai') {
    return 'Provider Key 不能使用保留值 openai，请改成 openai-official 之类的自定义标识'
  }
  return ''
}

function buildAuthPayload(form) {
  const shouldKeepManualBalanceCredential = form._showChannelBalance !== true || shouldShowManualBalanceCredential(form)
  return {
    apiKey: form.apiKey || '',
    balanceToken: shouldKeepManualBalanceCredential ? (form.balanceToken || '') : '',
    balanceUserId: shouldKeepManualBalanceCredential ? (form.balanceUserId || null) : null
  }
}

function detectBalancePlatform(form = {}) {
  const text = [
    form.presetId,
    form.providerKey,
    form.name,
    form.websiteUrl,
    form.baseUrl
  ].map(value => String(value || '').trim().toLowerCase()).join(' ')
  if (text.includes('anyrouter')) return 'anyrouter'
  if (text.includes('code.newcli.com') || text.includes('newcli') || text.includes('new-cli')) return 'newcli'
  return null
}

function shouldShowManualBalanceCredential(form = {}) {
  if (form._showChannelBalance !== true) return false
  return MANUAL_BALANCE_CREDENTIAL_PLATFORMS.has(detectBalancePlatform(form))
}

function buildBalanceCredentialField(label = '余额凭据') {
  return {
    key: 'balanceToken',
    label,
    type: 'password',
    showWhen: shouldShowManualBalanceCredential,
    placeholder: '选填：余额接口需要的会话 Token / Cookie（NewCLI 可填完整 Cookie）'
  }
}

function buildBalanceUserIdField() {
  return {
    key: 'balanceUserId',
    label: '余额用户 ID',
    type: 'number',
    min: 1,
    clearable: true,
    showWhen: shouldShowManualBalanceCredential,
    placeholder: '选填：New API / AnyRouter 需要 New-Api-User 时填写'
  }
}

function applyPresetAuth(form) {
  return { ...form }
}

function formatOpenCodeGatewaySourceType(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'claude') return 'Claude Code'
  if (normalized === 'gemini') return 'Gemini'
  return 'Codex'
}

function buildModelOptions(models = []) {
  return models.map((model) => ({ label: model, value: model }))
}

function mergeModelOptions(...optionGroups) {
  const seen = new Set()
  const merged = []
  for (const options of optionGroups) {
    for (const option of options || []) {
      const value = String(option?.value || '').trim()
      if (!value) continue
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({
        label: option?.label || value,
        value
      })
    }
  }
  return merged
}

function getToolModelOptions(toolType) {
  return buildModelOptions(getAllModelsByToolType(toolType))
}

function resolveClaudeModelToolType(gatewaySourceType) {
  return String(gatewaySourceType || '').trim().toLowerCase() === 'openai_compatible'
    ? 'codex'
    : 'claude'
}

function formatGeminiApiFormat(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'vertex_ai_v1') return 'Vertex AI v1'
  return 'Gemini API'
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
          buildBalanceCredentialField(),
          buildBalanceUserIdField(),
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
            description: '指定用于速度测试的模型，留空则使用自动检测',
            options: getToolModelOptions('claude'),
            clearable: true
          }
        ]
      },
      {
        title: '模型重定向',
        description: '仅在代理开启时生效，将请求的模型重定向到指定模型',
        collapsible: true,
        showWhen: (form) => form.presetId === 'official' || form.gatewaySourceType === 'openai_compatible',
        fields: [
          {
            key: 'modelRedirects',
            type: 'model-redirect',
            fullWidth: true
          }
        ]
      },
      {
        title: 'OpenAI 网关',
        description: 'OpenAI 格式渠道需要通过 Claude 代理使用；优先选择 Responses API，不兼容时再切到 Chat Completions',
        showWhen: (form) => form.gatewaySourceType === 'openai_compatible',
        fields: [
          {
            key: 'targetApi',
            label: '上游接口',
            type: 'radio-group',
            options: [
              { label: 'Responses API', value: 'responses' },
              { label: 'Chat Completions', value: 'chat.completions' }
            ]
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
      balanceToken: '',
      balanceUserId: null,
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
      gatewaySourceType: 'claude',
      targetApi: 'responses',
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
      balanceToken: channel.balanceToken || '',
      balanceUserId: channel.balanceUserId ?? null,
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
      gatewaySourceType: channel.gatewaySourceType || 'claude',
      targetApi: channel.targetApi || 'responses',
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
      newForm.gatewaySourceType = preset.gatewaySourceType || newForm.gatewaySourceType || 'claude'
      newForm.targetApi = preset.targetApi || newForm.targetApi || 'responses'

      if (preset.env) {
        newForm.modelConfig = {
          model: preset.env.ANTHROPIC_MODEL || '',
          haikuModel: preset.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
          sonnetModel: preset.env.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
          opusModel: preset.env.ANTHROPIC_DEFAULT_OPUS_MODEL || ''
        }
      }

      return applyPresetAuth(newForm)
    },
    fetchModelsForChannel: async (channelId, form) => {
      await loadDefaultModels()
      const toolType = resolveClaudeModelToolType(form.gatewaySourceType)
      const defaultOptions = getToolModelOptions(toolType)
      form.modelsFetching = true
      form.modelsFetchError = null
      form.modelsFetchErrorHint = null
      if (!channelId) {
        form.availableModels = defaultOptions
        form.modelsFetching = false
        return
      }
      try {
        const result = await fetchChannelModels(channelId, form.gatewaySourceType || null)
        if (result.models && result.models.length > 0) {
          form.availableModels = mergeModelOptions(
            buildModelOptions(result.models),
            defaultOptions
          )

          // Show info message if using fallback default model
          if (result.fallbackUsed) {
            form.modelsFetchError = result.error || '无法自动获取模型列表（API 端点受保护）'
            form.modelsFetchErrorHint = result.errorHint || '已使用默认模型列表，您也可以手动输入模型名称'
          }
        } else if (result.fallbackUsed || !result.supported) {
          form.availableModels = defaultOptions
          form.modelsFetchError = result.error || '该供应商不支持模型列表接口'
          form.modelsFetchErrorHint = result.errorHint || '已使用默认模型列表'
        }
      } catch (error) {
        form.availableModels = defaultOptions
        // Try to extract error details from response
        const errorData = error.response?.data
        if (errorData) {
          form.modelsFetchError = errorData.error || error.message || '获取模型列表失败'
          form.modelsFetchErrorHint = errorData.errorHint || '已使用默认模型列表'
        } else {
          form.modelsFetchError = error.message || '获取模型列表失败'
          form.modelsFetchErrorHint = '已使用默认模型列表'
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
        const authPayload = buildAuthPayload(form)
        await createClaudeChannel(
          form.name,
          form.baseUrl,
          authPayload.apiKey,
          form.websiteUrl || undefined,
          {
            maxConcurrency: normalizeConcurrency(form.maxConcurrency),
            weight: normalizeWeight(form.weight),
            enabled: form.enabled,
            presetId: form.presetId,
            modelConfig: form.modelConfig,
            modelRedirects: form.modelRedirects || [],
            proxyUrl: form.proxyUrl || '',
            speedTestModel: form.speedTestModel || null,
            gatewaySourceType: form.gatewaySourceType || 'claude',
            targetApi: form.targetApi || 'responses',
            balanceToken: authPayload.balanceToken,
            balanceUserId: authPayload.balanceUserId
          }
        )
      },
      update: async (channel, form) => {
        const authPayload = buildAuthPayload(form)
        await updateClaudeChannel(channel.id, {
          name: form.name,
          baseUrl: form.baseUrl,
          apiKey: authPayload.apiKey,
          websiteUrl: form.websiteUrl,
          maxConcurrency: normalizeConcurrency(form.maxConcurrency),
          weight: normalizeWeight(form.weight),
          enabled: form.enabled,
          presetId: form.presetId,
          modelConfig: form.modelConfig,
          modelRedirects: form.modelRedirects || [],
          proxyUrl: form.proxyUrl || '',
          speedTestModel: form.speedTestModel || null,
          gatewaySourceType: form.gatewaySourceType || 'claude',
          targetApi: form.targetApi || 'responses',
          balanceToken: authPayload.balanceToken,
          balanceUserId: authPayload.balanceUserId
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
    presets: codexPresets,
    presetCategories: codexPresetCategories,
    getPresetById: getCodexPresetById,
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
          { key: 'name', label: '渠道名称', type: 'text', required: true, placeholder: '显示名称' },
          {
            key: 'providerKey',
            label: 'Provider Key',
            type: 'text',
            required: true,
            placeholder: '英文标识，如 openai-official',
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
          buildBalanceCredentialField(),
          buildBalanceUserIdField(),
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
            placeholder: '选择用于测速的模型（留空则使用默认）',
            description: '指定用于速度测试的模型，留空则使用默认模型',
            options: getToolModelOptions('codex'),
            clearable: true
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
      presetId: 'openai',
      name: 'OpenAI',
      providerKey: 'openai-official',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      balanceToken: '',
      balanceUserId: null,
      websiteUrl: 'https://platform.openai.com',
      gatewaySourceType: 'codex',
      speedTestModel: '',
      modelRedirects: [],
      maxConcurrency: null,
      weight: 1,
      enabled: true,
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }),
    mapChannelToForm: (channel) => ({
      presetId: channel.presetId || 'custom',
      name: channel.name || '',
      providerKey: channel.providerKey || '',
      baseUrl: channel.baseUrl || '',
      apiKey: channel.apiKey || '',
      balanceToken: channel.balanceToken || '',
      balanceUserId: channel.balanceUserId ?? null,
      websiteUrl: channel.websiteUrl || '',
      gatewaySourceType: channel.gatewaySourceType || 'codex',
      speedTestModel: channel.speedTestModel || '',
      modelRedirects: channel.modelRedirects || [],
      maxConcurrency: channel.maxConcurrency ?? null,
      weight: channel.weight || 1,
      enabled: channel.enabled !== false,
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }),
    onPresetChange: (presetId, form) => {
      const preset = getCodexPresetById(presetId)
      if (!preset) return form

      const newForm = { ...form, presetId }
      newForm.name = preset.name
      newForm.baseUrl = preset.baseUrl
      newForm.websiteUrl = preset.websiteUrl || ''
      newForm.providerKey = preset.providerKey || ''
      newForm.gatewaySourceType = preset.gatewaySourceType || newForm.gatewaySourceType || 'codex'
      return applyPresetAuth(newForm)
    },
    fetchModelsForChannel: async (channelId, form) => {
      await loadDefaultModels()
      form.modelsFetching = true
      form.modelsFetchError = null
      form.modelsFetchErrorHint = null
      if (!channelId) {
        form.availableModels = getToolModelOptions('codex')
        form.modelsFetching = false
        return
      }
      try {
        const result = await fetchCodexChannelModels(channelId)
        if (result.models && result.models.length > 0) {
          form.availableModels = mergeModelOptions(
            buildModelOptions(result.models),
            getToolModelOptions('codex')
          )
          // 如果使用了回退，显示提示
          if (result.fallbackUsed) {
            form.modelsFetchError = result.error || '无法自动获取模型列表'
            form.modelsFetchErrorHint = result.errorHint || '已使用默认模型列表，您也可以手动输入模型名称'
          }
        } else if (result.fallbackUsed || !result.supported) {
          // 获取失败，使用默认列表
          form.availableModels = getToolModelOptions('codex')
          form.modelsFetchError = result.error || '该供应商不支持模型列表接口'
          form.modelsFetchErrorHint = result.errorHint || '已使用默认模型列表'
        }
      } catch (error) {
        // 出错时使用默认列表
        form.availableModels = getToolModelOptions('codex')
        form.modelsFetchError = error.message || '获取模型列表失败'
        form.modelsFetchErrorHint = '已使用默认模型列表'
      } finally {
        form.modelsFetching = false
      }
    },
    testFn: testCodexChannelSpeed,
    api: {
      fetch: async () => {
        const data = await getCodexChannels()
        return data.channels || []
      },
      create: async (form) => {
        const authPayload = buildAuthPayload(form)
        await createCodexChannel(
          form.name,
          form.providerKey,
          form.baseUrl,
          authPayload.apiKey,
          form.websiteUrl || '',
          {
            maxConcurrency: normalizeConcurrency(form.maxConcurrency),
            weight: normalizeWeight(form.weight),
            enabled: form.enabled,
            modelRedirects: form.modelRedirects || [],
            speedTestModel: form.speedTestModel || null,
            presetId: form.presetId || null,
            gatewaySourceType: form.gatewaySourceType || 'codex',
            balanceToken: authPayload.balanceToken,
            balanceUserId: authPayload.balanceUserId
          }
        )
      },
      update: async (channel, form) => {
        const authPayload = buildAuthPayload(form)
        await updateCodexChannel(channel.id, {
          name: form.name,
          baseUrl: form.baseUrl,
          apiKey: authPayload.apiKey,
          websiteUrl: form.websiteUrl,
          maxConcurrency: normalizeConcurrency(form.maxConcurrency),
          weight: normalizeWeight(form.weight),
          enabled: form.enabled,
          modelRedirects: form.modelRedirects || [],
          speedTestModel: form.speedTestModel || null,
          presetId: form.presetId || null,
          gatewaySourceType: form.gatewaySourceType || 'codex',
          balanceToken: authPayload.balanceToken,
          balanceUserId: authPayload.balanceUserId
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
    presets: geminiPresets,
    presetCategories: geminiPresetCategories,
    getPresetById: getGeminiPresetById,
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
          buildBalanceCredentialField(),
          buildBalanceUserIdField(),
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
            placeholder: '选择用于测速的模型（留空则使用 model 字段）',
            description: '指定用于速度测试的模型，留空则使用上方配置的 Model',
            options: getToolModelOptions('gemini'),
            clearable: true
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
      presetId: 'google',
      name: 'Google AI',
      model: 'gemini-2.5-pro',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: '',
      apiFormat: 'gemini_api',
      balanceToken: '',
      balanceUserId: null,
      websiteUrl: 'https://ai.google.dev',
      gatewaySourceType: 'gemini',
      speedTestModel: '',
      modelRedirects: [],
      maxConcurrency: null,
      weight: 1,
      enabled: true,
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }),
    mapChannelToForm: (channel) => ({
      presetId: channel.presetId || 'custom',
      name: channel.name || '',
      model: channel.model || '',
      baseUrl: channel.baseUrl || '',
      apiKey: channel.apiKey || '',
      apiFormat: channel.apiFormat || 'gemini_api',
      balanceToken: channel.balanceToken || '',
      balanceUserId: channel.balanceUserId ?? null,
      websiteUrl: channel.websiteUrl || '',
      gatewaySourceType: channel.gatewaySourceType || 'gemini',
      speedTestModel: channel.speedTestModel || '',
      modelRedirects: channel.modelRedirects || [],
      maxConcurrency: channel.maxConcurrency ?? null,
      weight: channel.weight || 1,
      enabled: channel.enabled !== false,
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }),
    onPresetChange: (presetId, form) => {
      const preset = getGeminiPresetById(presetId)
      if (!preset) return form

      const newForm = { ...form, presetId }
      newForm.name = preset.name
      newForm.baseUrl = preset.baseUrl
      newForm.websiteUrl = preset.websiteUrl || ''
      newForm.apiFormat = preset.apiFormat || 'gemini_api'
      newForm.gatewaySourceType = preset.gatewaySourceType || newForm.gatewaySourceType || 'gemini'
      return applyPresetAuth(newForm)
    },
    fetchModelsForChannel: async (channelId, form) => {
      await loadDefaultModels()
      form.modelsFetching = true
      form.modelsFetchError = null
      form.modelsFetchErrorHint = null
      if (!channelId) {
        form.availableModels = getToolModelOptions('gemini')
        form.modelsFetching = false
        return
      }
      try {
        const result = await fetchGeminiChannelModels(channelId)
        if (result.models && result.models.length > 0) {
          form.availableModels = mergeModelOptions(
            buildModelOptions(result.models),
            getToolModelOptions('gemini')
          )
          // 如果使用了回退，显示提示
          if (result.fallbackUsed) {
            form.modelsFetchError = result.error || '无法自动获取模型列表'
            form.modelsFetchErrorHint = result.errorHint || '已使用默认模型列表，您也可以手动输入模型名称'
          }
        } else if (result.fallbackUsed || !result.supported) {
          // 获取失败，使用默认列表
          form.availableModels = getToolModelOptions('gemini')
          form.modelsFetchError = result.error || '该供应商不支持模型列表接口'
          form.modelsFetchErrorHint = result.errorHint || '已使用默认模型列表'
        }
      } catch (error) {
        // 出错时使用默认列表
        form.availableModels = getToolModelOptions('gemini')
        form.modelsFetchError = error.message || '获取模型列表失败'
        form.modelsFetchErrorHint = '已使用默认模型列表'
      } finally {
        form.modelsFetching = false
      }
    },
    testFn: testGeminiChannelSpeed,
    api: {
      fetch: async () => {
        const data = await getGeminiChannels()
        return data.channels || []
      },
      create: async (form) => {
        const authPayload = buildAuthPayload(form)
        await createGeminiChannel(
          form.name,
          form.baseUrl,
          authPayload.apiKey,
          form.model,
          form.websiteUrl || '',
          {
            maxConcurrency: normalizeConcurrency(form.maxConcurrency),
            weight: normalizeWeight(form.weight),
            enabled: form.enabled,
            modelRedirects: form.modelRedirects || [],
            speedTestModel: form.speedTestModel || null,
            presetId: form.presetId || null,
            apiFormat: form.apiFormat || 'gemini_api',
            gatewaySourceType: form.gatewaySourceType || 'gemini',
            balanceToken: authPayload.balanceToken,
            balanceUserId: authPayload.balanceUserId
          }
        )
      },
      update: async (channel, form) => {
        const authPayload = buildAuthPayload(form)
        await updateGeminiChannel(channel.id, {
          name: form.name,
          model: form.model,
          baseUrl: form.baseUrl,
          apiKey: authPayload.apiKey,
          websiteUrl: form.websiteUrl,
          maxConcurrency: normalizeConcurrency(form.maxConcurrency),
          weight: normalizeWeight(form.weight),
          enabled: form.enabled,
          modelRedirects: form.modelRedirects || [],
          speedTestModel: form.speedTestModel || null,
          presetId: form.presetId || null,
          apiFormat: form.apiFormat || 'gemini_api',
          gatewaySourceType: form.gatewaySourceType || 'gemini',
          balanceToken: authPayload.balanceToken,
          balanceUserId: authPayload.balanceUserId
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
      return tags
    },
    buildInfoRows: (channel, helpers) => ([
      { label: 'Model', value: channel.model, mono: true },
      { label: 'API', value: formatGeminiApiFormat(channel.apiFormat) },
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
  opencode: () => ({
    type: 'opencode',
    displayName: 'OpenCode',
    schedulerSource: 'opencode',
    storageKeys: {
      localCollapse: 'opencodeChannelCollapse',
      collapseConfigKey: 'opencode',
      orderConfigKey: 'opencode'
    },
    emptyDescription: '暂无渠道',
    showEmptyAction: true,
    emptyActionText: '添加 OpenCode 渠道',
    modalWidth: 600,
    formLabelWidth: 95,
    showApplyButton: false,
    presets: opencodePresets,
    presetCategories: opencodePresetCategories,
    getPresetById: getOpenCodePresetById,
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
          { key: 'name', label: '渠道名称', type: 'text', required: true, placeholder: '显示名称' },
          {
            key: 'baseUrl',
            label: 'Base URL',
            type: 'text',
            required: true,
            placeholder: 'https://api.example.com/v1',
            validate: (value) => validateHttpUrl('Base URL', value, { required: true })
          },
          {
            key: 'apiKey',
            label: 'API Key',
            type: 'password',
            required: true,
            placeholder: 'sk-...'
          },
          buildBalanceCredentialField(),
          buildBalanceUserIdField(),
          {
            key: 'websiteUrl',
            label: '官网链接',
            type: 'text',
            placeholder: 'https://（选填）',
            validate: (value) => validateHttpUrl('官网链接', value, { required: false })
          },
          {
            key: 'model',
            label: '默认模型',
            type: 'select',
            placeholder: '选择或输入默认模型（留空则由调度器决定）',
            options: [],
            clearable: true
          },
          {
            key: 'speedTestModel',
            label: '测速模型',
            type: 'select',
            placeholder: '选择用于测速的模型（留空则使用默认模型）',
            description: '指定用于速度测试的模型，留空则自动检测',
            options: [],
            clearable: true
          },
          {
            key: 'allowedModels',
            label: '可用模型',
            type: 'model-multi-select',
            placeholder: '选择注册到 OpenCode 的模型（留空则使用检测到的所有模型）',
            description: '选择哪些模型注册到 opencode.json 的 provider 配置中'
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
      presetId: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      wireApi: 'openai',
      apiKey: '',
      balanceToken: '',
      balanceUserId: null,
      websiteUrl: 'https://openrouter.ai',
      model: '',
      gatewaySourceType: 'codex',
      speedTestModel: '',
      modelRedirects: [],
      allowedModels: [],
      maxConcurrency: null,
      weight: 1,
      enabled: true,
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }),
    mapChannelToForm: (channel) => ({
      presetId: channel.presetId || 'custom',
      name: channel.name || '',
      baseUrl: channel.baseUrl || '',
      wireApi: channel.wireApi || 'openai',
      apiKey: channel.apiKey || '',
      balanceToken: channel.balanceToken || '',
      balanceUserId: channel.balanceUserId ?? null,
      websiteUrl: channel.websiteUrl || '',
      model: channel.model || '',
      gatewaySourceType: channel.gatewaySourceType || 'codex',
      speedTestModel: channel.speedTestModel || '',
      modelRedirects: channel.modelRedirects || [],
      allowedModels: channel.allowedModels || [],
      maxConcurrency: channel.maxConcurrency ?? null,
      weight: channel.weight || 1,
      enabled: channel.enabled !== false,
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }),
    onPresetChange: (presetId, form) => {
      const preset = getOpenCodePresetById(presetId)
      if (!preset) return form

      const newForm = { ...form, presetId }
      newForm.name = preset.name
      newForm.baseUrl = preset.baseUrl
      newForm.websiteUrl = preset.websiteUrl || ''
      newForm.wireApi = preset.wireApi || 'openai'
      newForm.gatewaySourceType = preset.gatewaySourceType || newForm.gatewaySourceType || 'codex'
      return applyPresetAuth(newForm)
    },
    fetchModelsForChannel: async (channelId, form, { forceRefresh = false } = {}) => {
      await loadDefaultModels()
      form.modelsFetching = true
      form.modelsFetchError = null
      form.modelsFetchErrorHint = null

      const presetId = form.presetId || ''
      const isEntryChannel = ['entry_claude', 'entry_codex', 'entry_gemini'].includes(presetId)

      if (isEntryChannel) {
        const sourceType = form.gatewaySourceType || 'codex'
        const modelType = sourceType === 'claude' ? 'claude' : sourceType === 'gemini' ? 'gemini' : 'codex'
        form.availableModels = getToolModelOptions(modelType)
        form.modelsFetching = false
        return
      }

      if (!channelId) {
        if (!form.baseUrl) {
          form.availableModels = []
          form.modelsFetching = false
          return
        }
        try {
          const result = await probeOpenCodeChannelModels({
            baseUrl: form.baseUrl,
            apiKey: form.apiKey || '',
            gatewaySourceType: form.gatewaySourceType || 'codex'
          })
          form.availableModels = result.models && result.models.length > 0 ? buildModelOptions(result.models) : []
          if (result.error) {
            form.modelsFetchError = result.error
            form.modelsFetchErrorHint = result.errorHint || '请手动填写模型名称'
          }
        } catch (error) {
          form.availableModels = []
          form.modelsFetchError = error.message || '获取模型列表失败'
          form.modelsFetchErrorHint = '请手动填写模型名称'
        } finally {
          form.modelsFetching = false
        }
        return
      }

      try {
        const result = await fetchOpenCodeChannelModels(channelId, { forceRefresh })
        if (result.models && result.models.length > 0) {
          form.availableModels = buildModelOptions(result.models)
          if (result.fallbackUsed) {
            form.modelsFetchError = result.error || '无法自动获取模型列表'
            form.modelsFetchErrorHint = result.errorHint || '请手动填写模型名称'
          }
        } else {
          form.availableModels = []
          if (result.error) {
            form.modelsFetchError = result.error
            form.modelsFetchErrorHint = result.errorHint || '请手动填写模型名称'
          }
        }
      } catch (error) {
        form.availableModels = []
        form.modelsFetchError = error.message || '获取模型列表失败'
        form.modelsFetchErrorHint = '请手动填写模型名称'
      } finally {
        form.modelsFetching = false
      }
    },
    testFn: testOpenCodeChannelSpeed,
    api: {
      fetch: async () => {
        const data = await getOpenCodeChannels()
        return data.channels || []
      },
      create: async (form) => {
        const authPayload = buildAuthPayload(form)
        await createOpenCodeChannel(
          form.name,
          form.baseUrl,
          authPayload.apiKey,
          {
            wireApi: form.wireApi || 'openai',
            maxConcurrency: normalizeConcurrency(form.maxConcurrency),
            weight: normalizeWeight(form.weight),
            enabled: form.enabled,
            model: form.model || null,
            gatewaySourceType: form.gatewaySourceType || 'codex',
            modelRedirects: form.modelRedirects || [],
            speedTestModel: form.speedTestModel || null,
            presetId: form.presetId || null,
            websiteUrl: form.websiteUrl || '',
            allowedModels: form.allowedModels || [],
            balanceToken: authPayload.balanceToken,
            balanceUserId: authPayload.balanceUserId
          }
        )
      },
      update: async (channel, form) => {
        const authPayload = buildAuthPayload(form)
        await updateOpenCodeChannel(channel.id, {
          name: form.name,
          baseUrl: form.baseUrl,
          apiKey: authPayload.apiKey,
          wireApi: form.wireApi || 'openai',
          websiteUrl: form.websiteUrl,
          model: form.model || null,
          gatewaySourceType: form.gatewaySourceType || 'codex',
          maxConcurrency: normalizeConcurrency(form.maxConcurrency),
          weight: normalizeWeight(form.weight),
          enabled: form.enabled,
          modelRedirects: form.modelRedirects || [],
          speedTestModel: form.speedTestModel || null,
          presetId: form.presetId || null,
          allowedModels: form.allowedModels || [],
          balanceToken: authPayload.balanceToken,
          balanceUserId: authPayload.balanceUserId
        })
      },
      toggle: async (channel, enabled) => updateOpenCodeChannel(channel.id, { enabled }),
      remove: deleteOpenCodeChannel,
      resetHealth: async (channel) => {
        return resetOpenCodeChannelHealth(channel.id)
      }
    },
    getHeaderTags: (channel, helpers) => {
      const tags = []
      if (channel.health?.status === 'frozen') {
        tags.push({ text: helpers.formatFreeze(channel.health.freezeRemaining), type: 'error' })
      } else if (channel.health?.status === 'checking') {
        tags.push({ text: '检测中', type: 'warning' })
      }
      return tags
    },
    buildInfoRows: (channel, helpers) => ([
      { label: '入口协议', value: formatOpenCodeGatewaySourceType(channel.gatewaySourceType), mono: true },
      { label: 'Wire API', value: channel.wireApi || 'openai', mono: true },
      { label: 'Provider Key', value: channel.providerKey || '(未设置)', mono: true },
      { label: 'Model', value: channel.model || '(默认)', mono: true },
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
  pi: () => ({
    type: 'pi',
    displayName: 'Pi Agent',
    schedulerSource: 'pi',
    storageKeys: {
      localCollapse: 'piChannelCollapse',
      collapseConfigKey: 'pi',
      orderConfigKey: 'pi'
    },
    emptyDescription: '暂无 Pi 渠道',
    showEmptyAction: true,
    emptyActionText: '添加 Pi 渠道',
    modalWidth: 600,
    formLabelWidth: 95,
    showApplyButton: false,
    presets: opencodePresets,
    presetCategories: opencodePresetCategories,
    getPresetById: getOpenCodePresetById,
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
          { key: 'name', label: '渠道名称', type: 'text', required: true, placeholder: '显示名称' },
          {
            key: 'providerKey',
            label: 'Provider Key',
            type: 'text',
            required: true,
            placeholder: 'openai-official',
            validate: validateProviderKey
          },
          {
            key: 'baseUrl',
            label: 'Base URL',
            type: 'text',
            required: true,
            placeholder: 'https://api.example.com/v1',
            validate: (value) => validateHttpUrl('Base URL', value, { required: true })
          },
          {
            key: 'apiKey',
            label: 'API Key',
            type: 'password',
            required: true,
            placeholder: 'sk-...'
          },
          buildBalanceCredentialField(),
          buildBalanceUserIdField(),
          {
            key: 'websiteUrl',
            label: '官网链接',
            type: 'text',
            placeholder: 'https://（选填）',
            validate: (value) => validateHttpUrl('官网链接', value, { required: false })
          },
          {
            key: 'model',
            label: '默认模型',
            type: 'select',
            placeholder: '选择或输入默认模型（留空则由 Pi 决定）',
            options: [],
            clearable: true
          },
          {
            key: 'speedTestModel',
            label: '测速模型',
            type: 'select',
            placeholder: '选择用于测速的模型（留空则使用默认模型）',
            options: [],
            clearable: true
          },
          {
            key: 'allowedModels',
            label: '可用模型',
            type: 'model-multi-select',
            placeholder: '选择注册到 Pi Provider Extension 的模型',
            description: '留空时使用检测到的所有模型；写入受管 extension 的 pi.registerProvider()'
          }
        ]
      },
      {
        title: '模型重定向',
        description: '仅在 coding-tool-x 托管 Provider Extension 启用时用于模型选择提示',
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
      presetId: 'openrouter',
      name: 'OpenRouter',
      providerKey: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      wireApi: 'openai',
      providerApi: 'openai-completions',
      apiKey: '',
      balanceToken: '',
      balanceUserId: null,
      websiteUrl: 'https://openrouter.ai',
      model: '',
      gatewaySourceType: 'codex',
      speedTestModel: '',
      modelRedirects: [],
      allowedModels: [],
      maxConcurrency: null,
      weight: 1,
      enabled: true,
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }),
    mapChannelToForm: (channel) => ({
      presetId: channel.presetId || 'custom',
      name: channel.name || '',
      providerKey: channel.providerKey || channel.provider || channel.name || '',
      baseUrl: channel.baseUrl || '',
      wireApi: channel.wireApi || 'openai',
      providerApi: channel.providerApi || channel.api || 'openai-completions',
      apiKey: channel.apiKey || '',
      balanceToken: channel.balanceToken || '',
      balanceUserId: channel.balanceUserId ?? null,
      websiteUrl: channel.websiteUrl || '',
      model: channel.model || '',
      gatewaySourceType: channel.gatewaySourceType || 'codex',
      speedTestModel: channel.speedTestModel || '',
      modelRedirects: channel.modelRedirects || [],
      allowedModels: channel.allowedModels || [],
      maxConcurrency: channel.maxConcurrency ?? null,
      weight: channel.weight || 1,
      enabled: channel.enabled !== false,
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }),
    onPresetChange: (presetId, form) => {
      const preset = getOpenCodePresetById(presetId)
      if (!preset) return form
      const newForm = { ...form, presetId }
      newForm.name = preset.name
      newForm.providerKey = (preset.id || preset.name || 'provider')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '')
      newForm.baseUrl = preset.baseUrl
      newForm.websiteUrl = preset.websiteUrl || ''
      newForm.wireApi = preset.wireApi || 'openai'
      newForm.providerApi = 'openai-completions'
      newForm.gatewaySourceType = preset.gatewaySourceType || newForm.gatewaySourceType || 'codex'
      return applyPresetAuth(newForm)
    },
    fetchModelsForChannel: async (channelId, form, { forceRefresh = false } = {}) => {
      await loadDefaultModels()
      form.modelsFetching = true
      form.modelsFetchError = null
      form.modelsFetchErrorHint = null
      if (!channelId) {
        if (!form.baseUrl) {
          form.availableModels = []
          form.modelsFetching = false
          return
        }
        try {
          const result = await probePiChannelModels({
            baseUrl: form.baseUrl,
            apiKey: form.apiKey || '',
            gatewaySourceType: form.gatewaySourceType || 'codex'
          })
          form.availableModels = result.models && result.models.length > 0 ? buildModelOptions(result.models) : []
          if (result.error) {
            form.modelsFetchError = result.error
            form.modelsFetchErrorHint = result.errorHint || '请手动填写模型名称'
          }
        } catch (error) {
          form.availableModels = []
          form.modelsFetchError = error.message || '获取模型列表失败'
          form.modelsFetchErrorHint = '请手动填写模型名称'
        } finally {
          form.modelsFetching = false
        }
        return
      }
      try {
        const result = await fetchPiChannelModels(channelId, { forceRefresh })
        form.availableModels = result.models && result.models.length > 0 ? buildModelOptions(result.models) : []
        if (result.error) {
          form.modelsFetchError = result.error
          form.modelsFetchErrorHint = result.errorHint || '请手动填写模型名称'
        }
      } catch (error) {
        form.availableModels = []
        form.modelsFetchError = error.message || '获取模型列表失败'
        form.modelsFetchErrorHint = '请手动填写模型名称'
      } finally {
        form.modelsFetching = false
      }
    },
    testFn: testPiChannelSpeed,
    api: {
      fetch: async () => {
        const data = await getPiChannels()
        return data.channels || []
      },
      create: async (form) => {
        const authPayload = buildAuthPayload(form)
        await createPiChannel(form.name, form.baseUrl, authPayload.apiKey, {
          wireApi: form.wireApi || 'openai',
          providerApi: form.providerApi || 'openai-completions',
          providerKey: form.providerKey,
          maxConcurrency: normalizeConcurrency(form.maxConcurrency),
          weight: normalizeWeight(form.weight),
          enabled: form.enabled,
          model: form.model || null,
          gatewaySourceType: form.gatewaySourceType || 'codex',
          modelRedirects: form.modelRedirects || [],
          speedTestModel: form.speedTestModel || null,
          presetId: form.presetId || null,
          websiteUrl: form.websiteUrl || '',
          allowedModels: form.allowedModels || [],
          balanceToken: authPayload.balanceToken,
          balanceUserId: authPayload.balanceUserId
        })
      },
      update: async (channel, form) => {
        const authPayload = buildAuthPayload(form)
        await updatePiChannel(channel.id, {
          name: form.name,
          providerKey: form.providerKey,
          baseUrl: form.baseUrl,
          apiKey: authPayload.apiKey,
          wireApi: form.wireApi || 'openai',
          providerApi: form.providerApi || 'openai-completions',
          websiteUrl: form.websiteUrl,
          model: form.model || null,
          gatewaySourceType: form.gatewaySourceType || 'codex',
          maxConcurrency: normalizeConcurrency(form.maxConcurrency),
          weight: normalizeWeight(form.weight),
          enabled: form.enabled,
          modelRedirects: form.modelRedirects || [],
          speedTestModel: form.speedTestModel || null,
          presetId: form.presetId || null,
          allowedModels: form.allowedModels || [],
          balanceToken: authPayload.balanceToken,
          balanceUserId: authPayload.balanceUserId
        })
      },
      toggle: async (channel, enabled) => updatePiChannel(channel.id, { enabled }),
      remove: deletePiChannel,
      resetHealth: async (channel) => resetPiChannelHealth(channel.id)
    },
    getHeaderTags: (channel, helpers) => {
      const tags = []
      if (channel.health?.status === 'frozen') {
        tags.push({ text: helpers.formatFreeze(channel.health.freezeRemaining), type: 'error' })
      } else if (channel.health?.status === 'checking') {
        tags.push({ text: '检测中', type: 'warning' })
      }
      return tags
    },
    buildInfoRows: (channel, helpers) => ([
      { label: 'Provider', value: channel.providerKey || channel.provider || '(未设置)', mono: true },
      { label: 'API', value: channel.providerApi || channel.api || 'openai-completions', mono: true },
      { label: 'Model', value: channel.model || '(默认)', mono: true },
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
