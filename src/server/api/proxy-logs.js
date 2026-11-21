'use strict';

const express = require('express');
const { clearLogsBySource } = require('../websocket-server');

const KNOWN_SOURCES = new Set(['claude', 'codex', 'gemini', 'opencode', 'omp', 'dsh']);

function normalizeSource(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source || source === 'all') return null;
  if (!KNOWN_SOURCES.has(source)) {
    const error = new Error(`Unknown log source: ${source}`);
    error.status = 400;
    throw error;
  }
  return source;
}

module.exports = () => {
  const router = express.Router();

  // POST /api/proxy/logs/clear?source=codex
  // 不传 source 时清空全部日志（兼容旧调用）。
  router.post('/logs/clear', async (req, res) => {
    try {
      const source = normalizeSource(req.query.source ?? req.body?.source);
      await clearLogsBySource(source);
      res.json({ success: true, source: source || 'all' });
    } catch (error) {
      const status = error.status || 500;
      console.error('Failed to clear proxy logs:', error);
      res.status(status).json({ error: error.message || 'Failed to clear proxy logs' });
    }
  });

  return router;
};

module.exports._test = { normalizeSource, KNOWN_SOURCES };
