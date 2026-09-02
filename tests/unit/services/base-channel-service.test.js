// globals: true in vitest.config.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const BaseChannelService = require('../../../src/shared/base-channel-service');

let tempDir;
let channelsFile;
let clearChannelBalanceCache;
const CHANNEL_BALANCE_PATH = require.resolve('../../../src/server/services/channel-balance');

function createService(overrides = {}) {
  return new BaseChannelService({
    platform: 'test',
    channelsFilePath: channelsFile,
    defaultGatewaySource: 'claude',
    isProxyRunning: () => false,
    ...overrides,
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-base-channel-test-'));
  channelsFile = path.join(tempDir, 'channels', 'test.json');
  clearChannelBalanceCache = vi.fn();
  require.cache[CHANNEL_BALANCE_PATH] = {
    id: CHANNEL_BALANCE_PATH,
    filename: CHANNEL_BALANCE_PATH,
    loaded: true,
    exports: { clearChannelBalanceCache }
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('BaseChannelService', () => {
  describe('loadChannels / saveChannels', () => {
    it('should return empty channels when file does not exist', () => {
      const svc = createService();
      const data = svc.loadChannels();
      expect(data.channels).toEqual([]);
    });

    it('should save and load channels', () => {
      const svc = createService();
      svc.saveChannels({ channels: [{ id: 'ch1', name: 'Test' }] });
      const data = svc.loadChannels();
      expect(data.channels).toHaveLength(1);
      expect(data.channels[0].name).toBe('Test');
    });

    it('should apply defaults on load', () => {
      const svc = createService();
      svc.saveChannels({ channels: [{ id: 'ch1', name: 'Test' }] });
      const data = svc.loadChannels();
      expect(data.channels[0].enabled).toBe(true);
      expect(data.channels[0].weight).toBe(1);
    });

    it('should backfill websiteUrl from known preset metadata', () => {
      const svc = createService({ platform: 'claude' });
      svc.saveChannels({
        channels: [{
          id: 'ch1',
          name: 'Claude Official',
          presetId: 'official',
          baseUrl: 'https://api.anthropic.com'
        }]
      });
      const data = svc.loadChannels();
      expect(data.channels[0].websiteUrl).toBe('https://www.anthropic.com');
    });
  });
    it('reuses channel data while the file mtime is unchanged', () => {
      fs.mkdirSync(path.dirname(channelsFile), { recursive: true });
      fs.writeFileSync(channelsFile, JSON.stringify({ channels: [{ id: 'cached', name: 'Cached' }] }));
      const svc = createService();
      const readSpy = vi.spyOn(fs, 'readFileSync');

      const first = svc.loadChannels();
      const second = svc.loadChannels();

      expect(second).toEqual(first);
      expect(readSpy.mock.calls.filter(([filePath]) => filePath === channelsFile)).toHaveLength(1);
    });

    it('updates the cache immediately after saveChannels', () => {
      const svc = createService();
      svc.saveChannels({ channels: [{ id: 'saved', name: 'Saved' }] });

      expect(svc.loadChannels().channels).toEqual([
        expect.objectContaining({ id: 'saved', name: 'Saved' })
      ]);
    });

  it('reloads channels after an external mtime change', () => {
    const svc = createService();
    svc.saveChannels({ channels: [{ id: 'before', name: 'Before' }] });
    fs.writeFileSync(channelsFile, JSON.stringify({ channels: [{ id: 'after', name: 'After' }] }));

    expect(svc.loadChannels().channels).toEqual([
      expect.objectContaining({ id: 'after', name: 'After' })
    ]);
  });

  describe('createChannel', () => {
    it('should create a channel with generated id and timestamps', () => {
      const svc = createService();
      const ch = svc.createChannel({ name: 'New Channel', apiKey: 'sk-123' });
      expect(ch.id).toBeTruthy();
      expect(ch.name).toBe('New Channel');
      expect(ch.apiKey).toBe('sk-123');
      expect(ch.createdAt).toBeGreaterThan(0);
      expect(ch.updatedAt).toBeGreaterThan(0);
      expect(ch.enabled).toBe(true);
    });

    it('should persist the created channel', () => {
      const svc = createService();
      svc.createChannel({ name: 'Ch1' });
      const data = svc.getChannels();
      expect(data.channels).toHaveLength(1);
    });

    it('should enforce single-channel when proxy is off', () => {
      const svc = createService({ isProxyRunning: () => false });
      svc.createChannel({ name: 'Ch1', enabled: true });
      svc.createChannel({ name: 'Ch2', enabled: true });
      const data = svc.getChannels();
      const enabled = data.channels.filter(ch => ch.enabled);
      expect(enabled).toHaveLength(1);
      expect(enabled[0].name).toBe('Ch2');
    });

    it('should allow multiple enabled channels when proxy is on', () => {
      const svc = createService({ isProxyRunning: () => true });
      svc.createChannel({ name: 'Ch1', enabled: true });
      svc.createChannel({ name: 'Ch2', enabled: true });
      const data = svc.getChannels();
      const enabled = data.channels.filter(ch => ch.enabled);
      expect(enabled).toHaveLength(2);
    });
  });

  describe('updateChannel', () => {
    it('should update channel fields', () => {
      const svc = createService();
      const ch = svc.createChannel({ name: 'Original' });
      const updated = svc.updateChannel(ch.id, { name: 'Updated' });
      expect(updated.name).toBe('Updated');
      expect(updated.id).toBe(ch.id);
    });

    it('should throw for non-existent channel', () => {
      const svc = createService();
      expect(() => svc.updateChannel('nonexistent', { name: 'X' }))
        .toThrow('Channel not found');
    });

    it('should enforce single-channel on enable when proxy is off', () => {
      const svc = createService({ isProxyRunning: () => false });
      const ch1 = svc.createChannel({ name: 'Ch1', enabled: true });
      svc.createChannel({ name: 'Ch2', enabled: false });
      const data = svc.getChannels();
      const ch2 = data.channels.find(c => c.name === 'Ch2');
      svc.updateChannel(ch2.id, { enabled: true });
      const after = svc.getChannels();
      const enabled = after.channels.filter(c => c.enabled);
      expect(enabled).toHaveLength(1);
      expect(enabled[0].name).toBe('Ch2');
    });

    it('clears the balance cache when a channel is re-enabled', () => {
      const svc = createService({ isProxyRunning: () => true });
      const ch = svc.createChannel({ name: 'Ch1', enabled: false, baseUrl: 'https://api.example', apiKey: 'sk-test' });

      const updated = svc.updateChannel(ch.id, { enabled: true });

      expect(clearChannelBalanceCache).toHaveBeenCalledWith('test', expect.objectContaining({
        id: ch.id,
        enabled: true
      }));
      expect(updated.enabled).toBe(true);
    });

    it('does not clear the balance cache for ordinary edits', () => {
      const svc = createService();
      const ch = svc.createChannel({ name: 'Ch1', enabled: true });
      clearChannelBalanceCache.mockClear();

      svc.updateChannel(ch.id, { name: 'Ch1 edited' });

      expect(clearChannelBalanceCache).not.toHaveBeenCalled();
    });

    it('should update updatedAt timestamp', () => {
      const svc = createService();
      const ch = svc.createChannel({ name: 'Ch1' });
      const before = ch.updatedAt;
      // Small delay to ensure different timestamp
      const updated = svc.updateChannel(ch.id, { name: 'Ch1-v2' });
      expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('deleteChannel', () => {
    it('should remove the channel', () => {
      const svc = createService();
      const ch = svc.createChannel({ name: 'ToDelete' });
      const result = svc.deleteChannel(ch.id);
      expect(result.success).toBe(true);
      expect(svc.getChannels().channels).toHaveLength(0);
    });

    it('should throw for non-existent channel', () => {
      const svc = createService();
      expect(() => svc.deleteChannel('nonexistent'))
        .toThrow('Channel not found');
    });
  });

  describe('getEnabledChannels', () => {
    it('should return only enabled channels', () => {
      const svc = createService({ isProxyRunning: () => true });
      svc.createChannel({ name: 'Enabled', enabled: true });
      svc.createChannel({ name: 'Disabled', enabled: false });
      const enabled = svc.getEnabledChannels();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].name).toBe('Enabled');
    });
  });

  describe('disableAllChannels', () => {
    it('should disable all channels', () => {
      const svc = createService({ isProxyRunning: () => true });
      svc.createChannel({ name: 'Ch1', enabled: true });
      svc.createChannel({ name: 'Ch2', enabled: true });
      svc.disableAllChannels();
      const enabled = svc.getEnabledChannels();
      expect(enabled).toHaveLength(0);
    });
  });

  describe('applyChannelToSettings', () => {
    it('should enable only the target channel', () => {
      class TestService extends BaseChannelService {
        _applyToNativeSettings() { /* no-op for test */ }
      }
      const svc = new TestService({
        platform: 'test',
        channelsFilePath: channelsFile,
        isProxyRunning: () => true,
      });
      svc.createChannel({ name: 'Ch1', enabled: true });
      svc.createChannel({ name: 'Ch2', enabled: true });
      const data = svc.getChannels();
      const disabled = svc.updateChannel(data.channels[0].id, { enabled: false });
      clearChannelBalanceCache.mockClear();
      svc.applyChannelToSettings(disabled.id);
      const after = svc.getChannels();
      expect(after.channels[0].enabled).toBe(true);
      expect(after.channels[1].enabled).toBe(false);
      expect(clearChannelBalanceCache).toHaveBeenCalledWith('test', expect.objectContaining({
        id: disabled.id
      }));
    });

    it('should throw for non-existent channel', () => {
      class TestService extends BaseChannelService {
        _applyToNativeSettings() {}
      }
      const svc = new TestService({
        platform: 'test',
        channelsFilePath: channelsFile,
      });
      expect(() => svc.applyChannelToSettings('nonexistent'))
        .toThrow('Channel not found');
    });
  });

  describe('saveChannelOrder', () => {
    it('should reorder channels by id list', () => {
      const svc = createService({ isProxyRunning: () => true });
      const ch1 = svc.createChannel({ name: 'First' });
      const ch2 = svc.createChannel({ name: 'Second' });
      const ch3 = svc.createChannel({ name: 'Third' });
      svc.saveChannelOrder([ch3.id, ch1.id, ch2.id]);
      const data = svc.getChannels();
      expect(data.channels.map(c => c.name)).toEqual(['Third', 'First', 'Second']);
    });

    it('should append channels not in order list', () => {
      const svc = createService({ isProxyRunning: () => true });
      const ch1 = svc.createChannel({ name: 'First' });
      const ch2 = svc.createChannel({ name: 'Second' });
      svc.saveChannelOrder([ch2.id]);
      const data = svc.getChannels();
      expect(data.channels[0].name).toBe('Second');
      expect(data.channels[1].name).toBe('First');
    });
  });

  describe('getEffectiveApiKey', () => {
    it('should return apiKey from channel', () => {
      const svc = createService();
      expect(svc.getEffectiveApiKey({ apiKey: 'sk-123' })).toBe('sk-123');
    });

    it('should return null when no apiKey', () => {
      const svc = createService();
      expect(svc.getEffectiveApiKey({})).toBeNull();
      expect(svc.getEffectiveApiKey(null)).toBeNull();
    });
  });

  describe('subclass hooks', () => {
    it('should call _onAfterCreate hook', () => {
      let hookCalled = false;
      class HookService extends BaseChannelService {
        _onAfterCreate() { hookCalled = true; }
      }
      const svc = new HookService({
        platform: 'test',
        channelsFilePath: channelsFile,
      });
      svc.createChannel({ name: 'Test' });
      expect(hookCalled).toBe(true);
    });

    it('should call _onAfterUpdate hook', () => {
      let hookArgs = null;
      class HookService extends BaseChannelService {
        _onAfterUpdate(old, next) { hookArgs = { old, next }; }
      }
      const svc = new HookService({
        platform: 'test',
        channelsFilePath: channelsFile,
      });
      const ch = svc.createChannel({ name: 'Before' });
      svc.updateChannel(ch.id, { name: 'After' });
      expect(hookArgs.old.name).toBe('Before');
      expect(hookArgs.next.name).toBe('After');
    });

    it('should call _onAfterDelete hook', () => {
      let deletedChannel = null;
      class HookService extends BaseChannelService {
        _onAfterDelete(ch) { deletedChannel = ch; }
      }
      const svc = new HookService({
        platform: 'test',
        channelsFilePath: channelsFile,
      });
      const ch = svc.createChannel({ name: 'ToDelete' });
      svc.deleteChannel(ch.id);
      expect(deletedChannel.name).toBe('ToDelete');
    });

    it('should call _validateUniqueness on create', () => {
      class UniqueService extends BaseChannelService {
        _validateUniqueness(channels, fields) {
          if (channels.some(ch => ch.name === fields.name)) {
            throw new Error('Name must be unique');
          }
        }
      }
      const svc = new UniqueService({
        platform: 'test',
        channelsFilePath: channelsFile,
        isProxyRunning: () => true,
      });
      svc.createChannel({ name: 'Unique' });
      expect(() => svc.createChannel({ name: 'Unique' }))
        .toThrow('Name must be unique');
    });
  });
});
