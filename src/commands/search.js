// 搜索会话命令
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const { promptSelectSession, promptSearchKeyword, promptForkConfirm } = require('../ui/prompts');
const { resumeSession } = require('./resume');
const { loadAliases } = require('../server/services/alias');
const { resolveOperation } = require('../platforms/access');

function isDriverResult(value) {
  return value && typeof value === 'object' && typeof value.status === 'string';
}

function unwrapDriverResult(value) {
  if (!isDriverResult(value) || value.status !== 'ok') return value;
  return value.data;
}

function createFailureResult(error, platform, operation) {
  const result = {
    status: error?.code || 'failed',
    platform: error?.platform || platform || 'claude',
    capability: 'sessions',
    operation,
    error: error?.message || String(error)
  };
  if (error?.cause) {
    Object.defineProperty(result, 'cause', { value: error.cause, enumerable: false });
  }
  return result;
}

async function invokeSessionOperation(config, operation, args, options = {}) {
  const platform = options.platform || config.currentCliType || '';
  let resolved;
  try {
    resolved = resolveOperation(platform, 'sessions', operation, {
      ...options,
      fallback: 'claude'
    });
  } catch (error) {
    return createFailureResult(error, platform, operation);
  }

  try {
    return unwrapDriverResult(await resolved.operation(...args));
  } catch (error) {
    return createFailureResult(error, resolved.key, operation);
  }
}

function normalizeSearchResults(value) {
  const unwrapped = unwrapDriverResult(value);
  if (isDriverResult(unwrapped)) return unwrapped;
  if (Array.isArray(unwrapped)) return unwrapped;
  if (Array.isArray(unwrapped?.sessions)) return unwrapped.sessions;
  if (Array.isArray(unwrapped?.results)) return unwrapped.results;
  return [];
}

function normalizeSearchResult(result = {}) {
  const matches = Array.isArray(result.matches) ? result.matches : [];
  const projectName = String(result.projectName || result.project || result.projectId || '');
  return {
    ...result,
    sessionId: String(result.sessionId || result.id || ''),
    projectName,
    projectDisplayName: result.projectDisplayName || result.projectLabel || projectName || '未知项目',
    matches,
    matchCount: Number(result.matchCount ?? matches.length) || 0
  };
}

function resolveLimitAndOptions(limitOrOptions, maybeOptions) {
  if (limitOrOptions && typeof limitOrOptions === 'object' && !Array.isArray(limitOrOptions)) {
    return {
      limit: Number(limitOrOptions.limit) || 15,
      options: limitOrOptions
    };
  }
  return {
    limit: Number(limitOrOptions) || 15,
    options: maybeOptions || {}
  };
}

function reportDriverFailure(result) {
  if (!isDriverResult(result)) return;
  const message = result.error || `会话操作 ${result.operation || 'unknown'} 不可用`;
  console.log(chalk.yellow(`\n[WARN] ${message}\n`));
}

/**
 * 跨所有项目搜索会话内容
 */
async function searchSessionsAcrossProjects(config = {}, keyword, limitOrOptions = 15, maybeOptions = {}) {
  const { limit, options } = resolveLimitAndOptions(limitOrOptions, maybeOptions);
  const spinner = ora(`[SEARCH] 正在搜索 "${keyword}"...`).start();
  const result = await invokeSessionOperation(
    config,
    'searchAcrossProjects',
    [keyword, limit, { config }],
    options
  );
  const searchResults = normalizeSearchResults(result);

  if (isDriverResult(searchResults)) {
    spinner.stop();
    spinner.clear();
    return searchResults;
  }

  const aliases = loadAliases();
  const allResults = searchResults.map(item => {
    const normalized = normalizeSearchResult(item);
    return {
      ...normalized,
      alias: normalized.alias || aliases[normalized.sessionId] || null
    };
  });

  spinner.stop();
  spinner.clear();

  if (allResults.length === 0) {
    console.clear();
    console.log(chalk.red(`\n[ERROR] 未找到包含 "${keyword}" 的对话\n`));
    return [];
  }

  allResults.sort((a, b) => b.matchCount - a.matchCount);
  const totalMatches = allResults.reduce((sum, resultItem) => sum + resultItem.matchCount, 0);

  console.clear();
  console.log(chalk.green(`\n[NEW] 找到 ${allResults.length} 个对话，共 ${totalMatches} 处匹配\n`));

  const choices = [];

  allResults.forEach((resultItem, index) => {
    let displayName = '';
    displayName += chalk.bold.white(`${index + 1}. `);
    displayName += chalk.magenta.bold(`[${resultItem.projectDisplayName}] `);

    if (resultItem.alias) {
      displayName += chalk.yellow.bold(`[${resultItem.alias}] `);
    } else {
      displayName += chalk.gray(`[${resultItem.sessionId.substring(0, 8)}] `);
    }

    displayName += chalk.cyan(`(${resultItem.matchCount} 处匹配)`);

    choices.push({
      name: displayName,
      value: { sessionId: resultItem.sessionId, projectName: resultItem.projectName },
      short: resultItem.alias || resultItem.sessionId.substring(0, 8)
    });

    const matchesToShow = resultItem.matches.slice(0, 3);
    matchesToShow.forEach(match => {
      const roleColor = match.role === 'user' ? chalk.blue : chalk.green;
      const roleLabel = match.role === 'user' ? '用户' : '助手';

      choices.push({
        name: `    ${roleColor(`[${roleLabel}]`)} ${chalk.gray(match.context || match.text || '')}`,
        value: null,
        disabled: true
      });
    });

    if (resultItem.matches.length > 3) {
      choices.push({
        name: chalk.gray(`    ... 还有 ${resultItem.matches.length - 3} 处匹配`),
        value: null,
        disabled: true
      });
    }

    if (index < allResults.length - 1) {
      choices.push(new inquirer.Separator(chalk.gray('─'.repeat(10))));
    }
  });

  return choices;
}

/**
 * 处理搜索会话
 */
async function handleSearch(config = {}, switchProjectCallback, options = {}) {
  while (true) {
    const keyword = await promptSearchKeyword();
    const result = await searchSessionsAcrossProjects(config, keyword, options);

    if (isDriverResult(result)) {
      reportDriverFailure(result);
      return;
    }

    const choices = Array.isArray(result) ? result : [];
    if (choices.length === 0) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: '未找到匹配的对话',
          choices: [
            { name: chalk.blue('[<-]  返回主菜单'), value: 'back' },
            { name: chalk.cyan('[SEARCH]  重新搜索'), value: 'retry' }
          ]
        }
      ]);

      if (action === 'back') return;
      if (action === 'retry') continue;
    }

    choices.push(new inquirer.Separator(chalk.gray('='.repeat(80))));
    choices.push({ name: chalk.blue('[<-]  返回主菜单'), value: 'back' });
    choices.push({ name: chalk.cyan('[SEARCH]  重新搜索'), value: 'retry' });

    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: '选择对话:',
        pageSize: 20,
        choices
      }
    ]);

    if (selected === 'back') {
      return;
    }

    if (selected === 'retry') {
      continue;
    }

    const sessionId = selected.sessionId;
    const projectName = selected.projectName;
    config.currentProject = projectName;

    const action = await promptForkConfirm();

    if (action === 'back') {
      continue;
    }

    const fork = action === 'fork';
    await resumeSession(config, sessionId, fork, {
      ...options,
      platform: options.platform || config.currentCliType || ''
    });
  }
}

module.exports = {
  searchSessionsAcrossProjects,
  handleSearch,
};
