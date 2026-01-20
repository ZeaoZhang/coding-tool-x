/**
 * 配置导出/导入服务
 * 支持权限模板、配置模板、频道配置的导出与导入
 */

const fs = require('fs');
const path = require('path');
const permissionTemplatesService = require('./permission-templates-service');
const configTemplatesService = require('./config-templates-service');
const channelsService = require('./channels');

const CONFIG_VERSION = '1.0.0';

/**
 * 导出所有配置为JSON
 * @returns {Object} 配置导出对象
 */
function exportAllConfigs() {
  try {
    // 获取所有权限模板（只导出自定义模板）
    const allPermissionTemplates = permissionTemplatesService.getAllTemplates();
    const customPermissionTemplates = allPermissionTemplates.filter(t => !t.isBuiltin);

    // 获取所有配置模板（只导出自定义模板）
    const allConfigTemplates = configTemplatesService.getAllTemplates();
    const customConfigTemplates = allConfigTemplates.filter(t => !t.isBuiltin);

    // 获取所有频道配置
    const channelsData = channelsService.getAllChannels();
    const channels = channelsData?.channels || [];

    const exportData = {
      version: CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        permissionTemplates: customPermissionTemplates,
        configTemplates: customConfigTemplates,
        channels: channels || []
      }
    };

    return {
      success: true,
      data: exportData
    };
  } catch (error) {
    console.error('[ConfigExport] 导出配置失败:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * 导入配置
 * @param {Object} importData - 导入的配置对象
 * @param {Object} options - 导入选项 { overwrite: boolean }
 * @returns {Object} 导入结果
 */
function importConfigs(importData, options = {}) {
  const { overwrite = false } = options;
  const results = {
    permissionTemplates: { success: 0, failed: 0, skipped: 0 },
    configTemplates: { success: 0, failed: 0, skipped: 0 },
    channels: { success: 0, failed: 0, skipped: 0 }
  };

  try {
    // 验证导入数据格式
    if (!importData || !importData.data) {
      throw new Error('无效的导入数据格式');
    }

    const { permissionTemplates = [], configTemplates = [], channels = [] } = importData.data;

    // 导入权限模板
    for (const template of permissionTemplates) {
      try {
        const existing = permissionTemplatesService.getTemplateById(template.id);

        if (existing && !overwrite) {
          results.permissionTemplates.skipped++;
          continue;
        }

        if (existing && overwrite) {
          permissionTemplatesService.updateTemplate(template.id, template);
        } else {
          // 创建新模板（使用原ID）
          const newTemplate = {
            ...template,
            isBuiltin: false,
            importedAt: new Date().toISOString()
          };
          permissionTemplatesService.createTemplate(newTemplate);
        }
        results.permissionTemplates.success++;
      } catch (err) {
        console.error(`[ConfigImport] 导入权限模板失败: ${template.name}`, err);
        results.permissionTemplates.failed++;
      }
    }

    // 导入配置模板
    for (const template of configTemplates) {
      try {
        const existing = configTemplatesService.getTemplateById(template.id);

        if (existing && !overwrite) {
          results.configTemplates.skipped++;
          continue;
        }

        if (existing && overwrite) {
          configTemplatesService.updateTemplate(template.id, template);
        } else {
          const newTemplate = {
            ...template,
            isBuiltin: false,
            importedAt: new Date().toISOString()
          };
          configTemplatesService.createTemplate(newTemplate);
        }
        results.configTemplates.success++;
      } catch (err) {
        console.error(`[ConfigImport] 导入配置模板失败: ${template.name}`, err);
        results.configTemplates.failed++;
      }
    }

    // 导入频道配置
    for (const channel of channels) {
      try {
        const channelsData = channelsService.getAllChannels();
        const existingChannels = channelsData?.channels || [];
        const existing = existingChannels.find(c => c.id === channel.id);

        if (existing && !overwrite) {
          results.channels.skipped++;
          continue;
        }

        if (existing && overwrite) {
          channelsService.updateChannel(channel.id, channel);
        } else {
          // createChannel 需要单独的参数，不是一个对象
          const { name, baseUrl, apiKey, websiteUrl, ...extraConfig } = channel;
          channelsService.createChannel(name, baseUrl, apiKey, websiteUrl, extraConfig);
        }
        results.channels.success++;
      } catch (err) {
        console.error(`[ConfigImport] 导入频道失败: ${channel.name}`, err);
        results.channels.failed++;
      }
    }

    return {
      success: true,
      results,
      message: generateImportSummary(results)
    };
  } catch (error) {
    console.error('[ConfigImport] 导入配置失败:', error);
    return {
      success: false,
      message: error.message,
      results
    };
  }
}

/**
 * 生成导入摘要消息
 */
function generateImportSummary(results) {
  const parts = [];

  if (results.permissionTemplates.success > 0) {
    parts.push(`权限模板: ${results.permissionTemplates.success}成功`);
  }
  if (results.configTemplates.success > 0) {
    parts.push(`配置模板: ${results.configTemplates.success}成功`);
  }
  if (results.channels.success > 0) {
    parts.push(`频道: ${results.channels.success}成功`);
  }

  const totalSkipped = results.permissionTemplates.skipped +
                       results.configTemplates.skipped +
                       results.channels.skipped;
  if (totalSkipped > 0) {
    parts.push(`${totalSkipped}项已跳过`);
  }

  const totalFailed = results.permissionTemplates.failed +
                      results.configTemplates.failed +
                      results.channels.failed;
  if (totalFailed > 0) {
    parts.push(`${totalFailed}项失败`);
  }

  return parts.join(', ');
}

module.exports = {
  exportAllConfigs,
  importConfigs
};
