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
      warnings: []
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
      gatewaySourceType: 'codex',
      availableModels: [],
      modelsFetching: false,
      modelsFetchError: null,
      modelsFetchErrorHint: null
    }

    await channelPanelFactories.opencode().fetchModelsForChannel('', form)

    expect(form.availableModels).toEqual([
      { label: 'deepseek/deepseek-v4-pro', value: 'deepseek/deepseek-v4-pro' },
      { label: 'gpt-5.5', value: 'gpt-5.5' }
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
  })
})
