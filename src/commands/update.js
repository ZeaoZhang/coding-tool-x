const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const semver = require('semver');
const chalk = require('chalk');
const packageInfo = require('../../package.json');

const execFileAsync = promisify(execFile);

function resolveNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function getLatestVersion(packageName) {
  const npmCommand = resolveNpmCommand();
  const { stdout } = await execFileAsync(
    npmCommand,
    ['view', packageName, 'version', '--json'],
    { timeout: 15000, windowsHide: true }
  );
  const parsed = JSON.parse(stdout.trim());
  if (typeof parsed === 'string') return parsed;
  throw new Error('无法解析 npm 返回的版本号');
}

function runNpmInstall(packageName, version) {
  return new Promise((resolve, reject) => {
    const npmCommand = resolveNpmCommand();
    const child = spawn(npmCommand, ['install', '-g', `${packageName}@${version}`], {
      stdio: 'inherit',
      windowsHide: true
    });

    child.on('error', (err) => {
      if (err && err.code === 'ENOENT') {
        reject(new Error(`命令 "${npmCommand}" 未找到，请确认 Node.js/npm 已安装并在 PATH 中`));
        return;
      }
      reject(err);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm install 失败，退出码 ${code}`));
      }
    });
  });
}

async function handleUpdate(options = {}) {
  const checkOnly = options.checkOnly === true;
  const packageCandidates = Array.from(new Set([
    packageInfo.name,
    'coding-tool-x'
  ].filter(Boolean)));
  const currentVersion = packageInfo.version;

  console.log(chalk.cyan('\n[SEARCH] 检查更新中...\n'));

  let latestVersion;
  let packageName = packageCandidates[0];
  try {
    let lastError = null;
    for (const candidate of packageCandidates) {
      try {
        latestVersion = await getLatestVersion(candidate);
        packageName = candidate;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!latestVersion) {
      throw lastError || new Error('无法获取最新版本');
    }
  } catch (error) {
    console.error(chalk.red(`[ERROR] 检查更新失败: ${error.message}`));
    console.log(chalk.gray('[TIP] 可手动执行: npm view coding-tool-x version'));
    return;
  }

  if (!semver.valid(currentVersion) || !semver.valid(latestVersion)) {
    console.log(chalk.yellow(`[WARN]  版本格式异常，当前: ${currentVersion}, 最新: ${latestVersion}`));
    return;
  }

  if (!semver.gt(latestVersion, currentVersion)) {
    console.log(chalk.green(`[OK] 已是最新版本: ${currentVersion}\n`));
    return;
  }

  console.log(chalk.yellow(`发现新版本: ${currentVersion} -> ${latestVersion}`));
  if (checkOnly) {
    console.log(chalk.gray(`\n可执行更新命令: npm install -g ${packageName}@${latestVersion}\n`));
    return;
  }

  console.log(chalk.cyan('\n[DOWN]  正在更新...\n'));

  try {
    await runNpmInstall(packageName, latestVersion);
    console.log(chalk.green(`\n[OK] 更新完成: ${latestVersion}`));
    console.log(chalk.gray('请重新打开终端或重新执行 ctx --version 验证版本。\n'));
  } catch (error) {
    console.error(chalk.red(`\n[ERROR] 更新失败: ${error.message}`));
    console.log(chalk.gray(`[TIP] 可手动执行: npm install -g ${packageName}@${latestVersion}\n`));
  }
}

module.exports = {
  handleUpdate
};
