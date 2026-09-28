'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// DSH's patch language deliberately keeps `!!js` expressions unevaluated until
// the harness boots. The control plane only needs the static entry shape, so
// preserve the expression as text instead of executing it or rejecting it.
class DshJsExpression {
  constructor(value) {
    this.value = value;
  }
}

const DSH_YAML_SCHEMA = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    instanceOf: DshJsExpression,
    construct: value => `!!js ${value}`,
    represent: value => value.value
  })
]);

const DSH_YAML_SOURCE_TAGS = [{
  tag: 'tag:yaml.org,2002:js',
  resolve: value => `!!js ${value}`,
  stringify: item => String(item.value).replace(/^!!js\s*/, '')
}];

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function resolveDshInstallRoot(context = {}) {
  const command = String(
    context.dshCommand
      || context.dependencies?.dshCommand
      || process.env.DSH_COMMAND
      || 'dsh'
  ).trim();
  if (!command) return null;
  const commandHasPath = path.isAbsolute(command) || command.includes(path.sep);
  if (!commandHasPath && /\s/.test(command)) return null;

  const candidates = commandHasPath
    ? [path.resolve(command)]
    : String(context.dshEnv?.PATH || process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean)
      .map(directory => path.join(directory, command));

  for (const candidate of candidates) {
    let executablePath;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      executablePath = fs.realpathSync(candidate);
    } catch (_) {
      continue;
    }

    let directory = path.dirname(executablePath);
    for (let depth = 0; depth < 8; depth += 1) {
      const packageJson = readJsonFile(path.join(directory, 'package.json'), null);
      if (packageJson?.name === '@deepseek-ai/dsh') return directory;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return null;
}

function resolvePaths(context = {}) {
  const paths = context.paths || context.pathContext?.native || {};
  const home = path.resolve(paths.dir || paths.home || context.pathContext?.home || process.env.DSH_HOME || path.join(require('os').homedir(), '.dsh'));
  const resolved = {
    dir: home,
    settings: paths.settings || path.join(home, 'settings.yaml'),
    credentials: paths.credentials || path.join(home, '.credentials.yaml'),
    sessions: paths.sessions || path.join(home, 'sessions'),
    profiles: paths.profiles || path.join(home, 'profiles'),
    patch: paths.patch || path.join(home, 'cordis.patch.yml')
  };
  const installAnchor = paths.installAnchor || context.installAnchor || process.env.DSH_INSTALL_ANCHOR;
  const installRoot = paths.installRoot || context.installRoot || process.env.DSH_INSTALL_ROOT || resolveDshInstallRoot(context);
  if (installAnchor) resolved.installAnchor = installAnchor;
  if (installRoot) resolved.installRoot = installRoot;
  return resolved;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSecretKey(key) {
  return /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|authorization|credentials?)$/i.test(String(key || ''));
}

function redactSecrets(value, key = '') {
  if (isSecretKey(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(entry => redactSecrets(entry));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    redactSecrets(entryValue, entryKey)
  ]));
}

function redactPatchConfig(value, key = '') {
  if (isSecretKey(key)) return '[REDACTED]';
  if (key === 'env' || key === 'headers') {
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.keys(value).map(entryKey => [entryKey, '[REDACTED]']));
  }
  if (typeof value === 'string' && /^!!js\s+.*(?:process\.env|credentials?|secret|token|password)/i.test(value)) {
    return '[EXPRESSION]';
  }
  if (key === 'url' && typeof value === 'string') {
    try {
      const parsed = new URL(value);
      if (parsed.username) parsed.username = '[REDACTED]';
      if (parsed.password) parsed.password = '[REDACTED]';
      for (const name of [...parsed.searchParams.keys()]) {
        if (isSecretKey(name)) parsed.searchParams.set(name, '[REDACTED]');
      }
      return parsed.toString();
    } catch (_) {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(entry => redactPatchConfig(entry));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    redactPatchConfig(entryValue, entryKey)
  ]));
}

