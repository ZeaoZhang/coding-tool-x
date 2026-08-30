// 配置模板 API 路由
const express = require('express');
const router = express.Router();
const templatesService = require('../services/config-templates-service');

function normalizeAiConfigTypes(aiConfigTypes, aiConfigType) {
  const normalized = [];
  const seen = new Set();

  function pushType(value) {
    if (Array.isArray(value)) {
      for (const item of value) {
        pushType(item);
      }
      return;
    }

    if (typeof value !== 'string') {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        pushType(parsed);
        return;
      } catch (_) {
        // 非 JSON 字符串，继续按普通字符串处理
      }
    }

    const parts = trimmed.split(',').map(part => part.trim()).filter(Boolean);
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      normalized.push(lower);
    }
  }

  pushType(aiConfigTypes);
  if (normalized.length === 0) {
    pushType(aiConfigType);
  }

  return normalized;
}

/**
 * GET /api/config-templates
 * 获取所有配置模板
 */
router.get('/', (req, res) => {
  try {
    const templates = templatesService.getAllTemplates();
    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/config-templates/available-configs
 * 获取可用的配置项（用于模板编辑器选择）
 * 注意：此路由必须在 /:id 之前定义
 */
router.get('/available-configs', (req, res) => {
  try {
    const configs = templatesService.getAvailableConfigs();
    res.json({
      success: true,
      data: configs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/config-templates/:id
 * 获取单个配置模板详情
 */
// 注意：此路由需要放在所有静态子路由之后，避免把 /available-configs 等路径当成 id
router.get('/:id', (req, res, next) => {
  try {
    // 兜底：即便路由顺序被改动，也避免把保留路径当成模板 ID
    const reservedIds = new Set(['available-configs']);
    if (reservedIds.has(req.params.id)) {
      return next();
    }

    const template = templatesService.getTemplateById(req.params.id);
    if (!template) {
      return res.status(404).json({
        success: false,
        message: '模板不存在'
      });
    }
    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/config-templates
 * 创建自定义配置模板
 */
router.post('/', (req, res) => {
  try {
    const template = templatesService.createCustomTemplate(req.body);
    res.json({
      success: true,
      message: '模板创建成功',
      data: template
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PUT /api/config-templates/:id
 * 更新自定义配置模板
 */
router.put('/:id', (req, res) => {
  try {
    const template = templatesService.updateCustomTemplate(req.params.id, req.body);
    res.json({
      success: true,
      message: '模板更新成功',
      data: template
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * DELETE /api/config-templates/:id
 * 删除配置模板
 */
router.delete('/:id', (req, res) => {
  try {
    templatesService.deleteCustomTemplate(req.params.id);
    res.json({
      success: true,
      message: '模板删除成功'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/config-templates/:id/apply
 * 应用模板到项目目录
 */
router.post('/:id/apply', async (req, res) => {
  try {
    const { targetPath, aiConfigType, aiConfigTypes } = req.body;
    if (!targetPath) {
      return res.status(400).json({
        success: false,
        message: '目标路径不能为空'
      });
    }
    const { validateKnownProjectCwd } = require('../services/project-path-validation');
    const validatedTargetPath = await validateKnownProjectCwd(targetPath);
    if (!validatedTargetPath) {
      return res.status(400).json({
        success: false,
        message: '目标路径不能为空'
      });
    }
    const options = {};
    const normalizedAiConfigTypes = normalizeAiConfigTypes(aiConfigTypes, aiConfigType);
    if (normalizedAiConfigTypes.length > 0) {
      options.aiConfigTypes = normalizedAiConfigTypes;
    }
    const result = await templatesService.applyTemplateToProject(validatedTargetPath, req.params.id, options);
    const skippedCount = result?.results?.skipped?.length || 0;
    res.json({
      success: true,
      message: skippedCount > 0 ? `模板已部分应用（${skippedCount} 项已跳过）` : '模板应用成功',
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/config-templates/:id/preview
 * 预览模板应用效果
 */
router.post('/:id/preview', async (req, res) => {
  try {
    const { targetPath, aiConfigType, aiConfigTypes } = req.body;
    if (!targetPath) {
      return res.status(400).json({
        success: false,
        message: '目标路径不能为空'
      });
    }
    const { validateKnownProjectCwd } = require('../services/project-path-validation');
    const validatedTargetPath = await validateKnownProjectCwd(targetPath);
    if (!validatedTargetPath) {
      return res.status(400).json({
        success: false,
        message: '目标路径不能为空'
      });
    }
    const options = {};
    const normalizedAiConfigTypes = normalizeAiConfigTypes(aiConfigTypes, aiConfigType);
    if (normalizedAiConfigTypes.length > 0) {
      options.aiConfigTypes = normalizedAiConfigTypes;
    }
    const preview = await templatesService.previewTemplateApplication(validatedTargetPath, req.params.id, options);
    res.json({
      success: true,
      data: preview
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
