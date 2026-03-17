/**
 * Tests for src/server/services/gemini-channels.js
 *
 * Strategy: inject stubs into require.cache before requiring the module.
 * File I/O is redirected to a tmpdir created fresh in beforeEach.
 */

const os   = require('os');
const fs   = require('fs');
const path = require('path');

// ─── Absolute paths for deps that need to be stubbed ─────────────────────────

const PATHS_MODULE        = require.resolve('../../../src/config/paths');
const NATIVE_OAUTH_MODULE = require.resolve('../../../src/server/services/native-oauth-adapters');
const PROXY_UTILS_MODULE  = require.resolve('../../../src/server/services/base/proxy-utils');
const GEMINI_PROXY_MODULE = require.resolve('../../../src/server/gemini-proxy-server');
const GEMINI_CH_MODULE    = require.resolve('../../../src/server/services/gemini-channels');

// ─── Per-test state ───────────────────────────────────────────────────────────

let testDir, channelsFile, geminiDir;
let clearNativeOAuth;
let getGeminiProxyStatus;
let service;

function injectStubs() {
  clearNativeOAuth     = vi.fn();
  getGeminiProxyStatus = vi.fn(() => ({ running: false }));

  require.cache[PATHS_MODULE] = {
    id: PATHS_MODULE, filename: PATHS_MODULE, loaded: true,
    exports: {
      PATHS: {
        channels: { gemini: channelsFile }
      },
      NATIVE_PATHS: {
        gemini: {
          env:      path.join(geminiDir, '.env'),
          settings: path.join(geminiDir, 'settings.json')
        }
      }
    }
  };

  require.cache[NATIVE_OAUTH_MODULE] = {
    id: NATIVE_OAUTH_MODULE, filename: NATIVE_OAUTH_MODULE, loaded: true,
    exports: { clearNativeOAuth }
  };

  require.cache[PROXY_UTILS_MODULE] = {
    id: PROXY_UTILS_MODULE, filename: PROXY_UTILS_MODULE, loaded: true,
    exports: {
      normalizeGatewaySourceType: (v, d) => v || d
    }
  };

  require.cache[GEMINI_PROXY_MODULE] = {
    id: GEMINI_PROXY_MODULE, filename: GEMINI_PROXY_MODULE, loaded: true,
    exports: { getGeminiProxyStatus }
  };
}

beforeEach(() => {
  testDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-ch-'));
  channelsFile = path.join(testDir, 'gemini-channels.json');
  geminiDir    = path.join(testDir, 'gemini');
  fs.mkdirSync(geminiDir, { recursive: true });

  delete require.cache[GEMINI_CH_MODULE];
  injectStubs();
  service = require('../../../src/server/services/gemini-channels');
});

afterEach(() => {
  delete require.cache[GEMINI_CH_MODULE];
  fs.rmSync(testDir, { recursive: true, force: true });
});

// ─── loadChannels / getChannels ───────────────────────────────────────────────

describe('getChannels - no file', () => {
  it('returns channels array when channels file does not exist', () => {
    // No .env either, so initializeFromEnv returns empty
    const result = service.getChannels();
    expect(Array.isArray(result.channels)).toBe(true);
  });
});

describe('getChannels - valid file', () => {
  it('parses existing channels and applies defaults', () => {
    const raw = {
      channels: [
        { id: 'ch1', name: 'Test', baseUrl: 'https://api.example.com', apiKey: 'key1', model: 'gemini-2.5-pro' }
      ]
    };
    fs.writeFileSync(channelsFile, JSON.stringify(raw), 'utf8');

    const result = service.getChannels();
    expect(result.channels).toHaveLength(1);
    const ch = result.channels[0];
    expect(ch.id).toBe('ch1');
    expect(ch.enabled).toBe(true);       // default applied
    expect(ch.weight).toBe(1);           // default applied
    expect(ch.modelRedirects).toEqual([]); // default applied
    expect(ch.gatewaySourceType).toBe('gemini'); // normalizeGatewaySourceType stub
  });

  it('preserves explicit enabled=false from file', () => {
    const raw = {
      channels: [
        { id: 'ch2', name: 'Disabled', baseUrl: 'https://x.com', apiKey: 'k', model: 'gemini-2.5-pro', enabled: false }
      ]
    };
    fs.writeFileSync(channelsFile, JSON.stringify(raw), 'utf8');

    const result = service.getChannels();
    expect(result.channels[0].enabled).toBe(false);
  });
});

// ─── createChannel ────────────────────────────────────────────────────────────

describe('createChannel', () => {
  it('creates a channel and persists it to the channels file', () => {
    const ch = service.createChannel('Alpha', 'https://alpha.api.com', 'key-alpha');

    expect(ch.id).toBeTruthy();
    expect(ch.name).toBe('Alpha');
    expect(ch.baseUrl).toBe('https://alpha.api.com');
    expect(ch.apiKey).toBe('key-alpha');
    expect(ch.enabled).toBe(true);

    const saved = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
    expect(saved.channels).toHaveLength(1);
    expect(saved.channels[0].name).toBe('Alpha');
  });

  it('throws when a channel with the same name already exists', () => {
    service.createChannel('Alpha', 'https://alpha.api.com', 'key-alpha');
    expect(() => service.createChannel('Alpha', 'https://other.com', 'key2'))
      .toThrow(/already exists/i);
  });

  it('accepts extra config options', () => {
    const ch = service.createChannel('Beta', 'https://beta.com', 'k', 'gemini-1.5', {
      weight: 3,
      maxConcurrency: 5,
      enabled: false
    });
    expect(ch.weight).toBe(3);
    expect(ch.maxConcurrency).toBe(5);
    expect(ch.enabled).toBe(false);
  });
});

