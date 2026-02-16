const express = require('express');
const router = express.Router();
const { convertSession, previewConversion } = require('../services/session-converter');
const {
  SUPPORTED_SOURCE_TYPES,
  SUPPORTED_TARGET_APIS,
  convertToOpenCodePayload,
  convertClaudeToOpenCodePayload,
  convertCodexToOpenCodePayload,
  convertGeminiToOpenCodePayload,
  normalizeSourceType
} = require('../services/opencode-gateway-converter');

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
 * 获取 OpenCode 网关支持格式
 * GET /api/convert/opencode/formats
 */
router.get('/opencode/formats', (req, res) => {
  res.json({
    sourceTypes: SUPPORTED_SOURCE_TYPES.map(type => ({
      id: type,
      name: type === 'claude'
        ? 'Claude Code'
        : type === 'codex'
          ? 'Codex'
          : 'Gemini'
    })),
    target: 'opencode',
    targetApis: SUPPORTED_TARGET_APIS,
    defaultTargetApi: 'responses',
    endpoints: {
      responses: '/v1/responses',
      'chat.completions': '/v1/chat/completions'
    },
    sourceEndpoints: {
      claude: '/api/convert/opencode/claude',
      codex: '/api/convert/opencode/codex',
      gemini: '/api/convert/opencode/gemini'
    }
  });
});

function handleOpenCodeConvert(req, res, sourceType, converter) {
  try {
    const { payload, options = {} } = req.body || {};

    if (!payload) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: payload'
      });
    }

    const result = converter({ payload, options });
    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error(`[Convert API] OpenCode ${sourceType} convert error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Claude Code -> OpenCode
 * POST /api/convert/opencode/claude
 * Body: { payload, options? }
 */
router.post('/opencode/claude', (req, res) => {
  return handleOpenCodeConvert(req, res, 'claude', convertClaudeToOpenCodePayload);
});

/**
 * Codex -> OpenCode
 * POST /api/convert/opencode/codex
 * Body: { payload, options? }
 */
router.post('/opencode/codex', (req, res) => {
  return handleOpenCodeConvert(req, res, 'codex', convertCodexToOpenCodePayload);
});

/**
 * Gemini -> OpenCode
 * POST /api/convert/opencode/gemini
 * Body: { payload, options? }
 */
router.post('/opencode/gemini', (req, res) => {
  return handleOpenCodeConvert(req, res, 'gemini', convertGeminiToOpenCodePayload);
});

/**
 * 在线转换为 OpenCode 可处理格式
 * POST /api/convert/opencode
 * Body: { sourceType, payload, options? }
 */
router.post('/opencode', (req, res) => {
  try {
    const { sourceType, payload, options = {} } = req.body || {};

    if (!sourceType || !payload) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: sourceType, payload'
      });
    }

    const normalized = normalizeSourceType(sourceType);
    if (!SUPPORTED_SOURCE_TYPES.includes(normalized)) {
      return res.status(400).json({
        success: false,
        error: `Invalid sourceType: ${sourceType}. Must be one of: ${SUPPORTED_SOURCE_TYPES.join(', ')}`
      });
    }

    const result = convertToOpenCodePayload({
      sourceType: normalized,
      payload,
      options
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Convert API] OpenCode gateway convert error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
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
