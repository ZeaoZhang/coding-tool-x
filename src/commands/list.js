// 列出会话命令
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const { formatTime, formatSize, truncate } = require('../utils/format');
const { promptSelectSession, promptForkConfirm } = require('../ui/prompts');
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
    const result = await resolved.operation(...args);
    return unwrapDriverResult(result);
  } catch (error) {
    return createFailureResult(error, resolved.key, operation);
  }
}

function normalizeSessionCollection(value) {
  const unwrapped = unwrapDriverResult(value);
  if (isDriverResult(unwrapped)) return unwrapped;
  if (Array.isArray(unwrapped)) return unwrapped;
  return Array.isArray(unwrapped?.sessions) ? unwrapped.sessions : [];
}

function normalizeSession(session = {}) {
  const metadata = session.meta || session.metadata || {};
  return {
    ...session,
    sessionId: String(session.sessionId || session.id || ''),
    mtime: session.mtime || session.updatedAt || session.timestamp || Date.now(),
    size: Number(session.size ?? session.fileSize ?? metadata.size ?? 0) || 0,
    gitBranch: session.gitBranch || metadata.gitBranch || null,
    firstMessage: session.firstMessage || session.preview || session.summary || metadata.firstMessage || null
  };
}

function reportDriverFailure(result) {
  if (!isDriverResult(result)) return;
  const message = result.error || `会话操作 ${result.operation || 'unknown'} 不可用`;
  console.log(chalk.yellow(`\n[WARN] ${message}\n`));
}

/**
 * 列出会话
 */
async function listSessions(config = {}, limit = null, options = {}) {
  const maxSessions = limit || config.maxDisplaySessions || 15;
  const spinner = ora('加载会话列表...').start();
  const result = await invokeSessionOperation(
    config,
    'listSessions',
    [config.currentProject, { config }],
    options
  );
  const collection = normalizeSessionCollection(result);

  if (isDriverResult(collection)) {
    spinner.stop();
    spinner.clear();
    return collection;
  }

  const sessions = collection.slice(0, maxSessions).map(normalizeSession);
  if (sessions.length === 0) {
    spinner.fail('暂无会话记录');
    return [];
  }

  spinner.text = '解析会话信息...';

  const aliases = loadAliases();
  const choices = sessions.map((session, index) => {
    const time = formatTime(session.mtime);
    const size = formatSize(session.size);
    const alias = session.alias || aliases[session.sessionId];

    let displayName = '';
    displayName += chalk.bold.white(`${index + 1}. `);

    if (alias) {
      displayName += chalk.yellow.bold(`[${alias}] `);
    }

    displayName += chalk.cyan(`${time.padEnd(10)}`);
    displayName += chalk.gray(` │ ${size.padEnd(9)}`);

    if (session.gitBranch) {
      const branchName = session.gitBranch
        .replace('feature/', '')
        .replace('feat/', '')
        .replace('fix/', '')
        .substring(0, 25);
      displayName += chalk.green(` │ ${branchName.padEnd(25)}`);
    } else {
      displayName += chalk.gray(` │ ${''.padEnd(25)}`);
    }

    if (session.firstMessage && session.firstMessage !== 'Warmup') {
      const firstMsg = truncate(String(session.firstMessage), 50);
      displayName += chalk.gray(' │ ') + chalk.white(firstMsg);
    }

    return {
      name: displayName,
      value: session.sessionId,
      short: alias ? `${alias} (${session.sessionId.substring(0, 8)})` : `会话 ${session.sessionId.substring(0, 8)}`
    };
  });

  spinner.stop();
  spinner.clear();

  console.clear();
  console.log(chalk.green(`\n[NEW] 找到 ${sessions.length} 个会话\n`));

  return choices;
}

/**
 * 列出跨项目的最近会话
 */
async function listRecentSessionsAcrossProjects(config = {}, limit = null, options = {}) {
  const maxSessions = limit || 15;
  const spinner = ora('加载最新对话...').start();
  const result = await invokeSessionOperation(
    config,
    'recent',
    [maxSessions, { config }],
    options
  );
  const collection = normalizeSessionCollection(result);

  if (isDriverResult(collection)) {
    spinner.stop();
    spinner.clear();
    return collection;
  }

  const sessions = collection.slice(0, maxSessions).map(normalizeSession);
  if (sessions.length === 0) {
    spinner.fail('暂无会话记录');
    return [];
  }

  spinner.text = '解析会话信息...';

  const aliases = loadAliases();
  const choices = sessions.map((session, index) => {
    const time = formatTime(session.mtime);
    const size = formatSize(session.size);
    const alias = session.alias || aliases[session.sessionId];

    let displayName = '';
    displayName += chalk.bold.white(`${index + 1}. `);

    const projectName = session.projectDisplayName || session.projectName || '未知项目';
    displayName += chalk.magenta.bold(`[${projectName}] `);

    if (alias) {
      displayName += chalk.yellow.bold(`[${alias}] `);
    }

    displayName += chalk.cyan(`${time.padEnd(10)}`);
    displayName += chalk.gray(` │ ${size.padEnd(9)}`);

    if (session.gitBranch) {
      const branchName = session.gitBranch
        .replace('feature/', '')
        .replace('feat/', '')
        .replace('fix/', '')
        .substring(0, 25);
      displayName += chalk.green(` │ ${branchName.padEnd(25)}`);
    } else {
      displayName += chalk.gray(` │ ${''.padEnd(25)}`);
    }

    if (session.firstMessage && session.firstMessage !== 'Warmup') {
      const firstMsg = truncate(String(session.firstMessage), 50);
      displayName += chalk.gray(' │ ') + chalk.white(firstMsg);
    }

    return {
      name: displayName,
      value: { sessionId: session.sessionId, projectName: session.projectName },
      short: alias ? `${alias} (${session.sessionId.substring(0, 8)})` : `会话 ${session.sessionId.substring(0, 8)}`
    };
  });

  spinner.stop();
  spinner.clear();

  console.clear();
  console.log(chalk.green(`\n[NEW] 找到 ${sessions.length} 个最新对话（跨所有项目）\n`));

  return choices;
}

/**
 * 处理列出会话
 */
async function handleList(config, switchProjectCallback, crossProject = false, options = {}) {
  while (true) {
    const result = crossProject
      ? await listRecentSessionsAcrossProjects(config, null, options)
      : await listSessions(config, null, options);

    if (isDriverResult(result)) {
      reportDriverFailure(result);
      return;
    }

    const choices = Array.isArray(result) ? result : [];
    if (choices.length === 0) {
      return;
    }

    choices.push(new inquirer.Separator(chalk.gray('─'.repeat(50))));
    choices.push({ name: chalk.blue('[<-]  返回主菜单'), value: 'back' });

    if (!crossProject) {
      choices.push({ name: chalk.magenta('[SWITCH]  切换项目'), value: 'switch' });
    }

    const selected = await promptSelectSession(choices);

    if (selected === 'back') {
      return;
    }

    if (selected === 'switch') {
      const switched = await switchProjectCallback();
      if (!switched) {
        return;
      }
      continue;
    }

    let sessionId, projectName;
    if (crossProject) {
      sessionId = selected.sessionId;
      projectName = selected.projectName;
      config.currentProject = projectName;
    } else {
      sessionId = selected;
    }

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
  listSessions,
  listRecentSessionsAcrossProjects,
};