// ─── updateChannel ────────────────────────────────────────────────────────────

describe('updateChannel', () => {
  it('updates channel fields and persists the change', () => {
    const ch = service.createChannel('Gamma', 'https://gamma.com', 'key-g');
    const updated = service.updateChannel(ch.id, { name: 'Gamma-Updated', weight: 2 });

    expect(updated.name).toBe('Gamma-Updated');
    expect(updated.weight).toBe(2);
    expect(updated.id).toBe(ch.id); // ID preserved

    const saved = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
    expect(saved.channels[0].name).toBe('Gamma-Updated');
  });

  it('throws when channel id is not found', () => {
    expect(() => service.updateChannel('non-existent-id', { name: 'X' }))
      .toThrow('Channel not found');
  });

  it('throws on name conflict with another channel', () => {
    const ch1 = service.createChannel('One', 'https://one.com', 'k1');
    service.createChannel('Two', 'https://two.com', 'k2');
    expect(() => service.updateChannel(ch1.id, { name: 'Two' }))
      .toThrow(/already exists/i);
  });
});

// ─── deleteChannel ────────────────────────────────────────────────────────────

describe('deleteChannel', () => {
  it('removes the channel from the stored file', async () => {
    const ch = service.createChannel('Delta', 'https://delta.com', 'key-d');
    await service.deleteChannel(ch.id);

    const saved = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
    expect(saved.channels).toHaveLength(0);
  });

  it('throws when channel id is not found', async () => {
    await expect(service.deleteChannel('no-such-id')).rejects.toThrow('Channel not found');
  });
});

// ─── single-channel enforcement ──────────────────────────────────────────────

describe('single-channel enforcement (proxy OFF)', () => {
  it('enabling a channel via updateChannel disables all others when proxy is off', () => {
    getGeminiProxyStatus.mockReturnValue({ running: false });

    const ch1 = service.createChannel('Ch1', 'https://c1.com', 'k1', 'gemini-2.5-pro', { enabled: true });
    const ch2 = service.createChannel('Ch2', 'https://c2.com', 'k2', 'gemini-2.5-pro', { enabled: false });

    // Enable ch2 while proxy is off
    service.updateChannel(ch2.id, { enabled: true });

    const saved = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
    const savedCh1 = saved.channels.find(c => c.id === ch1.id);
    const savedCh2 = saved.channels.find(c => c.id === ch2.id);

    expect(savedCh2.enabled).toBe(true);
    expect(savedCh1.enabled).toBe(false);
  });

  it('does NOT disable others when proxy is running', () => {
    getGeminiProxyStatus.mockReturnValue({ running: true });

    const ch1 = service.createChannel('Ch1', 'https://c1.com', 'k1', 'gemini-2.5-pro', { enabled: true });
    const ch2 = service.createChannel('Ch2', 'https://c2.com', 'k2', 'gemini-2.5-pro', { enabled: false });

    service.updateChannel(ch2.id, { enabled: true });

    const saved = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
    const savedCh1 = saved.channels.find(c => c.id === ch1.id);
    expect(savedCh1.enabled).toBe(true); // unchanged
  });
});

// ─── applyChannelToSettings ───────────────────────────────────────────────────

describe('applyChannelToSettings', () => {
  it('writes .env and settings.json to gemini dir', () => {
    const ch = service.createChannel('Epsilon', 'https://eps.com', 'key-eps');
    service.applyChannelToSettings(ch.id);

    const envContent = fs.readFileSync(path.join(geminiDir, '.env'), 'utf8');
    expect(envContent).toContain('GOOGLE_GEMINI_BASE_URL=https://eps.com');
    expect(envContent).toContain('GEMINI_API_KEY=key-eps');

    const settings = JSON.parse(fs.readFileSync(path.join(geminiDir, 'settings.json'), 'utf8'));
    expect(settings.security.auth.selectedType).toBe('gemini-api-key');
  });

  it('disables all other channels in single-channel mode', () => {
    const ch1 = service.createChannel('F1', 'https://f1.com', 'k1');
    const ch2 = service.createChannel('F2', 'https://f2.com', 'k2');

    service.applyChannelToSettings(ch1.id);

    const saved = JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
    const s1 = saved.channels.find(c => c.id === ch1.id);
    const s2 = saved.channels.find(c => c.id === ch2.id);
    expect(s1.enabled).toBe(true);
    expect(s2.enabled).toBe(false);
  });

  it('throws when channel id is not found', () => {
    expect(() => service.applyChannelToSettings('ghost-id')).toThrow('Channel not found');
  });

  it('calls clearNativeOAuth with "gemini"', () => {
    const ch = service.createChannel('Zeta', 'https://z.com', 'kz');
    service.applyChannelToSettings(ch.id);
    expect(clearNativeOAuth).toHaveBeenCalledWith('gemini');
  });
});
