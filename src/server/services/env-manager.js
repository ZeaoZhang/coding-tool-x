/**
 * 环境变量管理服务
 *
 * 负责备份、删除和恢复环境变量
 */

const fs = require('fs');
const path = require('path');
const { PATHS, ensureStorageDirMigrated } = require('../../config/paths');

// 备份目录
const BACKUP_DIR = PATHS.envBackups;

function ensureParentDir(filePath) {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeFileAtomic(filePath, content) {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  try {
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupErr) {
        // ignore cleanup errors
      }
    }
  }
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPowerShellProfile(filePath) {
  return String(filePath || '').toLowerCase().endsWith('.ps1');
}

function matchesVarAssignment(line, varName, usePowerShell) {
  if (!line || !varName) {
    return false;
  }

  const escaped = escapeRegex(varName);
  const regex = usePowerShell
    ? new RegExp(`^\\s*\\$env:${escaped}\\s*=`, 'i')
    : new RegExp(`^\\s*(?:export\\s+)?${escaped}=`);
  return regex.test(line.trim());
}

function formatExportLine(varName, value, usePowerShell) {
  if (usePowerShell) {
    const escapedValue = String(value ?? '')
      .replace(/`/g, '``')
      .replace(/"/g, '`"');
    return `$env:${varName} = "${escapedValue}"`;
  }

  const escapedValue = String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
  return `export ${varName}="${escapedValue}"`;
}

/**
 * 确保备份目录存在
 */
function ensureBackupDir() {
  ensureStorageDirMigrated();
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

/**
 * 删除环境变量（带自动备份）
 * @param {Array} conflicts - 要删除的冲突列表
 * @returns {Object} 备份信息
 */
function deleteEnvVars(conflicts) {
  if (!conflicts || conflicts.length === 0) {
    throw new Error('没有选择要删除的环境变量');
  }

  // 只处理文件类型的环境变量（进程环境变量无法删除）
  const fileConflicts = conflicts.filter(c => c.sourceType === 'file');
  const processConflicts = conflicts.filter(c => c.sourceType === 'process');

  if (fileConflicts.length === 0 && processConflicts.length > 0) {
    throw new Error('进程环境变量无法直接删除，请手动从配置文件中移除');
  }

  // 1. 创建备份
  const backupInfo = createBackup(conflicts);

  // 2. 从文件中删除
  const results = [];
  const fileGroups = groupByFile(fileConflicts);

  for (const [filePath, vars] of Object.entries(fileGroups)) {
    try {
      removeVarsFromFile(filePath, vars);
      results.push({
        filePath,
        success: true,
        removedVars: vars.map(v => v.varName)
      });
    } catch (err) {
      results.push({
        filePath,
        success: false,
        error: err.message
      });
    }
  }

  // 同步清理当前服务进程中的同名变量，避免“删除后立即复检仍提示冲突”
  const clearedProcessVars = clearProcessEnvVars(conflicts);

  return {
    backupPath: backupInfo.backupPath,
    timestamp: backupInfo.timestamp,
    results,
    processConflictsSkipped: processConflicts.length,
    clearedProcessVars
  };
}

/**
 * 创建备份
 */
function createBackup(conflicts) {
  ensureBackupDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `env-backup-${timestamp}.json`);

  const backupData = {
    timestamp,
    createdAt: Date.now(),
    conflicts: conflicts.map(c => ({
      ...c,
      // 存储完整值用于恢复（不遮蔽）
      originalValue: getOriginalValue(c)
    }))
  };

  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf-8');

  return {
    backupPath: backupFile,
    timestamp
  };
}

/**
 * 获取原始值（从文件中重新读取）
 */
function getOriginalValue(conflict) {
  if (conflict.sourceType !== 'file' || !conflict.filePath || !conflict.lineNumber) {
    return null;
  }

  try {
    const content = fs.readFileSync(conflict.filePath, 'utf-8');
    const lines = content.split('\n');
    const line = lines[conflict.lineNumber - 1];

    if (line) {
      const match = line.match(/^(?:export\s+)?[A-Z_][A-Z0-9_]*=(.*)$/);
      if (match && match[1] !== undefined) {
        return cleanValue(match[1]);
      }

      const psMatch = line.match(/^\s*\$env:[A-Z_][A-Z0-9_]*\s*=\s*(.*)$/i);
      if (psMatch && psMatch[1] !== undefined) {
        return cleanValue(psMatch[1]);
      }
    }
  } catch (err) {
    // 忽略
  }

  return null;
}

/**
 * 清理变量值
 */
function cleanValue(value) {
  let cleaned = value.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned;
}

/**
 * 按文件分组
 */
function groupByFile(conflicts) {
  const groups = {};

  for (const conflict of conflicts) {
    if (conflict.filePath) {
      if (!groups[conflict.filePath]) {
        groups[conflict.filePath] = [];
      }
      groups[conflict.filePath].push(conflict);
    }
  }

  return groups;
}

/**
 * 清理当前 Node 进程中的环境变量
 */
function clearProcessEnvVars(conflicts) {
  const names = new Set();

  for (const conflict of conflicts || []) {
    const varName = String(conflict?.varName || '').trim();
    if (varName) {
      names.add(varName);
    }
  }

  const cleared = [];
  for (const varName of names) {
    if (Object.prototype.hasOwnProperty.call(process.env, varName)) {
      delete process.env[varName];
      cleared.push(varName);
    }
  }

  return cleared;
}

/**
 * 从文件中移除环境变量
 */
function removeVarsFromFile(filePath, vars) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const usePowerShell = isPowerShellProfile(filePath);

  // 收集要删除的行号（优先使用行号，行号不匹配时按变量名回退）
  const lineNumbersToRemove = new Set();
  for (const item of vars) {
    const varName = String(item.varName || '').trim();
    if (!varName) continue;

    const lineIndex = Number(item.lineNumber) - 1;
    if (
      Number.isInteger(lineIndex) &&
      lineIndex >= 0 &&
      lineIndex < lines.length &&
      matchesVarAssignment(lines[lineIndex], varName, usePowerShell)
    ) {
      lineNumbersToRemove.add(lineIndex);
      continue;
    }

    const fallbackIndex = lines.findIndex(line => matchesVarAssignment(line, varName, usePowerShell));
    if (fallbackIndex >= 0) {
      lineNumbersToRemove.add(fallbackIndex);
    }
  }

  if (lineNumbersToRemove.size === 0) {
    console.log(`[EnvManager] No matching vars found in ${filePath}, skip writing`);
    return;
  }

  const newLines = lines.filter((_, index) => !lineNumbersToRemove.has(index));
  const nextContent = newLines.join('\n');
  if (nextContent !== content) {
    writeFileAtomic(filePath, nextContent);
  }

  console.log(`[EnvManager] Removed ${lineNumbersToRemove.size} var(s) from ${filePath}`);
}

