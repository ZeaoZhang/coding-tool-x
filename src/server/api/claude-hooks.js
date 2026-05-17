const express = require('express');
const router = express.Router();
const notificationHooks = require('../services/notification-hooks');
const { createSameOriginGuard } = require('../services/network-access');
const { resolvePreferredHomeDir, normalizeWindowsHomePath } = require('../../utils/home-dir');

router.use(createSameOriginGuard({
  message: '禁止跨站访问 Claude Hooks 配置接口'
}));

router.get('/', (req, res) => {
  try {
    res.json(notificationHooks.getLegacyClaudeHookSettings());
  } catch (error) {
    console.error('Error getting Claude hooks:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/', (req, res) => {
  try {
    const result = notificationHooks.saveLegacyClaudeHookSettings(req.body || {});
    res.json({
      ...result,
      message: '配置已保存'
    });
  } catch (error) {
    console.error('Error saving Claude hooks:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/test', async (req, res) => {
  try {
    await notificationHooks.testNotification(req.body || {});
    res.json({
      success: true,
      message: '系统测试通知已发送'
    });
  } catch (error) {
    console.error('Error testing notification:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

module.exports = router;
module.exports.initDefaultHooks = notificationHooks.initDefaultHooks;
module.exports._test = {
  generateSystemNotificationCommand: notificationHooks._test.generateSystemNotificationCommand,
  parseStopHookStatus: notificationHooks._test.parseStopHookStatus,
  parseNotifyTypeMarker: notificationHooks._test.parseNotifyTypeMarker,
  buildStopHookCommand: notificationHooks._test.buildStopHookCommand,
  normalizeWindowsHomePath,
  resolvePreferredHomeDir,
  shouldRepairStopHook: notificationHooks._test.shouldRepairStopHook
};
