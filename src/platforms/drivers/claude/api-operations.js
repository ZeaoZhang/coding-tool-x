'use strict';

const os = require('os');
const { createApiOperationsDriver } = require('../../../shared/driver-factories/api');

function getHooksDriver(runtime) {
  const driver = runtime?.getDriver?.('claude', 'hooks');
  if (!driver || typeof driver.getHooks !== 'function') {
    throw new Error('Claude hooks capability is unavailable');
  }
  return driver;
}

function toLegacyHooksResponse(status) {
  return {
    success: true,
    stopHook: {
      enabled: status?.enabled === true,
      type: status?.type === 'dialog' || status?.type === 'browser' ? status.type : 'notification'
    },
    platform: os.platform()
  };
}

function createDriver(context = {}) {
  const { healthCheckAllProjects } = require('./health-check');
  return createApiOperationsDriver({
    ...context,
    platform: 'claude',
    operationHandlers: {
      getHooks: (_requestContext, { runtime }) => {
        const hooks = getHooksDriver(runtime || context.runtime);
        return toLegacyHooksResponse(hooks.getHooks());
      },
      saveHooks: async (requestContext, { runtime }) => {
        const hooks = getHooksDriver(runtime || context.runtime);
        await hooks.saveHooks(requestContext.body?.stopHook || {});
        return {
          ...toLegacyHooksResponse(hooks.getHooks()),
          message: '配置已保存'
        };
      },
      testHooks: async (requestContext, { runtime }) => {
        const hooks = getHooksDriver(runtime || context.runtime);
        await hooks.testHooks(requestContext.body || {});
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
