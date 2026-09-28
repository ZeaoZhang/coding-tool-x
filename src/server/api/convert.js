const express = require('express');
const router = express.Router();
const { getPlatformCatalog } = require('../services/platform-catalog');
const { createSameOriginGuard } = require('../services/network-access');

router.use(createSameOriginGuard({
  message: '禁止跨站访问请求转换接口'
}));

function getConversionDriver(target) {
  return getPlatformCatalog().driver(target, 'conversion');
}

function getConversionFormats(driver) {
  const formats = driver?.formats?.() || driver?.getFormats?.();
  return formats;
}

/**
 * Read conversion capabilities for a target CLI.
 * GET /api/convert/:target/formats
 */
router.get('/:target/formats', (req, res) => {
  const driver = getConversionDriver(req.params.target);
  const formats = getConversionFormats(driver);
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
    target: req.params.target,
    targetApis: formats.targetApis || [],
    defaultTargetApi: formats.defaultTargetApi,
    endpoints: formats.endpoints || {}
  });
});

/**
 * Online conversion to a CLI-compatible request format.
 * POST /api/convert/:target
 * Body: { sourceType, payload, options? }
 */
router.post('/:target', (req, res) => {
  try {
    const { sourceType, payload, options = {} } = req.body || {};
    const driver = getConversionDriver(req.params.target);
    const formats = getConversionFormats(driver);
    const sourceTypes = formats?.sourceTypes || [];
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
    console.error(`[Convert API] ${req.params.target} convert error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


module.exports = router;
