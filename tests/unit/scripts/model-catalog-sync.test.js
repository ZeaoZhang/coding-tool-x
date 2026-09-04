'use strict';

const {
  buildSnapshot,
  validateSourcePayload,
  validateSnapshot
} = require('../../../scripts/sync-model-catalog');

const policy = {
  sourceUrl: 'https://models.dev/api.json',
  minimumModelCount: 1,
  providers: {
    openai: {
      runtimeMode: 'direct',
      toolTypes: ['codex', 'opencode', 'omp'],
      modelPatterns: ['^(gpt-|o[134](?:-|$))']
    },
    deepseek: {
      runtimeMode: 'compatible',
      toolTypes: ['opencode', 'omp'],
      modelPatterns: ['^deepseek-']
    }
  }
};

const source = {
  openai: {
    id: 'openai',
    models: {
      'gpt-5.5': {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        family: 'gpt',
        reasoning: true,
        tool_call: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 1050000, output: 128000 },
        cost: { input: 5, output: 30, cache_read: 0.5 }
      },
      'chatgpt-image-latest': {
        id: 'chatgpt-image-latest',
        name: 'ChatGPT Image',
        family: 'image',
        tool_call: false,
        modalities: { input: ['text'], output: ['image'] },
        limit: { context: 128000, output: 1 },
        cost: { input: 1, output: 1 }
      }
    }
  },
  deepseek: {
    id: 'deepseek',
    models: {
      'deepseek-v4-pro': {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        family: 'deepseek-thinking',
        reasoning: true,
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1000000, output: 384000 },
        cost: { input: 0.435, output: 0.87, cache_read: 0.003625 }
      },
      'deepseek-no-price': {
        id: 'deepseek-no-price',
        family: 'deepseek',
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 128000, output: 8192 }
      }
    }
  }
};

