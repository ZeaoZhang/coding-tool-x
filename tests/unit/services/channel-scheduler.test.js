/**
 * Tests for src/server/services/channel-scheduler.js
 *
 * Pattern: manually inject vi.fn() stubs into require.cache before importing
 * the module under test. This is the correct approach for CommonJS modules in
 * this project (mirrors channel-health.test.js pattern).
 *
 * The scheduler has module-level state (schedulerStates). We clear the module
 * from require.cache in beforeEach so each test gets a fresh instance.
 */

const path = require('path');

// Absolute paths for the deps we need to stub
const CHANNELS_PATH = require.resolve('../../../src/server/services/channels');
const CODEX_PATH    = require.resolve('../../../src/server/services/codex-channels');
const GEMINI_PATH   = require.resolve('../../../src/server/services/gemini-channels');
const OPENCODE_PATH = require.resolve('../../../src/server/services/opencode-channels');
const HEALTH_PATH   = require.resolve('../../../src/server/services/channel-health');
const SCHEDULER_PATH = require.resolve('../../../src/server/services/channel-scheduler');

// Stable vi.fn() stubs – recreated in beforeEach so each test starts fresh
let getAllChannels;
let getCodexChannels;
let getGeminiChannels;
let getOpenCodeChannels;
let isChannelAvailable;
let getChannelHealthStatus;
let setOnChannelFrozen;

// The module under test – re-required each test
let allocateChannel;
let releaseChannel;
let getSchedulerState;

function makeChannel(id, overrides = {}) {
  return { id, name: `Channel ${id}`, enabled: true, weight: 1, ...overrides };
}

function injectStubs() {
  getAllChannels      = vi.fn(() => []);
  getCodexChannels   = vi.fn(() => ({ channels: [] }));
  getGeminiChannels  = vi.fn(() => ({ channels: [] }));
  getOpenCodeChannels = vi.fn(() => ({ channels: [] }));
  isChannelAvailable    = vi.fn(() => true);
  getChannelHealthStatus = vi.fn(() => ({ available: true }));
  setOnChannelFrozen    = vi.fn();

  require.cache[CHANNELS_PATH]  = { id: CHANNELS_PATH,  filename: CHANNELS_PATH,  loaded: true, exports: { getAllChannels } };
  require.cache[CODEX_PATH]     = { id: CODEX_PATH,     filename: CODEX_PATH,     loaded: true, exports: { getChannels: getCodexChannels } };
  require.cache[GEMINI_PATH]    = { id: GEMINI_PATH,    filename: GEMINI_PATH,    loaded: true, exports: { getChannels: getGeminiChannels } };
  require.cache[OPENCODE_PATH]  = { id: OPENCODE_PATH,  filename: OPENCODE_PATH,  loaded: true, exports: { getChannels: getOpenCodeChannels } };
  require.cache[HEALTH_PATH]    = { id: HEALTH_PATH,    filename: HEALTH_PATH,    loaded: true, exports: { isChannelAvailable, getChannelHealthStatus, setOnChannelFrozen } };
}

beforeEach(() => {
  // Remove stale module instances
  delete require.cache[SCHEDULER_PATH];

  injectStubs();

  const scheduler = require('../../../src/server/services/channel-scheduler');
  allocateChannel  = scheduler.allocateChannel;
  releaseChannel   = scheduler.releaseChannel;
  getSchedulerState = scheduler.getSchedulerState;
});

afterEach(() => {
  delete require.cache[SCHEDULER_PATH];
});

// ─── allocateChannel – no channels ───────────────────────────────────────────

describe('allocateChannel - no channels', () => {
  it('rejects with "暂无可用渠道" when no channels are configured', async () => {
    getAllChannels.mockReturnValue([]);
    await expect(allocateChannel({ source: 'claude' })).rejects.toThrow('暂无可用渠道');
  });

  it('rejects for codex source when no channels', async () => {
    getCodexChannels.mockReturnValue({ channels: [] });
    await expect(allocateChannel({ source: 'codex' })).rejects.toThrow('暂无可用渠道');
  });
});

// ─── allocateChannel – with available channels ────────────────────────────────

describe('allocateChannel - with available channels', () => {
  it('resolves with a channel object', async () => {
    getAllChannels.mockReturnValue([makeChannel('ch1')]);
    const result = await allocateChannel({ source: 'claude' });
    expect(result.id).toBe('ch1');
  });

  it('returned channel carries id, name, weight fields', async () => {
    getAllChannels.mockReturnValue([makeChannel('ch1', { weight: 3 })]);
    const result = await allocateChannel({ source: 'claude' });
    expect(result.id).toBe('ch1');
    expect(result.name).toBe('Channel ch1');
    expect(result.weight).toBe(3);
  });

  it('disabled channels are excluded', async () => {
    getAllChannels.mockReturnValue([
      makeChannel('disabled', { enabled: false }),
      makeChannel('enabled')
    ]);
    const result = await allocateChannel({ source: 'claude' });
    expect(result.id).toBe('enabled');
  });

  it('normalises weight to 1 when weight is 0 or undefined', () => {
    getAllChannels.mockReturnValue([
      makeChannel('ch1', { weight: 0 }),
      makeChannel('ch2', { weight: undefined })
    ]);
    const state = getSchedulerState('claude');
    state.channels.forEach(ch => expect(ch.weight).toBe(1));
  });
});

