const express = require('express');
const router = express.Router();
const { getStatistics, getDailyStatistics, getTodayStatistics, getTrendStatistics, getAvailableFilters } = require('../services/statistics-service');

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

/**
 * 获取可用的过滤器选项
 * GET /api/statistics/filters?startDate=&endDate=
 */
router.get('/filters', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
    }
    const result = getAvailableFilters(startDate, endDate);
    res.json(result);
  } catch (error) {
    console.error('Failed to get available filters:', error);
    res.status(500).json({ error: 'Failed to get available filters' });
  }
});

/**
 * 获取趋势统计数据
 * GET /api/statistics/trend
 *
 * @query {string} startDate - YYYY-MM-DD (required)
 * @query {string} endDate - YYYY-MM-DD (required)
 * @query {string} granularity - 'day' | 'hour' (default: 'day')
 * @query {string} groupBy - 'model' | 'channel' | 'toolType' (default: 'model')
 * @query {string} metric - 'tokens' | 'cost' | 'requests' (default: 'tokens')
 * @query {string} filterToolType - optional filter
 * @query {string} filterChannel - optional filter
 * @query {string} filterModel - optional filter
 */
router.get('/trend', async (req, res) => {
  try {
    const {
      startDate, endDate, granularity = 'day', step = 1, groupBy = 'model', metric = 'tokens',
      filterToolType, filterChannel, filterModel
    } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;

    if (diffDays < 1) {
      return res.status(400).json({ error: 'endDate must be >= startDate' });
    }

    if (granularity === 'hour' && diffDays > 7) {
      return res.status(400).json({ error: 'Hour granularity is limited to 7 days' });
    }

    if (diffDays > 90) {
      return res.status(400).json({ error: 'Date range cannot exceed 90 days' });
    }

    const filters = {
      toolType: filterToolType || null,
      channel: filterChannel || null,
      model: filterModel || null
    };
    const result = await getTrendStatistics({ startDate, endDate, granularity, step, groupBy, metric, filters });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Failed to get trend statistics:', error);
    res.status(500).json({ error: 'Failed to get trend statistics' });
  }
});

/**
 * 导出趋势统计数据
 * GET /api/statistics/trend/export
 *
 * @query {string} startDate - YYYY-MM-DD (required)
 * @query {string} endDate - YYYY-MM-DD (required)
 * @query {string} granularity - 'day' | 'hour' (default: 'day')
 * @query {string} groupBy - 'model' | 'channel' | 'toolType' (default: 'model')
 * @query {string} metric - 'tokens' | 'cost' | 'requests' (default: 'tokens')
 * @query {string} format - 'csv' | 'json' (default: 'csv')
 */
router.get('/trend/export', async (req, res) => {
  try {
    const { startDate, endDate, granularity = 'day', step = 1, groupBy = 'model', metric = 'tokens', format = 'csv' } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;

    if (diffDays < 1) {
      return res.status(400).json({ error: 'endDate must be >= startDate' });
    }

    if (granularity === 'hour' && diffDays > 7) {
      return res.status(400).json({ error: 'Hour granularity is limited to 7 days' });
    }

    if (diffDays > 90) {
      return res.status(400).json({ error: 'Date range cannot exceed 90 days' });
    }

    const result = await getTrendStatistics({ startDate, endDate, granularity, step, groupBy, metric });

    const filename = `analytics-${startDate}-${endDate}-${groupBy}-${metric}.${format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      return res.json(result);
    }

    // CSV format
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const seriesNames = result.series.map(s => s.name);
    const header = ['Date/Time', ...seriesNames, 'Total'].join(',');
    const rows = result.labels.map((label, i) => {
      const values = result.series.map(s => s.data[i] || 0);
      const total = values.reduce((a, b) => a + b, 0);
      return [label, ...values, total].join(',');
    });

    res.send([header, ...rows].join('\n'));
  } catch (error) {
    console.error('Failed to export trend statistics:', error);
    res.status(500).json({ error: 'Failed to export trend statistics' });
  }
});

module.exports = router;
