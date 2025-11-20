// 搜索会话命令
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const { promptSelectSession, promptSearchKeyword, promptForkConfirm } = require('../ui/prompts');
const { resumeSession } = require('./resume');
const { getProjects, searchSessions: searchSessionsInProject, parseRealProjectPath } = require('../server/services/sessions');
const { loadAliases } = require('../server/services/alias');

/**
 * 跨所有项目搜索会话内容
 */
async function searchSessionsAcrossProjects(config, keyword) {
  const spinner = ora(`🔍 正在搜索 "${keyword}"...`).start();

  const projects = getProjects(config);
  const aliases = loadAliases();
  const allResults = [];

  // 跨所有项目搜索
  for (const projectName of projects) {
    try {
      const { projectName: displayName } = parseRealProjectPath(projectName);
      spinner.text = `🔍 正在搜索项目: ${displayName}...`;
      const results = searchSessionsInProject(config, projectName, keyword, 15);

      if (results.length > 0) {
        results.forEach(result => {
          allResults.push({
            ...result,
            projectName: projectName,
            projectDisplayName: displayName,
            alias: aliases[result.sessionId] || null
          });
        });
      }
    } catch (e) {
      // 忽略单个项目的错误
    }
  }

  spinner.stop();
  spinner.clear();

  if (allResults.length === 0) {
    console.clear();
    console.log(chalk.red(`\n❌ 未找到包含 "${keyword}" 的对话\n`));
    return [];
  }

  // 按匹配数量排序
  allResults.sort((a, b) => b.matchCount - a.matchCount);

  // 统计总匹配数
  const totalMatches = allResults.reduce((sum, r) => sum + r.matchCount, 0);

  console.clear();
  console.log(chalk.green(`\n✨ 找到 ${allResults.length} 个对话，共 ${totalMatches} 处匹配\n`));

  const choices = [];

  allResults.forEach((result, index) => {
    // 构建显示名称
    let displayName = '';

    // 序号
    displayName += chalk.bold.white(`${index + 1}. `);

    // 项目名（洋红色高亮）
    displayName += chalk.magenta.bold(`[${result.projectDisplayName}] `);

    // 会话别名或 ID
    if (result.alias) {
      displayName += chalk.yellow.bold(`[${result.alias}] `);
    } else {
      displayName += chalk.gray(`[${result.sessionId.substring(0, 8)}] `);
    }

    // 匹配数量
    displayName += chalk.cyan(`(${result.matchCount} 处匹配)`);

    choices.push({
      name: displayName,
      value: { sessionId: result.sessionId, projectName: result.projectName },
      short: result.alias || result.sessionId.substring(0, 8)
    });

    // 显示前 3 个匹配的上下文
    const matchesToShow = result.matches.slice(0, 3);
    matchesToShow.forEach((match, idx) => {
      const roleColor = match.role === 'user' ? chalk.blue : chalk.green;
      const roleLabel = match.role === 'user' ? '用户' : '助手';

      choices.push({
        name: `    ${roleColor(`[${roleLabel}]`)} ${chalk.gray(match.context)}`,
        value: null,
        disabled: true
      });
    });

    // 如果还有更多匹配，显示提示
    if (result.matches.length > 3) {
      choices.push({
        name: chalk.gray(`    ... 还有 ${result.matches.length - 3} 处匹配`),
        value: null,
        disabled: true
      });
    }

    // 添加分隔线（不是最后一个）
    if (index < allResults.length - 1) {
      choices.push(new inquirer.Separator(chalk.gray('─'.repeat(10))));
    }
  });

  return choices;
}

/**
 * 处理搜索会话
 */
async function handleSearch(config, switchProjectCallback) {
  while (true) {
    const keyword = await promptSearchKeyword();
    const choices = await searchSessionsAcrossProjects(config, keyword);

    if (choices.length === 0) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: '未找到匹配的对话',
          choices: [
            { name: chalk.blue('↩️  返回主菜单'), value: 'back' },
            { name: chalk.cyan('🔎  重新搜索'), value: 'retry' },
          ],
        },
      ]);

      if (action === 'back') return;
      if (action === 'retry') continue;
    }

    // 添加操作选项
    choices.push(new inquirer.Separator(chalk.gray('═'.repeat(80))));
    choices.push({ name: chalk.blue('↩️  返回主菜单'), value: 'back' });
    choices.push({ name: chalk.cyan('🔎  重新搜索'), value: 'retry' });

    // 使用自定义 pageSize 以便显示更多结果
    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: '选择对话:',
        pageSize: 20,
        choices: choices,
      },
    ]);

    if (selected === 'back') {
      return;
    }

    if (selected === 'retry') {
      continue;
    }

    // selected 是 { sessionId, projectName }
    const sessionId = selected.sessionId;
    const projectName = selected.projectName;

    // 切换到该项目
    config.currentProject = projectName;

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
  searchSessionsAcrossProjects,
  handleSearch,
};
