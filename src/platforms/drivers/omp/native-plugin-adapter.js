const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const { getOmpCommand, getOmpPaths } = require('./config');

const execFileAsync = promisify(execFile);

const VALID_SCOPES = new Set(['user', 'project']);
const GENERIC_SOURCE_KINDS = new Set(['npm', 'link', 'linked', 'marketplace']);

function normalizeScope(scope, fallback = 'user') {
  return VALID_SCOPES.has(scope) ? scope : fallback;
}

function parseJsonOutput(output, commandLabel, emptyMessages = []) {
  const text = stripAnsi(output).trim();
  if (!text || emptyMessages.some(message => text.includes(message))) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`OMP returned invalid JSON for "${commandLabel}"`);
  }
}

function stripAnsi(output) {
  return String(output || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

function splitMarketplaceId(pluginId = '') {
  const value = String(pluginId || '');
  const index = value.lastIndexOf('@');
  if (index <= 0) return { name: value, marketplace: '' };
  return {
    name: value.slice(0, index),
    marketplace: value.slice(index + 1)
  };
}

function collectEntries(value, inherited = {}, result = []) {
  if (Array.isArray(value)) {
    value.forEach(item => collectEntries(item, inherited, result));
    return result;
  }
  if (!value || typeof value !== 'object') return result;

  const looksLikePlugin = Boolean(
    value.name || value.id || value.pluginId || value.package || value.installPath
  );
  if (looksLikePlugin) {
    result.push({ ...inherited, ...value });
    return result;
  }

  for (const [key, nested] of Object.entries(value)) {
    const next = { ...inherited };
    if (key === 'user' || key === 'project') next.scope = key;
    if (key === 'npm') next.pluginKind = 'npm';
    if (key === 'linked' || key === 'link') next.pluginKind = 'link';
    if (key === 'marketplace') next.pluginKind = 'marketplace';
    collectEntries(nested, next, result);
  }
  return result;
}

function normalizeInstalledPlugin(entry, kindHint = '') {
  const firstEntry = Array.isArray(entry.entries) ? entry.entries[0] || {} : {};
  const pluginKind = entry.pluginKind
    || entry.kind
    || entry.sourceKind
    || (entry.marketplace ? 'marketplace' : kindHint)
    || (entry.linked ? 'link' : 'npm');
  const isMarketplace = pluginKind === 'marketplace';
  const sourceIdentity = String(entry.source || '').trim();
  const rawIdentity = String(
    entry.pluginId
    || entry.id
    || entry.package
    || entry.installTarget
    || (!GENERIC_SOURCE_KINDS.has(sourceIdentity.toLowerCase()) ? sourceIdentity : '')
    || entry.name
    || ''
  ).trim();
  const marketplace = String(entry.marketplace || '').trim();
  const pluginId = isMarketplace && marketplace && !rawIdentity.endsWith(`@${marketplace}`)
    ? `${rawIdentity}@${marketplace}`
    : rawIdentity;
  const parsed = isMarketplace ? splitMarketplaceId(pluginId) : { name: entry.name || pluginId, marketplace };
  const scope = normalizeScope(entry.scope, 'user');

  if (!pluginId) {
    throw new Error('OMP plugin list returned an entry without a native identity');
  }

  return {
    ...entry,
    key: `omp:${pluginKind}:${pluginId}:${scope}`,
    pluginId,
    id: pluginId,
    name: String(entry.displayName || entry.name || parsed.name || pluginId),
    marketplace: marketplace || parsed.marketplace,
    installTarget: pluginId,
    directory: entry.directory || entry.installPath || pluginId,
    installPath: entry.installPath || entry.path || firstEntry.installPath || firstEntry.path || '',
    installSource: entry.installSource || entry.source || pluginId,
    source: `omp-${pluginKind}`,
    scope,
    pluginKind,
    pluginType: pluginKind,
    version: entry.version || firstEntry.version || 'latest',
    description: entry.description || entry.manifest?.description || firstEntry.description || '',
    installed: true,
    enabled: entry.enabled !== false && firstEntry.enabled !== false,
    readonly: false
  };
}

function normalizeMarketplacePlugin(entry, inheritedMarketplace = '') {
  const marketplace = String(entry.marketplace || inheritedMarketplace || '').trim();
  const rawName = String(entry.name || entry.id || entry.pluginId || '').trim();
  if (!rawName) return null;
  const parsed = splitMarketplaceId(rawName);
  const name = parsed.name;
  const marketplaceName = marketplace || parsed.marketplace;
  const pluginId = marketplaceName ? `${name}@${marketplaceName}` : rawName;
  return {
    ...entry,
    key: `omp-market:${pluginId}`,
    pluginId,
    id: pluginId,
    name,
    marketplace: marketplaceName,
    installTarget: pluginId,
    installSource: pluginId,
    source: entry.source || pluginId,
    directory: entry.directory || name,
    version: entry.version || 'latest',
    description: entry.description || '',
    pluginKind: 'marketplace',
    pluginType: 'marketplace',
    readonly: false,
    isInstalled: entry.installed === true
  };
}

class OmpNativePluginAdapter {
  constructor(options = {}) {
    this.commandRunner = options.commandRunner || execFileSync;
    this.pathContext = options.pathContext || null;
    this.cacheTtlMs = Math.max(0, Number(options.cacheTtlMs) || 30000);
    this._operationCache = new Map();
    this._operationInflight = new Map();
    this._listRefreshInflight = new Map();
    this._generation = 0;
    // Tests and embedders inject a synchronous runner; the production path
    // must not block the HTTP event loop while a plugin mutation downloads.
    this.asyncMutations = options.asyncMutations !== undefined
      ? options.asyncMutations === true
      : (process.env.NODE_ENV !== 'test' && !options.commandRunner);
  }

  _operationKey(operation, options = {}) {
    const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    const scope = normalizeScope(options.scope, '');
    return `${operation}:${cwd}:${scope}`;
  }

  _clone(value) {
    if (value === undefined) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  _cachedOperation(operation, options, execute) {
    const key = this._operationKey(operation, options);
    const now = Date.now();
    const cached = this._operationCache.get(key);
    if (!options.force && cached && now - cached.cachedAt < this.cacheTtlMs) {
      return this._clone(cached.value);
    }
    if (this._operationInflight.has(key)) {
      return this._operationInflight.get(key);
    }
    try {
      const value = execute();
      this._operationCache.set(key, { value: this._clone(value), cachedAt: now });
      return this._clone(value);
    } catch (error) {
      if (cached) {
        return {
          ...this._clone(cached.value),
          error: {
            message: error.message || String(error),
            retryable: true
          }
        };
      }
      throw error;
    }
  }

  invalidate(options = {}) {
    this._generation += 1;
    const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    const scope = normalizeScope(options.scope, '');
    const suffix = `:${cwd}:${scope}`;
    for (const key of this._operationCache.keys()) {
      if (key.endsWith(suffix)) this._operationCache.delete(key);
    }
  }

  run(args, options = {}) {
    const command = getOmpCommand();
    try {
      return this.commandRunner(command, args, {
        cwd: options.cwd || process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: options.timeout || 120000,
        windowsHide: true
      });
    } catch (error) {
      const detail = String(error?.stderr || error?.message || error).trim();
      throw new Error(
        `OMP 17.1+ plugin CLI command failed (${command} ${args.join(' ')}): ${detail}`
      );
    }
  }

  runJson(args, options = {}, emptyMessages = []) {
    const output = this.run(args, options);
    return parseJsonOutput(output, args.join(' '), emptyMessages);
  }

  _runAsync(args, options = {}) {
    const command = getOmpCommand();
    return execFileAsync(command, args, {
      cwd: options.cwd || process.cwd(),
      encoding: 'utf8',
      timeout: options.timeout || 120000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    }).catch((error) => {
      const detail = String(error?.stderr || error?.message || error).trim();
      throw new Error(
        `OMP 17.1+ plugin CLI command failed (${command} ${args.join(' ')}): ${detail}`
      );
    });
  }

  listPlugins(options = {}) {
    const key = this._operationKey('plugin:list', options);
    const now = Date.now();
    const cached = this._operationCache.get(key);
    if (!options.force && cached) {
      if (now - cached.cachedAt >= this.cacheTtlMs) {
        this._scheduleListRefresh(key, options);
      }
      return this._clone(cached.value);
    }
    const value = this._listPluginsUncached(options);
    this._operationCache.set(key, { value: this._clone(value), cachedAt: now });
    return this._clone(value);
  }

  _normalizePluginsPayload(payload, options = {}) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('OMP plugin list returned an invalid JSON payload');
    }
    const plugins = [];
    for (const entry of collectEntries(payload.npm || [])) {
      plugins.push(normalizeInstalledPlugin(entry, 'npm'));
    }
    for (const entry of collectEntries(payload.linked || payload.link || [])) {
      plugins.push(normalizeInstalledPlugin(entry, 'link'));
    }
    for (const entry of collectEntries(payload.marketplace || [])) {
      plugins.push(normalizeInstalledPlugin(entry, 'marketplace'));
    }
    plugins.push(...this.listLooseExtensions());
    return {
      plugins: options.cwd
        ? plugins
        : plugins.filter(plugin => plugin.scope !== 'project')
    };
  }

  _scheduleListRefresh(key, options = {}) {
    if (this._listRefreshInflight.has(key)) return;
    const generation = this._generation;
    const task = execFileAsync(getOmpCommand(), ['plugin', 'list', '--json'], {
      cwd: options.cwd || process.cwd(),
      encoding: 'utf8',
      timeout: options.timeout || 120000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    }).then(({ stdout }) => {
      if (generation !== this._generation) return;
      const payload = parseJsonOutput(stdout, 'plugin list');
      if (!payload) return;
      const value = this._normalizePluginsPayload(payload, options);
      this._operationCache.set(key, { value: this._clone(value), cachedAt: Date.now() });
    }).catch(() => {
      if (generation !== this._generation) return;
      const cached = this._operationCache.get(key);
      if (cached) cached.cachedAt = Date.now();
    }).finally(() => {
      if (this._listRefreshInflight.get(key) === task) this._listRefreshInflight.delete(key);
    });
    this._listRefreshInflight.set(key, task);
  }

  _listPluginsUncached(options = {}) {
    const payload = this.runJson(['plugin', 'list', '--json'], options);
    return this._normalizePluginsPayload(payload, options);
  }

  listLooseExtensions() {
    const extensionsDir = this.pathContext?.customized
      ? (this.pathContext.native?.extensions
        || path.join(this.pathContext.native?.dir || this.pathContext.home || process.cwd(), 'extensions'))
      : getOmpPaths().extensions;
    if (!fs.existsSync(extensionsDir)) return [];
    const plugins = [];

    for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!entry.isDirectory() && !['.js', '.mjs', '.cjs', '.ts'].includes(extension)) {
        continue;
      }
      const installPath = path.join(extensionsDir, entry.name);
      let manifest = {};
      if (entry.isDirectory()) {
        for (const manifestName of ['omp.json', 'extension.json', 'plugin.json', 'package.json']) {
          const manifestPath = path.join(installPath, manifestName);
          if (!fs.existsSync(manifestPath)) continue;
          try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          } catch {
            manifest = {};
          }
          break;
        }
      }
      let realPath = installPath;
      try {
        realPath = fs.realpathSync(installPath);
      } catch {
        // The absolute install path remains a stable local identity.
      }
      const name = manifest.name || (entry.isDirectory()
        ? entry.name
        : entry.name.slice(0, -extension.length));
      plugins.push({
        key: `omp:extension:${realPath}`,
        pluginId: `extension:${realPath}`,
        id: `extension:${realPath}`,
        name,
        directory: entry.name,
        installPath,
        installTarget: '',
        installSource: installPath,
        source: 'omp-extension',
        scope: 'user',
        version: manifest.version || 'local',
        description: manifest.description || '',
        installed: true,
        enabled: true,
        pluginType: 'extension',
        pluginKind: 'extension',
        readonly: true
      });
    }
    return plugins;
  }

  _installedPluginResult(pluginId, metadata = {}, options = {}) {
    const parsed = splitMarketplaceId(pluginId);
    return {
      success: true,
      plugin: normalizeInstalledPlugin({
        ...metadata,
        pluginId,
        name: metadata.name || parsed.name || pluginId,
        marketplace: metadata.marketplace || parsed.marketplace,
        scope: options.scope || metadata.scope,
        pluginKind: metadata.pluginKind || (parsed.marketplace ? 'marketplace' : 'npm')
      })
    };
  }

  installPlugin(target, metadata = {}, options = {}) {
    const pluginId = String(target || metadata.pluginId || metadata.installSource || '').trim();
    if (!pluginId) throw new Error('Missing OMP plugin target');
    const args = ['plugin', 'install', pluginId];
    if (options.force) args.push('--force');
    if (options.scope) args.push('--scope', normalizeScope(options.scope));
    if (this.asyncMutations) {
      return this._runAsync(args, options).then(() => {
        this.invalidate(options);
        return this._installedPluginResult(pluginId, metadata, options);
      });
    }
    this.run(args, options);
    this.invalidate(options);
    return this._installedPluginResult(pluginId, metadata, options);
  }

  uninstallPlugin(pluginId, options = {}) {
    const args = this._mutationArgs('uninstall', pluginId, options);
    if (this.asyncMutations) {
      return this._runAsync(args, options).then(() => {
        this.invalidate(options);
        return { success: true, message: 'Plugin uninstalled successfully' };
      });
    }
    this.run(args, options);
    this.invalidate(options);
    return { success: true, message: 'Plugin uninstalled successfully' };
  }

  togglePlugin(pluginId, enabled, options = {}) {
    const args = this._mutationArgs(enabled ? 'enable' : 'disable', pluginId, options);
    const result = {
      pluginId,
      name: splitMarketplaceId(pluginId).name,
      scope: options.scope || 'user',
      enabled,
      success: true
    };
    if (this.asyncMutations) {
      return this._runAsync(args, options).then(() => {
        this.invalidate(options);
        return result;
      });
    }
    this.run(args, options);
    this.invalidate(options);
    return result;
  }

  updatePluginConfig(pluginId, config, options = {}) {
    const target = String(pluginId || '').trim();
    if (!target) throw new Error('Missing OMP pluginId');
    const commands = [];
    for (const [key, value] of Object.entries(config || {})) {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      const args = ['plugin', 'config', 'set', target, key, serialized];
      if (options.scope) args.push('--scope', normalizeScope(options.scope));
      commands.push(args);
    }
    const result = {
      success: true,
      message: `Configuration updated for plugin "${target}"`
    };
    if (this.asyncMutations) {
      return commands.reduce(
        (previous, args) => previous.then(() => this._runAsync(args, options)),
        Promise.resolve()
      ).then(() => {
        this.invalidate(options);
        return result;
      });
    }
    for (const args of commands) {
      this.run(args, options);
    }
    this.invalidate(options);
    return result;
  }

  _mutationArgs(action, pluginId, options = {}) {
    const target = String(pluginId || '').trim();
    if (!target) throw new Error('Missing OMP pluginId');
    if (target.startsWith('extension:')) {
      throw new Error('OMP loose extensions are readonly and cannot be managed by the plugin CLI');
    }
    const args = ['plugin', action, target];
    if (options.scope) args.push('--scope', normalizeScope(options.scope));
    return args;
  }

  runMutation(action, pluginId, options = {}) {
    const args = this._mutationArgs(action, pluginId, options);
    this.run(args, options);
    this.invalidate(options);
  }

  discover(options = {}) {
    return this._cachedOperation(
      'plugin:discover',
      options,
      () => this._discoverUncached(options)
    );
  }

  _discoverUncached(options = {}) {
    const output = this.run(['plugin', 'discover', '--json'], options);
    const text = stripAnsi(output).trim();
    if (!text || text.includes('No plugins available')) return [];
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return this.discoverFromText(text, options);
    }

    const entries = [];
    if (Array.isArray(payload)) {
      entries.push(...payload);
    } else if (Array.isArray(payload.plugins)) {
      entries.push(...payload.plugins);
    } else if (Array.isArray(payload.marketplaces)) {
      for (const marketplace of payload.marketplaces) {
        for (const plugin of marketplace.plugins || []) {
          entries.push({ ...plugin, marketplace: plugin.marketplace || marketplace.name });
        }
      }
    } else {
      entries.push(...collectEntries(payload));
    }

    const seen = new Set();
    return entries
      .map(entry => normalizeMarketplacePlugin(entry, entry.marketplace))
      .filter(plugin => {
        if (!plugin || seen.has(plugin.pluginId)) return false;
        seen.add(plugin.pluginId);
        return true;
      });
  }

  discoverFromText(initialOutput, options = {}) {
    const marketplaces = this.listMarketplaces(options);
    if (marketplaces.length === 0) return [];
    const results = [];
    for (const marketplace of marketplaces) {
      const output = marketplaces.length === 1
        ? initialOutput
        : this.run(['plugin', 'discover', marketplace.id, '--json'], options);
      const lines = stripAnsi(output).split(/\r?\n/);
      let current = null;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('Available Plugins')) continue;
        if (/^No plugins (available|found)/i.test(line)) continue;
        if (/^\S/.test(rawLine)) continue;
        if (/^\s{4,}\S/.test(rawLine) && current) {
          current.description = line;
          continue;
        }
        const match = line.match(/^(.+?)(?:@([^@\s]+))?$/);
        if (!match) continue;
        current = normalizeMarketplacePlugin({
          name: match[1],
          version: match[2] || 'latest',
          marketplace: marketplace.id
        }, marketplace.id);
        if (current) results.push(current);
      }
    }
    return results;
  }

  listMarketplaces(options = {}) {
    return this._cachedOperation(
      'marketplace:list',
      options,
      () => this._listMarketplacesUncached(options)
    );
  }

  _listMarketplacesUncached(options = {}) {
    const output = this.run(['plugin', 'marketplace', 'list', '--json'], options);
    const text = stripAnsi(output).trim();
    if (!text || text.includes('No marketplaces configured')) return [];
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      const entries = text.split(/\r?\n/)
        .filter(line => /^\s{2,}\S/.test(line))
        .map(line => {
          const match = line.trim().match(/^(\S+)\s+(.+)$/);
          return match ? { name: match[1], sourceUri: match[2], source: match[2] } : null;
        })
        .filter(Boolean);
      if (entries.length === 0) {
        throw new Error('OMP returned invalid marketplace list output');
      }
      payload = entries;
    }
    const entries = Array.isArray(payload)
      ? payload
      : (payload.marketplaces || collectEntries(payload));
    return entries.map(entry => {
      const name = String(entry.name || entry.id || entry.marketplace || '').trim();
      const source = entry.source || entry.url || entry.repo || entry.repository || '';
      return {
        ...entry,
        id: name,
        name,
        label: name,
        source,
        sourceUri: typeof source === 'string' ? source : JSON.stringify(source),
        provider: 'omp-marketplace',
        enabled: true,
        mutable: {
          toggle: false,
          auth: false,
          remove: true,
          update: true
        }
      };
    }).filter(entry => entry.id);
  }

  addMarketplace(source, options = {}) {
    const target = String(source || '').trim();
    if (!target) throw new Error('Missing marketplace source');
    this.run(['plugin', 'marketplace', 'add', target], options);
    this.invalidate(options);
    return this.listMarketplaces(options);
  }

  removeMarketplace(name, options = {}) {
    const target = String(name || '').trim();
    this.run(['plugin', 'marketplace', 'remove', target], options);
    this.invalidate(options);
    return this.listMarketplaces(options);
  }

  updateMarketplaces(name = '', options = {}) {
    const args = ['plugin', 'marketplace', 'update'];
    this.run(args, options);
    this.invalidate(options);
    return this.listMarketplaces(options);
  }
}

module.exports = {
  OmpNativePluginAdapter,
  collectEntries,
  normalizeInstalledPlugin,
  normalizeMarketplacePlugin,
  parseJsonOutput
};
