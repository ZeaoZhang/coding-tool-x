const express = require('express');
const router = express.Router();
const {
  getSecurityStatus,
  verifySecurityPassword,
  setSecurityPassword
} = require('../services/security-config');

router.get('/', (req, res) => {
  try {
    const status = getSecurityStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    console.error('Error getting security status:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/verify', (req, res) => {
  try {
    const { password } = req.body;
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: '请输入密码' });
    }

    const result = verifySecurityPassword(password);
    if (result.reason === 'not_set') {
      return res.status(400).json({ error: '尚未设置访问密码' });
    }
    if (!result.ok) {
      return res.status(401).json({ error: '密码错误' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error verifying security password:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/password', (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const result = setSecurityPassword({ currentPassword, newPassword });
    res.json({ success: true, ...result });
  } catch (error) {
    const status = error.code === 'INVALID_PASSWORD' ? 401 : 400;
    console.error('Error setting security password:', error);
    res.status(status).json({ error: error.message });
  }
});

module.exports = router;
