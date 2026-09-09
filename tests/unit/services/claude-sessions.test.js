'use strict';

import { describe, it, afterEach, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ALIAS_PATH = require.resolve('../../../src/server/services/alias.js');
const CLAUDE_SESSIONS_PATH = require.resolve('../../../src/platforms/drivers/claude/sessions-implementation.js');
const DRIVER_PATH = require.resolve('../../../src/platforms/drivers/claude/sessions.js');

const sessionHistoryIndex = {
  getRecentSessions: vi.fn(),
  listSessions: vi.fn()
};

function loadClaudeSessions() {
  require.cache[ALIAS_PATH] = {
    id: ALIAS_PATH,
    filename: ALIAS_PATH,
    loaded: true,
    exports: { loadAliases: () => ({}), setAlias: vi.fn() }
  };
  delete require.cache[CLAUDE_SESSIONS_PATH];
  return require(CLAUDE_SESSIONS_PATH);
}

describe('Claude session history', () => {
  afterEach(() => {
    delete require.cache[CLAUDE_SESSIONS_PATH];
    delete require.cache[DRIVER_PATH];
    delete require.cache[ALIAS_PATH];
    sessionHistoryIndex.getRecentSessions.mockReset();
    sessionHistoryIndex.listSessions.mockReset();
  });

  it('returns recent sessions with aliases', async () => {
    const claudeSessions = loadClaudeSessions();
    sessionHistoryIndex.getRecentSessions.mockResolvedValue([{
      sessionId: 'session-1',
      projectName: 'demo',
      projectDisplayName: 'Demo',
      projectFullPath: '/tmp/demo',
      mtime: '2026-09-06T00:00:00.000Z',
      size: 42,
      filePath: '/tmp/demo/session-1.jsonl',
      gitBranch: 'main',
      firstMessage: 'Hello'
    }]);
    claudeSessions.configure({ sessionHistoryIndex });

    const result = await claudeSessions.getRecentSessions({}, 10);

    expect(result).toEqual([expect.objectContaining({
      sessionId: 'session-1',
      projectName: 'demo',
      alias: null
    })]);
  });

  it('accepts the descriptor request context for recent-session routes', async () => {
    const claudeSessions = loadClaudeSessions();
    sessionHistoryIndex.getRecentSessions.mockResolvedValue([{
      sessionId: 'session-2',
      projectName: 'demo',
      projectDisplayName: 'Demo',
      projectFullPath: '/tmp/demo',
      mtime: '2026-09-06T00:00:00.000Z',
      size: 42,
      filePath: '/tmp/demo/session-2.jsonl',
      gitBranch: 'main',
      firstMessage: 'Hello'
    }]);
    const { createDriver } = require(DRIVER_PATH);
    const driver = createDriver({
      requireImpl: () => claudeSessions,
      sessionHistoryIndex
    });

    const result = await driver.recent({
      config: { source: 'test' },
      query: { limit: '3' }
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'ok',
      data: [expect.objectContaining({ sessionId: 'session-2', alias: null })]
    }));
    expect(sessionHistoryIndex.getRecentSessions).toHaveBeenCalledWith(
      'claude',
      3,
      expect.objectContaining({ config: { source: 'test' } })
    );
  });
 
  it('accepts the descriptor request context for project-session routes', async () => {
    const claudeSessions = loadClaudeSessions();
    sessionHistoryIndex.listSessions.mockResolvedValue([{
      sessionId: 'session-3',
      projectName: 'demo',
      mtime: '2026-09-06T00:00:00.000Z',
      size: 42,
      filePath: '/tmp/demo/session-3.jsonl'
    }]);
    const { createDriver } = require(DRIVER_PATH);
    const driver = createDriver({
      requireImpl: () => claudeSessions,
      sessionHistoryIndex
    });

    const result = await driver.listSessions({
      params: { projectName: 'demo' },
      config: { source: 'test' }
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'ok',
      data: {
        sessions: [expect.objectContaining({ sessionId: 'session-3' })],
        totalSize: 42
      }
    }));
    expect(sessionHistoryIndex.listSessions).toHaveBeenCalledWith(
      'claude',
      'demo',
      expect.objectContaining({ config: { source: 'test' } })
    );
  });

  it('adapts stable mutation arguments to the Claude storage service', async () => {
    const service = {
      deleteSession: vi.fn(() => ({ success: true })),
      forkSession: vi.fn(() => ({ newSessionId: 'fork-1' }))
    };
    const invalidateSource = vi.fn();
    const { createDriver } = require(DRIVER_PATH);
    const driver = createDriver({
      requireImpl: () => service,
      sessionHistoryIndex: { invalidateSource }
    });
    const options = { config: { projectsDir: '/sessions' }, alias: 'copy' };

    expect(driver.delete('demo', 'session-1', options)).toMatchObject({ status: 'ok' });
    expect(driver.fork('demo', 'session-1', options)).toMatchObject({ status: 'ok' });

    expect(service.deleteSession).toHaveBeenCalledWith(options.config, 'demo', 'session-1');
    expect(service.forkSession).toHaveBeenCalledWith(options.config, 'demo', 'session-1', options);
    expect(invalidateSource).toHaveBeenCalledTimes(2);
  });
});