describe('model catalog synchronizer contract', () => {
  test('accepts a provider-scoped Models.dev payload', () => {
    expect(() => validateSourcePayload(source)).not.toThrow();
  });

  test('normalizes direct and compatible IDs and maps cost fields', () => {
    const result = buildSnapshot(source, {
      policy,
      previousSnapshot: { aliases: {}, models: {} },
      updatedAt: '2026-09-04'
    });

    expect(result.snapshot.models['gpt-5.5']).toMatchObject({
      sourceId: 'openai/gpt-5.5',
      provider: 'openai',
      toolTypes: ['codex', 'opencode', 'omp'],
      pricing: { input: 5, output: 30, cacheRead: 0.5 }
    });
    expect(result.snapshot.models['deepseek/deepseek-v4-pro']).toMatchObject({
      sourceId: 'deepseek/deepseek-v4-pro',
      provider: 'deepseek',
      toolTypes: ['opencode', 'omp']
    });
    expect(result.snapshot.aliases['deepseek-v4-pro']).toBe('deepseek/deepseek-v4-pro');
  });

  test('preserves legacy runtime fields when the source omits them', () => {
    const result = buildSnapshot(source, {
      policy,
      previousSnapshot: {
        aliases: {},
        models: {
          'gpt-5.5': {
            id: 'gpt-5.5',
            limit: { context: 1050000, output: 128000 },
            pricing: { input: 5, output: 30, cacheRead: 0.5 },
            thinking: {
              mode: 'effort',
              efforts: ['low', 'medium', 'high', 'xhigh'],
              defaultLevel: 'medium'
            }
          }
        }
      },
      updatedAt: '2026-09-04'
    });

    expect(result.snapshot.models['gpt-5.5'].thinking).toEqual({
      mode: 'effort',
      efforts: ['low', 'medium', 'high', 'xhigh'],
      defaultLevel: 'medium'
    });
  });

  test('excludes non-text and unpriced entries and reports them', () => {
    const result = buildSnapshot(source, {
      policy,
      previousSnapshot: { aliases: {}, models: {} },
      updatedAt: '2026-09-04'
    });

    expect(result.snapshot.models).not.toHaveProperty('chatgpt-image-latest');
    expect(result.snapshot.models).not.toHaveProperty('deepseek/deepseek-no-price');
    expect(result.warnings.join('\n')).toMatch(/chatgpt-image-latest|deepseek-no-price/);
  });

  test('preserves an existing model omitted by the source', () => {
    const previousSnapshot = {
      aliases: {},
      defaultModels: { claude: [], codex: [], gemini: [] },
      models: {
        'legacy-model': {
          limit: { context: 8192, output: 1024 },
          pricing: { input: 1, output: 2 }
        }
      }
    };
    const result = buildSnapshot(source, {
      policy,
      previousSnapshot,
      updatedAt: '2026-09-04'
    });

    expect(result.snapshot.models['legacy-model']).toEqual(previousSnapshot.models['legacy-model']);
    expect(result.changes.removed).toContain('legacy-model');
  });

  test('reports price and limit changes deterministically', () => {
    const previousSnapshot = {
      aliases: {},
      models: {
        'gpt-5.5': {
          sourceId: 'openai/gpt-5.5',
          limit: { context: 500000, output: 64000 },
          pricing: { input: 4, output: 20 }
        }
      }
    };
    const result = buildSnapshot(source, {
      policy,
      previousSnapshot,
      updatedAt: '2026-09-04'
    });

    expect(result.changes.updated).toContain('gpt-5.5');
    expect(result.changes.priceChanged).toContain('gpt-5.5');
    expect(result.changes.limitChanged).toContain('gpt-5.5');
    expect(result.snapshot.models['gpt-5.5'].limit).toEqual({ context: 1050000, output: 128000 });
    expect(result.snapshot.models['gpt-5.5'].pricing.input).toBe(5);
  });

  test('keeps the previous snapshot date when normalized content is unchanged', () => {
    const first = buildSnapshot(source, {
      policy,
      previousSnapshot: { aliases: {}, models: {} },
      updatedAt: '2026-09-04'
    }).snapshot;
    const second = buildSnapshot(source, {
      policy,
      previousSnapshot: first,
      updatedAt: '2026-09-05'
    }).snapshot;

    expect(second.lastUpdated).toBe('2026-09-04');
  });

  test('rejects duplicate runtime IDs and abnormal result sizes', () => {
    const duplicatePolicy = {
      ...policy,
      providers: {
        ...policy.providers,
        mirror: {
          runtimeMode: 'direct',
          toolTypes: ['codex'],
          modelPatterns: ['^gpt-']
        }
      }
    };
    const duplicateSource = {
      ...source,
      mirror: {
        models: {
          'gpt-5.5': { ...source.openai.models['gpt-5.5'], id: 'gpt-5.5' }
        }
      }
    };
    expect(() => buildSnapshot(duplicateSource, {
      policy: duplicatePolicy,
      previousSnapshot: { aliases: {}, models: {} },
      updatedAt: '2026-09-04'
    })).toThrow(/duplicate runtime model id/i);

    expect(() => validateSnapshot({ models: {} }, {
      selectedCount: 0,
      previousCount: 4,
      minimumModelCount: 1
    })).toThrow(/empty|abnormal/i);
  });

  test('filters negative prices and invalid limits with a warning', () => {
    const invalidSource = {
      ...source,
      openai: {
        ...source.openai,
        models: {
          ...source.openai.models,
          'gpt-invalid': {
            id: 'gpt-invalid',
            modalities: { input: ['text'], output: ['text'] },
            limit: { context: -1, output: 1 },
            cost: { input: -1, output: 1 }
          }
        }
      }
    };
    const result = buildSnapshot(invalidSource, {
      policy,
      previousSnapshot: { aliases: {}, models: {} },
      updatedAt: '2026-09-04'
    });
    expect(result.snapshot.models).not.toHaveProperty('gpt-invalid');
    expect(result.warnings.join('\n')).toMatch(/gpt-invalid|limit|cost/i);
  });

  test('rejects an invalid or empty upstream payload', () => {
    expect(() => validateSourcePayload({})).toThrow(/provider models/i);
    expect(() => validateSourcePayload({ openai: { models: [] } })).toThrow(/models must be an object/i);
    expect(() => validateSourcePayload({
      openai: { models: { invalid: { id: '' } } }
    })).toThrow(/model id/i);
  });
});
