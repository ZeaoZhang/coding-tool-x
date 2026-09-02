'use strict';

const platforms = ['claude', 'codex', 'gemini', 'opencode', 'omp'];

describe('session and statistics Driver contracts', () => {
  test.each(platforms)('%s exposes session and statistics operations', platform => {
    const sessionModule = require(`../../../../src/platforms/drivers/${platform}/sessions`);
    const statsModule = require(`../../../../src/platforms/drivers/${platform}/statistics`);
    const service = {
      getSessionsForProject: () => [], getSessionsByProject: () => [], getProjectSessions: () => [], getSessionsByProjectId: () => [],
      getRecentSessions: () => [], searchSessions: () => [], deleteSession: () => ({ success: true }), forkSession: () => ({}),
      getSessionStatus: () => ({}), getSessionMessages: () => [],
      getStatistics: () => ({}), getDailyStatistics: () => ({}), getTodayStatistics: () => ({}),
      recordRequest: () => ({ success: true }), resetStatistics: () => ({ success: true })
    };
    const context = { requireImpl: () => service };
    const sessions = sessionModule.createDriver(context);
    const statistics = statsModule.createDriver(context);
    for (const operation of ['listSessions', 'recent', 'search', 'delete', 'fork', 'status', 'messages']) {
      expect(typeof sessions[operation]).toBe('function');
    }
    for (const operation of ['getStatistics', 'getDailyStatistics', 'getTodayStatistics', 'recordRequest', 'resetStatistics']) {
      expect(typeof statistics[operation]).toBe('function');
    }
    expect(sessions.listSessions('project')).toMatchObject({ status: 'ok', platform, capability: 'sessions' });
    expect(statistics.getTodayStatistics()).toMatchObject({ status: 'ok', platform, capability: 'statistics' });
  });
});
