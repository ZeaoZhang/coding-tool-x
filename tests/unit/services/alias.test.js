'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ALIAS_PATH = require.resolve('../../../src/server/services/alias');
const PATHS_PATH = require.resolve('../../../src/config/paths');

let testDir;
let aliasFile;
let loadAliases, setAlias, deleteAlias, getAlias;

beforeEach(() => {
  testDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-alias-test-'));
  aliasFile = path.join(testDir, 'aliases.json');

  delete require.cache[ALIAS_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH, filename: PATHS_PATH, loaded: true,
    exports: { PATHS: { aliases: aliasFile } }
  };

  const mod  = require('../../../src/server/services/alias');
  loadAliases  = mod.loadAliases;
  setAlias     = mod.setAlias;
  deleteAlias  = mod.deleteAlias;
  getAlias     = mod.getAlias;
});

afterEach(() => {
  delete require.cache[ALIAS_PATH];
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── loadAliases ──────────────────────────────────────────────────────────────

describe('loadAliases', () => {
  test('returns empty object when file does not exist', () => {
    expect(loadAliases()).toEqual({});
  });

  test('returns parsed JSON when file exists', () => {
    fs.writeFileSync(aliasFile, JSON.stringify({ 'session-1': 'my-alias' }), 'utf8');
    expect(loadAliases()).toEqual({ 'session-1': 'my-alias' });
  });

  test('returns empty object when file contains invalid JSON', () => {
    fs.writeFileSync(aliasFile, 'not-valid-json{{{', 'utf8');
    expect(loadAliases()).toEqual({});
  });
});

// ─── setAlias ─────────────────────────────────────────────────────────────────

describe('setAlias', () => {
  test('sets an alias and returns the updated aliases object', () => {
    const result = setAlias('session-1', 'my-project');
    expect(result).toEqual({ 'session-1': 'my-project' });
  });

  test('persists the alias to disk', () => {
    setAlias('session-1', 'saved-alias');
    const parsed = JSON.parse(fs.readFileSync(aliasFile, 'utf8'));
    expect(parsed['session-1']).toBe('saved-alias');
  });

  test('adds to existing aliases without overwriting others', () => {
    fs.writeFileSync(aliasFile, JSON.stringify({ 'session-1': 'alias-one' }), 'utf8');
    const result = setAlias('session-2', 'alias-two');
    expect(result).toEqual({ 'session-1': 'alias-one', 'session-2': 'alias-two' });
  });

  test('overwrites existing alias for same sessionId', () => {
    setAlias('session-1', 'old-alias');
    const result = setAlias('session-1', 'new-alias');
    expect(result['session-1']).toBe('new-alias');
  });
});

// ─── deleteAlias ──────────────────────────────────────────────────────────────

describe('deleteAlias', () => {
  test('removes the alias and returns remaining aliases', () => {
    setAlias('session-1', 'alias-one');
    setAlias('session-2', 'alias-two');
    const result = deleteAlias('session-1');
    expect(result).toEqual({ 'session-2': 'alias-two' });
  });

  test('persists the deletion to disk', () => {
    setAlias('session-1', 'alias-one');
    deleteAlias('session-1');
    const parsed = JSON.parse(fs.readFileSync(aliasFile, 'utf8'));
    expect(parsed['session-1']).toBeUndefined();
  });

  test('returns empty object when deleting the only alias', () => {
    setAlias('session-1', 'alias-one');
    expect(deleteAlias('session-1')).toEqual({});
  });

  test('returns unchanged aliases when sessionId does not exist', () => {
    setAlias('session-1', 'alias-one');
    const result = deleteAlias('non-existent');
    expect(result).toEqual({ 'session-1': 'alias-one' });
  });
});

// ─── getAlias ─────────────────────────────────────────────────────────────────

describe('getAlias', () => {
  test('returns the alias string for an existing sessionId', () => {
    setAlias('session-1', 'my-alias');
    expect(getAlias('session-1')).toBe('my-alias');
  });

  test('returns null for a non-existing sessionId', () => {
    setAlias('session-1', 'my-alias');
    expect(getAlias('session-99')).toBeNull();
  });

  test('returns null when no file exists', () => {
    expect(getAlias('session-1')).toBeNull();
  });
});

// ─── multiple operations ──────────────────────────────────────────────────────

describe('multiple operations', () => {
  test('set two aliases, delete one, get the remaining', () => {
    setAlias('session-a', 'alpha');
    setAlias('session-b', 'beta');
    deleteAlias('session-a');
    expect(getAlias('session-a')).toBeNull();
    expect(getAlias('session-b')).toBe('beta');
  });
});
