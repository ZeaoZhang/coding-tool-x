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
