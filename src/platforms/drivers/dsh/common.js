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
  const installRoot = paths.installRoot || context.installRoot || process.env.DSH_INSTALL_ROOT;
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
  const plugins = names.map(name => {
    const packageDir = resolvePackageDir(profile.profileDir, name, paths);
    const packageJsonPath = packageDir ? path.join(packageDir, 'package.json') : null;
    const packageJson = packageJsonPath ? readJsonFile(packageJsonPath, {}) : {};
    const bundle = isObject(packageJson.dsh?.bundle) ? packageJson.dsh.bundle : null;
    const patchPath = bundle?.patch && packageDir ? path.resolve(packageDir, bundle.patch) : null;
    const patchExists = Boolean(patchPath && fs.existsSync(patchPath));
    return {
      name,
      requestedVersion: manifest.dependencies?.[name] || manifest.devDependencies?.[name] || null,
      version: packageJson.version || null,
      installed: Boolean(packageDir),
      bundle: Boolean(bundle),
      patch: bundle?.patch || null,
      patchPath,
      patchExists,
      inBundleList: bundleNames.includes(name),
      management: 'ctx+dsh-plugin'
    };
  });
  return {
    profile: profile.name,
    profilePath: profile.profileDir,
    manifestPath: profile.manifestPath,
    patchPath: path.join(profile.profileDir, 'cordis.patch.yml'),
    patchReload: profileConfig.patchReload || null,
    plugins
  };
}

function profilePatchFiles(context = {}, profileName) {
  const paths = resolvePaths(context);
  const pluginInfo = listProfilePlugins(context, profileName);
  if (!pluginInfo) return null;
  const profile = readProfileManifest(paths, profileName);
  const bundleFiles = pluginInfo.plugins
    .filter(plugin => plugin.inBundleList && plugin.patchPath)
    .map(plugin => plugin.patchPath);
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
    const hasComposedRow = meta.composedRows.some(row => patchEntryId(row.entry) === id);
    const withoutOwn = removeManagedRows(document, row => patchEntryId(row) === id);
    if (hasComposedRow) withoutOwn.push(entry);
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
        byId.set(row.id, row);
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
    note: 'ctx 通过 dsh plugin 管理插件依赖；插件运行生命周期和 profile 重启仍由 dsh 负责。'
  };
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
  listProfileCapabilities,
  listProfileMcp,
  listProfilePrompts,
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
