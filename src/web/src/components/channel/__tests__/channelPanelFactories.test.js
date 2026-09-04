import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  fetchOmpCatalogMetadata,
  fetchOmpChannelModels,
  fetchOpenCodeChannelModels,
  getAllModelsByToolType,
  loadDefaultModels,
  probeOmpChannelModels,
  probeOpenCodeChannelModels
} = vi.hoisted(() => ({
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
})
