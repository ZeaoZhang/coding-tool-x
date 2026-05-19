/**
 * Plugins Service
 *
 * Wraps the plugin system for API access
 */

const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');
const toml = require('toml');
const tomlStringify = require('@iarna/toml').stringify;
const AdmZip = require('adm-zip');
const { listPlugins, getPlugin, updatePlugin: updatePluginRegistry } = require('../../plugins/registry');
const { installPlugin: installPluginCore, uninstallPlugin: uninstallPluginCore } = require('../../plugins/plugin-installer');
const { initializePlugins, shutdownPlugins } = require('../../plugins/plugin-manager');
const { INSTALLED_DIR, CONFIG_DIR } = require('../../plugins/constants');
const { NATIVE_PATHS, PATHS } = require('../../config/paths');
const { maskToken } = require('./oauth-utils');
const {
  assertInsideAllowedRoots,
  normalizeSafeFileStem,
  normalizeSafeRelativePath,
  resolveInsideRoot
} = require('./config-artifact-paths');

const CLAUDE_PLUGINS_DIR = path.join(path.dirname(NATIVE_PATHS.claude.settings), 'plugins');
const CLAUDE_INSTALLED_FILE = path.join(CLAUDE_PLUGINS_DIR, 'installed_plugins.json');
const CLAUDE_MARKETPLACES_FILE = path.join(CLAUDE_PLUGINS_DIR, 'known_marketplaces.json');
const CLAUDE_PLUGINS_CACHE_DIR = path.join(CLAUDE_PLUGINS_DIR, 'cache');
const CLAUDE_MARKETPLACES_DIR = path.join(CLAUDE_PLUGINS_DIR, 'marketplaces');
const CODEX_PLUGINS_DIR = path.join(path.dirname(NATIVE_PATHS.codex.config), 'plugins');
const CODEX_PLUGINS_CACHE_DIR = path.join(CODEX_PLUGINS_DIR, 'cache');
const OPENCODE_CONFIG_DIR = NATIVE_PATHS.opencode.config;
const REPO_SOURCE_META_FILE = '.cc-tool-plugin-source.json';
const SUPPORTED_REPO_PROVIDERS = ['github', 'gitlab', 'local'];
const DEFAULT_GITHUB_HOST = 'https://github.com';
const DEFAULT_GITLAB_HOST = 'https://gitlab.com';
const DEFAULT_REPOS_BY_PLATFORM = {
  claude: [],
  codex: [],
  gemini: [],
  opencode: []
};
const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode'];
const PLATFORM_CAPABILITIES = {
  claude: {
    platform: 'claude',
    supportsPlugins: true,
    repositories: true,
    market: true,
    install: true,
    uninstall: true,
    toggle: true,
    config: true,
    import: true,
    syncRepos: true
  },
  codex: {
    platform: 'codex',
    supportsPlugins: true,
    repositories: true,
    market: true,
    install: true,
    uninstall: true,
    toggle: true,
    config: false,
    import: false,
    syncRepos: false
  },
  gemini: {
    platform: 'gemini',
    supportsPlugins: false,
    repositories: false,
    market: false,
    install: false,
    uninstall: false,
    toggle: false,
    config: false,
    import: false,
    syncRepos: false,
    disabledReason: 'Gemini plugin management is not implemented yet'
  },
  opencode: {
    platform: 'opencode',
    supportsPlugins: true,
    repositories: true,
    market: true,
    install: true,
    uninstall: true,
    toggle: true,
    config: true,
    import: false,
    syncRepos: false
  }
};

function cloneRepos(repos = []) {
  return repos.map(repo => ({ ...repo }));
}

function normalizeRepoToken(token = '') {
  return String(token || '').trim();
}

function normalizeRepoPath(input = '') {
  return String(input || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function normalizeRepoDirectory(directory = '') {
  return normalizeRepoPath(directory);
}

function normalizePluginRepoDirectory(directory = '', label = 'plugin directory') {
  return normalizeSafeRelativePath(directory || '', label, {
    allowEmpty: true,
    allowHiddenSegments: true
  });
}

function normalizePluginPathName(name = '', label = 'plugin name') {
  return normalizeSafeRelativePath(name, label, {
    allowHiddenSegments: false
  });
}

function normalizePluginCacheSegment(value = '', label = 'plugin segment', fallback = 'local') {
  const rawValue = String(value || '').trim() || fallback;
  return normalizeSafeFileStem(rawValue, label, {
    allowDots: true,
    pattern: /^[a-zA-Z0-9][a-zA-Z0-9._@+-]*$/
  });
}

function normalizeClaudeMarketplaceSegment(value = '', fallback = 'ctx') {
  return normalizePluginCacheSegment(value, 'Claude marketplace', fallback);
}

function resolvePluginConfigFile(configDir, name) {
  const safeName = normalizePluginPathName(name, 'plugin config name');
  return resolveInsideRoot(configDir, `${safeName}.json`, 'Plugin config path');
}

function joinRepoPath(...parts) {
  return normalizeRepoPath(parts.filter(Boolean).join('/'));
}

function stripGitSuffix(value = '') {
  return String(value || '').replace(/\.git$/i, '');
}

function slugifyCodexKey(value = '', fallback = 'local') {
  const slug = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.git$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function splitPluginMarketplaceKey(key = '') {
  const value = String(key || '');
  const atIndex = value.lastIndexOf('@');
  if (atIndex <= 0) return { name: value, marketplace: '' };
  return {
    name: value.slice(0, atIndex),
    marketplace: value.slice(atIndex + 1)
  };
}

function hasRepoInstallInfo(repoInfo = null) {
  return Boolean(
    repoInfo &&
    typeof repoInfo === 'object' &&
    (
      Object.prototype.hasOwnProperty.call(repoInfo, 'directory') ||
      repoInfo.localPath ||
      repoInfo.owner ||
      repoInfo.projectPath ||
      repoInfo.repoUrl ||
      repoInfo.url
    )
  );
}

function isWindowsAbsolutePath(input = '') {
  return /^[a-zA-Z]:[\\/]/.test(String(input || ''));
}

function expandHomePath(input = '') {
  const normalized = String(input || '').trim();
  if (!normalized) return '';
  if (normalized.startsWith('~/')) {
    return path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), normalized.slice(2));
  }
  if (normalized === '~') {
    return process.env.HOME || process.env.USERPROFILE || os.homedir();
  }
  if (normalized.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(normalized).pathname);
    } catch {
      return normalized;
    }
  }
  return normalized;
}

function resolveLocalRepoPath(input = '') {
  const expanded = expandHomePath(input);
  if (!expanded) return '';
  return path.resolve(expanded);
}

function normalizeRepoHost(host, provider = 'github') {
  const fallback = provider === 'gitlab' ? DEFAULT_GITLAB_HOST : DEFAULT_GITHUB_HOST;
  let normalized = String(host || '').trim();
  if (!normalized) {
    normalized = fallback;
  }
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }
  try {
    const parsed = new URL(normalized);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return fallback;
  }
}

function extractHostname(host = '') {
  const normalized = String(host || '').trim();
  if (!normalized) return '';
  try {
    return new URL(normalized).hostname || '';
  } catch {
    return normalized.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  }
}

function buildRepoUrl(repo) {
  if (repo.provider === 'local') {
    return repo.localPath || '';
  }
  if (repo.provider === 'gitlab') {
    return `${repo.host}/${repo.projectPath}`;
  }
  return `${repo.host}/${repo.owner}/${repo.name}`;
}

function buildRepoLabel(repo) {
  if (repo.provider === 'local') {
    return repo.localPath || '';
  }
  if (repo.provider === 'gitlab') {
    return repo.projectPath || '';
  }
  return [repo.owner, repo.name].filter(Boolean).join('/');
}

function buildRepoId(repo) {
  const branch = String(repo.branch || 'main').trim() || 'main';
  const directory = normalizeRepoDirectory(repo.directory);
  if (repo.provider === 'local') {
    return `local:${repo.localPath}::${directory}`;
  }
  if (repo.provider === 'gitlab') {
    return `gitlab:${repo.host}::${repo.projectPath}::${branch}::${directory}`;
  }
  return `github:${repo.host}::${repo.owner}/${repo.name}::${branch}::${directory}`;
}

