const express = require('express');
const router = express.Router();
const { convertSession, previewConversion } = require('../services/session-converter');

/**
 * 获取支持的格式列表
 * GET /api/convert/formats
 */
router.get('/formats', (req, res) => {
  res.json({
    formats: [
      {
        id: 'claude',
        name: 'Claude Code',
        description: 'Anthropic Claude Code CLI session format',
        extension: '.jsonl',
        icon: 'claude'
      },
      {
        id: 'codex',
        name: 'OpenAI Codex',
        description: 'OpenAI Codex CLI session format',
        extension: '.jsonl',
        icon: 'codex'
      },
      {
        id: 'gemini',
        name: 'Google Gemini',
        description: 'Google Gemini CLI session format',
        extension: '.json',
        icon: 'gemini'
      }
    ],
    conversions: [
      { from: 'claude', to: 'codex' },
      { from: 'claude', to: 'gemini' },
      { from: 'codex', to: 'claude' },
      { from: 'codex', to: 'gemini' },
      { from: 'gemini', to: 'claude' },
      { from: 'gemini', to: 'codex' }
    ]
  });
});

/**
 * 预览转换结果
 * POST /api/convert/preview
 * Body: { sourceType, sessionId }
 */
router.post('/preview', async (req, res) => {
  try {
    const { sourceType, sessionId } = req.body;

    if (!sourceType || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: sourceType, sessionId'
      });
    }

    const preview = await previewConversion(sourceType, sessionId);

    res.json({
      success: true,
      preview
    });
  } catch (error) {
    console.error('[Convert API] Preview error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 执行会话转换
 * POST /api/convert
 * Body: { sourceType, targetType, sessionId, options }
 */
router.post('/', async (req, res) => {
  try {
    const { sourceType, targetType, sessionId, options = {} } = req.body;

    // 验证必需参数
    if (!sourceType || !targetType || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: sourceType, targetType, sessionId'
      });
    }

    // 验证格式
    const validTypes = ['claude', 'codex', 'gemini'];
    if (!validTypes.includes(sourceType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid sourceType: ${sourceType}. Must be one of: ${validTypes.join(', ')}`
      });
    }
    if (!validTypes.includes(targetType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid targetType: ${targetType}. Must be one of: ${validTypes.join(', ')}`
      });
    }
    if (sourceType === targetType) {
      return res.status(400).json({
        success: false,
        error: 'Source and target types must be different'
      });
    }

    // 执行转换
    const result = await convertSession(sourceType, targetType, sessionId, options);

    res.json(result);
  } catch (error) {
    console.error('[Convert API] Conversion error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
