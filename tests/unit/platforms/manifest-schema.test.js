'use strict';

const { validateManifest, normalizeManifestError } = require('../../../src/platforms/manifest-schema');
const { BUILT_IN_MANIFESTS } = require('../../../src/platforms/registry');

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

test('accepts project resource metadata with safe relative paths', () => {
  const result = validateManifest({
    key: 'demo-cli',
    label: 'Demo CLI',
    command: 'demo',
    projectResources: {
      instruction: { path: 'AGENTS.md' },
      skills: { canonicalRoot: '.agents/skills', readRoots: ['.agents/skills'] },
      mcp: { path: '.codex/config.toml', format: 'codex-toml' }
    },
    capabilities: {}
  });

  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
});

test('rejects malformed project resource metadata', () => {
  const result = validateManifest({
    key: 'unsafe-cli',
    label: 'Unsafe CLI',
    command: 'unsafe',
    projectResources: {
      instruction: { path: '../AGENTS.md' },
      skills: { canonicalRoot: '.agents/skills', readRoots: ['.agents/skills'] },
      mcp: { path: '.mcp.json', format: 'unknown-format' }
    },
    capabilities: {}
  });

  expect(result.valid).toBe(false);
  expect(normalizeManifestError(result.errors)).toContain('projectResources');
});

test('validates per-scope Skill activation modes and native formats', () => {
  const valid = validateManifest({
    key: 'skill-cli',
    label: 'Skill CLI',
    command: 'skill',
    skillActivation: {
      user: { mode: 'native-copy', format: 'demo-skill-v1' },
      project: { mode: 'unsupported', format: null }
    },
    capabilities: {}
  });
  expect(valid.valid).toBe(true);

  const invalid = validateManifest({
    key: 'skill-cli',
    label: 'Skill CLI',
    command: 'skill',
    skillActivation: {
      user: { mode: 'unknown-mode', format: 'demo-skill-v1' },
      project: { mode: 'native-copy', format: 'unknown-format' }
    },
    capabilities: {}
  });
  expect(invalid.valid).toBe(false);
  expect(normalizeManifestError(invalid.errors)).toContain('skillActivation');
});
test('validates manifest API route descriptors and declared capabilities', () => {
  const base = {
    key: 'demo-cli',
    label: 'Demo CLI',
    command: 'demo',
    capabilities: { projects: 'legacy:claude' },
    api: {
      prefix: 'demo',
      routes: [{
        path: '/projects',
        method: 'GET',
        capability: 'projects',
        operation: 'listProjects',
        request: 'projects-list',
        response: 'projects-list'
      }]
    }
  };

  expect(validateManifest(base)).toMatchObject({ valid: true, errors: [] });
  expect(validateManifest({
    ...base,
    api: {
      ...base.api,
      routes: [{ ...base.api.routes[0], capability: 'sessions' }]
    }
  }).valid).toBe(false);
  expect(validateManifest({
    ...base,
    api: {
      ...base.api,
      routes: [
        base.api.routes[0],
        { ...base.api.routes[0] }
      ]
    }
  }).valid).toBe(false);
});

test('rejects route operations outside the capability contract', () => {
  const result = validateManifest({
    key: 'demo-cli',
    label: 'Demo CLI',
    command: 'demo',
    capabilities: { sessions: 'legacy:claude' },
    api: {
      prefix: 'demo',
      routes: [{
        path: '/sessions',
        method: 'GET',
        capability: 'sessions',
        operation: 'notAnOperation',
        request: 'default',
        response: 'default'
      }]
    }
  });

  expect(result.valid).toBe(false);
  expect(normalizeManifestError(result.errors)).toContain('/api/routes/0/operation');
});

test('rejects unknown named request and response codecs', () => {
  const base = {
    key: 'demo-cli',
    label: 'Demo CLI',
    command: 'demo',
    capabilities: { projects: 'legacy:claude' },
    api: {
      prefix: 'demo',
      routes: [{
        path: '/projects',
        method: 'GET',
        capability: 'projects',
        operation: 'listProjects',
        request: 'missing-codec',
        response: 'projects-list'
      }]
    }
  };

  const requestResult = validateManifest(base);
  const responseResult = validateManifest({
    ...base,
    api: {
      ...base.api,
      routes: [{ ...base.api.routes[0], request: 'default', response: 'missing-codec' }]
    }
  });

  expect(requestResult.valid).toBe(false);
  expect(normalizeManifestError(requestResult.errors)).toContain('/api/routes/0/request');
  expect(responseResult.valid).toBe(false);
  expect(normalizeManifestError(responseResult.errors)).toContain('/api/routes/0/response');
});

test('keeps every built-in route operation within the declared contract', () => {
  for (const manifest of BUILT_IN_MANIFESTS) {
    expect(validateManifest(manifest)).toMatchObject({ valid: true, errors: [] });
  }
});
