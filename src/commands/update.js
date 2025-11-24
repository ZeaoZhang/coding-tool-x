const chalk = require('chalk');
const { spawn } = require('child_process');
const ora = require('ora');
const { checkForUpdates } = require('../utils/version-check');

/**
 * 处理更新命令
 */
async function handleUpdate() {
  console.log(chalk.cyan.bold('\n🔍 检查更新中...\n'));

  const spinner = ora('正在检查版本...').start();

  try {
    const result = await checkForUpdates();

    spinner.stop();

    if (result.error) {
      console.log(chalk.yellow('⚠️  无法检查更新（网络连接失败）'));
      console.log(chalk.gray(`   当前版本: ${result.current}\n`));
      return;
    }

    console.log(chalk.gray(`📦 当前版本: ${chalk.white.bold(result.current)}`));
    console.log(chalk.gray(`📦 最新版本: ${chalk.white.bold(result.latest)}\n`));

    if (!result.hasUpdate) {
      console.log(chalk.green('✅ 已经是最新版本！\n'));
      return;
    }

    // 发现新版本
    console.log(chalk.green.bold('🎉 发现新版本！'));
    console.log(chalk.cyan(`   ${result.current} → ${result.latest}\n`));

    // 询问是否更新
    const inquirer = require('inquirer');
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: '是否立即更新？',
        default: true
      }
    ]);

    if (!confirm) {
      console.log(chalk.yellow('\n❌ 已取消更新\n'));
      return;
    }

    // 执行更新
    console.log(chalk.cyan('\n⏳ 正在更新...\n'));

    await performUpdate();

  } catch (err) {
    spinner.stop();
    console.error(chalk.red('\n❌ 检查更新失败:'), err.message);
    console.log();
  }
}

/**
 * 执行实际的更新操作
 */
function performUpdate() {
  return new Promise((resolve, reject) => {
    const updateProcess = spawn('npm', ['install', '-g', 'coding-tool@latest'], {
      stdio: 'inherit',
      shell: true
    });

    updateProcess.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green.bold('\n✅ 更新成功！\n'));
        console.log(chalk.cyan('💡 提示: 更新后可能需要重启终端或重新运行命令\n'));
        resolve();
      } else {
        console.log(chalk.red('\n❌ 更新失败'));
        console.log(chalk.yellow('💡 提示: 您可以尝试手动更新：'));
        console.log(chalk.gray('   $ npm install -g coding-tool@latest\n'));
        reject(new Error('Update failed with code ' + code));
      }
    });

    updateProcess.on('error', (err) => {
      console.log(chalk.red('\n❌ 更新失败:'), err.message);
      console.log(chalk.yellow('💡 提示: 您可以尝试手动更新：'));
      console.log(chalk.gray('   $ npm install -g coding-tool@latest\n'));
      reject(err);
    });
  });
}

/**
 * 静默检查更新（不进行交互，仅返回结果）
 */
async function checkUpdateSilently() {
  try {
    const result = await checkForUpdates();
    return result;
  } catch (err) {
    return {
      hasUpdate: false,
      error: true
    };
  }
}

module.exports = {
  handleUpdate,
  checkUpdateSilently
};
