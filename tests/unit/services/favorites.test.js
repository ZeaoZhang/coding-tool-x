'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const FAVORITES_PATH = require.resolve('../../../src/server/services/favorites');
const PATHS_PATH     = require.resolve('../../../src/config/paths');

let testDir;
let favoritesFile;
let loadFavorites, saveFavorites, addFavorite, removeFavorite, isFavorite, getFavorites, getAllFavorites;

beforeEach(() => {
  testDir       = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-favorites-test-'));
  favoritesFile = path.join(testDir, 'favorites.json');

  delete require.cache[FAVORITES_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH, filename: PATHS_PATH, loaded: true,
    exports: { PATHS: { favorites: favoritesFile } }
  };

  const mod    = require('../../../src/server/services/favorites');
  loadFavorites  = mod.loadFavorites;
  saveFavorites  = mod.saveFavorites;
  addFavorite    = mod.addFavorite;
  removeFavorite = mod.removeFavorite;
  isFavorite     = mod.isFavorite;
  getFavorites   = mod.getFavorites;
  getAllFavorites = mod.getAllFavorites;
});

afterEach(() => {
  delete require.cache[FAVORITES_PATH];
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── loadFavorites ────────────────────────────────────────────────────────────

describe('loadFavorites', () => {
  test('returns default empty arrays for all channels when file does not exist', () => {
    expect(loadFavorites()).toEqual({ claude: [], codex: [], gemini: [], opencode: [] });
  });

  test('returns parsed data from file when it exists', () => {
    const data = { claude: [{ sessionId: 's1', projectName: 'proj' }], codex: [], gemini: [], opencode: [] };
    fs.writeFileSync(favoritesFile, JSON.stringify(data), 'utf8');
    // Re-require so the cache initializes from the file we just wrote
    delete require.cache[FAVORITES_PATH];
    const mod = require('../../../src/server/services/favorites');
    const result = mod.loadFavorites();
    expect(result.claude).toHaveLength(1);
    expect(result.claude[0].sessionId).toBe('s1');
  });

  test('returns a deep copy — mutations do not affect internal cache', () => {
    const first = loadFavorites();
    first.claude.push({ sessionId: 'injected', projectName: 'hack' });
    const second = loadFavorites();
    expect(second.claude).toHaveLength(0);
  });
});

// ─── saveFavorites ────────────────────────────────────────────────────────────

describe('saveFavorites', () => {
  test('writes favorites JSON to disk', () => {
    const data = { claude: [{ sessionId: 's1', projectName: 'p1' }], codex: [], gemini: [], opencode: [] };
    saveFavorites(data);
    const parsed = JSON.parse(fs.readFileSync(favoritesFile, 'utf8'));
    expect(parsed.claude[0].sessionId).toBe('s1');
  });

  test('updates in-memory cache so loadFavorites reflects the new state', () => {
    const data = { claude: [{ sessionId: 's2', projectName: 'p2' }], codex: [], gemini: [], opencode: [] };
    saveFavorites(data);
    expect(loadFavorites().claude[0].sessionId).toBe('s2');
  });
});

// ─── addFavorite ──────────────────────────────────────────────────────────────

describe('addFavorite', () => {
  test('adds a session to the specified channel and returns success: true', () => {
    const result = addFavorite('claude', { sessionId: 's1', projectName: 'proj1' });
    expect(result.success).toBe(true);
    expect(result.favorites.claude).toHaveLength(1);
    expect(result.favorites.claude[0].sessionId).toBe('s1');
  });

  test('attaches an addedAt timestamp when adding', () => {
    const result = addFavorite('codex', { sessionId: 's1', projectName: 'proj1' });
    expect(result.favorites.codex[0].addedAt).toBeTypeOf('number');
  });

  test('returns success: false with "Already exists" when adding a duplicate', () => {
    const session = { sessionId: 's1', projectName: 'proj1' };
    addFavorite('claude', session);
    const second = addFavorite('claude', session);
    expect(second.success).toBe(false);
    expect(second.message).toBe('Already exists');
    expect(second.favorites.claude).toHaveLength(1);
  });

  test('duplicate detection uses both sessionId and projectName', () => {
    addFavorite('claude', { sessionId: 's1', projectName: 'proj1' });
    // Same sessionId but different projectName — not a duplicate
    const result = addFavorite('claude', { sessionId: 's1', projectName: 'proj2' });
    expect(result.success).toBe(true);
    expect(result.favorites.claude).toHaveLength(2);
  });
});

// ─── removeFavorite ───────────────────────────────────────────────────────────

describe('removeFavorite', () => {
  test('removes a matching favorite and returns success: true', () => {
    addFavorite('gemini', { sessionId: 's1', projectName: 'proj1' });
    const result = removeFavorite('gemini', 'proj1', 's1');
    expect(result.success).toBe(true);
    expect(result.favorites.gemini).toHaveLength(0);
  });

  test('returns success: false with "Not found" when item does not exist', () => {
    const result = removeFavorite('claude', 'no-project', 'no-session');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Not found');
  });

  test('returns success: false with "Channel not found" for an unknown channel', () => {
    const result = removeFavorite('unknown-channel', 'proj', 'sess');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Channel not found');
  });

  test('only removes the matched item, leaving others intact', () => {
    addFavorite('claude', { sessionId: 's1', projectName: 'proj1' });
    addFavorite('claude', { sessionId: 's2', projectName: 'proj2' });
    removeFavorite('claude', 'proj1', 's1');
    const remaining = getFavorites('claude');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sessionId).toBe('s2');
  });
});

// ─── isFavorite ───────────────────────────────────────────────────────────────

describe('isFavorite', () => {
  test('returns true when the session is a favorite', () => {
    addFavorite('opencode', { sessionId: 's1', projectName: 'proj1' });
    expect(isFavorite('opencode', 'proj1', 's1')).toBe(true);
  });

  test('returns false when the session is not a favorite', () => {
    expect(isFavorite('opencode', 'proj1', 's1')).toBe(false);
  });

  test('returns false for an unknown channel', () => {
    expect(isFavorite('unknown', 'proj1', 's1')).toBe(false);
  });
});

// ─── getFavorites ─────────────────────────────────────────────────────────────

describe('getFavorites', () => {
  test('returns the array for a specific channel', () => {
    addFavorite('codex', { sessionId: 's1', projectName: 'proj1' });
    const result = getFavorites('codex');
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].sessionId).toBe('s1');
  });

  test('returns empty array for a channel with no favorites', () => {
    expect(getFavorites('gemini')).toEqual([]);
  });
});

// ─── getAllFavorites ──────────────────────────────────────────────────────────

describe('getAllFavorites', () => {
  test('returns all channels with their favorites', () => {
    addFavorite('claude', { sessionId: 's1', projectName: 'p1' });
    addFavorite('codex', { sessionId: 's2', projectName: 'p2' });
    const all = getAllFavorites();
    expect(all.claude).toHaveLength(1);
    expect(all.codex).toHaveLength(1);
    expect(all.gemini).toHaveLength(0);
    expect(all.opencode).toHaveLength(0);
  });
});
