'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const pathsModPath = require.resolve('../../../src/config/paths');

let testDir;
let envPath;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-config-'));
  envPath = path.join(testDir, '.env');

  // Inject stub for NATIVE_PATHS so gemini-config uses testDir/.env
  require.cache[pathsModPath] = {
    id: pathsModPath,
    filename: pathsModPath,
    loaded: true,
    exports: { NATIVE_PATHS: { gemini: { env: envPath } }, PATHS: {} }
  };

  delete require.cache[require.resolve('../../../src/platforms/drivers/gemini/config')];
});

afterEach(() => {
  delete require.cache[pathsModPath];
  delete require.cache[require.resolve('../../../src/platforms/drivers/gemini/config')];
  fs.rmSync(testDir, { recursive: true, force: true });
});

function getModule() {
  return require('../../../src/platforms/drivers/gemini/config');
}

// ---------------------------------------------------------------------------
// getGeminiDir
// ---------------------------------------------------------------------------
describe('getGeminiDir', () => {
  test('returns dirname of envPath (i.e. testDir)', () => {
    expect(getModule().getGeminiDir()).toBe(testDir);
  });
});

// ---------------------------------------------------------------------------
// isGeminiInstalled
// ---------------------------------------------------------------------------
describe('isGeminiInstalled', () => {
  test('returns true when dir exists', () => {
    expect(getModule().isGeminiInstalled()).toBe(true);
  });

  test('returns false when dir does not exist', () => {
    const nonExistent = path.join(os.tmpdir(), 'gemini-no-such-dir-' + Date.now());
    const nonExistentEnv = path.join(nonExistent, '.env');
    require.cache[pathsModPath] = {
      id: pathsModPath, filename: pathsModPath, loaded: true,
      exports: { NATIVE_PATHS: { gemini: { env: nonExistentEnv } }, PATHS: {} }
    };
    delete require.cache[require.resolve('../../../src/platforms/drivers/gemini/config')];
    expect(getModule().isGeminiInstalled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadEnv
// ---------------------------------------------------------------------------
describe('loadEnv', () => {
  test('returns {} when .env does not exist', () => {
    expect(getModule().loadEnv()).toEqual({});
  });

  test('parses KEY=VALUE lines into object', () => {
    fs.writeFileSync(envPath, 'API_KEY=mykey\nMODEL=gemini-pro\n', 'utf8');
    expect(getModule().loadEnv()).toEqual({ API_KEY: 'mykey', MODEL: 'gemini-pro' });
  });

  test('skips comment lines starting with #', () => {
    fs.writeFileSync(envPath, '# this is a comment\nKEY=value\n', 'utf8');
    expect(getModule().loadEnv()).toEqual({ KEY: 'value' });
  });

  test('skips empty lines', () => {
    fs.writeFileSync(envPath, '\n\nKEY=value\n\n', 'utf8');
    expect(getModule().loadEnv()).toEqual({ KEY: 'value' });
  });

  test('value with equals sign is correctly parsed (only first = splits)', () => {
    fs.writeFileSync(envPath, 'URL=https://example.com?a=1&b=2\n', 'utf8');
    const result = getModule().loadEnv();
    expect(result.URL).toBe('https://example.com?a=1&b=2');
  });
});

// ---------------------------------------------------------------------------
// loadSettings
// ---------------------------------------------------------------------------
describe('loadSettings', () => {
  test('returns {} when settings.json does not exist', () => {
    expect(getModule().loadSettings()).toEqual({});
  });

  test('parses valid JSON and returns object', () => {
    const settings = { theme: 'dark', maxTokens: 2048 };
    fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify(settings), 'utf8');
    expect(getModule().loadSettings()).toEqual(settings);
  });

  test('returns {} for invalid JSON', () => {
    fs.writeFileSync(path.join(testDir, 'settings.json'), '{invalid', 'utf8');
    expect(getModule().loadSettings()).toEqual({});
  });
});
