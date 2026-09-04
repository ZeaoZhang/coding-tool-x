import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAllModelsFromMetadata, useDefaultModels } from '../useDefaultModels'

describe('useDefaultModels', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('groups catalog entries by explicit toolTypes instead of model prefixes', () => {
    const models = {
      'deepseek/deepseek-v4-pro': {
        id: 'deepseek/deepseek-v4-pro',
        provider: 'deepseek',
        toolTypes: ['opencode', 'omp'],
        limit: { context: 1000000, output: 384000 },
        pricing: { input: 0.435, output: 0.87 }
      },
      'gpt-5.5': {
        id: 'gpt-5.5',
        toolTypes: ['codex', 'opencode', 'omp'],
        limit: { context: 1000000, output: 128000 },
        pricing: { input: 5, output: 30 }
      }
    }

    const grouped = buildAllModelsFromMetadata(models, {
      claude: [],
      codex: ['gpt-5.5'],
      gemini: [],
      opencode: ['deepseek/deepseek-v4-pro', 'gpt-5.5'],
      omp: ['deepseek/deepseek-v4-pro', 'gpt-5.5']
    })

    expect(grouped.opencode).toEqual(['deepseek/deepseek-v4-pro', 'gpt-5.5'])
    expect(grouped.omp).toEqual(['deepseek/deepseek-v4-pro', 'gpt-5.5'])
    expect(grouped.claude).toEqual([])
  })

  it('loads dynamic tool groups from model-settings', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ defaultModels: { claude: [], codex: [], gemini: [] } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: {
            'deepseek/deepseek-v4-pro': {
              id: 'deepseek/deepseek-v4-pro',
              toolTypes: ['opencode', 'omp'],
              limit: { context: 1000000, output: 384000 },
              pricing: { input: 0.435, output: 0.87 }
            }
          },
          toolModels: {
            claude: [],
            codex: [],
            gemini: [],
            opencode: ['deepseek/deepseek-v4-pro'],
            omp: ['deepseek/deepseek-v4-pro']
          }
        })
      }))

    const { loadDefaultModels, getAllModelsByToolType, getDefaultModels } = useDefaultModels()
    await loadDefaultModels({ forceRefresh: true })

    expect(getAllModelsByToolType('opencode')).toContain('deepseek/deepseek-v4-pro')
    expect(getAllModelsByToolType('omp')).toContain('deepseek/deepseek-v4-pro')
    expect(getDefaultModels('omp')).toContain('deepseek/deepseek-v4-pro')
  })

  it('clears the refresh cache after a completed load', async () => {
    const fetchMock = vi.fn((url) => Promise.resolve({
      ok: true,
      json: async () => String(url).includes('/api/config/')
        ? { defaultModels: { claude: [], codex: [], gemini: [] } }
        : { models: {}, toolModels: {} }
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { loadDefaultModels, loading } = useDefaultModels()
    await loadDefaultModels({ forceRefresh: true })
    await loadDefaultModels({ forceRefresh: true })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(loading.value).toBe(false)
  })
})
