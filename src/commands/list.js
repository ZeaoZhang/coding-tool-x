// 列出会话命令
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const { getAllSessions, parseSessionInfoFast } = require('../utils/session');
const { formatTime, formatSize, truncate } = require('../utils/format');
const { promptSelectSession, promptForkConfirm } = require('../ui/prompts');
const { resumeSession } = require('./resume');
const { loadAliases } = require('../server/services/alias');

/**
 * 列出会话
 */
async function listSessions(config, limit = null) {
  const maxSessions = limit || config.maxDisplaySessions;
  const spinner = ora('加载会话列表...').start();

  const sessions = getAllSessions(config).slice(0, maxSessions);

  if (sessions.length === 0) {
    spinner.fail('暂无会话记录');
    return [];
  }

  spinner.text = '解析会话信息...';

  // 加载别名
  const aliases = loadAliases();

  const choices = sessions.map((session, index) => {
    const info = parseSessionInfoFast(session.filePath);
    const time = formatTime(session.mtime);
    const size = formatSize(session.size);
    const alias = aliases[session.sessionId];

    // 构建显示名称 - 清爽的单行布局
    let displayName = '';

    // 格式：序号. [别名] 时间 │ 大小 │ 分支 │ 第一条消息
    displayName += chalk.bold.white(`${index + 1}. `);

    // 如果有别名，优先显示别名
    if (alias) {
      displayName += chalk.yellow.bold(`[${alias}] `);
    }

    displayName += chalk.cyan(`${time.padEnd(10)}`);
    displayName += chalk.gray(` │ ${size.padEnd(9)}`);

    if (info.gitBranch) {
      const branchName = info.gitBranch
        .replace('feature/', '')
        .replace('feat/', '')
        .replace('fix/', '')
        .substring(0, 25);
      displayName += chalk.green(` │ ${branchName.padEnd(25)}`);
    } else {
      displayName += chalk.gray(` │ ${''.padEnd(25)}`);
    }

    // 只显示第一条用户消息（你说明这个会话是干嘛的）
    if (info.firstMessage && info.firstMessage !== 'Warmup') {
      const firstMsg = truncate(info.firstMessage, 50);
      displayName += chalk.gray(' │ ') + chalk.white(firstMsg);
    }

    return {
      name: displayName,
      value: session.sessionId,
      short: alias ? `${alias} (${session.sessionId.substring(0, 8)})` : `会话 ${session.sessionId.substring(0, 8)}`,
    };
  });

  spinner.stop();
  spinner.clear();

  // 清屏并重新显示，避免之前的输出干扰
  console.clear();
  console.log(chalk.green(`\n✨ 找到 ${sessions.length} 个会话\n`));

  return choices;
}

/**
 * 处理列出会话
 */
async function handleList(config, switchProjectCallback) {
  while (true) {
    const choices = await listSessions(config);

    if (choices.length === 0) {
      return;
    }

    // 添加操作选项
    choices.push(new inquirer.Separator(chalk.gray('─'.repeat(50))));
    choices.push({ name: chalk.blue('↩️  返回主菜单'), value: 'back' });
    choices.push({ name: chalk.magenta('🔀  切换项目'), value: 'switch' });

    const sessionId = await promptSelectSession(choices);

    if (sessionId === 'back') {
      return;
    }

    if (sessionId === 'switch') {
      const switched = await switchProjectCallback();
      if (!switched) {
        return; // 用户取消切换，返回主菜单
      }
      continue; // 切换后重新加载列表
    }

    // 询问是否 fork
    const action = await promptForkConfirm();

    if (action === 'back') {
      continue; // 返回列表重新选择
    }

    const fork = action === 'fork';
    await resumeSession(config, sessionId, fork);
  }
}

module.exports = {
  listSessions,
  handleList,
};