// ─── allocateChannel – weight-based selection ─────────────────────────────────

describe('allocateChannel - weight-based selection', () => {
  it('picks the single available channel', async () => {
    getAllChannels.mockReturnValue([makeChannel('only', { weight: 5 })]);
    const result = await allocateChannel({ source: 'claude' });
    expect(result.id).toBe('only');
  });

  it('high-weight channel is picked far more often (statistical)', async () => {
    getAllChannels.mockReturnValue([
      makeChannel('low', { weight: 1 }),
      makeChannel('high', { weight: 99 })
    ]);
    const counts = { low: 0, high: 0 };
    const ITERS = 200;
    for (let i = 0; i < ITERS; i++) {
      const ch = await allocateChannel({ source: 'claude', enableSessionBinding: false });
      counts[ch.id] = (counts[ch.id] || 0) + 1;
      releaseChannel(ch.id, 'claude');
    }
    expect(counts.high).toBeGreaterThan(ITERS * 0.8);
  });
});

// ─── allocateChannel – maxConcurrency ────────────────────────────────────────

describe('allocateChannel - maxConcurrency', () => {
  it('does not return a channel at its concurrency limit', async () => {
    getAllChannels.mockReturnValue([
      makeChannel('capped', { maxConcurrency: 1 }),
      makeChannel('open')
    ]);

    // Force the weighted picker to always take the first channel (capped)
    const origRandom = Math.random;
    Math.random = vi.fn(() => 0);
    const first = await allocateChannel({ source: 'claude', enableSessionBinding: false });
    Math.random = origRandom;
    expect(first.id).toBe('capped');

    // capped is now at its limit; next call (no binding) must fall through to open
    const second = await allocateChannel({ source: 'claude', enableSessionBinding: false });
    expect(second.id).toBe('open');
  });

  it('channel becomes available again after release', async () => {
    getAllChannels.mockReturnValue([makeChannel('solo', { maxConcurrency: 1 })]);
    const a = await allocateChannel({ source: 'claude' });
    expect(a.id).toBe('solo');
    releaseChannel('solo', 'claude');
    const b = await allocateChannel({ source: 'claude' });
    expect(b.id).toBe('solo');
  });

  it('null maxConcurrency allows unlimited concurrent allocations', async () => {
    getAllChannels.mockReturnValue([makeChannel('unlimited', { maxConcurrency: null })]);
    const [a, b, c] = await Promise.all([
      allocateChannel({ source: 'claude' }),
      allocateChannel({ source: 'claude' }),
      allocateChannel({ source: 'claude' })
    ]);
    expect(a.id).toBe('unlimited');
    expect(b.id).toBe('unlimited');
    expect(c.id).toBe('unlimited');
  });
});

// ─── allocateChannel – session binding ───────────────────────────────────────

describe('allocateChannel - session binding', () => {
  it('same sessionId is routed to the same channel', async () => {
    getAllChannels.mockReturnValue([makeChannel('ch1'), makeChannel('ch2')]);
    const first = await allocateChannel({ source: 'claude', sessionId: 'sess-A' });
    releaseChannel(first.id, 'claude');
    const second = await allocateChannel({ source: 'claude', sessionId: 'sess-A' });
    expect(second.id).toBe(first.id);
  });

  it('disabling session binding allows re-selection by weight', async () => {
    getAllChannels.mockReturnValue([
      makeChannel('ch1', { weight: 1 }),
      makeChannel('ch2', { weight: 999 })
    ]);
    // Force ch1 to be bound first
    const origRandom = Math.random;
    Math.random = vi.fn(() => 0);
    const bound = await allocateChannel({ source: 'claude', sessionId: 'sess-X' });
    Math.random = origRandom;
    releaseChannel(bound.id, 'claude');

    // Without binding, ch2's dominant weight should win
    const result = await allocateChannel({
      source: 'claude',
      sessionId: 'sess-X',
      enableSessionBinding: false
    });
    expect(result.id).toBe('ch2');
  });
});

// ─── releaseChannel ───────────────────────────────────────────────────────────

