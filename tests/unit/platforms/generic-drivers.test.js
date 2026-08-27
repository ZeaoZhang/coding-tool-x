'use strict';

const fs = require('fs');
const path = require('path');

const { createDriverRegistry } = require('../../../src/platforms/driver-registry');
const { createUnsupportedDriver } = require('../../../src/platforms/drivers/unsupported');
const { createGenericJsonlDriver } = require('../../../src/platforms/drivers/generic-jsonl');
const { createGenericFilesystemDriver } = require('../../../src/platforms/drivers/generic-filesystem');
const { createGenericOpenAICompatibleDriver } = require('../../../src/platforms/drivers/generic-openai-compatible');

function makeRegistry(drivers = {}) {
  return createDriverRegistry({
    drivers: {
      'generic-jsonl': createGenericJsonlDriver,
      'generic-filesystem': createGenericFilesystemDriver,
      'generic-openai-compatible': createGenericOpenAICompatibleDriver,
      unsupported: createUnsupportedDriver,
      ...drivers
    }
  });
}

function makeJsonlDriver(fsImpl, manifest = {}) {
  return makeRegistry().create('generic-jsonl', {
    platform: 'demo-cli',
    manifest: {
      paths: { sessions: '/tmp/demo/sessions' },
      sessionMapping: { messages: 'messages' },
      ...manifest
    },
    fsImpl
  });
}

