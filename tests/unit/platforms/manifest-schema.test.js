'use strict';

const { validateManifest, normalizeManifestError } = require('../../../src/platforms/manifest-schema');

test('accepts a valid generic platform manifest', () => {
  const result = validateManifest({
    key: 'demo-cli',
    label: 'Demo CLI',
    command: 'demo',
    iconToken: 'terminal',
    paths: { home: '~/.demo', sessions: '{home}/sessions' },
    capabilities: { sessions: 'generic-jsonl' }
  });

  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
});

test('accepts sessionGlob but still rejects unknown manifest fields', () => {
  const withGlob = validateManifest({
    key: 'demo-cli',
    label: 'Demo CLI',
    command: 'demo',
    paths: { sessions: '{home}/sessions' },
    sessionGlob: 'session-*.jsonl',
    capabilities: { sessions: 'generic-jsonl' }
  });

  expect(withGlob.valid).toBe(true);
  expect(withGlob.errors).toEqual([]);

  const withUnknown = validateManifest({
    key: 'demo-cli',
    label: 'Demo CLI',
    command: 'demo',
    paths: { sessions: '{home}/sessions' },
    sessionGlob: 'session-*.jsonl',
    arbitraryGlobRunner: true,
    capabilities: { sessions: 'generic-jsonl' }
  });

  expect(withUnknown.valid).toBe(false);
  expect(normalizeManifestError(withUnknown.errors)).toContain('arbitraryGlobRunner');
});

test('rejects OpenAI-compatible transport as a proxy lifecycle driver', () => {
  const result = validateManifest({
    key: 'proxy-cli',
    label: 'Proxy CLI',
    command: 'proxy-cli',
    capabilities: { proxy: 'generic-openai-compatible' }
  });

  expect(result.valid).toBe(false);
  expect(normalizeManifestError(result.errors)).toContain('only supports channels');
});

test('rejects generic drivers assigned to incompatible capabilities', () => {
  const cases = [
    ['sessions', 'generic-filesystem'],
    ['resourceSync', 'generic-jsonl'],
    ['proxy', 'generic-openai-compatible']
  ];
  for (const [capability, driver] of cases) {
    const result = validateManifest({ key: `bad-${capability}`, label: 'Bad', command: 'bad', capabilities: { [capability]: driver } });
    expect(result.valid).toBe(false);
    expect(normalizeManifestError(result.errors)).toContain('only supports');
  }
});
test('requires fixed mappings for generic MCP and prompt drivers', () => {
  const base = { key: 'demo-cli', label: 'Demo', command: 'demo' };
  for (const manifest of [
    { ...base, mcpFormat: 'json', capabilities: { mcp: 'generic-mcp' } },
    { ...base, capabilities: { prompts: 'generic-prompt' } },
    { ...base, promptFile: '', capabilities: { prompts: 'generic-prompt' } },
    { ...base, resourceMappings: { prompts: '' }, capabilities: { prompts: 'generic-prompt' } },
    { ...base, resourceMappings: { mcp: '' }, mcpFormat: 'json', capabilities: { mcp: 'generic-mcp' } }
  ]) {
    expect(validateManifest(manifest).valid).toBe(false);
  }

  expect(validateManifest({
    ...base,
    mcpFormat: 'json',
    resourceMappings: { mcp: '{home}/mcp.json' },
    capabilities: { mcp: 'generic-mcp' }
  }).valid).toBe(true);
  expect(validateManifest({
    ...base,
    promptFile: 'PROMPT.md',
    capabilities: { prompts: 'generic-prompt' }
  }).valid).toBe(true);
});

test('rejects executable module paths and unknown drivers', () => {
  const result = validateManifest({
    key: 'bad-cli',
    label: 'Bad',
    command: 'bad',
    driverModule: '/tmp/driver.js',
    capabilities: { sessions: 'user-code' }
  });

  expect(result.valid).toBe(false);
  expect(normalizeManifestError(result.errors)).toContain('driver');
});

test('rejects duplicate or malformed platform keys', () => {
  const result = validateManifest({
    key: 'Bad Key',
    label: 'Bad',
    command: 'bad',
    capabilities: {}
  });

  expect(result.valid).toBe(false);
  expect(normalizeManifestError(result.errors)).toContain('key');
});
