const chalk = require('chalk');
const fs = require('fs');
const { PATHS, ensureStorageDirMigrated } = require('../config/paths');

const SECURITY_FILE = PATHS.security;

function showSecurityHelp() {
  console.log(chalk.yellow('\n[SECURE] 安全设置命令:'));
  console.log('  ctx security reset       关闭访问密码（删除安全配置文件）');
  console.log('');
}

async function handleSecurityReset() {
  console.log(chalk.cyan('\n[SECURE] 安全设置 - 关闭访问密码\n'));
  ensureStorageDirMigrated();

  if (!fs.existsSync(SECURITY_FILE)) {
    console.log(chalk.yellow('[WARN]  未检测到安全配置文件'));
    console.log(chalk.gray(`路径: ${SECURITY_FILE}\n`));
    return;
  }

  try {
    fs.unlinkSync(SECURITY_FILE);
    console.log(chalk.green('[OK] 访问密码已关闭'));
    console.log(chalk.gray(`已删除: ${SECURITY_FILE}\n`));
  } catch (error) {
    console.error(chalk.red('[ERROR] 关闭密码失败:'), error.message);
    console.log(chalk.gray(`路径: ${SECURITY_FILE}\n`));
  }
}

module.exports = {
  showSecurityHelp,
  handleSecurityReset
};
