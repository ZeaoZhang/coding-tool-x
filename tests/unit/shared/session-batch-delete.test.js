'use strict';

const { batchDeleteSessions } = require('../../../src/shared/session-batch-delete');

describe('batchDeleteSessions', () => {
  test('deduplicates ids and reports deleted sessions in input order', async () => {
    const deleted = [];
    const result = await batchDeleteSessions({
      sessionIds: ['a', 'b', 'a', '', null],
      deleteOne: async sessionId => { deleted.push(sessionId); }
    });

    expect(deleted).toEqual(['a', 'b']);
    expect(result).toEqual({ deletedSessionIds: ['a', 'b'], failed: [] });
  });

  test('continues after a failure and records the per-session error', async () => {
    const result = await batchDeleteSessions({
      sessionIds: ['ok-1', 'bad', 'ok-2'],
      deleteOne: async sessionId => {
        if (sessionId === 'bad') throw new Error('Session not found');
      }
    });

    expect(result).toEqual({
      deletedSessionIds: ['ok-1', 'ok-2'],
      failed: [{ sessionId: 'bad', error: 'Session not found' }]
    });
  });

  test('requires a deleteOne callback', async () => {
    await expect(batchDeleteSessions({ sessionIds: ['a'] })).rejects.toThrow(/deleteOne/);
  });
});
