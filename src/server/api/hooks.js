const express = require('express');
const router = express.Router();
const notificationHooks = require('../services/notification-hooks');
const { createSameOriginGuard } = require('../services/network-access');

router.use(createSameOriginGuard({
  message: '禁止跨站访问通知配置接口'
}));

router.get('/', (req, res) => {
  try {
    res.json(notificationHooks.getNotificationSettings());
  } catch (error) {
    console.error('Error getting notification hook settings:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/', (req, res) => {
  try {
    const result = notificationHooks.saveNotificationSettings(req.body || {});
    res.json({
      ...result,
      message: '通知设置已保存'
    });
  } catch (error) {
    console.error('Error saving notification hook settings:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/test', async (req, res) => {
  try {
    await notificationHooks.testNotification(req.body || {});
    res.json({
      success: true,
      message: req.body?.testFeishu ? '飞书测试通知已发送' : '系统测试通知已发送'
    });
  } catch (error) {
    console.error('Error testing notification hook settings:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

module.exports = router;
