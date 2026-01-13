const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

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

/**
 * 从会话文件中提取 cwd
 * @param {string} sessionFilePath - 会话文件路径
 * @returns {string|null} cwd 或 null
 */
function extractCwdFromSession(sessionFilePath) {
  try {
    const content = fs.readFileSync(sessionFilePath, 'utf8');
    const firstLine = content.split('\n')[0];
    if (firstLine) {
      const json = JSON.parse(firstLine);
      return json.cwd || null;
    }
  } catch (err) {
    // Ignore parse errors
  }
  return null;
}

/**
 * 扫描旧的全局目录中的会话文件
 * @returns {Object} 扫描结果
 */
function scanLegacySessionFiles() {
  try {
    const legacyProjectsDir = path.join(os.homedir(), '.claude', 'projects');

    if (!fs.existsSync(legacyProjectsDir)) {
      return {
        found: false,
        message: 'Legacy directory not found (nothing to clean)',
        legacyDir: legacyProjectsDir
      };
    }

    const projects = [];
    const entries = fs.readdirSync(legacyProjectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectName = entry.name;
      const projectDir = path.join(legacyProjectsDir, projectName);
      const files = fs.readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl') || f.endsWith('.json'));

      if (files.length > 0) {
        let totalSize = 0;
        for (const file of files) {
          const filePath = path.join(projectDir, file);
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
        }

        projects.push({
          projectName,
          projectDir,
          fileCount: files.length,
          totalSize,
          files: files.slice(0, 5) // 只显示前5个文件名
        });
      }
    }

    return {
      found: true,
      legacyDir: legacyProjectsDir,
      projectCount: projects.length,
      projects
    };
  } catch (err) {
    return {
      found: false,
      error: err.message
    };
  }
}

/**
 * 迁移会话文件到正确的位置
 * @param {Object} options - 迁移选项
 * @returns {Object} 迁移结果
 */
function migrateSessionFiles(options = {}) {
  const {
    dryRun = false,  // 是否只是预演
    projectNames = null  // 指定要迁移的项目
  } = options;

  try {
    const legacyProjectsDir = path.join(os.homedir(), '.claude', 'projects');

    if (!fs.existsSync(legacyProjectsDir)) {
      return {
        success: true,
        message: 'No legacy directory found',
        migrated: 0
      };
    }

    const results = {
      dryRun,
      migrated: [],
      skipped: [],
      errors: []
    };

    const entries = fs.readdirSync(legacyProjectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectName = entry.name;

      // 如果指定了项目列表，只迁移列表中的项目
      if (projectNames && !projectNames.includes(projectName)) {
        continue;
      }

      const projectDir = path.join(legacyProjectsDir, projectName);
      const files = fs.readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'));

      for (const file of files) {
        const oldPath = path.join(projectDir, file);

        try {
          // 从会话文件提取 cwd
          const cwd = extractCwdFromSession(oldPath);

          if (!cwd || !fs.existsSync(cwd)) {
            results.skipped.push({
              file,
              reason: 'Invalid or missing cwd',
              oldPath
            });
            continue;
          }

          // 目标路径: {cwd}/.claude/sessions/{file}
          const targetDir = path.join(cwd, '.claude', 'sessions');
          const newPath = path.join(targetDir, file);

          // 如果文件已存在，跳过
          if (fs.existsSync(newPath)) {
            results.skipped.push({
              file,
              reason: 'Already exists at target',
              oldPath,
              newPath
            });
            continue;
          }

          if (!dryRun) {
            // 确保目标目录存在
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
            }

            // 复制文件（保留原文件）
            fs.copyFileSync(oldPath, newPath);
            console.log(`[Migration] Migrated: ${file} -> ${newPath}`);
          }

          results.migrated.push({
            file,
            oldPath,
            newPath,
            cwd
          });
        } catch (err) {
          results.errors.push({
            file,
            oldPath,
            error: err.message
          });
        }
      }
    }

    return {
      success: true,
      dryRun,
      migratedCount: results.migrated.length,
      skippedCount: results.skipped.length,
      errorCount: results.errors.length,
      results
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * 清理旧的全局目录中的会话文件
 * @param {Object} options - 清理选项
 * @returns {Object} 清理结果
 */
function cleanLegacySessionFiles(options = {}) {
  const {
    dryRun = false,  // 是否只是预演，不实际删除
    projectNames = null  // 指定要清理的项目名称列表，null 表示全部
  } = options;

  try {
    const legacyProjectsDir = path.join(os.homedir(), '.claude', 'projects');

    if (!fs.existsSync(legacyProjectsDir)) {
      return {
        success: true,
        message: 'No legacy directory found',
        deleted: 0
      };
    }

    const results = {
      dryRun,
      deleted: [],
      errors: [],
      totalSize: 0
    };

    const entries = fs.readdirSync(legacyProjectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectName = entry.name;

      // 如果指定了项目列表，只清理列表中的项目
      if (projectNames && !projectNames.includes(projectName)) {
        continue;
      }

      const projectDir = path.join(legacyProjectsDir, projectName);
      const files = fs.readdirSync(projectDir);

      for (const file of files) {
        const filePath = path.join(projectDir, file);

        try {
          const stats = fs.statSync(filePath);
          results.totalSize += stats.size;

          if (!dryRun) {
            fs.unlinkSync(filePath);
          }

          results.deleted.push({
            projectName,
            file,
            size: stats.size
          });
        } catch (err) {
          results.errors.push({
            projectName,
            file,
            error: err.message
          });
        }
      }

      // 如果项目目录为空，删除目录
      if (!dryRun) {
        try {
          const remainingFiles = fs.readdirSync(projectDir);
          if (remainingFiles.length === 0) {
            fs.rmdirSync(projectDir);
            console.log(`[Cleanup] Removed empty directory: ${projectDir}`);
          }
        } catch (err) {
          console.warn(`[Cleanup] Failed to remove directory ${projectDir}:`, err.message);
        }
      }
    }

    // 如果 projects 目录为空，删除它
    if (!dryRun) {
      try {
        const remainingProjects = fs.readdirSync(legacyProjectsDir);
        if (remainingProjects.length === 0) {
          fs.rmdirSync(legacyProjectsDir);
          console.log(`[Cleanup] Removed empty legacy directory: ${legacyProjectsDir}`);
        }
      } catch (err) {
        console.warn(`[Cleanup] Failed to remove legacy directory:`, err.message);
      }
    }

    return {
      success: true,
      dryRun,
      deletedCount: results.deleted.length,
      errorCount: results.errors.length,
      totalSize: results.totalSize,
      results
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

module.exports = {
  ensureProjectClaudeDir,
  healthCheckAllProjects,
  scanLegacySessionFiles,
  migrateSessionFiles,
  cleanLegacySessionFiles
};
