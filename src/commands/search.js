// 搜索会话命令
const fs = require('fs');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const { getAllSessions, parseSessionInfoFast } = require('../utils/session');
const { formatTime, formatSize, truncate } = require('../utils/format');
const { promptSelectSession, promptSearchKeyword, promptForkConfirm } = require('../ui/prompts');
const { resumeSession } = require('./resume');

/**
 * 搜索会话
 */
async function searchSessions(config, keyword) {
  const spinner = ora(`搜索 "${keyword}"...`).start();

  const sessions = getAllSessions(config);
  const matches = [];

  for (const session of sessions) {
    try {
      // 先检查文件名和基本信息
      const info = parseSessionInfoFast(session.filePath);
      const basicInfo = `${info.gitBranch} ${info.summary} ${info.firstMessage}`;

      if (basicInfo.toLowerCase().includes(keyword.toLowerCase())) {
        matches.push(session);
        continue;
      }

      // 如果基本信息没匹配，再搜索文件内容（只搜索小文件）
      if (session.size < 5 * 1024 * 1024) { // 小于5MB
        const content = fs.readFileSync(session.filePath, 'utf8');
        if (content.includes(keyword)) {
          matches.push(session);
        }
      }
    } catch (e) {
      // 忽略错误
    }
  }

  if (matches.length === 0) {
    spinner.fail('未找到匹配的会话');
    return [];
  }

  spinner.stop();
  spinner.clear();

  // 清屏并重新显示，避免之前的输出干扰
  console.clear();
  console.log(chalk.green(`\n✨ 找到 ${matches.length} 个匹配的会话\n`));

  const choices = matches.map((session, index) => {
    const info = parseSessionInfoFast(session.filePath);
    const time = formatTime(session.mtime);
    const size = formatSize(session.size);

    // 构建单行显示格式：序号. 时间 │ 大小 │ 分支 │ 第一条消息
    let displayName = '';

    displayName += chalk.bold.white(`${index + 1}. `);
    displayName += chalk.cyan(`${time.padEnd(10)}`);
    displayName += chalk.gray(` │ ${size.padEnd(9)}`);

    if (info.gitBranch) {
      const branchName = info.gitBranch
        .replace('feature/', '')
        .replace('feat/', '')
        .replace('fix/', '')
        .substring(0, 30);
      displayName += chalk.green(` │ ${branchName.padEnd(25)}`);
    } else {
      displayName += chalk.green(` │ ${''.padEnd(25)}`);
    }

    // 只显示第一条用户消息（单行格式）
    if (info.firstMessage && info.firstMessage !== 'Warmup') {
      const firstMsg = truncate(info.firstMessage, 50);
      displayName += chalk.gray(' │ ') + chalk.white(firstMsg);
    }

    return {
      name: displayName,
      value: session.sessionId,
      short: `会话 ${session.sessionId.substring(0, 8)}`,
    };
  });

  return choices;
}

/**
 * 处理搜索会话
 */
async function handleSearch(config, switchProjectCallback) {
  while (true) {
    const keyword = await promptSearchKeyword();
    const choices = await searchSessions(config, keyword);

    if (choices.length === 0) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: '未找到匹配的会话',
          choices: [
            { name: chalk.blue('↩️  返回主菜单'), value: 'back' },
            { name: chalk.cyan('🔎  重新搜索'), value: 'retry' },
            { name: chalk.magenta('🔀  切换项目'), value: 'switch' },
          ],
        },
      ]);

      if (action === 'back') return;
      if (action === 'retry') continue;
      if (action === 'switch') {
        const switched = await switchProjectCallback();
        if (!switched) return;
        continue;
      }
    }

    // 添加操作选项
    choices.push(new inquirer.Separator(chalk.gray('─'.repeat(50))));
    choices.push({ name: chalk.blue('↩️  返回主菜单'), value: 'back' });
    choices.push({ name: chalk.cyan('🔎  重新搜索'), value: 'retry' });
    choices.push({ name: chalk.magenta('🔀  切换项目'), value: 'switch' });

    const sessionId = await promptSelectSession(choices);

    if (sessionId === 'back') {
      return;
    }

    if (sessionId === 'retry') {
      continue;
    }

    if (sessionId === 'switch') {
      const switched = await switchProjectCallback();
      if (!switched) return;
      continue;
    }

    // 询问是否 fork
    const action = await promptForkConfirm();

    if (action === 'back') {
      continue;
    }

    const fork = action === 'fork';
    await resumeSession(config, sessionId, fork);
  }
}

module.exports = {
  searchSessions,
  handleSearch,
};
