'use strict';

const platforms = ['claude', 'codex', 'gemini', 'opencode', 'omp'];

describe('session and statistics Driver contracts', () => {
  test.each(platforms)('%s exposes session and statistics operations', async platform => {
    const sessionModule = require(`../../../../src/platforms/drivers/${platform}/sessions`);
    const statsModule = require(`../../../../src/platforms/drivers/${platform}/statistics`);
    const service = {
      getSessionsForProject: () => [], getSessionsByProject: () => [], getProjectSessions: () => [], getSessionsByProjectId: () => [],
      getRecentSessions: () => [], searchSessions: () => [], deleteSession: () => ({ success: true }), forkSession: () => ({}),
      getSessionStatus: () => ({}), getSessionMessages: () => [],
      getSessionOutline: () => ({ sessionId: 'session-1', items: [{ userMessageNumber: 1, preview: 'hello' }] }),
      getStatistics: () => ({}), getDailyStatistics: () => ({}), getTodayStatistics: () => ({}),
      recordRequest: () => ({ success: true }), resetStatistics: () => ({ success: true })
    };
    const sessionHistoryIndex = {
      invalidateSource: () => {},
      getSessionOutline: () => ({ sessionId: 'session-1', items: [{ userMessageNumber: 1, preview: 'hello' }] })
    };
    const context = { requireImpl: () => service, sessionHistoryIndex };
    const sessions = sessionModule.createDriver(context);
    const statistics = statsModule.createDriver(context);
    for (const operation of ['listSessions', 'recent', 'search', 'delete', 'fork', 'status', 'messages', 'batchDelete', 'outline']) {
      expect(typeof sessions[operation]).toBe('function');
    }
    for (const operation of ['getStatistics', 'getDailyStatistics', 'getTodayStatistics', 'recordRequest', 'resetStatistics']) {
      expect(typeof statistics[operation]).toBe('function');
    }
    expect(sessions.listSessions('project')).toMatchObject({ status: 'ok', platform, capability: 'sessions' });
    expect(statistics.getTodayStatistics()).toMatchObject({ status: 'ok', platform, capability: 'statistics' });

    const outline = await sessions.outline({ params: { sessionId: 'session-1' }, query: {} });
    expect(outline).toMatchObject({
      status: 'ok',
      platform,
      capability: 'sessions',
      operation: 'outline',
      data: { sessionId: 'session-1', items: [{ preview: 'hello' }] }
    });

    const batch = await sessions.batchDelete('project', ['session-1', 'session-2', 'session-1']);
    expect(batch).toMatchObject({
      status: 'ok',
      platform,
      capability: 'sessions',
      operation: 'batchDelete',
      data: { deletedSessionIds: ['session-1', 'session-2'], failed: [] }
    });
  });
});
