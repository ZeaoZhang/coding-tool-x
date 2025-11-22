const express = require('express');
const router = express.Router();
const { getStatistics, getDailyStatistics, getTodayStatistics } = require('../services/statistics-service');

/**
 * 获取总体统计数据
 * GET /api/statistics/summary
 */
router.get('/summary', (req, res) => {
  try {
    const stats = getStatistics();
    res.json(stats);
  } catch (error) {
    console.error('Failed to get statistics:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * 获取今日统计数据
 * GET /api/statistics/today
 */
router.get('/today', (req, res) => {
  try {
    const stats = getTodayStatistics();
    res.json(stats);
  } catch (error) {
    console.error('Failed to get today statistics:', error);
    res.status(500).json({ error: 'Failed to get today statistics' });
  }
});

/**
 * 获取指定日期的统计数据
 * GET /api/statistics/daily/:date
 *
 * @param {string} date - 日期，格式：YYYY-MM-DD
 */
router.get('/daily/:date', (req, res) => {
  try {
    const { date } = req.params;

    // 验证日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
    }

    const stats = getDailyStatistics(date);
    res.json(stats);
  } catch (error) {
    console.error('Failed to get daily statistics:', error);
    res.status(500).json({ error: 'Failed to get daily statistics' });
  }
});

/**
 * 获取最近N天的统计数据
 * GET /api/statistics/recent?days=7
 *
 * @query {number} days - 天数，默认7天
 */
router.get('/recent', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;

    if (days < 1 || days > 90) {
      return res.status(400).json({ error: 'Days must be between 1 and 90' });
    }

    const result = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const stats = getDailyStatistics(dateStr);
      result.push({
        date: dateStr,
        ...stats
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Failed to get recent statistics:', error);
    res.status(500).json({ error: 'Failed to get recent statistics' });
  }
});

module.exports = router;