function readYamlFile(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return clone(fallback);
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) return clone(fallback);
  const parsed = yaml.load(content, { schema: DSH_YAML_SCHEMA });
  return parsed === undefined || parsed === null ? clone(fallback) : parsed;
}

function markJsExpressions(value) {
  if (Array.isArray(value)) return value.map(markJsExpressions);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, markJsExpressions(entry)]));
  if (typeof value === 'string' && /^!!js\s+\S/.test(value)) return new DshJsExpression(value.replace(/^!!js\s+/, ''));
  return value;
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT' && fallback !== undefined) return clone(fallback);
    throw error;
  }
}

function fileRevision(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.dev}:${stat.ino}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function writeAtomic(filePath, content, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.ctx-tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', mode });
    if (mode !== undefined) fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, filePath);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_) {}
  }
}

function mergeSettings(existing, namespace, patch, replace = false) {
  if (!isObject(existing)) throw new Error('DSH settings document must be a mapping');
  if (typeof namespace !== 'string' || !namespace.trim()) throw new Error('settings namespace is required');
  if (!isObject(patch)) throw new Error('settings patch must be a mapping');
  const result = clone(existing);
  const current = isObject(result[namespace]) ? result[namespace] : {};
  result[namespace] = replace ? clone(patch) : { ...current, ...clone(patch) };
  return result;
}

function dumpYaml(value) {
  return yaml.dump(markJsExpressions(value), { schema: DSH_YAML_SCHEMA, noRefs: true, lineWidth: 120 });
}

function credentialMetadata(filePath) {
  if (!fs.existsSync(filePath)) return { path: filePath, exists: false, refs: [], records: [] };
  const parsed = readYamlFile(filePath, {});
  if (!isObject(parsed)) throw new Error('DSH credentials document must be a mapping');
  const mode = fs.statSync(filePath).mode & 0o777;
  const refs = isObject(parsed.refs) ? Object.keys(parsed.refs) : [];
  const records = isObject(parsed.records) ? Object.keys(parsed.records) : [];
  return {
    path: filePath,
    exists: true,
    mode,
    secure: (mode & 0o077) === 0,
    version: parsed.version === undefined ? null : parsed.version,
    refs,
    records
  };
}

function safeProfileName(value) {
  const name = String(value || '').trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('Invalid DSH profile name');
  }
  return name;
}

function readProfileManifest(paths, profileName) {
  const name = safeProfileName(profileName);
  const profileDir = path.join(paths.profiles, name);
  const resolved = path.resolve(profileDir);
  if (!resolved.startsWith(`${path.resolve(paths.profiles)}${path.sep}`)) throw new Error('Invalid DSH profile path');
  const manifestPath = path.join(profileDir, 'package.json');
  const manifest = readJsonFile(manifestPath, null);
  if (!manifest) return null;
  return { name, profileDir, manifestPath, manifest };
}

function resolvePackageDir(profileDir, packageName, paths = {}) {
  if (typeof packageName !== 'string' || !packageName.trim()) return null;
  const roots = [
    path.resolve(profileDir, 'node_modules'),
    path.resolve(paths.profiles || path.dirname(profileDir), 'node_modules'),
    paths.installAnchor ? path.resolve(path.dirname(paths.installAnchor), 'node_modules') : null,
    paths.installRoot ? path.resolve(paths.installRoot, 'node_modules') : null
  ].filter(Boolean);
  for (const root of [...new Set(roots)]) {
    const target = path.resolve(root, ...packageName.split('/'));
    if (!target.startsWith(`${root}${path.sep}`)) continue;
    try {
      if (fs.statSync(target).isDirectory()) return target;
    } catch (_) {}
  }
  return null;
}

