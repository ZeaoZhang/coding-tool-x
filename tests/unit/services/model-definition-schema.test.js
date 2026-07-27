'use strict';

const {
  MODEL_SCHEMA_VERSION,
  getPublicModelFieldSchema,
  normalizeModelSpec,
  normalizeCatalogModelList,
  normalizeProviderConfig,
  redactSensitiveFields,
  resolveModelDefinition,
  serializeModelSelector,
  splitModelSelector,
  validateModelDefinitions
} = require('../../../src/server/services/model-definition-schema');

describe('model-definition-schema', () => {
  test('separates OMP thinking selectors from the base model id', () => {
    expect(splitModelSelector('gpt-5.5:high')).toEqual({ modelId: 'gpt-5.5', thinkingLevel: 'high' });
    expect(splitModelSelector('openrouter/model:free')).toEqual({ modelId: 'openrouter/model:free', thinkingLevel: null });
    expect(serializeModelSelector('gpt-5.5:low', 'off')).toBe('gpt-5.5:off');
  });

  test('does not invent capabilities or limits for an unknown model', () => {
    const { spec } = normalizeModelSpec({ id: 'future-model' });
    expect(spec).toEqual({ id: 'future-model' });
    expect(spec).not.toHaveProperty('reasoning');
    expect(spec).not.toHaveProperty('contextWindow');
    expect(spec).not.toHaveProperty('maxTokens');
    expect(spec).not.toHaveProperty('cost');
  });

  test('completes the OMP cost object only when pricing metadata exists', () => {
    expect(normalizeModelSpec({ id: 'priced', pricing: { input: 5, output: 30, cacheRead: 0.5 } }).spec.cost)
      .toEqual({ input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 });
    expect(normalizeModelSpec({ id: 'unknown' }).spec.cost).toBeUndefined();
  });

  test('normalizes the complete supported model shape', () => {
    const { spec, warnings } = normalizeModelSpec({
      id: 'future-model',
      api: 'openai-responses',
      reasoning: true,
      thinking: { mode: 'effort', efforts: ['low', 'high'], defaultLevel: 'high' },
      input: ['text', 'image'],
      supportsTools: true,
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
      contextWindow: 500000,
      maxTokens: 64000,
      omitMaxOutputTokens: false,
      compat: {
        supportsDeveloperRole: true,
        maxTokensField: 'max_completion_tokens',
        extraBody: { service_tier: 'flex' }
      },
      remoteCompaction: { enabled: true, endpoint: '/compact' }
    });

    expect(warnings).toEqual([]);
    expect(spec).toEqual(expect.objectContaining({
      id: 'future-model',
      api: 'openai-responses',
      reasoning: true,
      supportsTools: true,
      contextWindow: 500000,
      maxTokens: 64000
    }));
    expect(spec.compat.extraBody).toEqual({ service_tier: 'flex' });
    expect(spec.remoteCompaction).toEqual({ enabled: true, endpoint: '/compact' });
  });

  test('applies catalog and builtin metadata only below explicit overrides', () => {
    const resolved = resolveModelDefinition({
      id: 'gpt-5.5',
      metadataMode: 'hybrid',
      overrides: { maxTokens: 32768 }
    }, {
      builtin: { id: 'gpt-5.5', contextWindow: 1050000, maxTokens: 128000 },
      catalog: { id: 'gpt-5.5', reasoning: true, maxTokens: 64000 }
    });

    expect(resolved.spec).toEqual(expect.objectContaining({
      id: 'gpt-5.5',
      contextWindow: 1050000,
      reasoning: true,
      maxTokens: 32768
    }));
    expect(resolved.provenance.maxTokens).toBe('explicit');
    expect(resolved.provenance.contextWindow).toBe('builtin');
    expect(resolved.provenance.reasoning).toBe('omp-catalog');
  });

  test('preserves unknown future fields outside the OMP write shape', () => {
    const resolved = resolveModelDefinition({
      id: 'future-model',
      futureCapability: { level: 2 },
      compat: { futureTransportFlag: true }
    });
    expect(resolved.spec).not.toHaveProperty('futureCapability');
    expect(resolved.spec.compat).toBeUndefined();
    expect(resolved.passthrough).toEqual({
      futureCapability: { level: 2 },
      compat: { futureTransportFlag: true }
    });
    expect(resolved.warnings).toContain('compat.futureTransportFlag is not supported by the current coding-tool-x schema');
  });

  test('exposes a versioned field schema and validates duplicate ids', () => {
    const schema = getPublicModelFieldSchema();
    expect(schema.schemaVersion).toBe(MODEL_SCHEMA_VERSION);
    expect(schema.modelFields.compat.type).toBe('compat');
    expect(schema.compatFields.supportsReasoningEffort).toBe('boolean');
    expect(validateModelDefinitions([{ id: 'a' }, { id: 'A' }])).toEqual(expect.objectContaining({
      valid: false,
      error: 'duplicate model id: A'
    }));
    expect(validateModelDefinitions([{ id: 'future', contextWindow: -1 }])).toEqual(expect.objectContaining({
      valid: false,
      error: 'future: contextWindow has an invalid value'
    }));
  });

  test('normalizes provider-level parameters separately from model fields', () => {
    const result = normalizeProviderConfig({
      compat: { supportsStrictMode: true },
      discovery: 'openai-models-list',
      modelOverrides: { model: { maxTokens: 1000 } },
      disableStrictTools: false,
      transport: 'pi-native',
      futureProviderField: true
    });
    expect(result.config).toEqual({
      compat: { supportsStrictMode: true },
      discovery: 'openai-models-list',
      modelOverrides: { model: { maxTokens: 1000 } },
      disableStrictTools: false,
      transport: 'pi-native'
    });
    expect(result.passthrough).toEqual({ futureProviderField: true });
  });

  test('redacts headers and secret-like keys in public metadata responses', () => {
    expect(redactSensitiveFields({
      headers: { Authorization: 'Bearer secret', 'X-Trace': 'safe-but-private' },
      extraBody: {
        api_key: 'secret',
        accessToken: 'secret',
        service_tier: 'flex',
        maxTokens: 1048576,
        maxTokensField: 'max_completion_tokens'
      }
    })).toEqual({
      headers: { Authorization: '[redacted]', 'X-Trace': '[redacted]' },
      extraBody: {
        api_key: '[redacted]',
        accessToken: '[redacted]',
        service_tier: 'flex',
        maxTokens: 1048576,
        maxTokensField: 'max_completion_tokens'
      }
    });
  });

  test('keeps token-limit metadata visible while redacting credentials', () => {
    const model = redactSensitiveFields({
      id: 'deepseek-v4-flash',
      maxTokens: 1048576,
      compat: { maxTokensField: 'max_tokens' },
      apiKey: 'secret',
      bearerToken: 'secret'
    });

    expect(model).toEqual({
      id: 'deepseek-v4-flash',
      maxTokens: 1048576,
      compat: { maxTokensField: 'max_tokens' },
      apiKey: '[redacted]',
      bearerToken: '[redacted]'
    });
    expect(validateModelDefinitions([model])).toEqual(expect.objectContaining({ valid: true }));
  });

  test('deduplicates selector-suffixed catalog entries and prefers the base model metadata', () => {
    const result = normalizeCatalogModelList([
      { id: 'gpt-5.5', reasoning: true, contextWindow: 1050000, maxTokens: 128000 },
      { id: 'gpt-5.5:high', reasoning: false, contextWindow: 128000, maxTokens: 4096 }
    ]);
    expect(result.models).toEqual([{
      id: 'gpt-5.5',
      reasoning: true,
      contextWindow: 1050000,
      maxTokens: 128000
    }]);
  });
});
