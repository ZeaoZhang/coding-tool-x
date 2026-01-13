// 配置模板 API 路由
const express = require('express');
const router = express.Router();
const templatesService = require('../services/config-templates-service');

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
router.get('/:id', (req, res) => {
  try {
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
 * 删除自定义配置模板
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
router.post('/:id/apply', (req, res) => {
  try {
    const { targetPath } = req.body;
    if (!targetPath) {
      return res.status(400).json({
        success: false,
        message: '目标路径不能为空'
      });
    }
    const result = templatesService.applyTemplateToProject(targetPath, req.params.id);
    res.json({
      success: true,
      message: '模板应用成功',
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
router.post('/:id/preview', (req, res) => {
  try {
    const { targetPath } = req.body;
    if (!targetPath) {
      return res.status(400).json({
        success: false,
        message: '目标路径不能为空'
      });
    }
    const preview = templatesService.previewTemplateApplication(targetPath, req.params.id);
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
