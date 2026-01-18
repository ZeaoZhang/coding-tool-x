const fs = require('fs');
const path = require('path');

/**
 * 健康检查：确保项目的 .claude/sessions 目录存在
 * @param {string} projectPath - 项目路径
 * @returns {Object} 检查结果
 */
function ensureProjectClaudeDir(projectPath) {
  try {
    const claudeDir = path.join(projectPath, '.claude');
    const sessionsDir = path.join(claudeDir, 'sessions');

    const result = {
      projectPath,
      claudeDirExists: fs.existsSync(claudeDir),
      sessionsDirExists: fs.existsSync(sessionsDir),
      created: false,
      error: null
    };

    // 如果目录不存在，自动创建
    if (!result.sessionsDirExists) {
      try {
        fs.mkdirSync(sessionsDir, { recursive: true });
        result.created = true;
        result.sessionsDirExists = true;
        result.claudeDirExists = true;
        console.log(`[Health Check] Created .claude/sessions directory for: ${projectPath}`);
      } catch (err) {
        result.error = `Failed to create directory: ${err.message}`;
        console.error(`[Health Check] Error creating directory for ${projectPath}:`, err);
      }
    }

    return result;
  } catch (err) {
    return {
      projectPath,
      error: err.message
    };
  }
}

/**
 * 批量检查所有项目的健康状态
 * @param {Array} projects - 项目列表
 * @returns {Object} 汇总结果
 */
function healthCheckAllProjects(projects) {
  const results = [];
  let checkedCount = 0;
  let createdCount = 0;
  let errorCount = 0;

  for (const project of projects) {
    if (!project.fullPath) continue;

    const result = ensureProjectClaudeDir(project.fullPath);
    results.push(result);
    checkedCount++;

    if (result.created) {
      createdCount++;
    }
    if (result.error) {
      errorCount++;
    }
  }

  return {
    summary: {
      total: checkedCount,
      created: createdCount,
      errors: errorCount,
      healthy: checkedCount - errorCount
    },
    results
  };
}

module.exports = {
  ensureProjectClaudeDir,
  healthCheckAllProjects
};
