const express = require('express');
const router = express.Router();
const { getPlatformCatalog } = require('../services/platform-catalog');

/**
 * 获取支持的格式列表
 * GET /api/convert/formats
 */
router.get('/formats', (req, res) => {
  const driver = getPlatformCatalog().driver('opencode', 'conversion');
  const formats = driver?.formats?.() || driver?.getFormats?.();
  if (!formats) {
    return res.status(404).json({ success: false, error: 'Conversion is not supported' });
  }
  const sourceTypes = formats.sourceTypes || [];
  res.json({
    formats: sourceTypes.map(type => ({
      id: type,
      name: (formats.formats || []).find(item => item.id === type)?.name
        || String(type).replace(/[-_]/g, ' ').replace(/\b\w/g, char => char.toUpperCase()),
      description: `${type} session format`,
      extension: '.jsonl',
      icon: type
    })),
    conversions: sourceTypes.flatMap(sourceType => sourceTypes
      .filter(targetType => targetType !== sourceType)
      .map(targetType => ({ from: sourceType, to: targetType })))
  });
});

/**
 * 获取 OpenCode 网关支持格式
 * GET /api/convert/opencode/formats
 */
router.get('/opencode/formats', (req, res) => {
  const driver = getConversionDriver();
  const formats = driver?.formats?.() || driver?.getFormats?.();
  if (!formats) {
    return res.status(404).json({ success: false, error: 'Conversion is not supported' });
  }
  const sourceTypes = formats.sourceTypes || [];
  res.json({
    sourceTypes: sourceTypes.map(type => ({
      id: type,
      name: (formats.formats || []).find(item => item.id === type)?.name
        || String(type).replace(/[-_]/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
    })),
    target: 'opencode',
    targetApis: formats.targetApis || [],
    defaultTargetApi: formats.defaultTargetApi,
    endpoints: formats.endpoints || {},
    sourceEndpoints: Object.fromEntries(sourceTypes.map(type => [type, `/api/convert/opencode/${type}`]))
  });
});

function getConversionDriver() {
  return getPlatformCatalog().driver('opencode', 'conversion');
}

function handleOpenCodeConvert(req, res, sourceType) {
  try {
    const { payload, options = {} } = req.body || {};
    const driver = getConversionDriver();

    if (!driver) {
      return res.status(404).json({ success: false, error: 'Conversion is not supported' });
    }
    if (!payload) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: payload'
      });
    }
    const result = driver.convertSource
      ? driver.convertSource(sourceType, payload, options)
      : driver.convert({ sourceType, payload, options });
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

router.post('/opencode/:sourceType', (req, res) => {
  return handleOpenCodeConvert(req, res, req.params.sourceType);
});

/**
 * 在线转换为 OpenCode 可处理格式
 * POST /api/convert/opencode
 * Body: { sourceType, payload, options? }
 */
router.post('/opencode', (req, res) => {
  try {
    const { sourceType, payload, options = {} } = req.body || {};
    const driver = getConversionDriver();
    const sourceTypes = driver?.formats?.().sourceTypes || driver?.getFormats?.().sourceTypes || [];
    const normalized = driver?.normalizeSourceType?.(sourceType) || sourceType;

    if (!driver) {
      return res.status(404).json({ success: false, error: 'Conversion is not supported' });
    }
    if (!sourceType || !payload) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: sourceType, payload'
      });
    }
    if (!sourceTypes.includes(normalized)) {
      return res.status(400).json({
        success: false,
        error: `Invalid sourceType: ${sourceType}. Must be one of: ${sourceTypes.join(', ')}`
      });
    }

    return res.json({
      success: true,
      ...driver.convert({ sourceType: normalized, payload, options })
    });
  } catch (error) {
    console.error('[Convert API] OpenCode gateway convert error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


module.exports = router;