describe('releaseChannel', () => {
  it('decrements inflight count after allocation', async () => {
    getAllChannels.mockReturnValue([makeChannel('ch1')]);
    await allocateChannel({ source: 'claude' });
    expect(getSchedulerState('claude').channels[0].inflight).toBe(1);
    releaseChannel('ch1', 'claude');
    expect(getSchedulerState('claude').channels[0].inflight).toBe(0);
  });

  it('inflight stays at 0 when releasing a never-allocated channel', () => {
    getAllChannels.mockReturnValue([makeChannel('ch1')]);
    getSchedulerState('claude'); // trigger refresh
    releaseChannel('ch1', 'claude');
    expect(getSchedulerState('claude').channels[0].inflight).toBe(0);
  });

  it('does nothing when channelId is falsy', () => {
    expect(() => releaseChannel(null,      'claude')).not.toThrow();
    expect(() => releaseChannel('',        'claude')).not.toThrow();
    expect(() => releaseChannel(undefined, 'claude')).not.toThrow();
  });

  it('tracks multiple concurrent inflight allocations', async () => {
    getAllChannels.mockReturnValue([makeChannel('ch1', { maxConcurrency: null })]);
    await allocateChannel({ source: 'claude' });
    await allocateChannel({ source: 'claude' });
    await allocateChannel({ source: 'claude' });
    expect(getSchedulerState('claude').channels[0].inflight).toBe(3);
    releaseChannel('ch1', 'claude');
    expect(getSchedulerState('claude').channels[0].inflight).toBe(2);
    releaseChannel('ch1', 'claude');
    releaseChannel('ch1', 'claude');
    expect(getSchedulerState('claude').channels[0].inflight).toBe(0);
  });

  it('drains the queue when a slot is freed', async () => {
    getAllChannels.mockReturnValue([makeChannel('ch1', { maxConcurrency: 1 })]);

    await allocateChannel({ source: 'claude' }); // fills the slot

    let resolved = false;
    const pending = allocateChannel({ source: 'claude' }).then(ch => {
      resolved = true;
      return ch;
    });

    expect(resolved).toBe(false);
    releaseChannel('ch1', 'claude');
    const result = await pending;
    expect(resolved).toBe(true);
    expect(result.id).toBe('ch1');
  });
});

// ─── getSchedulerState ────────────────────────────────────────────────────────

describe('getSchedulerState', () => {
  it('returns object with channels array and numeric pending count', () => {
    getAllChannels.mockReturnValue([makeChannel('ch1')]);
    const state = getSchedulerState('claude');
    expect(Array.isArray(state.channels)).toBe(true);
    expect(typeof state.pending).toBe('number');
  });

  it('channel entry has id, name, weight, maxConcurrency, inflight, health', () => {
    getAllChannels.mockReturnValue([makeChannel('ch1', { weight: 2 })]);
    getChannelHealthStatus.mockReturnValue({ available: true, frozen: false });
    const ch = getSchedulerState('claude').channels[0];
    expect(ch.id).toBe('ch1');
    expect(ch.name).toBe('Channel ch1');
    expect(ch.weight).toBe(2);
    expect(ch.maxConcurrency).toBeNull();
    expect(ch.inflight).toBe(0);
    expect(ch.health).toEqual({ available: true, frozen: false });
  });

  it('pending is 0 when queue is empty', () => {
    getAllChannels.mockReturnValue([makeChannel('ch1')]);
    expect(getSchedulerState('claude').pending).toBe(0);
  });

  it('returns empty channels array when no channels configured', () => {
    getAllChannels.mockReturnValue([]);
    const state = getSchedulerState('claude');
    expect(state.channels).toHaveLength(0);
    expect(state.pending).toBe(0);
  });

  it('returns correct state for codex source', () => {
    getCodexChannels.mockReturnValue({ channels: [makeChannel('codex-ch1')] });
    const state = getSchedulerState('codex');
    expect(state.channels).toHaveLength(1);
    expect(state.channels[0].id).toBe('codex-ch1');
  });
});

// ─── health check interaction ─────────────────────────────────────────────────

describe('allocateChannel - health check', () => {
  it('skips channels marked unavailable by health service', async () => {
    getAllChannels.mockReturnValue([makeChannel('frozen'), makeChannel('healthy')]);
    isChannelAvailable.mockImplementation(id => id !== 'frozen');
    const result = await allocateChannel({ source: 'claude' });
    expect(result.id).toBe('healthy');
  });

  it('queues the request (does not settle synchronously) when all channels are frozen', async () => {
    getAllChannels.mockReturnValue([makeChannel('ch1')]);
    isChannelAvailable.mockReturnValue(false);

    vi.useFakeTimers();
    try {
      let settled = false;
      const p = allocateChannel({ source: 'claude' })
        .then(() => { settled = true; })
        .catch(() => { settled = true; });

      // Still pending before timers advance
      expect(settled).toBe(false);

      // Advance past WAIT_TIMEOUT_MS (15 000 ms)
      vi.advanceTimersByTime(16000);

      // Flush microtasks so the rejection propagates
      await Promise.resolve();
      await p.catch(() => {});

      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
