const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SECURITY_FILE = path.join(os.homedir(), '.claude', 'cc-tool', 'security.json');

function showSecurityHelp() {
  console.log(chalk.yellow('\n🔐 安全设置命令:'));
  console.log('  ctx security reset       关闭访问密码（删除安全配置文件）');
  console.log('');
}

async function handleSecurityReset() {
  console.log(chalk.cyan('\n🔐 安全设置 - 关闭访问密码\n'));

  if (!fs.existsSync(SECURITY_FILE)) {
    console.log(chalk.yellow('⚠️  未检测到安全配置文件'));
    console.log(chalk.gray(`路径: ${SECURITY_FILE}\n`));
    return;
  }

  try {
    fs.unlinkSync(SECURITY_FILE);
    console.log(chalk.green('✅ 访问密码已关闭'));
    console.log(chalk.gray(`已删除: ${SECURITY_FILE}\n`));
  } catch (error) {
    console.error(chalk.red('❌ 关闭密码失败:'), error.message);
    console.log(chalk.gray(`路径: ${SECURITY_FILE}\n`));
  }
}

module.exports = {
  showSecurityHelp,
  handleSecurityReset
};
