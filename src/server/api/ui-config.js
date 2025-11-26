const express = require('express');
const router = express.Router();
const {
  loadUIConfig,
  saveUIConfig,
  updateUIConfig,
  updateNestedUIConfig
} = require('../services/ui-config');

// Get all UI config
router.get('/', (req, res) => {
  try {
    const config = loadUIConfig();
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error getting UI config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update entire UI config
router.post('/', (req, res) => {
  try {
    const { config } = req.body;
    if (!config) {
      return res.status(400).json({ error: 'Missing config' });
    }
    saveUIConfig(config);
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error saving UI config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update specific config key
router.put('/:key', (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const config = updateUIConfig(key, value);
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error updating UI config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update nested config
router.put('/:parentKey/:childKey', (req, res) => {
  try {
    const { parentKey, childKey } = req.params;
    const { value } = req.body;

    const config = updateNestedUIConfig(parentKey, childKey, value);
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error updating nested UI config:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
