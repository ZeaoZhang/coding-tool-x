'use strict';

const { createApiOperationsDriver } = require('../../../shared/driver-factories/api');

function createDriver(context = {}) {
  const notificationHooks = require('../../notification-hooks');
  const { healthCheckAllProjects } = require('./health-check');
  return createApiOperationsDriver({
    ...context,
    platform: 'claude',
    operationHandlers: {
      getHooks: () => notificationHooks.getLegacyClaudeHookSettings(),
      saveHooks: requestContext => ({
        ...notificationHooks.saveLegacyClaudeHookSettings(requestContext.body || {}),
        message: '配置已保存'
      }),
      testHooks: async requestContext => {
        await notificationHooks.testNotification(requestContext.body || {});
        return { success: true, message: '系统测试通知已发送' };
      },
      healthCheck: async (_requestContext, { sessionHistoryIndex }) => {
        const projects = sessionHistoryIndex
          ? await sessionHistoryIndex.listProjects('claude', { consistency: 'stale-ok' })
          : [];
        return {
          success: true,
          timestamp: new Date().toISOString(),
          ...healthCheckAllProjects(projects)
        };
      }
    }
  });
}

module.exports = { createDriver };
