import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  fetchClaudeChannels,
  fetchCodexChannels,
  fetchGeminiChannels,
  fetchOpenCodeChannels,
  fetchOmpChannels,
  fetchOmpCatalogMetadata,
  fetchOmpChannelModels,
  fetchOpenCodeChannelModels,
  getAllModelsByToolType,
  loadDefaultModels,
  probeOmpChannelModels,
  probeOpenCodeChannelModels
} = vi.hoisted(() => ({
  fetchClaudeChannels: vi.fn(),
  fetchCodexChannels: vi.fn(),
  fetchGeminiChannels: vi.fn(),
  fetchOpenCodeChannels: vi.fn(),
  fetchOmpChannels: vi.fn(),
  fetchOmpCatalogMetadata: vi.fn(),
  fetchOmpChannelModels: vi.fn(),
  fetchOpenCodeChannelModels: vi.fn(),
  getAllModelsByToolType: vi.fn(),
  loadDefaultModels: vi.fn(),
  probeOmpChannelModels: vi.fn(),
  probeOpenCodeChannelModels: vi.fn()
}))

vi.mock('../../../api/channels', async () => ({
  ...(await vi.importActual('../../../api/channels')),
  getChannels: fetchClaudeChannels,
  getCodexChannels: fetchCodexChannels,
  getGeminiChannels: fetchGeminiChannels,
  getOpenCodeChannels: fetchOpenCodeChannels,
  getOmpChannels: fetchOmpChannels,
  fetchOmpCatalogMetadata,
  fetchOmpChannelModels,
  fetchOpenCodeChannelModels,
  probeOmpChannelModels,
  probeOpenCodeChannelModels
}))

vi.mock('../../../composables/useDefaultModels.js', () => ({
  useDefaultModels: () => ({ getAllModelsByToolType, loadDefaultModels })
}))

import channelPanelFactories from '../channelPanelFactories'

describe('channel panel model catalogs', () => {
  beforeEach(() => {
    loadDefaultModels.mockReset().mockResolvedValue(undefined)
    fetchClaudeChannels.mockReset().mockResolvedValue([{ id: 'claude-1' }])
    fetchCodexChannels.mockReset().mockResolvedValue([{ id: 'codex-1' }])
    fetchOmpChannels.mockReset().mockResolvedValue([{ id: 'omp-1' }])
    fetchGeminiChannels.mockReset().mockResolvedValue([{ id: 'gemini-1' }])
    fetchOpenCodeChannels.mockReset().mockResolvedValue([{ id: 'opencode-1' }])
    getAllModelsByToolType.mockImplementation(toolType => ({
      codex: ['gpt-5.5'],
      opencode: ['deepseek/deepseek-v4-pro'],
      omp: ['deepseek/deepseek-v4-pro']
    }[toolType] || []))
    fetchOmpCatalogMetadata.mockReset().mockResolvedValue({
      models: [{ id: 'deepseek/deepseek-v4-pro', limit: { context: 1000000, output: 384000 } }],
      warnings: [],
      source: { name: 'models.dev' }
    })
    fetchOmpChannelModels.mockReset()
    fetchOpenCodeChannelModels.mockReset()
    probeOmpChannelModels.mockReset()
    probeOpenCodeChannelModels.mockReset()
  })
  it('keeps array channel responses from the platform API', async () => {
    const cases = [
      ['claude', fetchClaudeChannels],
      ['codex', fetchCodexChannels],
      ['gemini', fetchGeminiChannels],
      ['opencode', fetchOpenCodeChannels]
    ]

    for (const [platform, fetchMock] of cases) {
      await expect(channelPanelFactories[platform]().api.fetch()).resolves.toEqual([
        { id: `${platform}-1` }
      ])
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })
  it('normalizes array responses for OMP while preserving auth metadata', async () => {
    await expect(channelPanelFactories.omp().api.fetch()).resolves.toEqual({
      channels: [{ id: 'omp-1' }],
      authProviderMeta: null
    })
    expect(fetchOmpChannels).toHaveBeenCalledTimes(1)
  })



  it('uses the offline snapshot for OpenCode when no base URL is configured', async () => {
    const form = {
      presetId: 'openrouter',
      baseUrl: '',
      gatewaySourceType: 'openai_compatible',
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }

    await channelPanelFactories.opencode().fetchModelsForChannel('', form)

    expect(form.availableModels).toEqual([
      { label: 'deepseek/deepseek-v4-pro', value: 'deepseek/deepseek-v4-pro' }
    ])
    expect(probeOpenCodeChannelModels).not.toHaveBeenCalled()
  })

  it('uses the offline snapshot for OMP when no base URL is configured', async () => {
    const form = {
      baseUrl: '',
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }

    await channelPanelFactories.omp().fetchModelsForChannel('', form)

    expect(form.availableModels).toEqual([
      { label: 'deepseek/deepseek-v4-pro', value: 'deepseek/deepseek-v4-pro' }
    ])
    expect(probeOmpChannelModels).not.toHaveBeenCalled()
  })

  it('keeps the offline OMP catalog when a live probe returns no models', async () => {
    fetchOmpChannelModels.mockResolvedValue({ models: [] })
    const form = {
      baseUrl: 'http://127.0.0.1:20092',
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }

    await channelPanelFactories.omp().fetchModelsForChannel('channel-id', form)

    expect(form.availableModels).toEqual([
      { label: 'deepseek/deepseek-v4-pro', value: 'deepseek/deepseek-v4-pro' }
    ])
    expect(form.modelsFetchError).toBe('无法自动获取模型列表')
    expect(form.modelsFetchErrorHint).toBe('已使用 Models.dev 离线模型列表')
  })

  it('allows OMP metadata lookup without a provider key', async () => {
    const form = {
      providerKey: '',
      model: '',
      speedTestModel: '',
      allowedModels: [],
      modelDefinitionsJson: '[]'
    }

    await channelPanelFactories.omp().fetchModelMetadataForChannel(form)

    expect(fetchOmpCatalogMetadata).toHaveBeenCalledWith('', expect.any(Object))
    expect(form.modelDefinitionsJson).toContain('deepseek/deepseek-v4-pro')
    expect(form.modelMetadataStatus).toBe('已读取 1 个模型（Models.dev 离线快照）')
  })

  it('uses presets to select OAuth and hides API-only fields', () => {
    const cases = [
      ['claude', 'claude_oauth'],
      ['codex', 'codex_oauth'],
      ['gemini', 'gemini_oauth']
    ]

    for (const [platform, presetId] of cases) {
      const config = channelPanelFactories[platform]()
      const fields = config.formSections.flatMap(section => section.fields)
      const oauthField = fields.find(field => field.type === 'channel-auth')
      const oauthPreset = config.getPresetById(presetId)
      const form = config.onPresetChange(presetId, config.getInitialForm())

      expect(fields.some(field => field.label === '认证方式')).toBe(false)
      expect(oauthPreset).toEqual(expect.objectContaining({
        id: presetId,
        authMode: 'oauth',
        oauthProviderId: platform
      }))
      expect(form).toEqual(expect.objectContaining({
        presetId,
        authMode: 'oauth',
        baseUrl: '',
        apiKey: ''
      }))
      expect(oauthField?.showWhen(form)).toBe(true)

      for (const field of fields.filter(item => ['baseUrl', 'apiKey', 'providerKey', 'websiteUrl', 'speedTestModel'].includes(item.key))) {
        expect(field.showWhen(form)).toBe(false)
      }
    }
  })
})
