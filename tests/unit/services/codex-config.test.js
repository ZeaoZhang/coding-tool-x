'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const pathsModPath = require.resolve('../../../src/config/paths');

let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-config-'));

  // Inject stub for NATIVE_PATHS so codex-config uses testDir
  require.cache[pathsModPath] = {
    id: pathsModPath,
    filename: pathsModPath,
    loaded: true,
    exports: { NATIVE_PATHS: { codex: { dir: testDir } }, PATHS: {} }
  };

  // Force re-require of codex-config to pick up new stub
  delete require.cache[require.resolve('../../../src/platforms/drivers/codex/config')];
});

afterEach(() => {
  // Restore the real paths module
  delete require.cache[pathsModPath];
  delete require.cache[require.resolve('../../../src/platforms/drivers/codex/config')];

  // Clean up temp dir
  fs.rmSync(testDir, { recursive: true, force: true });
});

function getModule() {
  return require('../../../src/platforms/drivers/codex/config');
}

// ---------------------------------------------------------------------------
// getCodexDir
// ---------------------------------------------------------------------------
describe('getCodexDir', () => {
  test('returns the injected testDir', () => {
    expect(getModule().getCodexDir()).toBe(testDir);
  });
});

// ---------------------------------------------------------------------------
// isCodexInstalled
// ---------------------------------------------------------------------------
describe('isCodexInstalled', () => {
  test('returns true when dir exists', () => {
    expect(getModule().isCodexInstalled()).toBe(true);
  });

  test('returns false when dir does not exist', () => {
    const nonExistent = path.join(os.tmpdir(), 'codex-no-such-dir-' + Date.now());
    // Override stub to non-existent path
    require.cache[pathsModPath] = {
      id: pathsModPath, filename: pathsModPath, loaded: true,
      exports: { NATIVE_PATHS: { codex: { dir: nonExistent } }, PATHS: {} }
    };
    delete require.cache[require.resolve('../../../src/platforms/drivers/codex/config')];
    expect(getModule().isCodexInstalled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------
describe('loadConfig', () => {
  test('returns null when config.toml does not exist', () => {
    expect(getModule().loadConfig()).toBeNull();
  });

  test('parses valid TOML and returns object', () => {
    const tomlContent = '[model]\nname = "gpt-4o"\ntemperature = 0.7\n';
    fs.writeFileSync(path.join(testDir, 'config.toml'), tomlContent, 'utf8');
    const result = getModule().loadConfig();
    expect(result).not.toBeNull();
    expect(result.model.name).toBe('gpt-4o');
    expect(result.model.temperature).toBeCloseTo(0.7);
  });

  test('returns null for invalid TOML', () => {
    fs.writeFileSync(path.join(testDir, 'config.toml'), 'not = valid = toml ===', 'utf8');
    expect(getModule().loadConfig()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadAuth
// ---------------------------------------------------------------------------
describe('loadAuth', () => {
  test('returns {} when auth.json does not exist', () => {
    expect(getModule().loadAuth()).toEqual({});
  });

  test('parses valid JSON and returns object', () => {
    const auth = { token: 'abc123', user: 'test' };
    fs.writeFileSync(path.join(testDir, 'auth.json'), JSON.stringify(auth), 'utf8');
    expect(getModule().loadAuth()).toEqual(auth);
  });

  test('returns {} for invalid JSON', () => {
    fs.writeFileSync(path.join(testDir, 'auth.json'), '{bad json', 'utf8');
    expect(getModule().loadAuth()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// loadHistory
// ---------------------------------------------------------------------------
describe('loadHistory', () => {
  test('returns [] when history.jsonl does not exist', () => {
    expect(getModule().loadHistory()).toEqual([]);
  });

  test('parses valid JSONL and returns array of objects', () => {
    const lines = [
      JSON.stringify({ role: 'user', content: 'hello' }),
      JSON.stringify({ role: 'assistant', content: 'hi' })
    ].join('\n');
    fs.writeFileSync(path.join(testDir, 'history.jsonl'), lines, 'utf8');
    const result = getModule().loadHistory();
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });

  test('invalid JSON lines are filtered out', () => {
    const lines = [
      JSON.stringify({ role: 'user', content: 'hello' }),
      'not json at all',
      JSON.stringify({ role: 'assistant', content: 'hi' })
    ].join('\n');
    fs.writeFileSync(path.join(testDir, 'history.jsonl'), lines, 'utf8');
    const result = getModule().loadHistory();
    expect(result).toHaveLength(2);
  });
});