function isLikelyLocalPath(input = '') {
  const normalized = String(input || '').trim();
  if (!normalized) return false;
  return (
    normalized.startsWith('/') ||
    normalized.startsWith('~/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    normalized.startsWith('file://') ||
    isWindowsAbsolutePath(normalized)
  );
}

function stripJsonComments(input = '') {
  let result = '';
  let inString = false;
  let stringChar = '';
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      result += ch;
      if (ch === '\\') {
        if (next) {
          result += next;
          i += 2;
          continue;
        }
      } else if (ch === stringChar) {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"' || ch === '\'') {
      inString = true;
      stringChar = ch;
      result += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length - 1 && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    result += ch;
    i += 1;
  }

  return result;
}

class PluginsService {
  constructor(platform = 'claude') {
    this.platform = SUPPORTED_PLATFORMS.includes(platform) ? platform : 'claude';
    this.configDir = PATHS.config || path.join((PATHS.base || process.env.HOME || os.homedir()), 'config');
    this.ccToolConfigDir = path.dirname(PATHS.pluginRepos.claude);
    this.opencodePluginsDir = path.join(OPENCODE_CONFIG_DIR, 'plugins');
    this.opencodeLegacyPluginsDir = path.join(OPENCODE_CONFIG_DIR, 'plugin');
    this.codexPluginsCacheDir = CODEX_PLUGINS_CACHE_DIR;
    this.marketCachePath = PATHS.pluginMarketCache[this.platform] || PATHS.pluginMarketCache.claude;
    this._marketCache = null;
  }

  getCapabilities() {
    return { ...(PLATFORM_CAPABILITIES[this.platform] || PLATFORM_CAPABILITIES.claude) };
  }

  _pluginsSupported() {
    return this.getCapabilities().supportsPlugins !== false;
  }

  normalizeRepoConfig(repo = {}) {
    const provider = SUPPORTED_REPO_PROVIDERS.includes(repo.provider)
      ? repo.provider
      : (repo.localPath || isLikelyLocalPath(repo.url || '') ? 'local' : (repo.projectPath ? 'gitlab' : 'github'));
    const rawRepoUrl = String(repo.repoUrl || repo.url || '').trim();
    let parsedOwner = String(repo.owner || '').trim();
    let parsedName = stripGitSuffix(repo.name || '');
    let parsedProjectPath = normalizeRepoPath(repo.projectPath || '');

    if (rawRepoUrl && !parsedProjectPath) {
      try {
        const parsedUrl = new URL(rawRepoUrl);
        const pathParts = parsedUrl.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/').filter(Boolean);
        if (provider === 'gitlab' && pathParts.length > 0) {
          parsedProjectPath = pathParts.join('/');
        } else if (pathParts.length >= 2) {
          parsedOwner = parsedOwner || pathParts[0];
          parsedName = parsedName || stripGitSuffix(pathParts[1]);
        }
      } catch {
        // ignore invalid url, validation below will surface missing fields
      }
    }

    const normalized = {
      provider,
      branch: String(repo.branch || 'main').trim() || 'main',
      directory: normalizeRepoDirectory(repo.directory),
      enabled: repo.enabled !== false
    };

    if (provider === 'local') {
      normalized.localPath = resolveLocalRepoPath(repo.localPath || repo.path || repo.url || '');
      if (!normalized.localPath) {
        throw new Error('Missing local repository path');
      }
      normalized.name = path.basename(normalized.localPath) || 'local-repo';
    } else if (provider === 'gitlab') {
      normalized.host = normalizeRepoHost(repo.host, 'gitlab');
      normalized.projectPath = normalizeRepoPath(parsedProjectPath || [parsedOwner, parsedName].filter(Boolean).join('/'));
      if (!normalized.projectPath) {
        throw new Error('Missing GitLab project path');
      }
      normalized.name = stripGitSuffix(normalized.projectPath.split('/').pop() || '');
      normalized.owner = normalized.projectPath.split('/')[0] || '';
    } else {
      normalized.host = normalizeRepoHost(repo.host, 'github');
      normalized.owner = parsedOwner;
      normalized.name = parsedName;
      if (!normalized.owner || !normalized.name) {
        throw new Error('Repository owner and name are required');
      }
    }

    normalized.repoUrl = repo.repoUrl || repo.url || buildRepoUrl(normalized);
    normalized.url = normalized.repoUrl;
    normalized.label = buildRepoLabel(normalized);
    normalized.id = buildRepoId(normalized);

    if (provider !== 'local') {
      const token = normalizeRepoToken(repo.token);
      if (token) {
        normalized.token = token;
      }
    }

    if (repo.source) normalized.source = repo.source;
    if (repo.marketplace) normalized.marketplace = repo.marketplace;
    if (repo.lastUpdated) normalized.lastUpdated = repo.lastUpdated;
    if (repo.addedAt) normalized.addedAt = repo.addedAt;

    return normalized;
  }

  normalizeRepos(repos = []) {
    return repos.map(repo => this.normalizeRepoConfig(repo));
  }

  toClientRepo(repo = {}) {
    const normalizedRepo = this.normalizeRepoConfig(repo);
    const token = normalizeRepoToken(normalizedRepo.token);
    const clientRepo = {
      ...normalizedRepo,
      hasToken: Boolean(token),
      tokenPreview: token ? maskToken(token) : ''
    };
    delete clientRepo.token;
    return clientRepo;
  }

  getReposForClient(repos = null) {
    const sourceRepos = Array.isArray(repos) ? repos : this.getRepos();
    return sourceRepos.map(repo => this.toClientRepo(repo));
  }

  findStoredRepo(repo = {}) {
    const repoId = String(repo.id || repo.repoId || '').trim();
    const repos = this.loadReposConfig().repos;

    if (repoId) {
      return repos.find(candidate => candidate.id === repoId) || null;
    }

    try {
      const normalizedRepo = this.normalizeRepoConfig(repo);
      return repos.find(candidate => candidate.id === normalizedRepo.id) || null;
    } catch {
      return null;
    }
  }

  resolveRepoToken(repo = null) {
    if (!repo || typeof repo !== 'object') return null;

    const directToken = normalizeRepoToken(repo.token);
    if (directToken) {
      return directToken;
    }

    const storedRepo = this.findStoredRepo(repo);
    if (!storedRepo) {
      return null;
    }

    return normalizeRepoToken(storedRepo.token) || null;
  }

  clearMarketCache({ removeFile = true } = {}) {
    this._marketCache = null;
    if (removeFile) {
      try {
        if (fs.existsSync(this.marketCachePath)) {
          fs.unlinkSync(this.marketCachePath);
        }
      } catch (err) {
        // ignore cache deletion errors
      }
    }
  }

  loadMarketCacheFromFile() {
    try {
      if (fs.existsSync(this.marketCachePath)) {
        const data = JSON.parse(fs.readFileSync(this.marketCachePath, 'utf-8'));
        if (Array.isArray(data.plugins)) {
          return data.plugins;
        }
      }
    } catch (err) {
      // ignore cache read errors
    }
    return null;
  }

  saveMarketCacheToFile(plugins) {
    try {
      this._ensureDir(path.dirname(this.marketCachePath));
      fs.writeFileSync(this.marketCachePath, JSON.stringify({ plugins }), 'utf-8');
    } catch (err) {
      // ignore cache write errors
    }
  }

  prepareMarketPlugins(plugins = []) {
    const preparedPlugins = Array.isArray(plugins)
      ? plugins.map(plugin => ({ ...plugin }))
      : [];
    const seen = new Set();
    const installedPlugins = this.listPlugins().plugins;
    const installedNames = new Set(installedPlugins.map(p => p.name));

    const deduped = [];
    for (const plugin of preparedPlugins) {
      const key = [
        plugin.name || '',
        plugin.repoId || '',
        plugin.repoProvider || '',
        plugin.repoOwner || '',
        plugin.repoName || '',
        plugin.repoProjectPath || '',
        plugin.repoLocalPath || '',
        plugin.directory || plugin.installSource || ''
      ].join('::');
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        ...plugin,
        isInstalled: installedNames.has(plugin.name)
      });
    }

    deduped.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));
    return deduped;
  }

  _ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  _isOpenCode() {
    return this.platform === 'opencode';
  }

  _isCodex() {
    return this.platform === 'codex';
  }

  _isGemini() {
    return this.platform === 'gemini';
  }

  _getOpenCodePluginsDir() {
    if (fs.existsSync(this.opencodeLegacyPluginsDir) && !fs.existsSync(this.opencodePluginsDir)) {
      return this.opencodeLegacyPluginsDir;
    }
    return this.opencodePluginsDir;
  }

  _getOpenCodeConfigPath() {
    const jsonc = path.join(OPENCODE_CONFIG_DIR, 'opencode.jsonc');
    const json = path.join(OPENCODE_CONFIG_DIR, 'opencode.json');
    const config = path.join(OPENCODE_CONFIG_DIR, 'config.json');
    if (fs.existsSync(jsonc)) return jsonc;
    if (fs.existsSync(json)) return json;
    if (fs.existsSync(config)) return config;
    return json;
  }

  _readOpenCodeConfig() {
    const filePath = this._getOpenCodeConfigPath();
    if (!fs.existsSync(filePath)) return { filePath, config: {} };

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw.trim()) return { filePath, config: {} };
      if (filePath.endsWith('.jsonc')) {
        return { filePath, config: JSON.parse(stripJsonComments(raw)) };
      }
      return { filePath, config: JSON.parse(raw) };
    } catch (err) {
      console.error('[PluginsService] Failed to read opencode config:', err.message);
      return { filePath, config: {} };
    }
  }

  _writeOpenCodeConfig(filePath, config) {
    this._ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  }

  _listOpenCodeConfiguredPlugins() {
    const { config } = this._readOpenCodeConfig();
    if (!Array.isArray(config.plugin)) return [];
    return config.plugin.filter(Boolean);
  }

  _setOpenCodeConfiguredPlugins(plugins) {
    const { filePath, config } = this._readOpenCodeConfig();
    const nextConfig = (config && typeof config === 'object') ? { ...config } : {};
    nextConfig.plugin = Array.from(new Set((plugins || []).filter(Boolean)));
    this._writeOpenCodeConfig(filePath, nextConfig);
  }

  _listOpenCodeLocalPlugins() {
    const pluginsDir = this._getOpenCodePluginsDir();
    if (!fs.existsSync(pluginsDir)) return [];

    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    const plugins = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(pluginsDir, entry.name);

      if (entry.isDirectory()) {
        const pkgPath = path.join(fullPath, 'package.json');
        const repoSourceMeta = this.readRepoSourceMeta(fullPath) || {};
        let packageName = entry.name;
        let description = '';
        let version = '1.0.0';
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            packageName = pkg.name || packageName;
            description = pkg.description || '';
            version = pkg.version || version;
          } catch (err) {
            // ignore invalid package.json
          }
        }
        plugins.push({
          name: packageName,
          directory: entry.name,
          installPath: fullPath,
          source: 'opencode-local',
          version,
          description,
          installed: true,
          enabled: true,
          pluginType: 'local',
          ...repoSourceMeta
        });
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (['.js', '.mjs', '.cjs', '.ts'].includes(ext)) {
        plugins.push({
          name: entry.name.replace(ext, ''),
          directory: entry.name,
          installPath: fullPath,
          source: 'opencode-local',
          version: '1.0.0',
          description: '',
          installed: true,
          enabled: true,
          pluginType: 'local'
        });
      }
    }

    return plugins;
  }

  _readFirstMarkdownParagraph(filePath) {
    if (!fs.existsSync(filePath)) return '';
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && !line.startsWith('<!--'));
      return lines[0] || '';
    } catch {
      return '';
    }
  }

  _listCodexCachedPlugins() {
    const cacheDir = this.codexPluginsCacheDir;
    if (!fs.existsSync(cacheDir)) return [];

    const plugins = [];
    try {
      const marketplaces = fs.readdirSync(cacheDir, { withFileTypes: true });
      for (const marketplaceEntry of marketplaces) {
        if (!marketplaceEntry.isDirectory() || marketplaceEntry.name.startsWith('.')) continue;
        const marketplaceDir = path.join(cacheDir, marketplaceEntry.name);
        const pluginEntries = fs.readdirSync(marketplaceDir, { withFileTypes: true });

        for (const pluginEntry of pluginEntries) {
          if (!pluginEntry.isDirectory() || pluginEntry.name.startsWith('.')) continue;
          const pluginRoot = path.join(marketplaceDir, pluginEntry.name);
          const versionEntries = fs.readdirSync(pluginRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
          const selectedVersion = versionEntries
            .map(entry => ({
              name: entry.name,
              fullPath: path.join(pluginRoot, entry.name),
              mtimeMs: fs.statSync(path.join(pluginRoot, entry.name)).mtimeMs
            }))
            .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
          if (!selectedVersion) continue;

          const description = this._readFirstMarkdownParagraph(path.join(selectedVersion.fullPath, 'README.md'));
          const manifest = this._readLocalManifest(selectedVersion.fullPath, [
            '.codex-plugin/plugin.json',
            'plugin.json',
            'package.json'
          ]) || {};
          plugins.push({
            name: manifest.name || pluginEntry.name,
            marketplace: marketplaceEntry.name,
            version: manifest.version || selectedVersion.name,
            installPath: selectedVersion.fullPath,
            directory: path.relative(CODEX_PLUGINS_DIR, selectedVersion.fullPath),
            source: 'codex-cache',
            installed: true,
            enabled: this._isCodexPluginEnabled(manifest.name || pluginEntry.name, marketplaceEntry.name),
            pluginType: 'cache',
            description: manifest.description || description
          });
        }
      }
    } catch (err) {
      console.warn('[PluginsService] Failed to scan Codex plugin cache:', err.message);
    }

    plugins.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return plugins;
  }

  _readLocalManifest(rootDir, candidates = []) {
    for (const candidate of candidates) {
      const manifestPath = path.join(rootDir, candidate);
      if (!fs.existsSync(manifestPath)) continue;
      try {
        return JSON.parse(stripJsonComments(fs.readFileSync(manifestPath, 'utf8')));
      } catch {
        // try next candidate
      }
    }
    return null;
  }

  _readCodexConfig() {
    const filePath = NATIVE_PATHS.codex.config;
    if (!fs.existsSync(filePath)) return { filePath, config: {} };
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw.trim()) return { filePath, config: {} };
      return { filePath, config: toml.parse(raw) };
    } catch (err) {
      console.error('[PluginsService] Failed to read Codex config:', err.message);
      return { filePath, config: {} };
    }
  }

  _writeCodexConfig(config) {
    const filePath = NATIVE_PATHS.codex.config;
    this._ensureDir(path.dirname(filePath));
    const safeConfig = JSON.parse(JSON.stringify(config || {}));
    fs.writeFileSync(filePath, tomlStringify(safeConfig), 'utf8');
  }

  _readClaudeSettings() {
    const filePath = NATIVE_PATHS.claude.settings;
    if (!fs.existsSync(filePath)) return { filePath, settings: {} };
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return { filePath, settings: raw.trim() ? JSON.parse(raw) : {} };
    } catch (err) {
      console.error('[PluginsService] Failed to read Claude settings:', err.message);
      return { filePath, settings: {} };
    }
  }

  _writeClaudeSettings(settings) {
    const filePath = NATIVE_PATHS.claude.settings;
    this._ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(settings || {}, null, 2), 'utf8');
  }

  _setClaudePluginEnabled(name, marketplace, enabled) {
    const { settings } = this._readClaudeSettings();
    const nextSettings = (settings && typeof settings === 'object') ? { ...settings } : {};
    const pluginKey = marketplace ? `${name}@${marketplace}` : name;
    nextSettings.enabledPlugins = { ...(nextSettings.enabledPlugins || {}) };
    nextSettings.enabledPlugins[pluginKey] = !!enabled;
    this._writeClaudeSettings(nextSettings);
  }

  _removeClaudePluginEnabled(name, marketplace = '') {
    const { settings } = this._readClaudeSettings();
    const nextSettings = (settings && typeof settings === 'object') ? { ...settings } : {};
    const enabledPlugins = { ...(nextSettings.enabledPlugins || {}) };
    for (const key of Object.keys(enabledPlugins)) {
      const parsed = splitPluginMarketplaceKey(key);
      if (parsed.name === name && (!marketplace || parsed.marketplace === marketplace)) {
        delete enabledPlugins[key];
      }
    }
    nextSettings.enabledPlugins = enabledPlugins;
    this._writeClaudeSettings(nextSettings);
  }

  _isClaudePluginEnabled(name, marketplace = '') {
    const { settings } = this._readClaudeSettings();
    const enabledPlugins = settings.enabledPlugins || {};
    const pluginKey = marketplace ? `${name}@${marketplace}` : name;
    if (Object.prototype.hasOwnProperty.call(enabledPlugins, pluginKey)) {
      return enabledPlugins[pluginKey] !== false;
    }
    for (const [key, value] of Object.entries(enabledPlugins)) {
      const parsed = splitPluginMarketplaceKey(key);
      if (parsed.name === name) {
        return value !== false;
      }
    }
    return true;
  }

  _resolveClaudeMarketplaceName(normalizedRepo, explicit = '') {
    if (explicit) return normalizeClaudeMarketplaceSegment(explicit);
    if (normalizedRepo.marketplace) return normalizeClaudeMarketplaceSegment(normalizedRepo.marketplace);
    if (normalizedRepo.provider === 'local') return normalizeClaudeMarketplaceSegment(normalizedRepo.name || normalizedRepo.localPath, 'local');
    if (normalizedRepo.provider === 'gitlab') return normalizeClaudeMarketplaceSegment(normalizedRepo.name || normalizedRepo.projectPath, 'gitlab');
    return normalizeClaudeMarketplaceSegment(normalizedRepo.name || normalizedRepo.owner || 'ctx');
  }

  _resolveClaudePluginCachePath(marketplace, pluginName, version) {
    return resolveInsideRoot(
      CLAUDE_PLUGINS_CACHE_DIR,
      path.posix.join(
        normalizeClaudeMarketplaceSegment(marketplace),
        normalizePluginCacheSegment(pluginName, 'Claude plugin name', 'plugin'),
        normalizePluginCacheSegment(String(version || 'local'), 'Claude plugin version', 'local')
      ),
      'Claude plugin cache path'
    );
  }

  _resolveClaudeMarketplacePath(marketplace) {
    return resolveInsideRoot(
      CLAUDE_MARKETPLACES_DIR,
      normalizeClaudeMarketplaceSegment(marketplace),
      'Claude marketplace path'
    );
  }

  _registerClaudeMarketplace(marketplace, sourceDir, marketplaceInfo = {}) {
    const safeMarketplace = normalizeClaudeMarketplaceSegment(marketplace);
    const marketplaceDir = this._resolveClaudeMarketplacePath(safeMarketplace);
    this._ensureDir(path.join(marketplaceDir, '.claude-plugin'));

    const plugins = Array.isArray(marketplaceInfo.plugins) ? marketplaceInfo.plugins : [];
    const manifestPath = path.join(marketplaceDir, '.claude-plugin', 'marketplace.json');
    const marketplaceManifest = {
      name: safeMarketplace,
      owner: { name: 'CTX' },
      plugins,
      ...(marketplaceInfo.description ? { description: marketplaceInfo.description } : {})
    };
    fs.writeFileSync(manifestPath, JSON.stringify(marketplaceManifest, null, 2), 'utf8');

    this._ensureDir(CLAUDE_PLUGINS_DIR);
    let known = {};
    if (fs.existsSync(CLAUDE_MARKETPLACES_FILE)) {
      try {
        known = JSON.parse(fs.readFileSync(CLAUDE_MARKETPLACES_FILE, 'utf8'));
      } catch {
        known = {};
      }
    }
    known[safeMarketplace] = {
      source: {
        source: 'directory',
        path: marketplaceDir
      },
      installLocation: marketplaceDir,
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(CLAUDE_MARKETPLACES_FILE, JSON.stringify(known, null, 2), 'utf8');

    const { settings } = this._readClaudeSettings();
    const nextSettings = (settings && typeof settings === 'object') ? { ...settings } : {};
    nextSettings.extraKnownMarketplaces = { ...(nextSettings.extraKnownMarketplaces || {}) };
    nextSettings.extraKnownMarketplaces[safeMarketplace] = {
      source: {
        source: 'directory',
        path: marketplaceDir
      }
    };
    this._writeClaudeSettings(nextSettings);
    return marketplaceDir;
  }

  _upsertClaudeMarketplacePlugin(marketplace, pluginDir, plugin) {
    const marketplaceDir = this._resolveClaudeMarketplacePath(marketplace);
    const marketplaceManifestPath = path.join(marketplaceDir, '.claude-plugin', 'marketplace.json');
    let marketplaceManifest = {
      name: normalizeClaudeMarketplaceSegment(marketplace),
      owner: { name: 'CTX' },
      plugins: []
    };
    if (fs.existsSync(marketplaceManifestPath)) {
      try {
        marketplaceManifest = JSON.parse(fs.readFileSync(marketplaceManifestPath, 'utf8'));
      } catch {
        // recreate malformed marketplace manifest below
      }
    }
    if (!Array.isArray(marketplaceManifest.plugins)) {
      marketplaceManifest.plugins = [];
    }

    const pluginName = String(plugin.name || '').trim();
    const existingIndex = marketplaceManifest.plugins.findIndex(item => item?.name === pluginName);
    const nextEntry = {
      name: pluginName,
      source: `./plugins/${pluginName}`,
      description: plugin.description || ''
    };
    if (plugin.category) {
      nextEntry.category = plugin.category;
    }
    if (existingIndex >= 0) {
      marketplaceManifest.plugins[existingIndex] = {
        ...marketplaceManifest.plugins[existingIndex],
        ...nextEntry
      };
    } else {
      marketplaceManifest.plugins.push(nextEntry);
    }

    const marketplacePluginDir = resolveInsideRoot(
      marketplaceDir,
      path.posix.join('plugins', normalizePluginCacheSegment(pluginName, 'Claude plugin name', 'plugin')),
      'Claude marketplace plugin path'
    );
    if (fs.existsSync(marketplacePluginDir)) {
      fs.rmSync(marketplacePluginDir, { recursive: true, force: true });
    }
    this.copyDirRecursive(pluginDir, marketplacePluginDir, {
      excludeNames: [REPO_SOURCE_META_FILE]
    });
    this._registerClaudeMarketplace(marketplace, marketplaceDir, marketplaceManifest);
  }

  _registerClaudeInstalledPlugin(name, marketplace, installPath, installData = {}) {
    this._ensureDir(CLAUDE_PLUGINS_DIR);
    let nativeData = { version: 2, plugins: {} };
    if (fs.existsSync(CLAUDE_INSTALLED_FILE)) {
      try {
        nativeData = JSON.parse(fs.readFileSync(CLAUDE_INSTALLED_FILE, 'utf8'));
      } catch {
        nativeData = { version: 2, plugins: {} };
      }
    }
    nativeData.version = nativeData.version || 2;
    if (!nativeData.plugins || typeof nativeData.plugins !== 'object') {
      nativeData.plugins = {};
    }
    const nativeKey = marketplace ? `${name}@${marketplace}` : name;
    const installTimestamp = installData.installedAt || new Date().toISOString();
    nativeData.plugins[nativeKey] = [{
      scope: installData.scope || 'user',
      installPath,
      version: installData.version || '1.0.0',
      installedAt: installTimestamp,
      lastUpdated: installData.lastUpdated || installTimestamp,
      ...(installData.source ? { source: installData.source } : {}),
      ...(installData.repoSourceMeta || {})
    }];
    fs.writeFileSync(CLAUDE_INSTALLED_FILE, JSON.stringify(nativeData, null, 2), 'utf8');
    this._setClaudePluginEnabled(name, marketplace, true);
  }

  _isCodexPluginEnabled(name, marketplace = '') {
    const { config } = this._readCodexConfig();
    const plugins = config.plugins || {};
    if (marketplace) {
      const exact = plugins[`${name}@${marketplace}`];
      if (exact && typeof exact === 'object' && exact.enabled === false) return false;
    }
    for (const [key, value] of Object.entries(plugins)) {
      const parsed = splitPluginMarketplaceKey(key);
      if (parsed.name === name && value && typeof value === 'object' && value.enabled === false) {
        return false;
      }
    }
    return true;
  }

  _setCodexPluginEnabled(name, marketplace, enabled) {
    const { config } = this._readCodexConfig();
    const nextConfig = (config && typeof config === 'object') ? { ...config } : {};
    nextConfig.plugins = { ...(nextConfig.plugins || {}) };
    const pluginKey = marketplace ? `${name}@${marketplace}` : name;
    nextConfig.plugins[pluginKey] = {
      ...(nextConfig.plugins[pluginKey] || {}),
      enabled: !!enabled
    };
    this._writeCodexConfig(nextConfig);
  }

  _registerCodexMarketplace(marketplace, source) {
    const { config } = this._readCodexConfig();
    const nextConfig = (config && typeof config === 'object') ? { ...config } : {};
    nextConfig.marketplaces = { ...(nextConfig.marketplaces || {}) };
    nextConfig.marketplaces[marketplace] = {
      ...(nextConfig.marketplaces[marketplace] || {}),
      source_type: isLikelyLocalPath(source) ? 'local' : 'git',
      source,
      last_updated: new Date().toISOString()
    };
    this._writeCodexConfig(nextConfig);
  }

  _unregisterCodexPlugin(name, marketplace = '') {
    const { config } = this._readCodexConfig();
    const nextConfig = (config && typeof config === 'object') ? { ...config } : {};
    const plugins = { ...(nextConfig.plugins || {}) };
    for (const key of Object.keys(plugins)) {
      const parsed = splitPluginMarketplaceKey(key);
      if (parsed.name === name && (!marketplace || parsed.marketplace === marketplace)) {
        delete plugins[key];
      }
    }
    nextConfig.plugins = plugins;
    this._writeCodexConfig(nextConfig);
  }

  _resolveCodexMarketplaceName(repo, explicit = '') {
    if (explicit) return slugifyCodexKey(explicit);
    if (repo.marketplace) return slugifyCodexKey(repo.marketplace);
    if (repo.provider === 'local') return slugifyCodexKey(repo.localPath, 'local');
    if (repo.provider === 'gitlab') return slugifyCodexKey(repo.projectPath, 'gitlab');
    return slugifyCodexKey(repo.name || repo.owner || 'github');
  }

  /**
   * List all installed plugins with their status
   * Reads from Claude Code's native installed_plugins.json
   * @returns {Object} { plugins: Array }
   */
  listPlugins() {
    if (!this._pluginsSupported()) {
      return { plugins: [] };
    }

    if (this._isCodex()) {
      return { plugins: this._listCodexCachedPlugins() };
    }

    if (this._isOpenCode()) {
      const plugins = [];
      const seen = new Set();

      for (const pkg of this._listOpenCodeConfiguredPlugins()) {
        if (seen.has(pkg)) continue;
        seen.add(pkg);
        plugins.push({
          name: pkg,
          directory: pkg,
          source: 'opencode-config',
          version: 'latest',
          description: '',
          installed: true,
          enabled: true,
          pluginType: 'npm'
        });
      }

      for (const plugin of this._listOpenCodeLocalPlugins()) {
        if (!seen.has(plugin.name)) {
          seen.add(plugin.name);
          plugins.push(plugin);
        }
      }

      return { plugins };
    }

    const plugins = [];

    // Read Claude Code's installed_plugins.json
    if (fs.existsSync(CLAUDE_INSTALLED_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(CLAUDE_INSTALLED_FILE, 'utf8'));
        if (data.plugins) {
          for (const [key, installations] of Object.entries(data.plugins)) {
            if (installations && installations.length > 0) {
              const install = installations[0]; // Get first installation
              const { name, marketplace } = splitPluginMarketplaceKey(key);

              // Read plugin.json from installPath for description
              let description = '';
              let source = install.source || '';
              let repoUrl = install.repoUrl || '';
              let repoProvider = install.repoProvider || '';
              let repoOwner = install.repoOwner || '';
              let repoName = install.repoName || '';
              let repoBranch = install.repoBranch || 'main';
              let repoDirectory = install.repoDirectory || '';
              let repoHost = install.repoHost || '';
              let repoProjectPath = install.repoProjectPath || '';
              let repoLocalPath = install.repoLocalPath || '';
              let repoId = install.repoId || '';

              if (install.installPath && fs.existsSync(install.installPath)) {
                const manifestPath = path.join(install.installPath, 'plugin.json');
                if (fs.existsSync(manifestPath)) {
                  try {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    description = manifest.description || '';
                  } catch (err) {
                    // Ignore parse errors
                  }
                }

                const repoSourceMeta = this.readRepoSourceMeta(install.installPath) || {};
                repoUrl = repoUrl || repoSourceMeta.repoUrl || '';
                repoProvider = repoProvider || repoSourceMeta.repoProvider || '';
                repoOwner = repoOwner || repoSourceMeta.repoOwner || '';
                repoName = repoName || repoSourceMeta.repoName || '';
                repoBranch = repoBranch || repoSourceMeta.repoBranch || 'main';
                repoDirectory = repoDirectory || repoSourceMeta.repoDirectory || '';
                repoHost = repoHost || repoSourceMeta.repoHost || '';
                repoProjectPath = repoProjectPath || repoSourceMeta.repoProjectPath || '';
                repoLocalPath = repoLocalPath || repoSourceMeta.repoLocalPath || '';
                repoId = repoId || repoSourceMeta.repoId || '';
              }

              // Parse repoUrl from source if available
              if (!repoUrl && source) {
                const match = source.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
                if (match) {
                  repoUrl = `https://github.com/${match[1]}/${match[2]}`;
                  repoProvider = repoProvider || 'github';
                  repoOwner = repoOwner || match[1];
                  repoName = repoName || match[2];
                }
              }

              // Read enabled state from CTX registry (defaults to true if not set)
              const legacyInfo = getPlugin(name);
              const enabledState = this._isClaudePluginEnabled(name, marketplace) &&
                (legacyInfo ? legacyInfo.enabled !== false : true);

              plugins.push({
                name,
                marketplace,
                version: install.version || '1.0.0',
                installPath: install.installPath,
                installedAt: install.installedAt,
                scope: install.scope,
                enabled: enabledState,
                description,
                source,
                repoUrl,
                repoProvider,
                repoOwner,
                repoName,
                repoBranch,
                directory: repoDirectory || install.installPath || '',
                repoDirectory,
                repoHost,
                repoProjectPath,
                repoLocalPath,
                repoId
              });
            }
          }
        }
      } catch (err) {
        console.error('[PluginsService] Failed to read installed_plugins.json:', err.message);
      }
    }

    // Also check legacy registry
    try {
      const legacyPlugins = listPlugins();
      for (const plugin of legacyPlugins) {
        if (!plugins.find(p => p.name === plugin.name)) {
          plugins.push(plugin);
        }
      }
    } catch (err) {
      // Ignore legacy registry errors
    }

    return { plugins };
  }

  /**
   * Get single plugin details
   * @param {string} name - Plugin name
   * @returns {Object|null} Plugin details or null
   */
  getPlugin(name) {
    if (this._isCodex()) {
      const plugin = this.listPlugins().plugins.find(p => p.name === name || `${p.name}@${p.marketplace}` === name);
      if (!plugin) return null;
      const manifest = plugin.installPath
        ? this._readLocalManifest(plugin.installPath, ['.codex-plugin/plugin.json', 'plugin.json', 'package.json'])
        : null;
      return {
        name: plugin.name,
        ...plugin,
        author: manifest?.author || '',
        commands: manifest?.commands || [],
        hooks: manifest?.hooks || [],
        manifest
      };
    }

    if (this._isOpenCode()) {
      const plugin = this.listPlugins().plugins.find(p => p.name === name || p.directory === name);
      if (!plugin) return null;
      return plugin;
    }

    const plugin = getPlugin(name);
    if (!plugin) {
      return null;
    }

    const pluginDir = path.join(INSTALLED_DIR, name);
    const manifestPath = path.join(pluginDir, 'plugin.json');

    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (err) {
        // Ignore parse errors
      }
    }

    return {
      name,
      ...plugin,
      description: manifest?.description || '',
      author: manifest?.author || '',
      commands: manifest?.commands || [],
      hooks: manifest?.hooks || [],
      manifest
    };
  }

  /**
   * Install plugin from Git URL or repo directory
   * @param {string} source - Git repository URL or tree URL
   * @param {Object} repoInfo - Optional repo info { owner, name, branch, directory }
   * @returns {Promise<Object>} Installation result
   */
  async installPlugin(source, repoInfo = null) {
    if (this._isCodex()) {
      if (hasRepoInstallInfo(repoInfo)) {
        return this._installFromRepoDirectory(repoInfo);
      }

      const parsedSource = this.parseRepoTreeSource(source);
      if (parsedSource) {
        return this._installFromRepoDirectory(parsedSource);
      }

      const parsedRepo = this._repoFromGitUrl(source, 'main');
      if (parsedRepo) {
        return this._installFromRepoDirectory({ ...parsedRepo, directory: '' });
      }

      return {
        success: false,
        error: 'Codex plugin install expects repository metadata, a GitHub/GitLab tree URL, or a Git repository URL'
      };
    }

    if (!this._pluginsSupported()) {
      return {
        success: false,
        error: `${this.platform} plugin management is not supported`
      };
    }

    if (this._isOpenCode()) {
      if (hasRepoInstallInfo(repoInfo)) {
        return this._installFromRepoDirectory(repoInfo, { installRoot: this._getOpenCodePluginsDir() });
      }

      const parsedSource = this.parseRepoTreeSource(source);
      if (parsedSource) {
        return this._installFromRepoDirectory(parsedSource, { installRoot: this._getOpenCodePluginsDir() });
      }

      const parsedRepo = this._repoFromGitUrl(source, 'main');
      if (parsedRepo) {
        return this._installFromRepoDirectory({ ...parsedRepo, directory: '' }, { installRoot: this._getOpenCodePluginsDir() });
      }

      // OpenCode 原生支持 npm 包名，通过 opencode.json 的 plugin 数组管理
      if (!/^https?:\/\//.test(source)) {
        const plugins = this._listOpenCodeConfiguredPlugins();
        if (!plugins.includes(source)) {
          plugins.push(source);
          this._setOpenCodeConfiguredPlugins(plugins);
        }
        return {
          success: true,
          plugin: { name: source, version: 'latest', description: '' }
        };
      }

      return {
        success: false,
        error: 'OpenCode plugin install expects npm package name or GitHub tree URL'
      };
    }

    if (hasRepoInstallInfo(repoInfo)) {
      return await this._installFromRepoDirectory(repoInfo);
    }

    const parsedSource = this.parseRepoTreeSource(source);
    if (parsedSource) {
      return await this._installFromRepoDirectory(parsedSource);
    }

    const parsedRepo = this._repoFromGitUrl(source, 'main');
    if (parsedRepo) {
      return await this._installFromRepoDirectory({ ...parsedRepo, directory: '' });
    }

    // Fallback to original git clone method
    return await installPluginCore(source);
  }

  /**
   * Install plugin from repo directory
   * @private
   */
  async _installFromRepoDirectory(repoInfo, options = {}) {
    const normalizedRepo = this.normalizeRepoConfig(repoInfo);
    const directory = normalizePluginRepoDirectory(repoInfo.directory || normalizedRepo.directory || '');
    const pluginName = directory.split('/').filter(Boolean).pop() || slugifyCodexKey(normalizedRepo.name, 'plugin');
    const manifestCandidates = this._getManifestCandidates(directory);

    try {
      let manifest;
      let manifestPath = '';
      for (const candidate of manifestCandidates) {
        try {
          manifestPath = joinRepoPath(directory, candidate);
          manifest = await this.fetchRepoJson(normalizedRepo, manifestPath);
          break;
        } catch {
          manifestPath = '';
        }
      }
      if (!manifest) {
        manifest = { name: pluginName, version: '1.0.0' };
      }

      const installedPluginName = String(manifest.name || pluginName || 'plugin').trim() || 'plugin';
      const installRoot = this._resolvePluginInstallRoot(normalizedRepo, repoInfo, manifest, options);

      // Create plugin directory
      const pluginDir = this._isCodex()
        ? installRoot
        : this.platform === 'claude'
          ? installRoot
        : resolveInsideRoot(
          installRoot,
          normalizePluginPathName(installedPluginName, 'plugin name'),
          'Plugin install path',
          { allowHiddenSegments: false }
        );
      if (!fs.existsSync(pluginDir)) {
        fs.mkdirSync(pluginDir, { recursive: true });
      }

      if (normalizedRepo.provider === 'local') {
        const sourceDir = directory
          ? resolveInsideRoot(normalizedRepo.localPath, directory, 'Plugin directory', { allowHiddenSegments: true })
          : normalizedRepo.localPath;
        if (!fs.existsSync(sourceDir)) {
          throw new Error(`Plugin directory not found: ${directory}`);
        }
        this.copyDirRecursive(sourceDir, pluginDir);
      } else {
        const tempDir = path.join(os.tmpdir(), `plugin-${Date.now()}`);
        const zipPath = path.join(tempDir, 'repo.zip');
        fs.mkdirSync(tempDir, { recursive: true });

        try {
          let zipUrl = '';
          let zipHeaders = {};

          if (normalizedRepo.provider === 'gitlab') {
            const projectId = encodeURIComponent(normalizedRepo.projectPath);
            zipUrl = `${normalizedRepo.host}/api/v4/projects/${projectId}/repository/archive.zip?sha=${encodeURIComponent(normalizedRepo.branch)}`;
            const token = this.getGitLabToken(normalizedRepo);
            if (token) {
              zipHeaders['PRIVATE-TOKEN'] = token;
            }
          } else {
            zipUrl = `https://api.github.com/repos/${normalizedRepo.owner}/${normalizedRepo.name}/zipball/${encodeURIComponent(normalizedRepo.branch)}`;
            const token = this.getGitHubToken(normalizedRepo);
            zipHeaders.Accept = 'application/vnd.github+json';
            if (token) {
              zipHeaders.Authorization = `token ${token}`;
            }
          }

          await this.downloadFile(zipUrl, zipPath, zipHeaders);
          const zip = new AdmZip(zipPath);
          zip.extractAllTo(tempDir, true);

          const extractedDir = fs.readdirSync(tempDir).find(item =>
            fs.statSync(path.join(tempDir, item)).isDirectory()
          );
          if (!extractedDir) {
            throw new Error('Empty archive');
          }

          const extractedRoot = path.join(tempDir, extractedDir);
          const sourceDir = directory
            ? resolveInsideRoot(extractedRoot, directory, 'Plugin directory', { allowHiddenSegments: true })
            : extractedRoot;
          if (!fs.existsSync(sourceDir)) {
            throw new Error(`Plugin directory not found: ${directory}`);
          }
          this.copyDirRecursive(sourceDir, pluginDir);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }

      // Write plugin.json if not exists
      const fallbackManifestPath = path.join(pluginDir, this._isCodex() ? '.codex-plugin/plugin.json' : 'plugin.json');
      if (!fs.existsSync(fallbackManifestPath)) {
        this._ensureDir(path.dirname(fallbackManifestPath));
        fs.writeFileSync(fallbackManifestPath, JSON.stringify(manifest, null, 2));
      }
      if (this.platform === 'claude') {
        const claudeManifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
        if (!fs.existsSync(claudeManifestPath)) {
          this._ensureDir(path.dirname(claudeManifestPath));
          fs.writeFileSync(claudeManifestPath, JSON.stringify(manifest, null, 2));
        }
      }

      if (this._isCodex()) {
        const marketplace = this._resolveCodexMarketplaceName(normalizedRepo, repoInfo.marketplace);
        const sourceUrl = this.buildRepoBrowserUrl(normalizedRepo, directory) || buildRepoUrl(normalizedRepo);
        this.writeRepoSourceMeta(pluginDir, {
          repoId: normalizedRepo.id,
          repoProvider: normalizedRepo.provider,
          repoOwner: normalizedRepo.owner || '',
          repoName: normalizedRepo.name || '',
          repoBranch: normalizedRepo.branch,
          repoDirectory: directory,
          repoHost: normalizedRepo.host || '',
          repoProjectPath: normalizedRepo.projectPath || '',
          repoLocalPath: normalizedRepo.localPath || '',
          repoUrl: normalizedRepo.repoUrl || buildRepoUrl(normalizedRepo),
          marketplace,
          manifestPath,
          source: sourceUrl
        });
        this._registerCodexMarketplace(marketplace, normalizedRepo.repoUrl || buildRepoUrl(normalizedRepo));
        this._setCodexPluginEnabled(installedPluginName, marketplace, true);
      } else if (this.platform === 'claude') {
        const installTimestamp = new Date().toISOString();
        const sourceUrl = this.buildRepoBrowserUrl(normalizedRepo, directory) || buildRepoUrl(normalizedRepo);
        const marketplace = this._resolveClaudeMarketplaceName(normalizedRepo, repoInfo.marketplace);
        const repoSourceMeta = {
          repoId: normalizedRepo.id,
          repoProvider: normalizedRepo.provider,
          repoOwner: normalizedRepo.owner || '',
          repoName: normalizedRepo.name || '',
          repoBranch: normalizedRepo.branch,
          repoDirectory: directory,
          repoHost: normalizedRepo.host || '',
          repoProjectPath: normalizedRepo.projectPath || '',
          repoLocalPath: normalizedRepo.localPath || '',
          repoUrl: normalizedRepo.repoUrl || buildRepoUrl(normalizedRepo),
          repoMarketplace: marketplace,
          source: sourceUrl
        };

        // Register in CTX legacy registry (for listPlugins fallback)
        const { addPlugin } = require('../../plugins/registry');
        try {
          addPlugin(installedPluginName, {
            version: manifest.version || '1.0.0',
            enabled: true,
            installedAt: installTimestamp,
            source: sourceUrl
          });
        } catch (e) {
          console.warn('[PluginsService] Legacy registry addPlugin warning:', e.message);
        }

        this.writeRepoSourceMeta(pluginDir, repoSourceMeta);
        this._upsertClaudeMarketplacePlugin(marketplace, pluginDir, {
          name: installedPluginName,
          description: manifest.description || '',
          category: manifest.category || ''
        });

        // Also register in Claude's native installed_plugins.json
        try {
          this._registerClaudeInstalledPlugin(installedPluginName, marketplace, pluginDir, {
            version: manifest.version || '1.0.0',
            installedAt: installTimestamp,
            scope: 'user',
            source: sourceUrl,
            repoSourceMeta
          });
        } catch (e) {
          console.error('[PluginsService] Failed to update native installed_plugins.json:', e.message);
        }
      } else if (!this._isOpenCode()) {
        const installTimestamp = new Date().toISOString();
        const sourceUrl = this.buildRepoBrowserUrl(normalizedRepo, directory) || buildRepoUrl(normalizedRepo);
        const repoSourceMeta = {
          repoId: normalizedRepo.id,
          repoProvider: normalizedRepo.provider,
          repoOwner: normalizedRepo.owner || '',
          repoName: normalizedRepo.name || '',
          repoBranch: normalizedRepo.branch,
          repoDirectory: directory,
          repoHost: normalizedRepo.host || '',
          repoProjectPath: normalizedRepo.projectPath || '',
          repoLocalPath: normalizedRepo.localPath || '',
          repoUrl: normalizedRepo.repoUrl || buildRepoUrl(normalizedRepo),
          source: sourceUrl
        };

        const { addPlugin } = require('../../plugins/registry');
        try {
          addPlugin(installedPluginName, {
            version: manifest.version || '1.0.0',
            enabled: true,
            installedAt: installTimestamp,
            source: sourceUrl
          });
        } catch (e) {
          console.warn('[PluginsService] Legacy registry addPlugin warning:', e.message);
        }

        this.writeRepoSourceMeta(pluginDir, repoSourceMeta);
      }

      return {
        success: true,
        plugin: {
          name: manifest.name || pluginName,
          version: manifest.version || '1.0.0',
          description: manifest.description || ''
        }
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to install plugin: ${err.message}`
      };
    }
  }

  _getManifestCandidates() {
    if (this._isCodex()) {
      return ['.codex-plugin/plugin.json', 'plugin.json', 'package.json'];
    }
    if (this._isOpenCode()) {
      return ['package.json', 'plugin.json'];
    }
    return ['.claude-plugin/plugin.json', 'plugin.json', 'package.json'];
  }

  _resolvePluginInstallRoot(normalizedRepo, repoInfo, manifest, options = {}) {
    if (!this._isCodex()) {
      if (this.platform === 'claude') {
        const marketplace = this._resolveClaudeMarketplaceName(normalizedRepo, repoInfo.marketplace);
        const pluginName = manifest.name || normalizeRepoPath(repoInfo.directory || '').split('/').pop() || 'plugin';
        const version = manifest.version || repoInfo.version || 'local';
        return this._resolveClaudePluginCachePath(marketplace, pluginName, version);
      }
      return options.installRoot || INSTALLED_DIR;
    }

    const marketplace = normalizePluginCacheSegment(
      this._resolveCodexMarketplaceName(normalizedRepo, repoInfo.marketplace),
      'Codex marketplace',
      'local'
    );
    const pluginName = normalizePluginCacheSegment(
      manifest.name || normalizeRepoPath(repoInfo.directory || '').split('/').pop() || 'plugin',
      'Codex plugin name',
      'plugin'
    );
    const version = normalizePluginCacheSegment(
      String(manifest.version || repoInfo.version || 'local').trim() || 'local',
      'Codex plugin version',
      'local'
    );
    return resolveInsideRoot(
      this.codexPluginsCacheDir,
      path.posix.join(marketplace, pluginName, version),
      'Codex plugin cache path'
    );
  }

  /**
   * Parse GitHub/GitLab tree URL or local path
   * @private
   */
  parseRepoTreeSource(source = '') {
    const value = String(source || '').trim();
    if (!value) return null;

    if (isLikelyLocalPath(value)) {
      return {
        provider: 'local',
        localPath: value,
        directory: ''
      };
    }

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }

    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/').filter(Boolean);
    if (parsed.hostname.includes('github')) {
      if (parts.length < 4 || parts[2] !== 'tree') return null;
      return {
        provider: 'github',
        host: `${parsed.protocol}//${parsed.host}`,
        owner: parts[0],
        name: parts[1],
        branch: parts[3],
        directory: parts.slice(4).join('/')
      };
    }

    const treeIndex = parts.findIndex((part, index) => part === '-' && parts[index + 1] === 'tree');
    if (treeIndex < 0 || !parts[treeIndex + 2]) return null;
    return {
      provider: 'gitlab',
      host: `${parsed.protocol}//${parsed.host}`,
      projectPath: parts.slice(0, treeIndex).join('/'),
      branch: parts[treeIndex + 2],
      directory: parts.slice(treeIndex + 3).join('/')
    };
  }

  /**
   * Uninstall plugin
   * @param {string} name - Plugin name
   * @returns {Object} Uninstallation result
   */
  uninstallPlugin(name) {
    if (this._isCodex()) {
      const plugins = this.listPlugins().plugins;
      const target = plugins.find(plugin => plugin.name === name || `${plugin.name}@${plugin.marketplace}` === name);
      if (!target) {
        return {
          success: false,
          error: `Plugin "${name}" not found`
        };
      }

      const pluginRoot = target.installPath
        ? assertInsideAllowedRoots(
          path.dirname(assertInsideAllowedRoots(target.installPath, [this.codexPluginsCacheDir], 'Codex plugin install path')),
          [this.codexPluginsCacheDir],
          'Codex plugin root'
        )
        : resolveInsideRoot(
          this.codexPluginsCacheDir,
          path.posix.join(
            normalizePluginCacheSegment(target.marketplace || '', 'Codex marketplace', 'local'),
            normalizePluginCacheSegment(target.name || name, 'Codex plugin name', 'plugin')
          ),
          'Codex plugin root'
        );
      if (pluginRoot && fs.existsSync(pluginRoot)) {
        fs.rmSync(pluginRoot, { recursive: true, force: true });
      }
      this._unregisterCodexPlugin(target.name, target.marketplace || '');

      return {
        success: true,
        message: 'Plugin uninstalled successfully'
      };
    }

    if (!this._pluginsSupported()) {
      return {
        success: false,
        error: `${this.platform} plugin management is not supported`
      };
    }

    if (this._isOpenCode()) {
      const safeName = normalizePluginPathName(name, 'plugin name');
      const pluginsDir = this._getOpenCodePluginsDir();
      let removed = false;

      // Remove from opencode config.plugin (npm plugins)
      const configured = this._listOpenCodeConfiguredPlugins();
      const next = configured.filter(p => p !== safeName);
      if (next.length !== configured.length) {
        this._setOpenCodeConfiguredPlugins(next);
        removed = true;
      }

      // Remove local plugin directory/file
      if (fs.existsSync(pluginsDir)) {
        const directPath = resolveInsideRoot(pluginsDir, safeName, 'OpenCode plugin path');
        if (fs.existsSync(directPath)) {
          fs.rmSync(directPath, { recursive: true, force: true });
          removed = true;
        } else {
          const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
          for (const entry of entries) {
            const baseName = entry.name.replace(path.extname(entry.name), '');
            if (entry.name === safeName || baseName === safeName) {
              const entryPath = resolveInsideRoot(pluginsDir, entry.name, 'OpenCode plugin path');
              fs.rmSync(entryPath, { recursive: true, force: true });
              removed = true;
              break;
            }
          }
        }
      }

      return {
        success: true,
        message: removed ? 'Plugin removed successfully' : 'Plugin not found'
      };
    }

    // Claude: Remove from native installed_plugins.json and delete install directories
    let removed = false;
    const safeName = normalizePluginPathName(name, 'plugin name');
    if (fs.existsSync(CLAUDE_INSTALLED_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(CLAUDE_INSTALLED_FILE, 'utf8'));
        if (data.plugins) {
          const keysToDelete = [];
          const baseName = safeName.split('/').pop(); // handle "plugins/pr-review-toolkit" → "pr-review-toolkit"
          for (const [key, installations] of Object.entries(data.plugins)) {
            const { name: pluginName } = splitPluginMarketplaceKey(key);
            if (pluginName === safeName || key === safeName || pluginName === baseName) {
              keysToDelete.push(key);
              // Delete install directories
              if (Array.isArray(installations)) {
                for (const install of installations) {
                  if (install.installPath && fs.existsSync(install.installPath)) {
                    try {
                      const installPath = assertInsideAllowedRoots(
                        install.installPath,
                        [INSTALLED_DIR, CLAUDE_PLUGINS_DIR],
                        'Claude plugin install path'
                      );
                      fs.rmSync(installPath, { recursive: true, force: true });
                    } catch (e) {
                      console.error('[PluginsService] Failed to delete install dir:', e.message);
                    }
                  }
                }
              }
            }
          }
          if (keysToDelete.length > 0) {
            for (const key of keysToDelete) {
              const parsed = splitPluginMarketplaceKey(key);
              this._removeClaudePluginEnabled(parsed.name || safeName, parsed.marketplace || '');
              delete data.plugins[key];
            }
            fs.writeFileSync(CLAUDE_INSTALLED_FILE, JSON.stringify(data, null, 2), 'utf8');
            removed = true;
          }
        }
      } catch (err) {
        console.error('[PluginsService] Failed to update installed_plugins.json:', err.message);
      }
    }

    // Also try legacy registry removal
    try {
      const legacyResult = uninstallPluginCore(name);
      if (legacyResult.success) removed = true;
    } catch (err) {
      // Ignore legacy registry errors
    }

    if (!removed) {
      return {
        success: false,
        error: `Plugin "${name}" not found`
      };
    }

    return {
      success: true,
      message: 'Plugin uninstalled successfully'
    };
  }

  /**
   * Toggle plugin enabled/disabled
   * @param {string} name - Plugin name
   * @param {boolean} enabled - Enable or disable
   * @returns {Object} Updated plugin info
   */
  togglePlugin(name, enabled) {
    if (this._isCodex()) {
      const plugins = this.listPlugins().plugins;
      const target = plugins.find(plugin => plugin.name === name || `${plugin.name}@${plugin.marketplace}` === name);
      if (!target) {
        throw new Error(`Plugin "${name}" not found`);
      }
      this._setCodexPluginEnabled(target.name, target.marketplace || '', enabled);
      return {
        name: target.name,
        enabled,
        success: true
      };
    }

    if (!this._pluginsSupported()) {
      throw new Error(`${this.platform} plugin management is not supported`);
    }

    if (this._isOpenCode()) {
      const configured = this._listOpenCodeConfiguredPlugins();
      const exists = configured.includes(name);
      if (enabled && !exists) {
        configured.push(name);
        this._setOpenCodeConfiguredPlugins(configured);
      } else if (!enabled && exists) {
        this._setOpenCodeConfiguredPlugins(configured.filter(p => p !== name));
      }

      return {
        name,
        enabled
      };
    }

    // Claude: store enabled state in CTX registry
    // First check if plugin exists in native installed_plugins.json
    let pluginExists = false;
    const baseName = name.split('/').pop();
    if (fs.existsSync(CLAUDE_INSTALLED_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(CLAUDE_INSTALLED_FILE, 'utf8'));
        if (data.plugins) {
          for (const key of Object.keys(data.plugins)) {
            const { name: pluginName } = splitPluginMarketplaceKey(key);
            if (pluginName === name || key === name || pluginName === baseName) {
              pluginExists = true;
              break;
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    // Also check legacy registry
    const legacyPlugin = getPlugin(name);
    if (legacyPlugin) pluginExists = true;

    if (!pluginExists) {
      throw new Error(`Plugin "${name}" not found`);
    }

    // Store enabled state in CTX registry (upsert)
    let matchedMarketplace = '';
    try {
      const { addPlugin } = require('../../plugins/registry');
      if (legacyPlugin) {
        updatePluginRegistry(name, { enabled });
      } else {
        addPlugin(name, { version: '1.0.0', enabled, source: 'claude-native' });
      }
    } catch (e) {
      console.warn('[PluginsService] Failed to update plugin registry:', e.message);
    }
    if (fs.existsSync(CLAUDE_INSTALLED_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(CLAUDE_INSTALLED_FILE, 'utf8'));
        for (const key of Object.keys(data.plugins || {})) {
          const parsed = splitPluginMarketplaceKey(key);
          if (parsed.name === name || key === name || parsed.name === baseName) {
            matchedMarketplace = parsed.marketplace || '';
            break;
          }
        }
      } catch {
        // ignore
      }
    }
    this._setClaudePluginEnabled(baseName || name, matchedMarketplace, enabled);

    return {
      name,
      enabled,
      success: true
    };
  }

  /**
   * Update plugin config
   * @param {string} name - Plugin name
   * @param {Object} config - Configuration object
   * @returns {Object} Result
   */
  updatePluginConfig(name, config) {
    if (this._isCodex()) {
      throw new Error('Codex cached plugins do not support config updates');
    }

    if (!this._pluginsSupported()) {
      throw new Error(`${this.platform} plugin management is not supported`);
    }

    if (this._isOpenCode()) {
      const configDir = path.join(OPENCODE_CONFIG_DIR, 'plugins-config');
      const configFile = resolvePluginConfigFile(configDir, name);
      this._ensureDir(path.dirname(configFile));
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
      return {
        success: true,
        message: `Configuration updated for plugin "${name}"`
      };
    }

    const plugin = getPlugin(name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" not found`);
    }

    const configFile = resolvePluginConfigFile(CONFIG_DIR, name);

    // Ensure config directory exists
    if (!fs.existsSync(path.dirname(configFile))) {
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
    }

    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');

    return {
      success: true,
      message: `Configuration updated for plugin "${name}"`
    };
  }

  /**
   * Get plugin repositories config file path
   * @returns {string} Config file path
   */
  getReposConfigPath() {
    const filePath = PATHS.pluginRepos[this.platform] || PATHS.pluginRepos.claude;
    this._ensureDir(path.dirname(filePath));
    return filePath;
  }

  _getDefaultRepos() {
    return cloneRepos(DEFAULT_REPOS_BY_PLATFORM[this.platform] || DEFAULT_REPOS_BY_PLATFORM.claude);
  }

  /**
   * Load repos from config file
   * @returns {Object} Config object with repos array
   */
  loadReposConfig() {
    const configPath = this.getReposConfigPath();
    const defaultRepos = this._getDefaultRepos();
    if (!fs.existsSync(configPath)) {
      return { repos: this.normalizeRepos(defaultRepos) };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (parsed && Array.isArray(parsed.repos)) {
        return { ...parsed, repos: this.normalizeRepos(parsed.repos) };
      }
      return { repos: this.normalizeRepos(defaultRepos) };
    } catch (err) {
      console.error('Failed to load repos config:', err);
      return { repos: this.normalizeRepos(defaultRepos) };
    }
  }

  /**
   * Save repos to config file
   * @param {Object} config - Config object with repos array
   */
  saveReposConfig(config) {
    const configPath = this.getReposConfigPath();
    const normalizedRepos = this.normalizeRepos(config?.repos || []);
    fs.writeFileSync(configPath, JSON.stringify({ ...(config || {}), repos: normalizedRepos }, null, 2), 'utf8');
  }

  /**
   * Get plugin repositories
   * Reads from both our config and Claude Code's native marketplace config
   * @returns {Array} Repos list
   */
  getRepos() {
    if (!this.getCapabilities().repositories) {
      return [];
    }

    const repos = [];
    const seenRepos = new Set();
    const pushRepo = (repo) => {
      if (!repo) return;
      let normalizedRepo;
      try {
        normalizedRepo = this.normalizeRepoConfig(repo);
      } catch {
        return;
      }
      const key = normalizedRepo.id;
      if (seenRepos.has(key)) return;
      repos.push(normalizedRepo);
      seenRepos.add(key);
    };
    const parseRepoUrl = (url) => {
      if (!url || typeof url !== 'string') return null;
      const match = url.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
      if (!match) return null;
      return { owner: match[1], name: match[2], url };
    };

    // 1. Load our own config
    const config = this.loadReposConfig();
    for (const repo of config.repos || []) {
      pushRepo(repo);
    }

    // 2. Load Claude Code's native marketplace config (Claude only)
    if (this.platform === 'claude' && fs.existsSync(CLAUDE_MARKETPLACES_FILE)) {
      try {
        const marketplaces = JSON.parse(fs.readFileSync(CLAUDE_MARKETPLACES_FILE, 'utf8'));
        const entries = [];
        if (Array.isArray(marketplaces)) {
          entries.push(...marketplaces.map(item => ({ key: '', data: item })));
        } else if (marketplaces && typeof marketplaces === 'object') {
          entries.push(...Object.entries(marketplaces).map(([key, data]) => ({ key, data })));
          if (Array.isArray(marketplaces.marketplaces)) {
            entries.push(...marketplaces.marketplaces.map(item => ({ key: item?.name || '', data: item })));
          }
        }

        for (const { key, data } of entries) {
          const sourceUrl = data?.source?.url || data?.url || data?.repoUrl || data?.repository;
          const parsed = parseRepoUrl(sourceUrl);
          if (!parsed) continue;
          pushRepo({
            provider: 'github',
            owner: parsed.owner,
            name: parsed.name,
            repoUrl: parsed.url,
            branch: data?.source?.branch || data?.branch || 'main',
            enabled: data?.enabled !== false,
            source: 'claude-native',
            marketplace: key || data?.name || '',
            lastUpdated: data?.lastUpdated
          });
        }
      } catch (err) {
        console.error('[PluginsService] Failed to read known_marketplaces.json:', err.message);
      }
    }

    return repos;
  }

  /**
   * Add repository
   * @param {Object} repo - Repository info { url, owner, name, branch, enabled }
   * @returns {Array} Updated repos list
   */
  addRepo(repo) {
    const config = this.loadReposConfig();
    const normalizedRepo = this.normalizeRepoConfig({
      ...repo,
      addedAt: repo.addedAt || new Date().toISOString()
    });
    const existingIndex = config.repos.findIndex(r => r.id === normalizedRepo.id);

    if (existingIndex >= 0) {
      config.repos[existingIndex] = normalizedRepo;
    } else {
      config.repos.push(normalizedRepo);
    }

    this.saveReposConfig(config);
    this.clearMarketCache();

    return this.getRepos();
  }

  /**
   * Remove repository
   * @param {string} owner - Repository owner
   * @param {string} name - Repository name
   * @returns {Array} Updated repos list
   */
  removeRepo(owner, name, repoId = '') {
    const config = this.loadReposConfig();
    config.repos = config.repos.filter(r => {
      if (repoId) {
        return r.id !== repoId;
      }
      return !(r.owner === owner && r.name === name);
    });
    this.saveReposConfig(config);
    this.clearMarketCache();
    return this.getRepos();
  }

  /**
   * Toggle repository enabled status
   * @param {string} owner - Repository owner
   * @param {string} name - Repository name
   * @param {boolean} enabled - Enable or disable
   * @returns {Array} Updated repos list
   */
  toggleRepo(owner, name, enabled, repoId = '') {
    const config = this.loadReposConfig();
    const repo = config.repos.find(r => {
      if (repoId) return r.id === repoId;
      return r.owner === owner && r.name === name;
    });
    if (!repo) {
      throw new Error('Repository not found');
    }
    repo.enabled = enabled;
    this.saveReposConfig(config);
    this.clearMarketCache();
    return this.getRepos();
  }

  updateRepoAuth(owner, name, token = '', clearToken = false, repoId = '') {
    const config = this.loadReposConfig();
    const repo = config.repos.find(r => {
      if (repoId) return r.id === repoId;
      return r.owner === owner && r.name === name;
    });

    if (!repo) {
      throw new Error('Repository not found');
    }

    if (repo.provider === 'local') {
      throw new Error('Local repository does not support token auth');
    }

    if (clearToken) {
      delete repo.token;
    } else {
      const normalizedToken = normalizeRepoToken(token);
      if (!normalizedToken) {
        throw new Error('Missing token');
      }
      repo.token = normalizedToken;
    }

    this.saveReposConfig(config);
    this.clearMarketCache();
    return this.getRepos();
  }

  getTokenFromConfigFile(fileName) {
    try {
      const configPath = path.join(this.configDir, fileName);
      if (fs.existsSync(configPath)) {
        return fs.readFileSync(configPath, 'utf-8').trim() || null;
      }
    } catch {
      // ignore
    }
    return null;
  }

  getTokenFromCommand(command, args = []) {
    try {
      const output = execFileSync(command, args, {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      }).trim();
      return output || null;
    } catch {
      return null;
    }
  }

  getTokenFromGitCredential(host) {
    const hostname = extractHostname(host);
    if (!hostname) return null;

    try {
      const output = execFileSync('git', ['credential', 'fill'], {
        input: `protocol=https\nhost=${hostname}\n\n`,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      });
      const passwordLine = output
        .split(/\r?\n/)
        .find(line => line.startsWith('password='));
      if (!passwordLine) return null;
      return passwordLine.slice('password='.length).trim() || null;
    } catch {
      return null;
    }
  }

  getGitHubToken(repoOrHost = DEFAULT_GITHUB_HOST) {
    if (repoOrHost && typeof repoOrHost === 'object') {
      const repoToken = this.resolveRepoToken(repoOrHost);
      if (repoToken) {
        return repoToken;
      }
    }

    const host = typeof repoOrHost === 'string'
      ? repoOrHost
      : (repoOrHost?.host || DEFAULT_GITHUB_HOST);

    if (process.env.GITHUB_TOKEN) {
      return process.env.GITHUB_TOKEN;
    }

    const configToken = this.getTokenFromConfigFile('github-token.txt');
    if (configToken) {
      return configToken;
    }

    const hostname = extractHostname(host);
    if (hostname) {
      const ghHostToken = this.getTokenFromCommand('gh', ['auth', 'token', '--hostname', hostname]);
      if (ghHostToken) {
        return ghHostToken;
      }
    }

    const ghToken = this.getTokenFromCommand('gh', ['auth', 'token']);
    if (ghToken) {
      return ghToken;
    }

    return this.getTokenFromGitCredential(host);
  }

  getGitLabToken(repoOrHost = DEFAULT_GITLAB_HOST) {
    if (repoOrHost && typeof repoOrHost === 'object') {
      const repoToken = this.resolveRepoToken(repoOrHost);
      if (repoToken) {
        return repoToken;
      }
    }

    const host = typeof repoOrHost === 'string'
      ? repoOrHost
      : (repoOrHost?.host || DEFAULT_GITLAB_HOST);

    if (process.env.GITLAB_TOKEN) {
      return process.env.GITLAB_TOKEN;
    }
    if (process.env.GITLAB_PRIVATE_TOKEN) {
      return process.env.GITLAB_PRIVATE_TOKEN;
    }

    const configToken = this.getTokenFromConfigFile('gitlab-token.txt');
    if (configToken) {
      return configToken;
    }

    const hostname = extractHostname(host);
    if (hostname) {
      const glabHostToken = this.getTokenFromCommand('glab', ['auth', 'token', '--hostname', hostname]);
      if (glabHostToken) {
        return glabHostToken;
      }
    }

    const glabToken = this.getTokenFromCommand('glab', ['auth', 'token']);
    if (glabToken) {
      return glabToken;
    }

    return this.getTokenFromGitCredential(host);
  }

  async fetchGitHubApi(url, repo = null) {
    const token = this.getGitHubToken(repo || url);
    const headers = {
      'User-Agent': 'coding-tool-x',
      'Accept': 'application/vnd.github.v3+json'
    };
    if (token) {
      headers.Authorization = `token ${token}`;
    }

    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers,
        timeout: 15000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error('Invalid JSON response'));
            }
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  async fetchGitLabApi(url, { raw = false, repo = null } = {}) {
    const token = this.getGitLabToken(repo || url);
    const headers = {
      'User-Agent': 'coding-tool-x'
    };
    if (!raw) {
      headers.Accept = 'application/json';
    }
    if (token) {
      headers['PRIVATE-TOKEN'] = token;
    }

    return new Promise((resolve, reject) => {
      const transport = url.startsWith('http:') ? http : https;
      const req = transport.get(url, {
        headers,
        timeout: 15000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            if (raw) {
              resolve(data);
              return;
            }
            try {
              resolve({
                data: JSON.parse(data),
                headers: res.headers
              });
            } catch {
              reject(new Error('Invalid JSON response'));
            }
          } else {
            reject(new Error(`GitLab API error: ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  async fetchGitHubRepoTree(repo) {
    const treeUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${repo.branch}?recursive=1`;
    const tree = await this.fetchGitHubApi(treeUrl, repo);
    return tree?.tree || [];
  }

  async fetchGitLabTree(repo) {
    const tree = [];
    const projectId = encodeURIComponent(repo.projectPath);
    let page = 1;

    while (page) {
      const url = `${repo.host}/api/v4/projects/${projectId}/repository/tree?ref=${encodeURIComponent(repo.branch)}&recursive=true&per_page=100&page=${page}`;
      const response = await this.fetchGitLabApi(url, { repo });
      tree.push(...(response.data || []).map(item => ({
        ...item,
        path: normalizeRepoPath(item.path),
        type: item.type === 'tree' ? 'tree' : 'blob'
      })));
      const nextPage = Number(response.headers['x-next-page'] || 0);
      page = Number.isFinite(nextPage) && nextPage > 0 ? nextPage : 0;
    }

    return tree;
  }

  scanLocalRepoTree(currentDir, repoRoot, tree) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = normalizeRepoPath(path.relative(repoRoot, fullPath));
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        tree.push({ path: relativePath, type: 'tree', name: entry.name });
        this.scanLocalRepoTree(fullPath, repoRoot, tree);
      } else {
        tree.push({ path: relativePath, type: 'blob', name: entry.name });
      }
    }
  }

  async fetchLocalRepoTree(repo) {
    const tree = [];
    if (!fs.existsSync(repo.localPath)) {
      throw new Error(`Local repo path not found: ${repo.localPath}`);
    }
    this.scanLocalRepoTree(repo.localPath, repo.localPath, tree);
    return tree;
  }

  async fetchRepoTree(repo) {
    if (repo.provider === 'local') {
      return this.fetchLocalRepoTree(repo);
    }
    if (repo.provider === 'gitlab') {
      return this.fetchGitLabTree(repo);
    }
    return this.fetchGitHubRepoTree(repo);
  }

  async fetchGitHubFileContent(repo, filePath, file = null) {
    if (file?.sha) {
      const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/blobs/${file.sha}`;
      const data = await this.fetchGitHubApi(url, repo);
      if (!data || typeof data.content !== 'string') {
        throw new Error('Invalid GitHub blob response');
      }
      return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    }

    const normalizedPath = normalizeRepoPath(filePath);
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${normalizedPath}?ref=${encodeURIComponent(repo.branch)}`;
    const data = await this.fetchGitHubApi(url, repo);
    if (typeof data.content !== 'string') {
      throw new Error('Invalid GitHub contents response');
    }
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
  }

  async fetchGitLabFileContent(repo, filePath) {
    const projectId = encodeURIComponent(repo.projectPath);
    const normalizedFilePath = encodeURIComponent(normalizeRepoPath(filePath));
    const url = `${repo.host}/api/v4/projects/${projectId}/repository/files/${normalizedFilePath}/raw?ref=${encodeURIComponent(repo.branch)}`;
    return this.fetchGitLabApi(url, { raw: true, repo });
  }

  async fetchRepoFileContent(repo, filePath, file = null) {
    if (repo.provider === 'local') {
      const safeFilePath = normalizePluginRepoDirectory(filePath, 'plugin repository file path');
      if (!safeFilePath) {
        throw new Error('Invalid plugin repository file path');
      }
      const localFilePath = resolveInsideRoot(repo.localPath, safeFilePath, 'Plugin repository file path', { allowHiddenSegments: true });
      return fs.readFileSync(localFilePath, 'utf-8');
    }
    if (repo.provider === 'gitlab') {
      return this.fetchGitLabFileContent(repo, filePath);
    }
    return this.fetchGitHubFileContent(repo, filePath, file);
  }

  async fetchRepoJson(repo, filePath, file = null) {
    const content = await this.fetchRepoFileContent(repo, filePath, file);
    return JSON.parse(stripJsonComments(content));
  }

  buildRepoBrowserUrl(repo, filePath = '') {
    const normalizedPath = normalizeRepoPath(filePath);
    if (repo.provider === 'local') {
      return null;
    }
    if (repo.provider === 'gitlab') {
      const suffix = normalizedPath ? `/-/tree/${repo.branch}/${normalizedPath}` : `/-/tree/${repo.branch}`;
      return `${repo.host}/${repo.projectPath}${suffix}`;
    }
    const suffix = normalizedPath ? `tree/${repo.branch}/${normalizedPath}` : `tree/${repo.branch}`;
    return `${repo.host}/${repo.owner}/${repo.name}/${suffix}`;
  }

  writeRepoSourceMeta(pluginDir, metadata = {}) {
    try {
      fs.writeFileSync(
        path.join(pluginDir, REPO_SOURCE_META_FILE),
        JSON.stringify(metadata, null, 2),
        'utf8'
      );
    } catch {
      // ignore
    }
  }

  readRepoSourceMeta(pluginDir) {
    try {
      const metaPath = path.join(pluginDir, REPO_SOURCE_META_FILE);
      if (!fs.existsSync(metaPath)) return null;
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {
      return null;
    }
  }

  copyDirRecursive(sourceDir, destDir, options = {}) {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (options.excludeNames?.includes(entry.name)) continue;
      const sourcePath = path.join(sourceDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
        this.copyDirRecursive(sourcePath, destPath, options);
      } else {
        fs.copyFileSync(sourcePath, destPath);
      }
    }
  }

  downloadFile(url, destination, headers = {}) {
    return new Promise((resolve, reject) => {
      const transport = url.startsWith('http:') ? http : https;
      const file = fs.createWriteStream(destination);

      const req = transport.get(url, {
        headers: {
          'User-Agent': 'coding-tool-x',
          ...headers
        },
        timeout: 30000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close(() => {
            fs.unlink(destination, () => {
              this.downloadFile(res.headers.location, destination, headers).then(resolve).catch(reject);
            });
          });
          return;
        }

        if (res.statusCode !== 200) {
          file.close(() => {
            fs.unlink(destination, () => reject(new Error(`HTTP ${res.statusCode}`)));
          });
          return;
        }

        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      });

      req.on('error', (err) => {
        file.close(() => {
          fs.unlink(destination, () => reject(err));
        });
      });

      req.on('timeout', () => {
        req.destroy();
        file.close(() => {
          fs.unlink(destination, () => reject(new Error('Request timeout')));
        });
      });
    });
  }

  /**
   * Sync repositories to Claude Code marketplace
   * @returns {Promise<Object>} Sync results
   */
  async syncRepos() {
    if (!this.getCapabilities().syncRepos) {
      return { success: true, results: [] };
    }

    const repos = this.getRepos();
    const results = [];
    const { execSync } = require('child_process');

    for (const repo of repos.filter(r => r.enabled)) {
      const repoRef = repo.repoUrl || repo.url || buildRepoUrl(repo);
      if (!repoRef || repo.provider === 'local') {
        results.push({ repo: repoRef || repo.id, success: false, error: 'Local repository sync is not supported by Claude marketplace' });
        continue;
      }
      try {
        execSync(`claude plugin marketplace add ${repoRef}`, {
          encoding: 'utf8',
          timeout: 30000,
          stdio: 'pipe',
          windowsHide: true
        });
        results.push({ repo: repoRef, success: true });
      } catch (err) {
        results.push({ repo: repoRef, success: false, error: err.message });
      }
    }

    return { success: true, results };
  }

  /**
   * Sync plugins from Claude Code
   * @returns {Promise<Object>} Updated plugins list
   */
  async syncPlugins() {
    return this.listPlugins();
  }

  /**
   * Get plugin README content
   * @param {Object} plugin - Plugin object with name, repoUrl, source, or repoInfo
   * @returns {Promise<string>} README content or empty string
   */
  async getPluginReadme(plugin) {
    try {
      const normalizedDirectory = normalizeRepoPath(plugin.directory || '');
      const readmeCandidates = [];
      const pushReadmeCandidates = (directory = '') => {
        const base = normalizeRepoPath(directory);
        if (base) {
          readmeCandidates.push(`${base}/README.md`, `${base}/readme.md`);
        } else {
          readmeCandidates.push('README.md', 'readme.md');
        }
      };

      if (normalizedDirectory) {
        pushReadmeCandidates(normalizedDirectory);
      }
      pushReadmeCandidates('');

      if (plugin.installPath && fs.existsSync(plugin.installPath)) {
        const localCandidates = normalizedDirectory
          ? [path.join(plugin.installPath, 'README.md'), path.join(plugin.installPath, 'readme.md')]
          : readmeCandidates.map(candidate => path.join(plugin.installPath, candidate));
        for (const candidatePath of localCandidates) {
          if (fs.existsSync(candidatePath)) {
            return fs.readFileSync(candidatePath, 'utf8');
          }
        }
      }

      let repo = null;
      if (plugin.repoProvider || plugin.repoLocalPath || plugin.repoProjectPath || plugin.repoOwner) {
        try {
          repo = this.normalizeRepoConfig({
            id: plugin.repoId,
            provider: plugin.repoProvider,
            host: plugin.repoHost,
            owner: plugin.repoOwner,
            name: plugin.repoName,
            branch: plugin.repoBranch || 'main',
            projectPath: plugin.repoProjectPath,
            localPath: plugin.repoLocalPath,
            repoUrl: plugin.repoUrl
          });
        } catch {
          repo = null;
        }
      } else if (plugin.source) {
        repo = this.parseRepoTreeSource(plugin.source);
      }

      if (!repo && plugin.repoUrl) {
        const parsedTreeSource = this.parseRepoTreeSource(plugin.repoUrl);
        if (parsedTreeSource) {
          repo = parsedTreeSource;
        } else if (plugin.repoUrl.includes('github.com')) {
          const match = plugin.repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
          if (match) {
            repo = this.normalizeRepoConfig({
              provider: 'github',
              owner: match[1],
              name: match[2],
              branch: plugin.repoBranch || 'main'
            });
          }
        }
      }

      if (!repo) return '';

      for (const candidate of readmeCandidates) {
        try {
          return await this.fetchRepoFileContent(repo, candidate);
        } catch {
          // try next candidate
        }
      }

      return '';
    } catch (err) {
      console.error('[PluginsService] Failed to fetch README:', err.message);
      return '';
    }
  }

  _parseGitHubRepo(url = '') {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/#?]+)/i);
    if (!match) return null;
    return {
      owner: match[1],
      name: match[2].replace(/\.git$/, '')
    };
  }

  buildMarketPluginItem(repo, data = {}) {
    const itemRepo = data.repo || repo;
    const directory = Object.prototype.hasOwnProperty.call(data, 'directory')
      ? data.directory
      : data.name;
    return {
      name: data.name,
      displayName: data.displayName || '',
      description: data.description || '',
      author: data.author || itemRepo.owner || itemRepo.projectPath || 'unknown',
      version: data.version || '1.0.0',
      category: data.category || 'general',
      marketplace: data.marketplace || repo.marketplace || '',
      repoUrl: data.repoUrl || itemRepo.repoUrl || buildRepoUrl(itemRepo),
      repoProvider: itemRepo.provider,
      repoOwner: itemRepo.owner || '',
      repoName: itemRepo.name || '',
      repoBranch: itemRepo.branch || 'main',
      repoHost: itemRepo.host || '',
      repoProjectPath: itemRepo.projectPath || '',
      repoLocalPath: itemRepo.localPath || '',
      repoId: itemRepo.id,
      directory: normalizeRepoPath(directory || ''),
      installSource: data.installSource || '',
      marketplaceFormat: data.marketplaceFormat || '',
      readmeUrl: this.buildRepoBrowserUrl(itemRepo, directory || ''),
      lspServers: data.lspServers || null,
      commands: data.commands || [],
      hooks: data.hooks || [],
      isInstalled: false
    };
  }

  async _fetchOpenCodeMarketplacePlugins(repo, branch) {
    if (!this._isOpenCode()) return [];

    const tree = await this.fetchRepoTree(repo);
    const manifestFiles = tree.filter(item =>
      item.type === 'blob' &&
      item.path.startsWith('plugins/') &&
      item.path.endsWith('.plugin.json')
    );
    if (manifestFiles.length === 0) return [];

    const results = await Promise.allSettled(
      manifestFiles.map(async (file) => {
        const manifest = await this.fetchRepoJson(repo, file.path, file);

        const author = Array.isArray(manifest.authors)
          ? manifest.authors.map(item => item?.name).filter(Boolean).join(', ')
          : '';
        const firstCategory = Array.isArray(manifest.categories) ? manifest.categories[0] : '';
        const repoUrl = manifest.links?.repository || `https://github.com/${repo.owner}/${repo.name}`;
        // OpenCode supports npm package plugins via opencode.json "plugin" array.
        // Use package name as install source so UI install button is enabled.
        const installSource = String(manifest.name || '').trim();
        const githubRepo = this._parseGitHubRepo(repoUrl);

        return this.buildMarketPluginItem(repo, {
          name: manifest.name || file.name.replace(/\.plugin\.json$/, ''),
          displayName: manifest.displayName || '',
          description: manifest.description || '',
          author: author || repo.owner,
          version: manifest.version || manifest.opencode?.minimumVersion || '1.0.0',
          category: firstCategory ? String(firstCategory).toLowerCase() : 'general',
          directory: file.path,
          installSource,
          marketplaceFormat: 'opencode-plugin-json',
          repoUrl
        });
      })
    );

    return results
      .filter(item => item.status === 'fulfilled' && item.value)
      .map(item => item.value);
  }

  _repoFromMarketplaceSource(parentRepo, source) {
    if (!source) return { repo: parentRepo, directory: '', installSource: '' };

    if (typeof source === 'string') {
      const raw = source.trim();
      if (!raw) return { repo: parentRepo, directory: '', installSource: '' };
      if (isLikelyLocalPath(raw) || raw.startsWith('.')) {
        return {
          repo: parentRepo,
          directory: normalizeRepoPath(raw.replace(/^\.\//, '')),
          installSource: ''
        };
      }
      const parsedTree = this.parseRepoTreeSource(raw);
      if (parsedTree) {
        return { repo: this.normalizeRepoConfig(parsedTree), directory: parsedTree.directory, installSource: raw };
      }
      const parsedRepo = this._repoFromGitUrl(raw, parentRepo.branch || 'main');
      if (parsedRepo) {
        return { repo: parsedRepo, directory: '', installSource: raw };
      }
      return { repo: parentRepo, directory: normalizeRepoPath(raw.replace(/^\.\//, '')), installSource: raw };
    }

    if (typeof source !== 'object') {
      return { repo: parentRepo, directory: '', installSource: '' };
    }

    const sourceType = source.source || source.type || '';
    const rawPath = source.path || source.directory || '';
    if (sourceType === 'local' || (!source.url && rawPath)) {
      return {
        repo: parentRepo,
        directory: normalizeRepoPath(String(rawPath).replace(/^\.\//, '')),
        installSource: ''
      };
    }

    if (source.url) {
      const branch = source.ref || source.branch || source.sha || parentRepo.branch || 'main';
      const parsedRepo = this._repoFromGitUrl(source.url, branch);
      if (parsedRepo) {
        return {
          repo: parsedRepo,
          directory: normalizeRepoPath(rawPath),
          installSource: source.url
        };
      }
    }

    return {
      repo: parentRepo,
      directory: normalizeRepoPath(rawPath),
      installSource: source.url || ''
    };
  }

  _repoFromGitUrl(url = '', branch = 'main') {
    const value = String(url || '').trim();
    if (!value) return null;

    const sshMatch = value.match(/^git@([^:]+):(.+?)(?:\.git)?$/i);
    if (sshMatch) {
      const host = `https://${sshMatch[1]}`;
      const repoPath = sshMatch[2].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
      const parts = repoPath.split('/').filter(Boolean);
      if (sshMatch[1].includes('github') && parts.length >= 2) {
        return this.normalizeRepoConfig({
          provider: 'github',
          host,
          owner: parts[0],
          name: parts[1],
          branch,
          repoUrl: value
        });
      }
      if (parts.length > 0) {
        return this.normalizeRepoConfig({
          provider: 'gitlab',
          host,
          projectPath: repoPath,
          branch,
          repoUrl: value
        });
      }
    }

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }

    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/').filter(Boolean);
    if (parsed.hostname.includes('github') && parts.length >= 2) {
      return this.normalizeRepoConfig({
        provider: 'github',
        host: `${parsed.protocol}//${parsed.host}`,
        owner: parts[0],
        name: parts[1],
        branch,
        repoUrl: value
      });
    }

    if (parsed.hostname.includes('gitlab') && parts.length >= 1) {
      return this.normalizeRepoConfig({
        provider: 'gitlab',
        host: `${parsed.protocol}//${parsed.host}`,
        projectPath: parts.join('/'),
        branch,
        repoUrl: value
      });
    }

    return null;
  }

  async _readManifestFromRepo(repo, directory, candidates) {
    for (const candidate of candidates) {
      try {
        return await this.fetchRepoJson(repo, joinRepoPath(directory, candidate));
      } catch {
        // try next candidate
      }
    }
    return null;
  }

  async _fetchClaudeMarketplacePlugins(repo, marketplace, readJson) {
    if (!marketplace || !Array.isArray(marketplace.plugins)) return [];
    const results = [];
    for (const plugin of marketplace.plugins) {
      const sourceInfo = this._repoFromMarketplaceSource(repo, plugin.source);
      const canReadManifest = sourceInfo.repo.provider === 'local' || sourceInfo.repo.id === repo.id;
      const manifest = canReadManifest
        ? await this._readManifestFromRepo(sourceInfo.repo, sourceInfo.directory, [
            '.claude-plugin/plugin.json',
            'plugin.json',
            'package.json'
          ])
        : null;
      results.push(this.buildMarketPluginItem(repo, {
        repo: sourceInfo.repo,
        name: manifest?.name || plugin.name,
        description: manifest?.description || plugin.description || '',
        author: manifest?.author || plugin.author?.name || marketplace.owner?.name || repo.owner,
        version: manifest?.version || plugin.version || '1.0.0',
        category: plugin.category || 'general',
        directory: sourceInfo.directory || plugin.name,
        marketplace: marketplace.name || repo.marketplace || '',
        installSource: sourceInfo.directory ? '' : sourceInfo.installSource,
        marketplaceFormat: 'claude-marketplace',
        lspServers: plugin.lspServers || null,
        commands: manifest?.commands || [],
        hooks: manifest?.hooks || []
      }));
    }
    return results;
  }

  async _fetchCodexMarketplacePlugins(repo, marketplace) {
    if (!marketplace || !Array.isArray(marketplace.plugins)) return [];
    const marketplaceName = this._resolveCodexMarketplaceName(repo, marketplace.name || marketplace.interface?.displayName || repo.marketplace);
    const results = [];
    for (const plugin of marketplace.plugins) {
      const sourceInfo = this._repoFromMarketplaceSource(repo, plugin.source);
      const canReadManifest = sourceInfo.repo.provider === 'local' || sourceInfo.repo.id === repo.id;
      const manifest = canReadManifest
        ? await this._readManifestFromRepo(sourceInfo.repo, sourceInfo.directory, [
            '.codex-plugin/plugin.json',
            'plugin.json',
            'package.json'
          ])
        : null;
      results.push(this.buildMarketPluginItem(repo, {
        repo: sourceInfo.repo,
        name: manifest?.name || plugin.name,
        description: manifest?.description || plugin.description || '',
        author: manifest?.author || plugin.author?.name || marketplace.owner?.name || repo.owner,
        version: manifest?.version || plugin.version || '1.0.0',
        category: plugin.category || 'general',
        directory: sourceInfo.directory || plugin.name,
        marketplace: marketplaceName,
        installSource: sourceInfo.directory ? '' : sourceInfo.installSource,
        marketplaceFormat: 'codex-marketplace',
        commands: manifest?.commands || [],
        hooks: manifest?.hooks || []
      }));
    }
    return results;
  }

  /**
   * Get market plugins from configured repositories
   * @returns {Promise<Array>} List of available market plugins
   */
  async getMarketPlugins(forceRefresh = false) {
    if (!this.getCapabilities().market) {
      return [];
    }

    if (forceRefresh) {
      this.clearMarketCache({ removeFile: false });
    }

    const fileCache = this.loadMarketCacheFromFile();

    if (!forceRefresh && Array.isArray(this._marketCache) && this._marketCache.length > 0) {
      if (Array.isArray(fileCache) && fileCache.length > this._marketCache.length) {
        this._marketCache = this.prepareMarketPlugins(fileCache);
        return this._marketCache;
      }
      this._marketCache = this.prepareMarketPlugins(this._marketCache);
      return this._marketCache;
    }

    if (!forceRefresh && Array.isArray(fileCache) && fileCache.length > 0) {
      this._marketCache = this.prepareMarketPlugins(fileCache);
      return this._marketCache;
    }

    const repos = this.getRepos().filter(r => r.enabled);
    const marketPlugins = [];
    let repoFailureCount = 0;

    for (const repo of repos) {
      const repoLabel = repo.label || repo.repoUrl || repo.localPath || `${repo.owner || ''}/${repo.name || ''}`;
      const pluginsBefore = marketPlugins.length;
      try {
        const tree = await this.fetchRepoTree(repo);
        const files = tree.filter(item => item.type === 'blob');
        const fileMap = new Map(files.map(file => [normalizeRepoPath(file.path), file]));
        const readJson = async (filePath) => {
          const normalizedPath = normalizeRepoPath(filePath);
          const file = fileMap.get(normalizedPath);
          if (!file) {
            throw new Error(`File not found: ${normalizedPath}`);
          }
          return this.fetchRepoJson(repo, normalizedPath, file);
        };

        // Claude official marketplace format
        if (this.platform === 'claude' && fileMap.has('.claude-plugin/marketplace.json')) {
          const marketplace = await readJson('.claude-plugin/marketplace.json');
          if (marketplace && marketplace.plugins) {
            marketPlugins.push(...await this._fetchClaudeMarketplacePlugins(repo, marketplace, readJson));
            continue; // Skip legacy format check
          }
        }

        // Codex marketplace format generated by plugin-creator
        if (this._isCodex() && fileMap.has('.agents/plugins/marketplace.json')) {
          const marketplace = await readJson('.agents/plugins/marketplace.json');
          if (marketplace && marketplace.plugins) {
            marketPlugins.push(...await this._fetchCodexMarketplacePlugins(repo, marketplace));
            continue;
          }
        }

        // OpenCode plugin marketplace format: plugins/*.plugin.json
        if (this._isOpenCode()) {
          const openCodeMarketplacePlugins = await this._fetchOpenCodeMarketplacePlugins(repo, repo.branch || 'main');
          if (openCodeMarketplacePlugins.length > 0) {
            marketPlugins.push(...openCodeMarketplacePlugins);
            continue;
          }
        }

        const nestedManifestFiles = files.filter(file => {
          if (this._isCodex()) {
            return file.path === '.codex-plugin/plugin.json' || file.path.endsWith('/.codex-plugin/plugin.json');
          }
          if (this.platform === 'claude') {
            return file.path === '.claude-plugin/plugin.json' || file.path.endsWith('/.claude-plugin/plugin.json');
          }
          return false;
        });
        const nestedDirs = new Set();
        for (const file of nestedManifestFiles) {
          const marker = this._isCodex() ? '/.codex-plugin/plugin.json' : '/.claude-plugin/plugin.json';
          const rootMarker = marker.slice(1);
          const dir = file.path === rootMarker
            ? ''
            : normalizeRepoPath(file.path.slice(0, -marker.length));
          const dirKey = dir || '.';
          if (nestedDirs.has(dirKey)) continue;
          nestedDirs.add(dirKey);
          const manifest = await readJson(file.path);
          marketPlugins.push(this.buildMarketPluginItem(repo, {
            name: manifest.name || dir.split('/').pop(),
            description: manifest.description || '',
            author: manifest.author || repo.owner,
            version: manifest.version || '1.0.0',
            directory: dir,
            marketplace: this._isCodex() ? this._resolveCodexMarketplaceName(repo) : '',
            marketplaceFormat: this._isCodex() ? 'codex-manifest' : 'claude-manifest',
            commands: manifest.commands || [],
            hooks: manifest.hooks || []
          }));
        }
        if (nestedDirs.size > 0) {
          continue;
        }

        // Legacy format: each directory is a plugin with plugin.json/package.json
        const pluginDirs = Array.from(new Set(
          files
            .map(item => item.path.split('/')[0])
            .filter(dir => dir && !dir.startsWith('.') && dir !== 'node_modules')
        ));

        for (const dir of pluginDirs) {
          try {
            const manifest = await readJson(`${dir}/plugin.json`);

            marketPlugins.push(this.buildMarketPluginItem(repo, {
              name: manifest.name || dir,
              description: manifest.description || '',
              author: manifest.author || repo.owner,
              version: manifest.version || '1.0.0',
              directory: dir,
              commands: manifest.commands || [],
              hooks: manifest.hooks || []
            }));
          } catch (e) {
            // OpenCode 仓库常见 package.json 格式
            if (this._isOpenCode()) {
              try {
                const pkg = await readJson(`${dir}/package.json`);
                marketPlugins.push(this.buildMarketPluginItem(repo, {
                  name: pkg.name || dir,
                  description: pkg.description || '',
                  author: pkg.author || repo.owner,
                  version: pkg.version || '1.0.0',
                  directory: dir
                }));
              } catch (pkgErr) {
                // neither plugin.json nor package.json
              }
            }
          }
        }
      } catch (err) {
        repoFailureCount++;
        console.error(`[PluginsService] Failed to fetch plugins from ${repoLabel}:`, err.message);
        continue;
      }
      const added = marketPlugins.length - pluginsBefore;
      console.log(`[PluginsService] ${repoLabel}: ${added} plugins loaded`);
    }

    const preparedPlugins = this.prepareMarketPlugins(marketPlugins);
    const preparedFileCache = Array.isArray(fileCache) && fileCache.length > 0
      ? this.prepareMarketPlugins(fileCache)
      : null;
    const shouldUseStaleFileCache = preparedFileCache && (
      (repos.length > 0 && repoFailureCount === repos.length) ||
      (repoFailureCount > 0 && preparedFileCache.length > preparedPlugins.length)
    );

    if (shouldUseStaleFileCache) {
      this._marketCache = preparedFileCache;
      return this._marketCache;
    }

    this._marketCache = preparedPlugins;
    this.saveMarketCacheToFile(preparedPlugins);

    return preparedPlugins;
  }
}

module.exports = { PluginsService };
