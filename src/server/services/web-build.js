'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '../../..');
const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'dist']);
const WATCHED_WEB_FILES = ['index.html', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'vite.config.js'];
const WATCHED_WEB_DIRS = ['src', 'public'];

function pathExists(targetPath) {
  return fs.existsSync(targetPath);
}

function getLatestMtimeMs(targetPath) {
  if (!pathExists(targetPath)) {
    return 0;
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  let latest = stat.mtimeMs;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const childPath = path.join(targetPath, entry.name);
    latest = Math.max(latest, getLatestMtimeMs(childPath));
  }
  return latest;
}

function getWatchedWebSourceMtimeMs(sourceRoot) {
  let latest = 0;
  for (const fileName of WATCHED_WEB_FILES) {
    latest = Math.max(latest, getLatestMtimeMs(path.join(sourceRoot, fileName)));
  }
  for (const dirName of WATCHED_WEB_DIRS) {
    latest = Math.max(latest, getLatestMtimeMs(path.join(sourceRoot, dirName)));
  }
  return latest;
}

function inspectWebBuildState(options = {}) {
  const projectRoot = options.projectRoot || DEFAULT_PROJECT_ROOT;
  const sourceRoot = options.sourceRoot || path.join(projectRoot, 'src/web');
  const distRoot = options.distRoot || path.join(projectRoot, 'dist/web');
  const distIndexPath = path.join(distRoot, 'index.html');
  const sourceAvailable = pathExists(sourceRoot) && pathExists(path.join(sourceRoot, 'package.json'));
  const distExists = pathExists(distIndexPath);

  if (!sourceAvailable) {
    return {
      projectRoot,
      sourceRoot,
      distRoot,
      distIndexPath,
      sourceAvailable: false,
      distExists,
      sourceMtimeMs: 0,
      distMtimeMs: getLatestMtimeMs(distRoot),
      needsBuild: false,
      reason: 'source-unavailable'
    };
  }

  const sourceMtimeMs = getWatchedWebSourceMtimeMs(sourceRoot);
  const distMtimeMs = getLatestMtimeMs(distRoot);
  const hasDistAssets = distExists && distMtimeMs > 0;
  const isStale = hasDistAssets && sourceMtimeMs > distMtimeMs + 1;

  return {
    projectRoot,
    sourceRoot,
    distRoot,
    distIndexPath,
    sourceAvailable: true,
    distExists,
    sourceMtimeMs,
    distMtimeMs,
    needsBuild: !hasDistAssets || isStale,
    reason: !hasDistAssets ? 'dist-missing' : (isStale ? 'dist-stale' : 'up-to-date')
  };
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runWebBuild(options = {}) {
  const sourceRoot = options.sourceRoot || path.join(DEFAULT_PROJECT_ROOT, 'src/web');
  const npmCommand = options.npmCommand || getNpmCommand();
  const env = options.env || process.env;
  const stdio = options.stdio || 'inherit';

  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ['run', 'build'], {
      cwd: sourceRoot,
      env,
      stdio,
      windowsHide: true
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Web UI build exited with code ${code}`));
    });
  });
}

async function ensureWebDistReady(options = {}) {
  const initialState = options.state || inspectWebBuildState(options);
  if (!initialState.needsBuild) {
    return {
      ...initialState,
      built: false,
      skipped: true,
      previousReason: initialState.reason
    };
  }

  const runBuild = options.runBuild || runWebBuild;

  try {
    await runBuild({
      sourceRoot: initialState.sourceRoot,
      distRoot: initialState.distRoot,
      npmCommand: options.npmCommand || getNpmCommand(),
      env: options.env,
      stdio: options.stdio
    });
  } catch (error) {
    const dependencyHint = pathExists(path.join(initialState.sourceRoot, 'node_modules'))
      ? ''
      : '（未检测到 src/web/node_modules，前端依赖可能尚未安装）';
    throw new Error(`Web UI 静态资源构建失败: ${error.message}${dependencyHint}`);
  }

  const finalState = inspectWebBuildState({
    projectRoot: initialState.projectRoot,
    sourceRoot: initialState.sourceRoot,
    distRoot: initialState.distRoot
  });

  return {
    ...finalState,
    built: true,
    skipped: false,
    previousReason: initialState.reason
  };
}

module.exports = {
  inspectWebBuildState,
  ensureWebDistReady,
  _test: {
    getLatestMtimeMs,
    getWatchedWebSourceMtimeMs,
    getNpmCommand,
    runWebBuild
  }
};
