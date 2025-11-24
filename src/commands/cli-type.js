// CLI类型切换命令
const chalk = require('chalk');
const inquirer = require('inquirer');
const { loadConfig, saveConfig } = require('../config/loader');

const CLI_TYPES = {
  claude: { name: 'Claude Code', color: 'cyan' },
  codex: { name: 'Codex', color: 'green' },
  gemini: { name: 'Gemini', color: 'magenta' }
};

/**
 * 切换CLI类型
 */
async function handleSwitchCliType() {
  console.clear();
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║          切换 CLI 类型          ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════╝\n'));

  const config = loadConfig();
  const currentType = config.currentCliType || 'claude';

  console.log(chalk.gray(`当前类型: ${CLI_TYPES[currentType].name}\n`));

  // 构建类型选项
  const choices = Object.entries(CLI_TYPES).map(([type, info]) => {
    let name = '';

    // 如果是当前类型，添加✓标记
    if (type === currentType) {
      name += chalk.green('✓ ');
    } else {
      name += '  ';
    }

    // 类型名称
    name += chalk[info.color](info.name);

    return {
      name,
      value: type
    };
  });

  // 添加返回选项
  choices.push(new inquirer.Separator(chalk.gray('─'.repeat(14))));
  choices.push({ name: chalk.gray('返回主菜单'), value: 'back' });

  const { selectedType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedType',
      message: '请选择 CLI 类型:',
      choices: choices,
    },
  ]);

  if (selectedType === 'back') {
    return;
  }

  if (selectedType === currentType) {
    console.log(chalk.yellow('\n已经是当前类型了\n'));
    await inquirer.prompt([
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

  // 保存新的类型
  config.currentCliType = selectedType;
  saveConfig(config);

  console.log(chalk.green(`\n✅ 已切换到 ${CLI_TYPES[selectedType].name}\n`));
  console.log(chalk.gray('下次启动时将使用新的类型\n'));

  await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '请选择操作:',
      choices: [
        { name: chalk.blue('返回主菜单'), value: 'back' },
      ],
    },
  ]);
}

module.exports = {
  handleSwitchCliType
};