/**
 * 获取备份列表
 */
function getBackupList() {
  ensureBackupDir();

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('env-backup-') && f.endsWith('.json'))
    .sort()
    .reverse(); // 最新的在前

  return files.map(fileName => {
    const filePath = path.join(BACKUP_DIR, fileName);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      return {
        fileName,
        filePath,
        timestamp: data.timestamp,
        createdAt: data.createdAt,
        conflictCount: data.conflicts?.length || 0
      };
    } catch (err) {
      return {
        fileName,
        filePath,
        error: err.message
      };
    }
  });
}

/**
 * 从备份恢复
 */
function restoreFromBackup(backupPath) {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`备份文件不存在: ${backupPath}`);
  }

  const content = fs.readFileSync(backupPath, 'utf-8');
  const backupData = JSON.parse(content);

  const results = [];

  for (const conflict of backupData.conflicts) {
    if (conflict.sourceType !== 'file' || !conflict.filePath || !conflict.originalValue) {
      results.push({
        varName: conflict.varName,
        success: false,
        error: '无法恢复非文件类型的环境变量'
      });
      continue;
    }

    try {
      restoreVarToFile(conflict.filePath, conflict.varName, conflict.originalValue);
      results.push({
        varName: conflict.varName,
        filePath: conflict.filePath,
        success: true
      });
    } catch (err) {
      results.push({
        varName: conflict.varName,
        success: false,
        error: err.message
      });
    }
  }

  return { results };
}

/**
 * 恢复环境变量到文件
 */
function restoreVarToFile(filePath, varName, value) {
  const usePowerShell = isPowerShellProfile(filePath);
  const exportLine = formatExportLine(varName, value, usePowerShell);
  let content = '';

  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8');
  }

  const lines = content ? content.split(/\r?\n/) : [];
  let replaced = false;

  for (let i = 0; i < lines.length; i++) {
    if (matchesVarAssignment(lines[i], varName, usePowerShell)) {
      lines[i] = exportLine;
      replaced = true;
    }
  }

  if (!replaced) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(exportLine);
  }

  const nextContent = `${lines.join('\n')}\n`;
  writeFileAtomic(filePath, nextContent);

  console.log(`[EnvManager] Restored ${varName} to ${filePath}`);
}

/**
 * 删除备份文件
 */
function deleteBackup(backupPath) {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`备份文件不存在: ${backupPath}`);
  }

  // 安全检查：确保是备份目录下的文件
  if (!backupPath.startsWith(BACKUP_DIR)) {
    throw new Error('无效的备份文件路径');
  }

  fs.unlinkSync(backupPath);
  return true;
}

module.exports = {
  deleteEnvVars,
  getBackupList,
  restoreFromBackup,
  deleteBackup,
  BACKUP_DIR
};