function listProfiles(context = {}) {
  const paths = resolvePaths(context);
  if (!fs.existsSync(paths.profiles)) return [];
  return fs.readdirSync(paths.profiles, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const profile = readProfileManifest(paths, entry.name);
      const manifest = profile?.manifest || {};
      const profileConfig = isObject(manifest.dsh?.profile) ? manifest.dsh.profile : {};
      return {
        name: entry.name,
        path: path.join(paths.profiles, entry.name),
        manifestPath: profile?.manifestPath || path.join(paths.profiles, entry.name, 'package.json'),
        exists: Boolean(profile),
        bundles: Array.isArray(profileConfig.bundles) ? [...profileConfig.bundles] : [],
        patchReload: profileConfig.patchReload || null,
        dependencies: isObject(manifest.dependencies) ? { ...manifest.dependencies } : {}
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function listProfilePlugins(context = {}, profileName) {
  const paths = resolvePaths(context);
  const profile = readProfileManifest(paths, profileName);
  if (!profile) return null;
  const manifest = profile.manifest || {};
  const profileConfig = isObject(manifest.dsh?.profile) ? manifest.dsh.profile : {};
  const bundleNames = Array.isArray(profileConfig.bundles) ? profileConfig.bundles : [];
  const dependencyNames = Object.keys(isObject(manifest.dependencies) ? manifest.dependencies : {});
  const names = [...new Set([...bundleNames, ...dependencyNames])];
  const describePlugin = name => {
    const packageDir = resolvePackageDir(profile.profileDir, name, paths);
    const packageJsonPath = packageDir ? path.join(packageDir, 'package.json') : null;
    const packageJson = packageJsonPath ? readJsonFile(packageJsonPath, {}) : {};
    const bundle = isObject(packageJson.dsh?.bundle) ? packageJson.dsh.bundle : null;
    const declaredPatches = Array.isArray(bundle?.patch)
      ? bundle.patch
      : bundle?.patch ? [bundle.patch] : [];
    const patchPaths = packageDir
      ? declaredPatches.filter(item => typeof item === 'string' && item.trim()).map(item => path.resolve(packageDir, item))
      : [];
    const patchPath = patchPaths[0] || null;
    const patchExists = patchPaths.length > 0 && patchPaths.every(filePath => fs.existsSync(filePath));
    return {
      name,
      requestedVersion: manifest.dependencies?.[name] || manifest.devDependencies?.[name] || null,
      version: packageJson.version || null,
      installed: Boolean(packageDir),
      bundle: Boolean(bundle),
      patch: bundle?.patch || null,
      patchPath,
      patchPaths,
      patchExists,
      description: packageJson.description || '',
      inBundleList: bundleNames.includes(name),
      builtIn: isBuiltInProfilePackage(packageDir, name, profile.profileDir, paths),
      management: 'ctx+dsh-plugin'
    };
  };
  const declaredPlugins = names.map(describePlugin);
  const builtinNames = bundledPluginNames(declaredPlugins);
  const plugins = [...declaredPlugins];
  for (const name of builtinNames) {
    if (names.includes(name)) continue;
    const plugin = describePlugin(name);
    plugin.installed = true;
    if (!plugin.builtIn) {
      const packageDir = resolvePackageDir(profile.profileDir, name, paths);
      const profileModules = path.join(profile.profileDir, 'node_modules');
      const sharedProfileModules = path.join(paths.profiles, 'node_modules');
      if (!packageDir || (!isPathInside(profileModules, packageDir) && !isPathInside(sharedProfileModules, packageDir))) {
        plugin.builtIn = true;
      }
    }
    plugins.push(plugin);
  }
  return {
    profile: profile.name,
    profilePath: profile.profileDir,
    manifestPath: profile.manifestPath,
    patchPath: path.join(profile.profileDir, 'cordis.patch.yml'),
    patchReload: profileConfig.patchReload || null,
    plugins
  };
}

function isPathInside(parentPath, targetPath) {
  if (!parentPath || !targetPath) return false;
  const parent = path.resolve(parentPath);
  const target = path.resolve(targetPath);
  return target === parent || target.startsWith(`${parent}${path.sep}`);
}

function isBuiltInProfilePackage(packageDir, packageName, profileDir, paths) {
  const profileModules = path.join(profileDir, 'node_modules');
  const sharedProfileModules = path.join(paths.profiles, 'node_modules');
  if (packageDir && (isPathInside(profileModules, packageDir) || isPathInside(sharedProfileModules, packageDir))) return false;
  if (/^@deepseek-ai\/dsh-/.test(packageName)) return true;
  if (!packageDir) return false;
  return true;
}

function bundledPluginNames(plugins) {
  const names = new Set();
  for (const plugin of plugins) {
    if (!plugin.inBundleList || !plugin.builtIn) continue;
    for (const filePath of plugin.patchPaths || []) {
      if (!fs.existsSync(filePath)) continue;
      const rows = collectPatchRows(readYamlFile(filePath, []), [], filePath);
      for (const row of rows) {
        const match = typeof row.name === 'string'
          ? row.name.match(/^(@deepseek-ai\/[a-z0-9._-]+)(?:\/[a-z0-9._-]+)*$/i)
          : null;
        if (match) names.add(match[1]);
      }
    }
  }
  return names;
}

function listManageableProfilePlugins(context = {}, profileName) {
  const result = listProfilePlugins(context, profileName);
  if (!result) return null;
  return {
    ...result,
    plugins: result.plugins.filter(plugin => !plugin.builtIn)
  };
}

function profilePatchFiles(context = {}, profileName) {
  const paths = resolvePaths(context);
  const pluginInfo = listProfilePlugins(context, profileName);
  if (!pluginInfo) return null;
  const profile = readProfileManifest(paths, profileName);
  const bundleFiles = pluginInfo.plugins
    .filter(plugin => plugin.inBundleList)
    .flatMap(plugin => plugin.patchPaths || (plugin.patchPath ? [plugin.patchPath] : []));
  const files = [...new Set([
    ...bundleFiles,
    path.join(profile.profileDir, 'cordis.patch.yml'),
    paths.patch
  ])];
  return { paths, profile, pluginInfo, files };
}

function readProfilePatchContributions(context = {}, profileName) {
  const info = profilePatchFiles(context, profileName);
  if (!info) return null;
  const contributions = [];
  for (const filePath of info.files) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    const parsed = readYamlFile(filePath, []);
    contributions.push({
      path: filePath,
      rows: collectPatchRows(parsed, [], filePath, { includeConfig: true })
    });
  }
  return { ...info, contributions };
}

function patchEntryId(entry) {
  return isObject(entry) && typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null;
}

function patchRowsFromDocument(document) {
  const rows = [];
  const visit = value => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (!isObject(value)) return;
    for (const operation of ['insert', 'replace', 'delete', 'update']) {
      const entries = Array.isArray(value[operation]) ? value[operation] : [];
      for (const entry of entries) {
        if (isObject(entry)) rows.push({ operation, entry });
      }
    }
    if (patchEntryId(value)) rows.push({ operation: 'row', entry: value });
  };
  visit(document);
  return rows;
}

function ensurePatchDocument(document) {
  if (document === undefined || document === null) return [];
  if (!Array.isArray(document)) throw new Error('DSH profile patch must be a top-level YAML array');
  return document;
}

function assertPatchRevision(filePath, expectedRevision) {
  const currentRevision = fileRevision(filePath);
  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    const error = new Error('DSH profile patch changed on disk; reload before updating');
    error.statusCode = 409;
    throw error;
  }
  return currentRevision;
}