describe('driver registry', () => {
  test('lazily creates registered drivers with invocation context', () => {
    const factory = vi.fn(context => ({ status: 'ok', context }));
    const registry = makeRegistry({ 'lazy:test': factory });

    expect(factory).not.toHaveBeenCalled();
    expect(registry.has('lazy:test')).toBe(true);
    expect(registry.ids()).toContain('lazy:test');

    const driver = registry.create('lazy:test', { platform: 'demo-cli', capability: 'sessions' });

    expect(driver).toEqual({ status: 'ok', context: { platform: 'demo-cli', capability: 'sessions' } });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  test('rejects invalid registrations and unknown drivers', () => {
    const registry = makeRegistry();

    expect(() => registry.register('Bad Driver', () => null)).toThrow(/Invalid capability driver/);
    expect(() => registry.register('valid-driver', null)).toThrow(/Invalid capability driver/);
    expect(() => registry.create('missing-driver')).toThrow(/Unknown capability driver: missing-driver/);
  });

  test('default registry exports built-in generic and unsupported drivers for runtime use', () => {
    const { getDriverRegistry } = require('../../../src/platforms/driver-registry');
    const registry = getDriverRegistry();

    expect(registry.ids()).toEqual(expect.arrayContaining([
      'unsupported',
      'generic-jsonl',
      'generic-filesystem',
      'generic-openai-compatible',
      'legacy:claude',
      'legacy:codex',
      'legacy:gemini',
      'legacy:opencode',
      'legacy:omp'
    ]));
    expect(registry.create('unsupported', { platform: 'demo-cli', capability: 'proxy' })).toEqual({
      status: 'unsupported',
      platform: 'demo-cli',
      capability: 'proxy'
    });
    expect(registry.create('legacy:claude', { platform: 'claude', capability: 'sessions' })).toEqual({
      status: 'unsupported',
      platform: 'claude',
      capability: 'sessions'
    });
  });
});

describe('unsupported driver', () => {
  test('unsupported driver never returns a successful empty value', () => {
    const result = makeRegistry().create('unsupported', {
      platform: 'demo-cli', capability: 'proxy'
    });

    expect(result).toEqual({ status: 'unsupported', platform: 'demo-cli', capability: 'proxy' });
    expect(result.status).not.toBe('ok');
  });
});

describe('generic JSONL driver', () => {
  test('inventories and normalizes sessions', async () => {
    const fsImpl = {
      readdir: async () => ['session-1.jsonl'],
      stat: async () => ({ size: 20, mtimeMs: 10 }),
      readFile: vi.fn(async () => '{"id":"m1","role":"user","content":"hello"}\n')
    };
    const driver = makeJsonlDriver(fsImpl);

    const descriptors = await driver.inventory();
    expect(descriptors[0]).toEqual(expect.objectContaining({
      filePath: '/tmp/demo/sessions/session-1.jsonl',
      size: 20,
      mtimeMs: 10,
      sessionId: 'session-1',
      projectHint: undefined
    }));
    expect(fsImpl.readFile).not.toHaveBeenCalled();

    const parsed = await driver.parse(descriptors[0]);
    expect(parsed.sessionId).toBe('session-1');
    expect(parsed.messages[0]).toEqual(expect.objectContaining({ role: 'user', content: 'hello' }));
  });

  test('sessionGlob filters the full basename pattern', async () => {
    const fsImpl = {
      readdir: async () => ['session-good.jsonl', 'notes.jsonl'],
      stat: async filePath => ({ size: filePath.includes('good') ? 20 : 10, mtimeMs: 12 }),
      readFile: vi.fn(async () => '{"role":"user","content":"hello"}\n')
    };
    const driver = makeJsonlDriver(fsImpl, { sessionGlob: 'session-*.jsonl' });

    await expect(driver.inventory()).resolves.toEqual([
      expect.objectContaining({
        filePath: '/tmp/demo/sessions/session-good.jsonl',
        sessionId: 'session-good'
      })
    ]);
    expect(fsImpl.readFile).not.toHaveBeenCalled();
  });

  test('sessionGlob supports question marks and literal characters', async () => {
    const fsImpl = {
      readdir: async () => ['session-a.jsonl', 'session-abjsonl', 'session-aa.jsonl'],
      stat: async () => ({ size: 20, mtimeMs: 12 })
    };
    const driver = makeJsonlDriver(fsImpl, { sessionGlob: 'session-?.jsonl' });

    await expect(driver.inventory()).resolves.toEqual([
      expect.objectContaining({
        filePath: '/tmp/demo/sessions/session-a.jsonl',
        sessionId: 'session-a'
      })
    ]);
  });

  test('returns a typed inventory failure when the session directory is missing', async () => {
    const fsImpl = {
      readdir: async () => {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
    };
    const driver = makeJsonlDriver(fsImpl);

    await expect(driver.inventory()).resolves.toEqual({
      status: 'failed',
      platform: 'demo-cli',
      capability: 'sessions',
      operation: 'inventory',
      root: '/tmp/demo/sessions',
      error: 'missing'
    });
  });

  test('returns a failed inventory with non-enumerable cause for malformed mapped metadata', async () => {
    const cause = new Error('malformed metadata');
    const fsImpl = {
      readdir: async () => ['session.jsonl'],
      stat: async () => ({ size: 1, mtimeMs: 1 }),
      readFile: async () => { throw cause; }
    };
    const driver = makeJsonlDriver(fsImpl, { sessionMapping: { sessionId: 'id' } });

    const result = await driver.inventory();
    expect(result).toEqual(expect.objectContaining({
      status: 'failed', platform: 'demo-cli', capability: 'sessions', operation: 'inventory'
    }));
    expect(result.cause).toBe(cause);
    expect(Object.keys(result)).not.toContain('cause');
  });

  test('returns a typed parse failure for malformed JSONL', async () => {
    const fsImpl = {
      readFile: async () => '{"role":"user"}\nnot-json\n'
    };
    const driver = makeJsonlDriver(fsImpl);

    await expect(driver.parse({ filePath: '/tmp/demo/sessions/bad.jsonl', sessionId: 'bad' })).resolves.toEqual(expect.objectContaining({
      status: 'failed',
      platform: 'demo-cli',
      capability: 'sessions',
      operation: 'parse',
      filePath: '/tmp/demo/sessions/bad.jsonl'
    }));
  });

  test('parses nested message mappings and project hints', async () => {
    const fsImpl = {
      readFile: async () => JSON.stringify({
        id: 'session-from-file',
        project: 'demo-project',
        messages: [{ author: 'assistant', text: 'nested hello', createdAt: 20, modelName: 'gpt-test' }]
      })
    };
    const driver = makeJsonlDriver(fsImpl, {
      sessionMapping: {
        sessionId: 'id',
        projectName: 'project',
        messages: 'messages',
        role: 'author',
        content: 'text',
        timestamp: 'createdAt',
        model: 'modelName'
      }
    });

    await expect(driver.parse({ filePath: '/tmp/demo/sessions/nested.jsonl' })).resolves.toEqual({
      sessionId: 'session-from-file',
      projectName: 'demo-project',
      filePath: '/tmp/demo/sessions/nested.jsonl',
      messages: [expect.objectContaining({
        role: 'assistant',
        content: 'nested hello',
        timestamp: 20,
        model: 'gpt-test'
      })]
    });
  });

  test('keeps duplicate mapped session ids as separate descriptors by file path', async () => {
    const readFile = vi.fn(async () => JSON.stringify({ id: 'same-session' }));
    const fsImpl = {
      readdir: async () => ['first.jsonl', 'second.jsonl'],
      stat: async filePath => ({ size: filePath.endsWith('second.jsonl') ? 30 : 20, mtimeMs: 10 }),
      readFile
    };
    const driver = makeJsonlDriver(fsImpl, {
      sessionMapping: { sessionId: 'id' }
    });

    const descriptors = await driver.inventory();

    expect(descriptors).toEqual([
      expect.objectContaining({ filePath: '/tmp/demo/sessions/first.jsonl', sessionId: 'same-session' }),
      expect.objectContaining({ filePath: '/tmp/demo/sessions/second.jsonl', sessionId: 'same-session' })
    ]);
  });

  test('inventory uses mapped session and project fields when declared', async () => {
    const readFile = vi.fn(async () => JSON.stringify({
      session: { id: 'mapped-session' },
      project: { name: 'mapped-project' },
      messages: []
    }));
    const fsImpl = {
      readdir: async () => ['raw-file.jsonl'],
      stat: async () => ({ size: 25, mtimeMs: 30 }),
      readFile
    };
    const driver = makeJsonlDriver(fsImpl, {
      sessionMapping: { sessionId: 'session.id', projectName: 'project.name' }
    });

    await expect(driver.inventory()).resolves.toEqual([
      {
        filePath: '/tmp/demo/sessions/raw-file.jsonl',
        size: 25,
        mtimeMs: 30,
        sessionId: 'mapped-session',
        projectHint: 'mapped-project'
      }
    ]);
    expect(readFile).toHaveBeenCalledWith('/tmp/demo/sessions/raw-file.jsonl', 'utf8');
  });
});

describe('generic filesystem driver', () => {
  test('lists resources from mapped roots', async () => {
    const fsImpl = {
      readdir: async () => ['settings.json'],
      stat: async () => ({ isDirectory: () => false, isFile: () => true, size: 7, mtimeMs: 11 })
    };
    const driver = makeRegistry().create('generic-filesystem', {
      platform: 'demo-cli',
      manifest: { resourceMappings: { settings: '/tmp/demo/settings' } },
      fsImpl
    });

    await expect(driver.list('settings')).resolves.toEqual([
      { name: 'settings.json', target: '/tmp/demo/settings/settings.json', type: 'file', size: 7, mtimeMs: 11 }
    ]);
  });

  test('normalizes relative sync names and copies files inside mapped roots', async () => {
    const calls = [];
    const fsImpl = {
      mkdir: async target => calls.push(['mkdir', target]),
      stat: async filePath => ({ isDirectory: () => filePath === '/tmp/source-dir', isFile: () => filePath !== '/tmp/source-dir' }),
      copyFile: async (source, target) => calls.push(['copyFile', source, target]),
      cp: async (source, target, options) => calls.push(['cp', source, target, options])
    };
    const driver = makeRegistry().create('generic-filesystem', {
      platform: 'demo-cli',
      manifest: { resourceMappings: { commands: '/tmp/demo/commands' } },
      fsImpl
    });

    await expect(driver.sync('commands', './tools/run.md', '/tmp/source.md')).resolves.toEqual({
      status: 'ok',
      target: path.join('/tmp/demo/commands', 'tools', 'run.md')
    });
    expect(calls).toEqual([
      ['mkdir', path.join('/tmp/demo/commands', 'tools')],
      ['copyFile', '/tmp/source.md', path.join('/tmp/demo/commands', 'tools', 'run.md')]
    ]);
  });

  test('rejects path traversal for sync and remove operations', async () => {
    const fsImpl = {
      rm: vi.fn()
    };
    const driver = makeRegistry().create('generic-filesystem', {
      platform: 'demo-cli',
      manifest: { resourceMappings: { commands: '/tmp/demo/commands' } },
      fsImpl
    });

    expect(await driver.sync('commands', '../outside.md', '/tmp/source.md')).toEqual(expect.objectContaining({
      status: 'failed',
      platform: 'demo-cli',
      capability: 'resourceSync',
      operation: 'sync'
    }));
    expect(await driver.remove('commands', '../outside.md')).toEqual(expect.objectContaining({
      status: 'failed',
      platform: 'demo-cli',
      capability: 'resourceSync',
      operation: 'remove'
    }));
    expect(fsImpl.rm).not.toHaveBeenCalled();
  });

  test('removes resource directories only after resolving inside mapped roots', async () => {
    const rm = vi.fn();
    const driver = makeRegistry().create('generic-filesystem', {
      platform: 'demo-cli',
      manifest: { resourceMappings: { commands: '/tmp/demo/commands' } },
      fsImpl: { rm }
    });

    await expect(driver.remove('commands', 'tools')).resolves.toEqual({
      status: 'ok',
      target: path.join('/tmp/demo/commands', 'tools')
    });
    expect(rm).toHaveBeenCalledWith(path.join('/tmp/demo/commands', 'tools'), {
      recursive: true,
      force: true
    });
  });

  test('rejects absolute sync names outside the mapped root', async () => {
    const fsImpl = {
      copyFile: vi.fn()
    };
    const driver = makeRegistry().create('generic-filesystem', {
      platform: 'demo-cli',
      manifest: { resourceMappings: { commands: '/tmp/demo/commands' } },
      fsImpl
    });

    expect(await driver.sync('commands', '/tmp/demo/outside.md', '/tmp/source.md')).toEqual(expect.objectContaining({
      status: 'failed',
      platform: 'demo-cli',
      capability: 'resourceSync',
      operation: 'sync'
    }));
    expect(fsImpl.copyFile).not.toHaveBeenCalled();
  });

  test('returns typed failures for unknown resource mappings', async () => {
    const driver = makeRegistry().create('generic-filesystem', {
      platform: 'demo-cli',
      manifest: { resourceMappings: {} }
    });

    await expect(driver.list('commands')).resolves.toEqual(expect.objectContaining({
      status: 'failed',
      platform: 'demo-cli',
      capability: 'resourceSync',
      operation: 'list'
    }));
  });

  test('lists and syncs through a normal existing filesystem root', async () => {
    const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'generic-existing-root-'));
    const source = path.join(root, 'source.md');
    fs.writeFileSync(path.join(root, 'tool.md'), 'tool');
    fs.writeFileSync(source, 'source');
    try {
      const driver = makeRegistry().create('generic-filesystem', {
        platform: 'demo-cli',
        manifest: { resourceMappings: { commands: root } }
      });

      await expect(driver.list('commands')).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'tool.md', target: path.join(root, 'tool.md'), type: 'file' })
      ]));
      await expect(driver.sync('commands', 'nested/copied.md', source)).resolves.toEqual({
        status: 'ok', target: path.join(root, 'nested', 'copied.md')
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects mapped roots whose existing parent is reached through a symlink', async () => {
    const realParent = fs.mkdtempSync(path.join(require('os').tmpdir(), 'generic-real-parent-'));
    const source = path.join(realParent, 'source.md');
    fs.writeFileSync(source, 'source');
    const linkParent = path.join(require('os').tmpdir(), `generic-link-parent-${Date.now()}`);
    fs.symlinkSync(realParent, linkParent, 'dir');
    const root = path.join(linkParent, 'commands');
    try {
      const driver = makeRegistry().create('generic-filesystem', {
        platform: 'demo-cli',
        manifest: { resourceMappings: { commands: root } }
      });

      await expect(driver.sync('commands', 'tool.md', source)).resolves.toEqual(expect.objectContaining({
        status: 'failed', platform: 'demo-cli', capability: 'resourceSync', operation: 'sync'
      }));
    } finally {
      fs.rmSync(linkParent, { recursive: true, force: true });
      fs.rmSync(realParent, { recursive: true, force: true });
    }
  });

  test('rejects symlink roots and targets outside the mapped resource root', async () => {
    const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'generic-resource-root-'));
    const outside = fs.mkdtempSync(path.join(require('os').tmpdir(), 'generic-resource-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(outside, path.join(root, 'escape'), 'dir');
    try {
      const driver = makeRegistry().create('generic-filesystem', {
        platform: 'demo-cli',
        manifest: { resourceMappings: { commands: root } }
      });

      await expect(driver.list('commands')).resolves.toEqual(expect.objectContaining({
        status: 'failed', platform: 'demo-cli', capability: 'resourceSync', operation: 'list'
      }));
      await expect(driver.remove('commands', 'escape')).resolves.toEqual(expect.objectContaining({
        status: 'failed', platform: 'demo-cli', capability: 'resourceSync', operation: 'remove'
      }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('sync refuses to overwrite an existing symlink leaf outside the mapped root', async () => {
    const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'generic-leaf-root-'));
    const outside = fs.mkdtempSync(path.join(require('os').tmpdir(), 'generic-leaf-outside-'));
    const source = path.join(root, 'source.md');
    const victim = path.join(outside, 'victim.md');
    fs.writeFileSync(source, 'source');
    fs.writeFileSync(victim, 'victim');
    fs.symlinkSync(victim, path.join(root, 'link'));
    try {
      const driver = makeRegistry().create('generic-filesystem', {
        platform: 'demo-cli',
        manifest: { resourceMappings: { commands: root } }
      });

      await expect(driver.sync('commands', 'link', source)).resolves.toEqual(expect.objectContaining({
        status: 'failed', platform: 'demo-cli', capability: 'resourceSync', operation: 'sync'
      }));
      expect(fs.readFileSync(victim, 'utf8')).toBe('victim');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('filesystem failures preserve their original cause safely', async () => {
    const cause = new Error('filesystem failed');
    const driver = makeRegistry().create('generic-filesystem', {
      platform: 'demo-cli',
      manifest: { resourceMappings: { commands: '/tmp/demo/commands' } },
      fsImpl: { readdir: async () => { throw cause; } }
    });
    const result = await driver.list('commands');
    expect(result.cause).toBe(cause);
    expect(Object.keys(result)).not.toContain('cause');
  });

  test('sync and remove are idempotent for existing and missing resources', async () => {
    const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'generic-idempotent-root-'));
    const source = path.join(root, 'source.md');
    fs.writeFileSync(source, 'source');
    try {
      const driver = makeRegistry().create('generic-filesystem', {
        platform: 'demo-cli',
        manifest: { resourceMappings: { commands: root } }
      });
      await expect(driver.sync('commands', 'tool.md', source)).resolves.toEqual({ status: 'ok', target: path.join(root, 'tool.md') });
      await expect(driver.sync('commands', 'tool.md', source)).resolves.toEqual({ status: 'ok', target: path.join(root, 'tool.md') });
      await expect(driver.remove('commands', 'tool.md')).resolves.toEqual({ status: 'ok', target: path.join(root, 'tool.md') });
      await expect(driver.remove('commands', 'tool.md')).resolves.toEqual({ status: 'ok', target: path.join(root, 'tool.md') });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('sync creates a missing mapped resource root recursively', async () => {
    const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'generic-missing-root-'));
    const source = path.join(root, 'source.md');
    fs.writeFileSync(source, 'source');
    const targetRoot = path.join(root, 'mapped');
    try {
      const driver = makeRegistry().create('generic-filesystem', {
        platform: 'demo-cli',
        manifest: { resourceMappings: { commands: targetRoot } }
      });
      await expect(driver.sync('commands', 'nested/file.md', source)).resolves.toEqual({
        status: 'ok', target: path.join(targetRoot, 'nested/file.md')
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('generic OpenAI-compatible driver', () => {
  test('normalizes endpoints and authenticates requests without exposing API keys', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const driver = makeRegistry().create('generic-openai-compatible', {
      platform: 'demo-cli',
      manifest: { paths: { baseUrl: 'https://api.example.test/v1///' } },
      fetchImpl
    });

    expect(driver.normalizeEndpoint('/chat/completions')).toBe('https://api.example.test/v1/chat/completions');
    expect(driver.buildHeaders({ apiKey: 'secret-key' })).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-key'
    });
    await expect(driver.request('/models', { apiKey: 'secret-key' }, { headers: { 'X-Test': '1' } })).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.test/v1/models', expect.objectContaining({
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-key',
        'X-Test': '1'
      }
    }));
    expect(JSON.stringify(driver)).not.toContain('secret-key');
  });

  test('throws on missing base URL and failed responses', async () => {
    expect(() => makeRegistry().create('generic-openai-compatible', {
      platform: 'demo-cli',
      manifest: {}
    })).toThrow(/Missing base URL for demo-cli/);

    const driver = makeRegistry().create('generic-openai-compatible', {
      platform: 'demo-cli',
      manifest: { baseUrl: 'https://api.example.test' },
      fetchImpl: async () => ({ ok: false, status: 401 })
    });

    await expect(driver.request('/models', { apiKey: 'secret-key' })).rejects.toThrow('OpenAI-compatible request failed: 401');
  });

  test('does not invoke a local proxy lifecycle for OpenAI-compatible channels', () => {
    const driver = makeRegistry().create('generic-openai-compatible', {
      platform: 'demo-cli',
      manifest: { baseUrl: 'https://api.example.test' },
      fetchImpl: async () => ({ ok: true, json: async () => ({}) })
    });

    expect(driver.status).toBeUndefined();
    expect(driver.start).toBeUndefined();
    expect(driver.stop).toBeUndefined();
  });

  test('wraps network and JSON response failures with a safe typed error', async () => {
    const networkCause = new Error('network failed');
    const networkDriver = makeRegistry().create('generic-openai-compatible', {
      platform: 'demo-cli',
      manifest: { baseUrl: 'https://api.example.test' },
      fetchImpl: async () => { throw networkCause; }
    });
    await expect(networkDriver.request('/models', { apiKey: 'secret-key' })).rejects.toMatchObject({
      platform: 'demo-cli', capability: 'channels', operation: 'request', message: 'OpenAI-compatible request failed'
    });

    const jsonCause = new Error('invalid json');
    const jsonDriver = makeRegistry().create('generic-openai-compatible', {
      platform: 'demo-cli',
      manifest: { baseUrl: 'https://api.example.test' },
      fetchImpl: async () => ({ ok: true, json: async () => { throw jsonCause; } })
    });
    await expect(jsonDriver.request('/models', {})).rejects.toMatchObject({
      platform: 'demo-cli', capability: 'channels', operation: 'request', message: 'OpenAI-compatible request failed'
    });
  });
});


