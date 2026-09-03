const express = require('express');
const router = express.Router();
const { invokeCapabilityDriver } = require('../../../server/api/capability-driver');

/**
 * 获取 Codex 总体统计数据
 * GET /api/codex/statistics/summary
 */
router.get('/summary', async (req, res) => {
  try {
    const stats = await invokeCapabilityDriver('codex', 'statistics', 'getStatistics');
    res.json(stats);
  } catch (error) {
    console.error('[Codex] Failed to get statistics:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * 获取 Codex 今日统计数据
 * GET /api/codex/statistics/today
 */
router.get('/today', async (req, res) => {
  try {
    const stats = await invokeCapabilityDriver('codex', 'statistics', 'getTodayStatistics');
    res.json(stats);
  } catch (error) {
    console.error('[Codex] Failed to get today statistics:', error);
    res.status(500).json({ error: 'Failed to get today statistics' });
  }
});

/**
 * 获取 Codex 指定日期的统计数据
 * GET /api/codex/statistics/daily/:date
 */
router.get('/daily/:date', async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
    }

    const stats = await invokeCapabilityDriver('codex', 'statistics', 'getDailyStatistics', [date]);
    res.json(stats);
  } catch (error) {
    console.error('[Codex] Failed to get daily statistics:', error);
    res.status(500).json({ error: 'Failed to get daily statistics' });
  }
});

module.exports = router;