function updateProfilePatch(context = {}, profileName, mutator, options = {}) {
  const info = profilePatchFiles(context, profileName);
  if (!info) return null;
  const patchPath = path.join(info.profile.profileDir, 'cordis.patch.yml');
  const expectedRevision = options.expectedRevision;
  assertPatchRevision(patchPath, expectedRevision);
  const current = ensurePatchDocument(readYamlFile(patchPath, []));
  const next = mutator(clone(current), {
    patchPath,
    currentRevision: fileRevision(patchPath),
    composedRows: info.files.flatMap(filePath => {
      if (!fs.existsSync(filePath)) return [];
      return patchRowsFromDocument(readYamlFile(filePath, [])).map(row => ({ ...row, source: filePath }));
    })
  });
  if (!Array.isArray(next)) throw new Error('DSH profile patch update must return an array');
  writeAtomic(patchPath, dumpYaml(next), 0o600);
  return { profile: profileName, patchPath, revision: fileRevision(patchPath) };
}

function removeManagedRows(document, predicate) {
  const next = [];
  for (const item of document) {
    if (!isObject(item)) {
      next.push(item);
      continue;
    }
    let changed = false;
    const copy = { ...item };
    for (const operation of ['insert', 'replace', 'delete', 'update']) {
      if (!Array.isArray(copy[operation])) continue;
      const kept = copy[operation].filter(entry => {
        const match = isObject(entry) && predicate(entry);
        if (match) changed = true;
        return !match;
      });
      if (kept.length) copy[operation] = kept;
      else delete copy[operation];
    }
    if (patchEntryId(copy) && predicate(copy)) {
      changed = true;
      continue;
    }
    if (!changed || Object.keys(copy).length) next.push(copy);
  }
  return next;
}

