'use strict';

const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const { resolvePaths, listProfilePlugins, listManageableProfilePlugins, safeProfileName } = require('./common');

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

function packageNameFromSpec(spec) {
  const value = String(spec || '').trim();
  if (!value || /^(?:https?:|git\+|github:|file:)/i.test(value)) return null;
  const slash = value.lastIndexOf('/');
  const versionSeparator = value.lastIndexOf('@');
  if (versionSeparator > slash) return value.slice(0, versionSeparator);
  return value;
}

function profilePluginInventory(context, profileName) {
  const plugins = listProfilePlugins(context, profileName);
  if (!plugins) {
    const error = new Error(`DSH profile not found: ${profileName}`);
    error.statusCode = 404;
    throw error;
  }
  return plugins.plugins;
}

function requireExternalPluginSpecs(context, profileName, specs, { allowNew = false } = {}) {
  const plugins = profilePluginInventory(context, profileName);
  const byName = new Map(plugins.map(plugin => [plugin.name, plugin]));
  const builtinNames = new Set(plugins.filter(plugin => plugin.builtIn).map(plugin => plugin.name));
  for (const spec of specs) {
    const name = packageNameFromSpec(spec);
    if (name && builtinNames.has(name)) {
      throw new Error(`DSH built-in plugin cannot be managed here: ${name}`);
    }
    if (!allowNew && (!name || !byName.has(name) || byName.get(name).builtIn)) {
      throw new Error(`Only installed external DSH plugins can be managed here: ${spec}`);
    }
  }
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
    plugins: listManageableProfilePlugins(context, profile)
  };
}

async function installPlugin(context = {}, request = {}) {
  const body = request.body || {};
  const profileName = request.params?.profileName;
  const specs = normalizeSpecs(body.specs || body.spec || body.package);
  requireExternalPluginSpecs(context, profileName, specs, { allowNew: true });
  return runDshPlugin(context, profileName, ['add', ...specs], {
    cwd: body.cwd
  });
}

async function uninstallPlugin(context = {}, request = {}) {
  const body = request.body || {};
  const specs = normalizeSpecs(body.specs || body.spec || request.params?.pluginName);
  const profileName = request.params?.profileName;
  requireExternalPluginSpecs(context, profileName, specs);
  return runDshPlugin(context, profileName, ['remove', ...specs], { cwd: body.cwd });
}

async function updatePlugin(context = {}, request = {}) {
  const body = request.body || {};
  const specs = body.specs || body.spec || body.package;
  const profileName = request.params?.profileName;
  const inventory = profilePluginInventory(context, profileName);
  let targets;
  if (specs === undefined) {
    targets = inventory.filter(plugin => !plugin.builtIn).map(plugin => plugin.name);
  } else {
    targets = normalizeSpecs(specs);
    requireExternalPluginSpecs(context, profileName, targets);
  }
  if (!targets.length) {
    const profile = safeProfileName(profileName);
    return {
      profile,
      exitCode: 0,
      stdout: '',
      stderr: '',
      skipped: 'No installed external DSH plugins to update',
      plugins: listManageableProfilePlugins(context, profile)
    };
  }
  return runDshPlugin(context, profileName, ['update', ...targets], { cwd: body.cwd });
}

module.exports = {
  runDshPlugin,
  installPlugin,
  uninstallPlugin,
  updatePlugin
};
