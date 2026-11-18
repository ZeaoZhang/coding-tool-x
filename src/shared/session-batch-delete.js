'use strict';

/**
 * Delete sessions one by one and report per-session failures.
 * @param {{ sessionIds?: string[], deleteOne: (sessionId: string) => unknown }} options
 * @returns {Promise<{ deletedSessionIds: string[], failed: Array<{sessionId: string, error: string}> }>}
 */
async function batchDeleteSessions({ sessionIds = [], deleteOne } = {}) {
  if (typeof deleteOne !== 'function') {
    throw new TypeError('batchDeleteSessions requires deleteOne');
  }
  const uniqueIds = [...new Set((Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean))];
  const deletedSessionIds = [];
  const failed = [];
  for (const sessionId of uniqueIds) {
    try {
      await deleteOne(sessionId);
      deletedSessionIds.push(sessionId);
    } catch (error) {
      failed.push({
        sessionId,
        error: error?.message || String(error)
      });
    }
  }
  return { deletedSessionIds, failed };
}

module.exports = { batchDeleteSessions };