function upsertProfilePatchRow(context = {}, profileName, entry, options = {}) {
  const id = patchEntryId(entry);
  if (!id) throw new Error('DSH patch entry id is required');
  return updateProfilePatch(context, profileName, (document, meta) => {
    const hasComposedRowOutsideProfile = meta.composedRows.some(row => (
      patchEntryId(row.entry) === id && path.resolve(row.source) !== path.resolve(meta.patchPath)
    ));
    const withoutOwn = removeManagedRows(document, row => patchEntryId(row) === id);
    if (hasComposedRowOutsideProfile) withoutOwn.push(entry);
    else withoutOwn.push({ insert: [entry] });
    return withoutOwn;
  }, options);
}

function deleteProfilePatchRow(context = {}, profileName, id, options = {}) {
  const rowId = patchEntryId({ id });
  if (!rowId) throw new Error('DSH patch entry id is required');
  return updateProfilePatch(context, profileName, (document, meta) => {
    const hasComposedRow = meta.composedRows.some(row => patchEntryId(row.entry) === rowId);
    const hasNonLocalRow = meta.composedRows.some(row => patchEntryId(row.entry) === rowId && row.source !== meta.patchPath);
    const withoutOwn = removeManagedRows(document, row => patchEntryId(row) === rowId);
    if (hasComposedRow && hasNonLocalRow) {
      withoutOwn.push({ delete: [{ id: rowId }] });
    }
    return withoutOwn;
  }, options);
}

function collectPatchRows(value, rows = [], source = null, options = {}) {
  const pushRow = (operation, entry) => {
    const row = {
      operation,
      id: entry.id || null,
      name: entry.name || null,
      disabled: entry.disabled === true,
      hasDisabled: Object.prototype.hasOwnProperty.call(entry, 'disabled'),
      hasConfig: Object.prototype.hasOwnProperty.call(entry, 'config'),
      source
    };
    if (options.includeConfig && row.hasConfig) row.config = redactPatchConfig(entry.config);
    rows.push(row);
  };
  if (Array.isArray(value)) {
    for (const entry of value) collectPatchRows(entry, rows, source, options);
    return rows;
  }
  if (!isObject(value)) return rows;
  for (const operation of ['insert', 'replace', 'delete', 'update']) {
    const entries = Array.isArray(value[operation]) ? value[operation] : [];
    for (const entry of entries) {
      if (isObject(entry)) pushRow(operation, entry);
    }
  }
  if (value.id || value.name) {
    pushRow('row', value);
  }
  for (const [key, nested] of Object.entries(value)) {
    if (!['insert', 'replace', 'delete', 'update', 'config'].includes(key)) collectPatchRows(nested, rows, source, options);
  }
  return rows;
}

