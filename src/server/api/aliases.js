const express = require('express');
const router = express.Router();
const { setAlias, deleteAlias, loadAliases } = require('../services/alias');

module.exports = () => {
  // GET /api/aliases - List all session aliases
  router.get('/', (req, res) => {
    try {
      res.json({ success: true, aliases: loadAliases() });
    } catch (error) {
      console.error('Error loading aliases:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/aliases - Set alias for a session
  router.post('/', (req, res) => {
    try {
      const { sessionId, alias } = req.body;

      if (!sessionId || !alias) {
        return res.status(400).json({ error: 'sessionId and alias are required' });
      }

      const aliases = setAlias(sessionId, alias);
      res.json({ success: true, aliases });
    } catch (error) {
      console.error('Error setting alias:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/aliases/:sessionId - Delete alias
  router.delete('/:sessionId', (req, res) => {
    try {
      const { sessionId } = req.params;
      const aliases = deleteAlias(sessionId);
      res.json({ success: true, aliases });
    } catch (error) {
      console.error('Error deleting alias:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
