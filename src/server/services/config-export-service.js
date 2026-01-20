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
    // 获取所有权限模板(只导出自定义模板)
    const allPermissionTemplates = permissionTemplatesService.getAllTemplates();
    const customPermissionTemplates = allPermissionTemplates.filter(t => !t.isBuiltin);

    // 获取所有配置模板(只导出自定义模板)
    const allConfigTemplates = configTemplatesService.getAllTemplates();
    const customConfigTemplates = allConfigTemplates.filter(t => !t.isBuiltin);

    // 获取所有频道配置
    const channelsData = channelsService.getAllChannels();
    const channels = channelsData?.channels || [];

    // 获取工作区配置
    const workspaceService = require('./workspace-service');
    const workspaces = workspaceService.loadWorkspaces();

    // 获取收藏配置
    const favoritesService = require('./favorites');
    const favorites = favoritesService.loadFavorites();

    // 获取 Agents 配置
    const agentsService = require('./agents-service');
    const agents = agentsService.getAllAgents();

    // 获取 Skills 配置
    const skillService = require('./skill-service');
    const skills = skillService.getAllSkills();

    // 获取 Commands 配置
    const commandsService = require('./commands-service');
    const commands = commandsService.getAllCommands();

    // 获取 Rules 配置
    const rulesService = require('./rules-service');
    const rules = rulesService.getAllRules();

    // 获取 MCP 配置
    const mcpService = require('./mcp-service');
    const mcpServers = mcpService.getAllServers();

    // 读取 Markdown 配置文件
    const { PATHS } = require('../../config/paths');
    const markdownFiles = {};
    const mdFileNames = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];

    for (const fileName of mdFileNames) {
      const filePath = path.join(PATHS.base, fileName);
      if (fs.existsSync(filePath)) {
        try {
          markdownFiles[fileName] = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
          console.warn(`无法读取 ${fileName}:`, err.message);
        }
      }
    }

    const exportData = {
      version: CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        permissionTemplates: customPermissionTemplates,
        configTemplates: customConfigTemplates,
        channels: channels || [],
        workspaces: workspaces || { workspaces: [] },
        favorites: favorites || { favorites: [] },
        agents: agents || [],
        skills: skills || [],
        commands: commands || [],
        rules: rules || [],
        mcpServers: mcpServers || [],
        markdownFiles: markdownFiles
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
  const { overwrite = true } = options; // 默认覆盖模式
  const results = {
    permissionTemplates: { success: 0, failed: 0, skipped: 0 },
    configTemplates: { success: 0, failed: 0, skipped: 0 },
    channels: { success: 0, failed: 0, skipped: 0 },
    workspaces: { success: 0, failed: 0, skipped: 0 },
    favorites: { success: 0, failed: 0, skipped: 0 },
    agents: { success: 0, failed: 0, skipped: 0 },
    skills: { success: 0, failed: 0, skipped: 0 },
    commands: { success: 0, failed: 0, skipped: 0 },
    rules: { success: 0, failed: 0, skipped: 0 },
    mcpServers: { success: 0, failed: 0, skipped: 0 },
    markdownFiles: { success: 0, failed: 0, skipped: 0 }
  };

  try {
    // 验证导入数据格式
    if (!importData || !importData.data) {
      throw new Error('无效的导入数据格式');
    }

    const {
      permissionTemplates = [],
      configTemplates = [],
      channels = [],
      workspaces = null,
      favorites = null,
      agents = [],
      skills = [],
      commands = [],
      rules = [],
      mcpServers = [],
      markdownFiles = {}
    } = importData.data;

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
          const { name, baseUrl, apiKey, websiteUrl, ...extraConfig } = channel;
          channelsService.createChannel(name, baseUrl, apiKey, websiteUrl, extraConfig);
        }
        results.channels.success++;
      } catch (err) {
        console.error(`[ConfigImport] 导入频道失败: ${channel.name}`, err);
        results.channels.failed++;
      }
    }

    // 导入工作区配置
    if (workspaces && overwrite) {
      try {
        const workspaceService = require('./workspace-service');
        workspaceService.saveWorkspaces(workspaces);
        results.workspaces.success = workspaces.workspaces?.length || 0;
      } catch (err) {
        console.error('[ConfigImport] 导入工作区失败:', err);
        results.workspaces.failed++;
      }
    }

    // 导入收藏配置
    if (favorites && overwrite) {
      try {
        const favoritesService = require('./favorites');
        favoritesService.saveFavorites(favorites);
        const count = Object.values(favorites).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
        results.favorites.success = count;
      } catch (err) {
        console.error('[ConfigImport] 导入收藏失败:', err);
        results.favorites.failed++;
      }
    }

    // 导入 Agents
    if (agents && agents.length > 0 && overwrite) {
      try {
        const agentsService = require('./agents-service');
        for (const agent of agents) {
          try {
            agentsService.saveAgent(agent);
            results.agents.success++;
          } catch (err) {
            console.error(`[ConfigImport] 导入 Agent 失败: ${agent.name}`, err);
            results.agents.failed++;
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 Agents 失败:', err);
      }
    }

    // 导入 Skills
    if (skills && skills.length > 0 && overwrite) {
      try {
        const skillService = require('./skill-service');
        for (const skill of skills) {
          try {
            skillService.saveSkill(skill);
            results.skills.success++;
          } catch (err) {
            console.error(`[ConfigImport] 导入 Skill 失败: ${skill.name}`, err);
            results.skills.failed++;
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 Skills 失败:', err);
      }
    }

    // 导入 Commands
    if (commands && commands.length > 0 && overwrite) {
      try {
        const commandsService = require('./commands-service');
        for (const command of commands) {
          try {
            commandsService.saveCommand(command);
            results.commands.success++;
          } catch (err) {
            console.error(`[ConfigImport] 导入 Command 失败: ${command.name}`, err);
            results.commands.failed++;
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 Commands 失败:', err);
      }
    }

    // 导入 Rules
    if (rules && rules.length > 0 && overwrite) {
      try {
        const rulesService = require('./rules-service');
        for (const rule of rules) {
          try {
            rulesService.saveRule(rule);
            results.rules.success++;
          } catch (err) {
            console.error(`[ConfigImport] 导入 Rule 失败: ${rule.name}`, err);
            results.rules.failed++;
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 Rules 失败:', err);
      }
    }

    // 导入 MCP Servers
    if (mcpServers && mcpServers.length > 0 && overwrite) {
      try {
        const mcpService = require('./mcp-service');
        for (const server of mcpServers) {
          try {
            mcpService.saveServer(server);
            results.mcpServers.success++;
          } catch (err) {
            console.error(`[ConfigImport] 导入 MCP Server 失败: ${server.name}`, err);
            results.mcpServers.failed++;
          }
        }
      } catch (err) {
        console.error('[ConfigImport] 导入 MCP Servers 失败:', err);
      }
    }

    // 导入 Markdown 文件
    if (markdownFiles && Object.keys(markdownFiles).length > 0 && overwrite) {
      const { PATHS } = require('../../config/paths');
      for (const [fileName, content] of Object.entries(markdownFiles)) {
        try {
          const filePath = path.join(PATHS.base, fileName);
          fs.writeFileSync(filePath, content, 'utf8');
          results.markdownFiles.success++;
        } catch (err) {
          console.error(`[ConfigImport] 导入 ${fileName} 失败:`, err);
          results.markdownFiles.failed++;
        }
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

  const types = [
    { key: 'permissionTemplates', label: '权限模板' },
    { key: 'configTemplates', label: '配置模板' },
    { key: 'channels', label: '频道' },
    { key: 'workspaces', label: '工作区' },
    { key: 'favorites', label: '收藏' },
    { key: 'agents', label: 'Agents' },
    { key: 'skills', label: 'Skills' },
    { key: 'commands', label: 'Commands' },
    { key: 'rules', label: 'Rules' },
    { key: 'mcpServers', label: 'MCP服务器' },
    { key: 'markdownFiles', label: 'Markdown文件' }
  ];

  for (const { key, label } of types) {
    if (results[key] && results[key].success > 0) {
      parts.push(`${label}: ${results[key].success}成功`);
    }
  }

  const totalSkipped = Object.values(results).reduce((sum, r) => sum + (r.skipped || 0), 0);
  if (totalSkipped > 0) {
    parts.push(`${totalSkipped}项已跳过`);
  }

  const totalFailed = Object.values(results).reduce((sum, r) => sum + (r.failed || 0), 0);
  if (totalFailed > 0) {
    parts.push(`${totalFailed}项失败`);
  }

  return parts.join(', ') || '无数据导入';
}

module.exports = {
  exportAllConfigs,
  importConfigs
};