function effectivePatchRows(info) {
  const byId = new Map();
  for (const contribution of info.contributions) {
    for (const row of contribution.rows) {
      if (!row.id) continue;
      if (row.operation === 'delete') {
        byId.delete(row.id);
      } else {
        const current = byId.get(row.id);
        if (row.operation === 'insert' || !current) {
          byId.set(row.id, row);
        } else {
          byId.set(row.id, {
            ...current,
            ...row,
            name: row.name || current.name,
            disabled: row.hasDisabled ? row.disabled : current.disabled,
            hasDisabled: row.hasDisabled || current.hasDisabled,
            config: row.hasConfig ? row.config : current.config,
            hasConfig: row.hasConfig || current.hasConfig
          });
        }
      }
    }
  }
  return [...byId.values()];
}

function listProfileCapabilities(context = {}, profileName) {
  const info = readProfilePatchContributions(context, profileName);
  if (!info) return null;
  return {
    profile: info.pluginInfo.profile,
    bundles: info.pluginInfo.plugins.filter(plugin => plugin.inBundleList).map(plugin => plugin.name),
    contributions: info.contributions.map(({ path: source, rows }) => ({
      path: source,
      rows: rows.map(({ config, ...row }) => row)
    })),
    management: 'ctx',
    note: 'ctx 通过 dsh plugin 管理依赖安装、移除和更新；DSH 进程及 profile 运行时仍由 dsh 负责。'
  };
}

function isMcpPatchRow(row) {
  const config = isObject(row.config) ? row.config : {};
  return row.name === '@deepseek-ai/dsh-mcp-client'
    || (typeof config.serverName === 'string' && typeof config.transport === 'string');
}

function isPromptPatchRow(row) {
  return row.id === 'system-prompt'
    || row.name === '@deepseek-ai/dsh-system-prompt'
    || /prompt/i.test(String(row.id || ''))
    || /prompt/i.test(String(row.name || ''));
}

function listProfileMcp(context = {}, profileName) {
  const info = readProfilePatchContributions(context, profileName);
  if (!info) return null;
  const servers = effectivePatchRows(info)
    .filter(isMcpPatchRow)
    .map(row => ({
      id: row.id,
      name: row.name,
      operation: row.operation,
      disabled: row.disabled,
      enabled: !row.disabled,
      source: row.source,
      config: row.config || {}
    }));
  return {
    profile: info.pluginInfo.profile,
    servers,
    management: 'ctx',
    note: 'ctx 管理 MCP 的 profile patch 配置；连接、重连和实际调用由 dsh-mcp-client 运行时管理。'
  };
}

function listProfilePrompts(context = {}, profileName) {
  const info = readProfilePatchContributions(context, profileName);
  if (!info) return null;
  const prompts = effectivePatchRows(info)
    .filter(isPromptPatchRow)
    .map(row => ({
      id: row.id,
      name: row.name,
      operation: row.operation,
      disabled: row.disabled,
      enabled: !row.disabled,
      source: row.source,
      config: row.config || {}
    }));
  return {
    profile: info.pluginInfo.profile,
    prompts,
    management: 'ctx',
    note: 'ctx 管理 prompt 的 profile patch 配置；section 注册与组装仍由 dsh-system-prompt 运行时完成。'
  };
}

function listPlugins(context = {}) {
  return {
    profiles: listProfiles(context).map(profile => listProfilePlugins(context, profile.name)).filter(Boolean),
    management: 'ctx+dsh-plugin',
    note: '内置插件只读展示；仅 Profile 安装的外置插件由此处管理。'
  };
}

