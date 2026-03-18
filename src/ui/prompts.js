// 交互提示
const inquirer = require('inquirer');
const chalk = require('chalk');

/**
 * 选择会话提示
 */
async function promptSelectSession(choices) {
  const { sessionId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'sessionId',
      message: '选择会话或操作:',
      pageSize: 15,
      choices: choices,
    },
  ]);

  return sessionId;
}

/**
 * Fork 确认提示
 */
async function promptForkConfirm() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: chalk.bold('选择恢复方式:'),
      default: 'continue',
      choices: [
        {
          name: chalk.green('[NOTE] 继续原会话 (推荐) - 在原会话上继续对话，所有内容会追加到原文件'),
          value: 'continue',
        },
        {
          name: chalk.yellow('[FORK] 创建新分支 (Fork) - 基于原会话创建新会话，保留原会话不变'),
          value: 'fork',
        },
        new inquirer.Separator(chalk.gray('─'.repeat(14))),
        { name: chalk.blue('[<-]  返回重新选择'), value: 'back' },
      ],
    },
  ]);

  return action;
}

/**
 * 搜索关键词提示
 */
async function promptSearchKeyword() {
  const { keyword } = await inquirer.prompt([
    {
      type: 'input',
      name: 'keyword',
      message: chalk.cyan('[SEARCH] 输入搜索关键词:'),
      validate: (input) => {
        if (!input.trim()) {
          return '请输入搜索关键词';
        }
        return true;
      },
    },
  ]);

  return keyword.trim();
}

/**
 * 选择项目提示
 */
async function promptSelectProject(projects) {
  // 添加取消选项
  const choices = [
    ...projects,
    new inquirer.Separator(chalk.gray('─'.repeat(14))),
    { name: chalk.gray('[<-]  取消切换'), value: null }
  ];

  const { project } = await inquirer.prompt([
    {
      type: 'list',
      name: 'project',
      message: chalk.cyan('选择项目:'),
      pageSize: 15,
      choices: choices,
    },
  ]);

  return project;
}

module.exports = {
  promptSelectSession,
  promptForkConfirm,
  promptSearchKeyword,
  promptSelectProject,
};
