'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { createGenericMcpDriver } = require('../../../src/platforms/drivers/generic-mcp');
const { createGenericPromptDriver } = require('../../../src/platforms/drivers/generic-prompt');

test('default registry registers fixed MCP and prompt drivers', () => {
  const { getDriverRegistry } = require('../../../src/platforms/driver-registry');
  const registry = getDriverRegistry();
  expect(registry.has('generic-mcp')).toBe(true);
  expect(registry.has('generic-prompt')).toBe(true);
  expect(typeof registry.create('generic-mcp', { platform: 'demo', capability: 'mcp' }).read).toBe('function');
  expect(typeof registry.create('generic-prompt', { platform: 'demo', capability: 'prompts' }).write).toBe('function');
});

describe('generic capability system aliases', () => {
  test.each([
    ['MCP', 'mcp', '/var/tmp'],
    ['prompt', 'prompts', '/var/tmp'],
    ['MCP', 'mcp', os.tmpdir()],
    ['prompt', 'prompts', os.tmpdir()]
  ])('writes nested %s mappings under macOS system aliases (%s)', async (_label, capability, base) => {
    const root = fs.mkdtempSync(path.join(base, `generic-${capability}-system-alias-`));
    const file = path.join(root, 'nested', capability === 'mcp' ? 'mcp.json' : 'PROMPT.md');
    const manifest = capability === 'mcp'
      ? { resourceMappings: { mcp: file }, mcpFormat: 'json' }
      : { resourceMappings: { prompts: file } };
    const driver = capability === 'mcp'
      ? createGenericMcpDriver({ platform: 'demo-cli', manifest })
      : createGenericPromptDriver({ platform: 'demo-cli', manifest });
    try {
      const result = await driver.write(capability === 'mcp' ? { servers: {} } : 'system alias prompt');
      expect(result).toEqual(expect.objectContaining({ status: 'ok', operation: 'write' }));
      expect(fs.existsSync(file)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('generic MCP driver', () => {
  test('reads and writes only the declared JSON mapping', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-mcp-'));
    const file = path.join(root, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ servers: { demo: { command: 'demo' } } }), 'utf8');
    try {
      const driver = createGenericMcpDriver({ platform: 'demo-cli', manifest: { resourceMappings: { mcp: file }, mcpFormat: 'json' } });
      await expect(driver.read()).resolves.toEqual({ servers: { demo: { command: 'demo' } } });
      await expect(driver.write({ servers: { next: { command: 'next' } } })).resolves.toEqual(expect.objectContaining({ status: 'ok', platform: 'demo-cli', capability: 'mcp', operation: 'write' }));
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ servers: { next: { command: 'next' } } });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });


  test('rejects non-JSON mappings and exposes no dynamic execution operation', async () => {
    const driver = createGenericMcpDriver({ platform: 'demo-cli', manifest: { resourceMappings: { mcp: '/tmp/mcp.json' } } });
    await expect(driver.read()).resolves.toEqual(expect.objectContaining({ status: 'failed', capability: 'mcp', operation: 'read' }));
    await expect(driver.write({})).resolves.toEqual(expect.objectContaining({ status: 'failed', capability: 'mcp', operation: 'write' }));
    expect(driver).not.toHaveProperty('require');
    expect(driver).not.toHaveProperty('invoke');
  });
  test.each([
    ['declared home', 'home'],
    ['ancestor under home', 'ancestor'],
    ['ancestor above home', 'outer-ancestor']
  ])('rejects symlinked %s for read, write, and remove', async (_description, location) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-mcp-symlink-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-mcp-outside-'));
    const targetName = location === 'home' ? 'mcp.json' : path.join('nested', 'mcp.json');
    const outsideFile = path.join(outside, 'mcp.json');
    fs.writeFileSync(outsideFile, JSON.stringify({ outside: true }), 'utf8');
    let home = path.join(root, 'home');
    if (location === 'home') fs.symlinkSync(outside, home, 'dir');
    else if (location === 'outer-ancestor') {
      fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
      home = path.join(root, 'link', 'new-home');
    } else {
      fs.mkdirSync(home);
      fs.symlinkSync(outside, path.join(home, 'nested'), 'dir');
    }
    try {
      const driver = createGenericMcpDriver({ platform: 'demo-cli', manifest: { paths: { home }, resourceMappings: { mcp: targetName }, mcpFormat: 'json' } });
      await expect(driver.read()).resolves.toEqual(expect.objectContaining({ status: 'failed', operation: 'read' }));
      await expect(driver.write({ escaped: true })).resolves.toEqual(expect.objectContaining({ status: 'failed', operation: 'write' }));
      await expect(driver.remove()).resolves.toEqual(expect.objectContaining({ status: 'failed', operation: 'remove' }));
      expect(fs.readFileSync(outsideFile, 'utf8')).toBe(JSON.stringify({ outside: true }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('keeps the previous JSON mapping when an atomic write fails and cleans its temp file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-mcp-atomic-'));
    const file = path.join(root, 'mcp.json');
    const original = JSON.stringify({ servers: { stable: { command: 'stable' } } });
    fs.writeFileSync(file, original, 'utf8');
    const fsImpl = {
      ...fsp,
      open: async (...args) => {
        const handle = await fsp.open(...args);
        handle.writeFile = async () => {
          throw new Error('simulated interrupted write');
        };
        return handle;
      }
    };
    try {
      const driver = createGenericMcpDriver({ platform: 'demo-cli', fsImpl, manifest: { resourceMappings: { mcp: file }, mcpFormat: 'json' } });
      await expect(driver.write({ servers: { replacement: { command: 'replacement' } } })).resolves.toEqual(expect.objectContaining({ status: 'failed', operation: 'write' }));
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
      expect(fs.readdirSync(root)).toEqual(['mcp.json']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('descriptor read rejects an ancestor swap and never returns outside content', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-mcp-read-race-'));
    const home = path.join(root, 'home');
    const target = path.join(home, 'mcp.json');
    const moved = path.join(root, 'mcp-inside.json');
    const outside = path.join(root, 'outside.json');
    fs.mkdirSync(home);
    fs.writeFileSync(target, JSON.stringify({ inside: true }), 'utf8');
    fs.writeFileSync(outside, JSON.stringify({ outside: true }), 'utf8');
    let swapped = false;
    const fsImpl = { ...fsp, open: async (...args) => {
      const handle = await fsp.open(...args);
      if (!swapped && path.basename(args[0]) === 'mcp.json') {
        swapped = true;
        fs.renameSync(target, moved);
        fs.symlinkSync(outside, target);
      }
      return handle;
    } };
    try {
      const driver = createGenericMcpDriver({ platform: 'demo-cli', fsImpl, manifest: { paths: { home }, resourceMappings: { mcp: target }, mcpFormat: 'json' } });
      const result = await driver.read();
      expect(result && (result.inside === true || result.status === 'failed')).toBeTruthy();
      expect(result && result.outside).not.toBe(true);
      expect(JSON.parse(fs.readFileSync(outside, 'utf8'))).toEqual({ outside: true });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('remove refuses a pre-operation target swap', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-mcp-remove-race-'));
    const home = path.join(root, 'home');
    const target = path.join(home, 'mcp.json');
    const moved = path.join(root, 'mcp-inside.json');
    const outside = path.join(root, 'outside.json');
    fs.mkdirSync(home);
    fs.writeFileSync(target, JSON.stringify({ inside: true }), 'utf8');
    fs.writeFileSync(outside, JSON.stringify({ outside: true }), 'utf8');
    let swapped = false;
    const fsImpl = { ...fsp, realpath: async value => {
      const result = await fsp.realpath(value);
      if (!swapped && value === target) {
        swapped = true;
        fs.renameSync(target, moved);
        fs.symlinkSync(outside, target);
      }
      return result;
    } };
    try {
      const driver = createGenericMcpDriver({ platform: 'demo-cli', fsImpl, manifest: { paths: { home }, resourceMappings: { mcp: target }, mcpFormat: 'json' } });
      await expect(driver.remove()).resolves.toEqual(expect.objectContaining({ status: 'failed', operation: 'remove' }));
      expect(fs.existsSync(moved)).toBe(true);
      expect(fs.existsSync(outside)).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

});

describe('generic prompt driver', () => {
  test('reads and writes UTF-8 text at the declared prompt path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-prompt-'));
    const file = path.join(root, 'PROMPT.md');
    fs.writeFileSync(file, 'hello', 'utf8');
    try {
      const driver = createGenericPromptDriver({ platform: 'demo-cli', manifest: { resourceMappings: { prompts: file } } });
      await expect(driver.read()).resolves.toBe('hello');
      await expect(driver.write('updated')).resolves.toEqual(expect.objectContaining({ status: 'ok', platform: 'demo-cli', capability: 'prompts', operation: 'write' }));
      expect(fs.readFileSync(file, 'utf8')).toBe('updated');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('supports safe promptFile mapping and typed errors', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-prompt-file-'));
    try {
      const driver = createGenericPromptDriver({ platform: 'demo-cli', manifest: { paths: { home: root }, promptFile: 'PROMPT.md' } });
      await expect(driver.write('safe')).resolves.toEqual(expect.objectContaining({ status: 'ok' }));
      await expect(driver.read()).resolves.toBe('safe');
      const bad = createGenericPromptDriver({ platform: 'demo-cli', manifest: { promptFile: '../outside.md' } });
      await expect(bad.read()).resolves.toEqual(expect.objectContaining({ status: 'failed', capability: 'prompts', operation: 'read' }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('falls back to promptFile when the optional prompts mapping is empty', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-prompt-fallback-'));
    const file = path.join(root, 'PROMPT.md');
    fs.writeFileSync(file, 'promptFile content', 'utf8');
    try {
      const driver = createGenericPromptDriver({
        platform: 'demo-cli',
        manifest: { resourceMappings: { prompts: '' }, promptFile: file }
      });
      await expect(driver.read()).resolves.toBe('promptFile content');
      await expect(driver.write('updated')).resolves.toEqual(expect.objectContaining({ status: 'ok', target: file }));
      expect(fs.readFileSync(file, 'utf8')).toBe('updated');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test.each([
    ['declared home', 'home'],
    ['ancestor under home', 'ancestor'],
    ['ancestor above home', 'outer-ancestor']
  ])('rejects symlinked %s for read, write, and remove', async (_description, location) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-prompt-symlink-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-prompt-outside-'));
    const targetName = location === 'home' ? 'PROMPT.md' : path.join('nested', 'PROMPT.md');
    const outsideFile = path.join(outside, 'PROMPT.md');
    fs.writeFileSync(outsideFile, 'outside', 'utf8');
    let home = path.join(root, 'home');
    if (location === 'home') fs.symlinkSync(outside, home, 'dir');
    else if (location === 'outer-ancestor') {
      fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
      home = path.join(root, 'link', 'new-home');
    } else {
      fs.mkdirSync(home);
      fs.symlinkSync(outside, path.join(home, 'nested'), 'dir');
    }
    try {
      const driver = createGenericPromptDriver({ platform: 'demo-cli', manifest: { paths: { home }, promptFile: targetName } });
      await expect(driver.read()).resolves.toEqual(expect.objectContaining({ status: 'failed', operation: 'read' }));
      await expect(driver.write('should not escape')).resolves.toEqual(expect.objectContaining({ status: 'failed', operation: 'write' }));
      await expect(driver.remove()).resolves.toEqual(expect.objectContaining({ status: 'failed', operation: 'remove' }));
      expect(fs.readFileSync(outsideFile, 'utf8')).toBe('outside');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
  test('descriptor read rejects an ancestor swap and never returns outside content', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-prompt-read-race-'));
    const home = path.join(root, 'home');
    const target = path.join(home, 'PROMPT.md');
    const moved = path.join(root, 'PROMPT-inside.md');
    const outside = path.join(root, 'PROMPT-outside.md');
    fs.mkdirSync(home);
    fs.writeFileSync(target, 'inside', 'utf8');
    fs.writeFileSync(outside, 'outside', 'utf8');
    let swapped = false;
    const fsImpl = { ...fsp, open: async (...args) => {
      const handle = await fsp.open(...args);
      if (!swapped && path.basename(args[0]) === 'PROMPT.md') {
        swapped = true;
        fs.renameSync(target, moved);
        fs.symlinkSync(outside, target);
      }
      return handle;
    } };
    try {
      const driver = createGenericPromptDriver({ platform: 'demo-cli', fsImpl, manifest: { paths: { home }, resourceMappings: { prompts: target } } });
      const result = await driver.read();
      expect(result === 'inside' || result.status === 'failed').toBe(true);
      expect(result).not.toBe('outside');
      expect(fs.readFileSync(outside, 'utf8')).toBe('outside');
      expect(swapped).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('remove refuses a pre-operation target swap', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-prompt-remove-race-'));
    const home = path.join(root, 'home');
    const target = path.join(home, 'PROMPT.md');
    const moved = path.join(root, 'PROMPT-inside.md');
    const outside = path.join(root, 'PROMPT-outside.md');
    fs.mkdirSync(home);
    fs.writeFileSync(target, 'inside', 'utf8');
    fs.writeFileSync(outside, 'outside', 'utf8');
    let swapped = false;
    const fsImpl = { ...fsp, realpath: async value => {
      const result = await fsp.realpath(value);
      if (!swapped && value === target) {
        swapped = true;
        fs.renameSync(target, moved);
        fs.symlinkSync(outside, target);
      }
      return result;
    } };
    try {
      const driver = createGenericPromptDriver({ platform: 'demo-cli', fsImpl, manifest: { paths: { home }, resourceMappings: { prompts: target } } });
      await expect(driver.remove()).resolves.toEqual(expect.objectContaining({ status: 'failed', operation: 'remove' }));
      expect(fs.existsSync(moved)).toBe(true);
      expect(fs.existsSync(outside)).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('keeps the previous prompt when an atomic write fails and cleans its temp file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-prompt-atomic-'));
    const file = path.join(root, 'PROMPT.md');
    fs.writeFileSync(file, 'stable prompt', 'utf8');
    const fsImpl = {
      ...fsp,
      open: async (...args) => {
        const handle = await fsp.open(...args);
        handle.writeFile = async () => {
          throw new Error('simulated interrupted write');
        };
        return handle;
      }
    };
    try {
      const driver = createGenericPromptDriver({ platform: 'demo-cli', fsImpl, manifest: { resourceMappings: { prompts: file } } });
      await expect(driver.write('replacement prompt')).resolves.toEqual(expect.objectContaining({ status: 'failed', operation: 'write' }));
      expect(fs.readFileSync(file, 'utf8')).toBe('stable prompt');
      expect(fs.readdirSync(root)).toEqual(['PROMPT.md']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
