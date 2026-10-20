'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PATHS_PATH = require.resolve('../../../src/config/paths');
const LOADER_PATH = require.resolve('../../../src/config/loader');
const PRICING_PATH = require.resolve('../../../src/server/utils/pricing');
const USAGE_PATH = require.resolve('../../../src/server/services/usage-log-utils');

let testDir;
let originalPathsModule;
let pricing;
let usage;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-overrides-'));
  const configFile = path.join(testDir, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({
    modelMetadataOverrides: {
      'gpt-5.5': {
        pricing: { input: 99, output: 88, cacheRead: 9 }
      },
      'custom-model': {
        pricing: { input: 1, output: 2, cacheRead: 0.1 }
      }
    }
  }), 'utf8');

  originalPathsModule = require.cache[PATHS_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      PATHS: { configFile },
      NATIVE_PATHS: { claude: { projects: path.join(testDir, 'projects') } },
      ensureStorageDirMigrated: vi.fn()
    }
  };
  delete require.cache[LOADER_PATH];
  delete require.cache[PRICING_PATH];
  delete require.cache[USAGE_PATH];
  pricing = require('../../../src/server/utils/pricing');
  usage = require('../../../src/server/services/usage-log-utils');
});

afterEach(() => {
  delete require.cache[USAGE_PATH];
  delete require.cache[LOADER_PATH];
  delete require.cache[PRICING_PATH];
  if (originalPathsModule) {
    require.cache[PATHS_PATH] = originalPathsModule;
  } else {
    delete require.cache[PATHS_PATH];
  }
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('modelMetadataOverrides pricing precedence', () => {
  it('reuses prices within a scan and refreshes them for the next scan', () => {
    const configFile = path.join(testDir, 'config.json');
    const read = vi.spyOn(fs, 'readFileSync');
    try {
      const calculate = usage.createUsageCostCalculator('opencode');
      expect(calculate('gpt-5.5', { input: 1000000 })).toBe(99);
      expect(calculate('gpt-5.5', { output: 1000000 })).toBe(88);
      expect(read.mock.calls.filter(([file]) => file === configFile)).toHaveLength(1);
      fs.writeFileSync(configFile, JSON.stringify({ modelMetadataOverrides: { 'gpt-5.5': { pricing: { input: 7 } } } }));
      expect(usage.createUsageCostCalculator('opencode')('gpt-5.5', { input: 1000000 })).toBe(7);
    } finally { read.mockRestore(); }
  });

  it('limits a scan pricing cache to 64 models and excludes oversized keys', () => {
    const configFile = path.join(testDir, 'config.json');
    const read = vi.spyOn(fs, 'readFileSync');
    try {
      const calculate = usage.createUsageCostCalculator('opencode');
      for (let i = 0; i < 65; i++) calculate(`unknown-${i}`, { input: 1 });
      calculate('unknown-64', { input: 2 });
      calculate('unknown-0', { input: 2 });
      expect(read.mock.calls.filter(([file]) => file === configFile)).toHaveLength(66);
      calculate('x'.repeat(2049), { input: 1 });
      calculate('x'.repeat(2049), { input: 1 });
      expect(read.mock.calls.filter(([file]) => file === configFile)).toHaveLength(68);
    } finally { read.mockRestore(); }
  });

  it('keeps Gemini reasoning and cache token billing in a scan calculator', () => {
    const tokens = { input: 10, output: 20, reasoning: 30, cacheRead: 40 };
    expect(usage.createUsageCostCalculator('gemini')('gpt-5.5', tokens))
      .toBe(usage.calculateUsageCost('gemini', 'gpt-5.5', tokens));
  });

  it('uses an override before model-metadata.json pricing', () => {
    expect(pricing.resolveModelPricing('codex', 'gpt-5.5')).toEqual({
      input: 99,
      output: 88,
      cacheRead: 9
    });
  });

  it('uses the same override when calculating the recorded usage cost', () => {
    expect(usage.calculateUsageCost('codex', 'gpt-5.5', {
      input: 1000000,
      output: 1000000
    })).toBeCloseTo(187, 8);
  });

  it('provides pricing for a custom model absent from model-metadata.json', () => {
    expect(pricing.resolveModelPricing('opencode', 'custom-model')).toEqual({
      input: 1,
      output: 2,
      cacheRead: 0.1
    });
  });

  it('returns no pricing when neither source has the model', () => {
    expect(pricing.resolveModelPricing('claude', 'unknown-model')).toEqual({});
  });
});
