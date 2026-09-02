const express = require('express');
const router = express.Router();
const {
  getStatistics,
  getDailyStatistics,
  getTodayStatistics
} = require('./statistics-implementation');

router.get('/summary', (req, res) => {
  try {
    res.json(getStatistics());
  } catch (error) {
    console.error('[OMP] Failed to get statistics:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

router.get('/today', (req, res) => {
  try {
    res.json(getTodayStatistics());
  } catch (error) {
    console.error('[OMP] Failed to get today statistics:', error);
    res.status(500).json({ error: 'Failed to get today statistics' });
  }
});

router.get('/daily/:date', (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
    }
    res.json(getDailyStatistics(date));
  } catch (error) {
    console.error('[OMP] Failed to get daily statistics:', error);
    res.status(500).json({ error: 'Failed to get daily statistics' });
  }
});

module.exports = router;
