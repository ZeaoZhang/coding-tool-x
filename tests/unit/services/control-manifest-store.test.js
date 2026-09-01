'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ControlManifestStore, DEFAULT_CONTROL_MANIFEST } = require('../../../src/server/services/control-manifest-store');

describe('ControlManifestStore', () => {
  let tempDir;
  let userPath;
  let projectPath;
  let store;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-manifest-'));
    userPath = path.join(tempDir, 'config', 'effective-control.json');
    projectPath = path.join(tempDir, 'project');
    fs.mkdirSync(projectPath, { recursive: true });
    projectPath = fs.realpathSync(projectPath);
    store = new ControlManifestStore({
      userPath,
      projectPathResolver: ({ projectPath: canonicalPath }) => path.join(canonicalPath, '.ctx-control.json'),
      fsImpl: fs
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('reads the default manifest when the target file is missing', () => {
    expect(store.read({ scope: 'user', projectPath: null })).toEqual(DEFAULT_CONTROL_MANIFEST);
  });

  test('writes a restricted manifest atomically with owner-only permissions', async () => {
    const manifest = {
      version: 1,
      updatedAt: 123,
      skills: { skillA: { enabled: false } },
      mcp: { serverA: { enabled: true, secretRef: 'env:GITHUB_TOKEN' } },
      secret: 'must-not-persist',
      serverSpec: { command: 'node' }
    };

    await store.write({ scope: 'user', projectPath: null }, manifest);

    expect(store.read({ scope: 'user', projectPath: null })).toEqual({
      version: 1,
      updatedAt: 123,
      skills: { skillA: { enabled: false } },
      mcp: { serverA: { enabled: true, secretRef: 'env:GITHUB_TOKEN' } }
    });
    expect(fs.statSync(userPath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(userPath)).filter(name => name.includes('.tmp'))).toEqual([]);
  });

  test('rejects malformed manifests instead of silently resetting them', () => {
    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    for (const invalid of [[], { version: 2 }, { version: 1, skills: [] }, 'not-json']) {
      fs.writeFileSync(userPath, typeof invalid === 'string' ? invalid : JSON.stringify(invalid));
      expect(() => store.read({ scope: 'user', projectPath: null })).toThrow('Invalid control manifest');
    }
  });

  test('uses the canonical project path only for project manifests', async () => {
    await store.write({ scope: 'project', projectPath }, { version: 1, skills: {}, mcp: {} });
    expect(fs.existsSync(path.join(projectPath, '.ctx-control.json'))).toBe(true);
    expect(fs.existsSync(userPath)).toBe(false);
  });

  test('rejects symlinked manifest paths', () => {
    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    const outside = path.join(tempDir, 'outside.json');
    fs.writeFileSync(outside, JSON.stringify({ version: 1, skills: {}, mcp: {} }));
    fs.symlinkSync(outside, userPath);

    expect(() => store.read({ scope: 'user', projectPath: null })).toThrow(/symlink/i);
    expect(() => store.write({ scope: 'user', projectPath: null }, {
      version: 1,
      skills: {},
      mcp: {}
    })).toThrow(/symlink/i);
  });
});
