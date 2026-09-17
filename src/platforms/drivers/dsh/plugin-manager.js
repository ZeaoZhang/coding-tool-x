'use strict';

const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const { resolvePaths, listProfilePlugins, safeProfileName } = require('./common');

const execFileAsync = promisify(execFile);

function redactCommandOutput(value) {
  return String(value || '')
    .replace(/((?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|authorization)\s*[=:]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/[^\s/@]+:)[^@\s]+@/gi, '$1[REDACTED]@');
}

function normalizeSpecs(value) {
  const values = Array.isArray(value) ? value : [value];
  const specs = values
    .map(spec => String(spec || '').trim())
    .filter(Boolean);
  if (!specs.length) throw new Error('至少需要一个 DSH plugin package spec');
  if (specs.some(spec => spec.includes('\0') || spec.startsWith('-'))) {
    throw new Error('DSH plugin package spec 不能是选项或包含 NUL 字符');
  }
  return specs;
}

function resolveWorkingDirectory(paths, value) {
  if (value === undefined || value === null || value === '') return paths.dir;
  const cwd = path.resolve(String(value));
  try {
    if (!require('fs').statSync(cwd).isDirectory()) throw new Error('not a directory');
  } catch (_) {
    throw new Error(`DSH plugin working directory does not exist: ${cwd}`);
  }
  return cwd;
}

function commandFor(context = {}) {
  return context.dshCommand
    || context.dependencies?.dshCommand
    || process.env.DSH_COMMAND
    || 'dsh';
}

function commandEnvironment(paths, context = {}) {
  const env = { ...process.env, ...(context.dshEnv || {}) };
  env.DSH_HOME = paths.dir;
  if (paths.installAnchor) env.DSH_INSTALL_ANCHOR = paths.installAnchor;
  if (paths.installRoot) env.DSH_INSTALL_ROOT = paths.installRoot;
  return env;
}

async function runDshPlugin(context = {}, profileName, args, options = {}) {
  const paths = resolvePaths(context);
  const profile = safeProfileName(profileName);
  const command = commandFor(context);
  const cwd = resolveWorkingDirectory(paths, options.cwd);
  const commandArgs = ['plugin', '--profile', profile, ...args];
  let result;
  try {
    result = await execFileAsync(command, commandArgs, {
      cwd,
      env: commandEnvironment(paths, context),
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: options.timeoutMs || 15 * 60 * 1000,
      windowsHide: true
    });
  } catch (error) {
    const status = error && typeof error.code === 'number' ? error.code : null;
    const wrapped = new Error(redactCommandOutput(error?.stderr?.trim() || error?.message || 'DSH plugin command failed'));
    wrapped.code = error?.code === 'ENOENT' ? 'DSH_COMMAND_NOT_FOUND' : 'DSH_PLUGIN_COMMAND_FAILED';
    wrapped.statusCode = error?.code === 'ENOENT' ? 503 : 422;
    wrapped.exitCode = status;
    wrapped.stdout = redactCommandOutput(error?.stdout);
    wrapped.stderr = redactCommandOutput(error?.stderr);
    throw wrapped;
  }
  return {
    command,
    args: commandArgs,
    cwd,
    profile,
    exitCode: 0,
    stdout: redactCommandOutput(result.stdout),
    stderr: redactCommandOutput(result.stderr),
    plugins: listProfilePlugins(context, profile)
  };
}

async function installPlugin(context = {}, request = {}) {
  const body = request.body || {};
  return runDshPlugin(context, request.params?.profileName, ['add', ...normalizeSpecs(body.specs || body.spec || body.package)], {
    cwd: body.cwd
  });
}

async function uninstallPlugin(context = {}, request = {}) {
  const body = request.body || {};
  const specs = normalizeSpecs(body.specs || body.spec || request.params?.pluginName);
  return runDshPlugin(context, request.params?.profileName, ['remove', ...specs], { cwd: body.cwd });
}

async function updatePlugin(context = {}, request = {}) {
  const body = request.body || {};
  const specs = body.specs || body.spec || body.package;
  const args = ['update', ...(specs === undefined ? [] : normalizeSpecs(specs))];
  return runDshPlugin(context, request.params?.profileName, args, { cwd: body.cwd });
}

module.exports = {
  runDshPlugin,
  installPlugin,
  uninstallPlugin,
  updatePlugin
};