function listProfileAgentPresets(context = {}, profileName) {
  const info = readProfilePatchContributions(context, profileName);
  if (!info) return null;
  const patchPath = path.join(info.profile.profileDir, 'cordis.patch.yml');
  const bundledPatchPaths = new Set(info.pluginInfo.plugins
    .filter(plugin => plugin.inBundleList && plugin.builtIn && plugin.patchPath)
    .flatMap(plugin => plugin.patchPaths || [plugin.patchPath])
    .map(filePath => path.resolve(filePath)));
  const bundledPresetIds = new Set(info.contributions
    .filter(contribution => bundledPatchPaths.has(path.resolve(contribution.path)))
    .flatMap(contribution => contribution.rows)
    .filter(row => row.name === '@deepseek-ai/dsh-agent-preset')
    .map(row => row.id));
  const presets = effectivePatchRows(info)
    .filter(row => row.name === '@deepseek-ai/dsh-agent-preset' && isObject(row.config))
    .map(row => ({
      id: String(row.config.id || String(row.id || '').replace(/^preset-/, '')),
      patchId: row.id,
      name: typeof row.config.name === 'string' ? row.config.name : '',
      description: typeof row.config.description === 'string' ? row.config.description : '',
      order: Number.isFinite(row.config.order) ? row.config.order : 0,
      plugins: Array.isArray(row.config.plugins) ? redactPatchConfig(row.config.plugins) : [],
      builtIn: bundledPresetIds.has(row.id),
      source: row.source
    }))
    .filter(preset => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preset.id));
  return {
    profile: info.pluginInfo.profile,
    revision: fileRevision(patchPath),
    presets,
    management: 'ctx-profile-patch'
  };
}

function effectiveRawPatchEntry(context = {}, profileName, entryId) {
  const info = profilePatchFiles(context, profileName);
  if (!info) return null;
  const byId = new Map();
  for (const filePath of info.files) {
    if (!fs.existsSync(filePath)) continue;
    for (const { operation, entry } of patchRowsFromDocument(readYamlFile(filePath, []))) {
      const id = patchEntryId(entry);
      if (!id) continue;
      if (operation === 'delete') {
        byId.delete(id);
        continue;
      }
      const current = byId.get(id);
      if (operation === 'insert' || !current) {
        byId.set(id, { ...entry, source: filePath });
      } else {
        byId.set(id, { ...current, ...entry, id, source: filePath });
      }
    }
  }
  return byId.get(entryId) || null;
}

function restoreRedactedValues(value, original) {
  if (value === '[REDACTED]' || value === '[EXPRESSION]') return clone(original);
  if (Array.isArray(value)) {
    const originalArray = Array.isArray(original) ? original : [];
    return value.map((entry, index) => {
      const entryId = isObject(entry) ? entry.id : null;
      const originalEntry = entryId
        ? originalArray.find(candidate => isObject(candidate) && candidate.id === entryId)
        : originalArray[index];
      return restoreRedactedValues(entry, originalEntry);
    });
  }
  if (!isObject(value)) return value;
  const originalObject = isObject(original) ? original : {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    restoreRedactedValues(entry, originalObject[key])
  ]));
}

function restoreAgentPresetRedactions(context = {}, profileName, presetId, config) {
  const original = effectiveRawPatchEntry(context, profileName, presetId);
  if (!original || !isObject(original.config)) return config;
  return restoreRedactedValues(config, original.config);
}

module.exports = {
  clone,
  resolvePaths,
  isObject,
  readYamlFile,
  DSH_YAML_SOURCE_TAGS,
  readJsonFile,
  fileRevision,
  writeAtomic,
  mergeSettings,
  credentialMetadata,
  listProfiles,
  listProfilePlugins,
  listManageableProfilePlugins,
  listProfileCapabilities,
  listProfileMcp,
  listProfilePrompts,
  listProfileAgentPresets,
  restoreAgentPresetRedactions,
  listPlugins,
  profilePatchFiles,
  readProfilePatchContributions,
  dumpYaml,
  updateProfilePatch,
  upsertProfilePatchRow,
  deleteProfilePatchRow,
  safeProfileName,
  redactSecrets,
  redactPatchConfig
};
