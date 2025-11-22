const express = require('express');
const router = express.Router();
const { detectAvailableTerminals } = require('../services/terminal-detector');
const { loadTerminalConfig, saveTerminalConfig, getSelectedTerminal } = require('../services/terminal-config');

// GET /api/settings/terminals - 获取可用终端列表
router.get('/terminals', (req, res) => {
  try {
    const availableTerminals = detectAvailableTerminals();
    const config = loadTerminalConfig();

    res.json({
      available: availableTerminals,
      selected: config.selectedTerminal,
      customCommand: config.customCommand
    });
  } catch (error) {
    console.error('Error getting terminals:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/settings/terminal-config - 获取当前终端配置
router.get('/terminal-config', (req, res) => {
  try {
    const config = loadTerminalConfig();
    const selectedTerminal = getSelectedTerminal();

    res.json({
      config,
      selectedTerminal
    });
  } catch (error) {
    console.error('Error getting terminal config:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/settings/terminal-config - 保存终端配置
router.post('/terminal-config', (req, res) => {
  try {
    const { selectedTerminal, customCommand } = req.body;

    const config = {
      selectedTerminal: selectedTerminal || null,
      customCommand: customCommand || null
    };

    saveTerminalConfig(config);

    res.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Error saving terminal config:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
