// 渠道管理命令
const chalk = require('chalk');
const inquirer = require('inquirer');
const { getAllChannels, createChannel, activateChannel } = require('../server/services/channels');
const { getProxyStatus } = require('../server/proxy-server');

/**
 * 切换渠道
 */
async function handleSwitchChannel() {
  console.clear();
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║          切换渠道          ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════╝\n'));

  const channels = getAllChannels();

  if (channels.length === 0) {
    console.log(chalk.yellow('还没有添加任何渠道'));
    console.log(chalk.gray('提示: 使用主菜单的"添加渠道"功能来添加新渠道\n'));

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '请选择操作:',
        choices: [
          { name: chalk.blue('返回主菜单'), value: 'back' },
        ],
      },
    ]);

    return;
  }

  const proxyStatus = getProxyStatus();
  const isProxyMode = proxyStatus.running;

  // 构建渠道选项
  const choices = channels.map(channel => {
    let name = '';

    // 如果是激活的渠道，添加✓标记
    if (channel.isActive) {
      name += chalk.green('✓ ');
    } else {
      name += '  ';
    }

    // 渠道名称
    name += chalk.bold(channel.name);

    // Base URL（简化显示）
    const baseUrl = channel.baseUrl.replace('https://', '').replace('http://', '');
    name += chalk.gray(` (${baseUrl.substring(0, 40)})`);

    return {
      name,
      value: channel.id,
      short: channel.name,
    };
  });

  choices.push(new inquirer.Separator(chalk.gray('─'.repeat(14))));
  choices.push({ name: chalk.blue('↩️  返回主菜单'), value: 'back' });

  const { channelId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'channelId',
      message: isProxyMode
        ? '选择要切换的渠道（动态切换模式）:'
        : '选择要切换的渠道（需要重启 Claude Code 生效）:',
      pageSize: 15,
      choices,
    },
  ]);

  if (channelId === 'back') {
    return;
  }

  try {
    const channel = activateChannel(channelId);
    console.log(chalk.green(`\n✅ 已切换到渠道: ${channel.name}\n`));

    if (isProxyMode) {
      console.log(chalk.cyan('💡 动态切换模式已激活，无需重启 Claude Code'));
    } else {
      console.log(chalk.yellow('⚠️  请重启 Claude Code 以使用新渠道'));
      console.log(chalk.gray('   提示: 开启"动态切换"可以无需重启即可切换渠道\n'));
    }

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: '按回车继续...',
      },
    ]);
  } catch (error) {
    console.log(chalk.red(`\n❌ 切换失败: ${error.message}\n`));

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: '按回车继续...',
      },
    ]);
  }
}

/**
 * 添加渠道
 */
async function handleAddChannel() {
  console.clear();
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║          添加渠道          ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════╝\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: '渠道名称:',
      validate: (input) => {
        if (!input.trim()) {
          return '渠道名称不能为空';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Base URL:',
      validate: (input) => {
        if (!input.trim()) {
          return 'Base URL 不能为空';
        }
        // 简单的 URL 验证
        if (!input.startsWith('http://') && !input.startsWith('https://')) {
          return 'Base URL 必须以 http:// 或 https:// 开头';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'apiKey',
      message: 'API Key:',
      validate: (input) => {
        if (!input.trim()) {
          return 'API Key 不能为空';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'websiteUrl',
      message: '网站地址（可选，直接回车跳过）:',
    },
  ]);

  try {
    const channel = createChannel(
      answers.name.trim(),
      answers.baseUrl.trim(),
      answers.apiKey.trim(),
      answers.websiteUrl.trim() || undefined
    );

    console.log(chalk.green(`\n✅ 渠道添加成功: ${channel.name}\n`));
    console.log(chalk.gray('提示: 使用"切换渠道"功能来激活此渠道\n'));

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: '按回车继续...',
      },
    ]);
  } catch (error) {
    console.log(chalk.red(`\n❌ 添加失败: ${error.message}\n`));

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: '按回车继续...',
      },
    ]);
  }
}

module.exports = {
  handleSwitchChannel,
  handleAddChannel,
};
