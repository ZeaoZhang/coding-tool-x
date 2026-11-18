'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const nativeConfig = require('../../../../src/platforms/drivers/opencode/native-config-implementation');

describe('OpenCode native config model metadata', () => {
  let configDir;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-opencode-'));
    nativeConfig.configure({
      pathContext: { customized: true, native: { config: configDir } }
    });
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function writeChannel(definitions, extras = {}) {
    const model = extras.model || definitions[0].id;
    nativeConfig.setChannelConfig({
      name: 'Metadata channel',
      providerKey: 'metadata',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'sk-test',
      ...extras,
      model,
      models: definitions
    });
    return nativeConfig.readConfig(nativeConfig.selectConfigPath())
      .provider.metadata.models[model];
  }

  test('writes explicit context window, reasoning and input modalities', () => {
    const entry = writeChannel([{
      id: 'custom-model',
      contextWindow: 64000,
      maxTokens: 8192,
      reasoning: true,
      input: ['text', 'image']
    }]);

    expect(entry).toEqual(expect.objectContaining({
      limit: { context: 64000, output: 8192 },
      reasoning: true,
      modalities: { input: ['text', 'image'] }
    }));
  });

  test('falls back to Models.dev metadata for known models', () => {
    const entry = writeChannel([{ id: 'gpt-5.4' }]);

    expect(entry.limit).toEqual({ context: 1050000, output: 128000 });
    expect(entry.reasoning).toBe(true);
    expect(entry.modalities.input).toEqual(expect.arrayContaining(['text', 'image']));
  });

  test('omits limit unless both context and output are known', () => {
    const entry = writeChannel([{ id: 'unknown-model-metadata', contextWindow: 32000 }]);

    expect(entry).toEqual({ name: 'unknown-model-metadata' });
  });

  test('drops fractional token limits that the native schemas reject', () => {
    const entry = writeChannel([{
      id: 'unknown-model-fractional',
      contextWindow: 32000.5,
      maxTokens: 4096.5
    }]);

    expect(entry).toEqual({ name: 'unknown-model-fractional' });
  });
});
