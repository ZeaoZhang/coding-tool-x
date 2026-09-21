'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { exportAllConfigsZip } = require('../server/services/config-export-service');

/**
 * 导出统一配置包。
 *
 * 保留旧命令入口，但实际复用服务端的 Manifest/Driver 导出流程，
 * 不再只导出 Claude Code，也不再维护第二套打包逻辑。
 */
async function exportConfig(options = {}) {
  const result = exportAllConfigsZip();
  if (!result.success) {
    console.error(chalk.red('[ERROR] 导出失败:'), result.message || '未知错误');
    return null;
  }

  const outputPath = path.resolve(process.cwd(), options.output || result.filename || 'ctx-config.zip');
  fs.writeFileSync(outputPath, result.data);
  console.log(chalk.green('[OK] 配置导出成功！'));
  console.log(chalk.gray(`   文件位置: ${outputPath}`));
  console.log(chalk.gray(`   文件大小: ${(result.data.length / 1024 / 1024).toFixed(2)} MB`));
  return outputPath;
}

module.exports = { exportConfig };
