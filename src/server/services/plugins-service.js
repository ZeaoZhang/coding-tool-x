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
const AdmZip = require('adm-zip');
const { listPlugins, getPlugin, updatePlugin: updatePluginRegistry } = require('../../plugins/registry');
const { installPlugin: installPluginCore, uninstallPlugin: uninstallPluginCore } = require('../../plugins/plugin-installer');
const { initializePlugins, shutdownPlugins } = require('../../plugins/plugin-manager');
const { INSTALLED_DIR, CONFIG_DIR } = require('../../plugins/constants');
const { NATIVE_PATHS, PATHS } = require('../../config/paths');
const { maskToken } = require('./oauth-utils');

const CLAUDE_PLUGINS_DIR = path.join(path.dirname(NATIVE_PATHS.claude.settings), 'plugins');
const CLAUDE_INSTALLED_FILE = path.join(CLAUDE_PLUGINS_DIR, 'installed_plugins.json');
const CLAUDE_MARKETPLACES_FILE = path.join(CLAUDE_PLUGINS_DIR, 'known_marketplaces.json');
const OPENCODE_CONFIG_DIR = NATIVE_PATHS.opencode.config;
const REPO_SOURCE_META_FILE = '.cc-tool-plugin-source.json';
const SUPPORTED_REPO_PROVIDERS = ['github', 'gitlab', 'local'];
const DEFAULT_GITHUB_HOST = 'https://github.com';
const DEFAULT_GITLAB_HOST = 'https://gitlab.com';
const DEFAULT_REPOS_BY_PLATFORM = {
  claude: [],
  opencode: []
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

function stripGitSuffix(value = '') {
  return String(value || '').replace(/\.git$/i, '');
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
    this.platform = ['claude', 'opencode'].includes(platform) ? platform : 'claude';
    this.configDir = PATHS.config || path.join((PATHS.base || process.env.HOME || os.homedir()), 'config');
    this.ccToolConfigDir = path.dirname(PATHS.pluginRepos.claude);
    this.opencodePluginsDir = path.join(OPENCODE_CONFIG_DIR, 'plugins');
    this.opencodeLegacyPluginsDir = path.join(OPENCODE_CONFIG_DIR, 'plugin');
    this.marketCachePath = this.platform === 'opencode'
      ? PATHS.pluginMarketCache.opencode
      : PATHS.pluginMarketCache.claude;
    this._marketCache = null;
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

  /**
   * List all installed plugins with their status
   * Reads from Claude Code's native installed_plugins.json
   * @returns {Object} { plugins: Array }
   */
  listPlugins() {
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
              const [name, marketplace] = key.split('@');

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
              const enabledState = legacyInfo ? legacyInfo.enabled !== false : true;

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
    if (this._isOpenCode()) {
      if (repoInfo && repoInfo.directory) {
        return this._installFromRepoDirectory(repoInfo, { installRoot: this._getOpenCodePluginsDir() });
      }

      const parsedSource = this.parseRepoTreeSource(source);
      if (parsedSource) {
        return this._installFromRepoDirectory(parsedSource, { installRoot: this._getOpenCodePluginsDir() });
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

    if (repoInfo && repoInfo.directory) {
      return await this._installFromRepoDirectory(repoInfo);
    }

    const parsedSource = this.parseRepoTreeSource(source);
    if (parsedSource) {
      return await this._installFromRepoDirectory(parsedSource);
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
    const directory = normalizeRepoPath(repoInfo.directory || '');
    const pluginName = directory.split('/').pop();
    const installRoot = options.installRoot || INSTALLED_DIR;

    try {
      let manifest;
      try {
        manifest = await this.fetchRepoJson(normalizedRepo, `${directory}/plugin.json`);
      } catch {
        try {
          manifest = await this.fetchRepoJson(normalizedRepo, `${directory}/package.json`);
        } catch {
          manifest = { name: pluginName, version: '1.0.0' };
        }
      }

      // Create plugin directory
      const pluginDir = path.join(installRoot, manifest.name || pluginName);
      if (!fs.existsSync(pluginDir)) {
        fs.mkdirSync(pluginDir, { recursive: true });
      }

      if (normalizedRepo.provider === 'local') {
        const sourceDir = path.join(normalizedRepo.localPath, directory);
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

          const sourceDir = path.join(tempDir, extractedDir, directory);
          if (!fs.existsSync(sourceDir)) {
            throw new Error(`Plugin directory not found: ${directory}`);
          }
          this.copyDirRecursive(sourceDir, pluginDir);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }

      // Write plugin.json if not exists
      const manifestPath = path.join(pluginDir, 'plugin.json');
      if (!fs.existsSync(manifestPath)) {
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }

      if (!this._isOpenCode()) {
        const installedPluginName = manifest.name || pluginName;
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

        // Also register in Claude's native installed_plugins.json
        try {
          this._ensureDir(CLAUDE_PLUGINS_DIR);
          let nativeData = { plugins: {} };
          if (fs.existsSync(CLAUDE_INSTALLED_FILE)) {
            try {
              nativeData = JSON.parse(fs.readFileSync(CLAUDE_INSTALLED_FILE, 'utf8'));
              if (!nativeData.plugins) nativeData.plugins = {};
            } catch (e) { /* ignore parse error */ }
          }
          const nativeKey = `${installedPluginName}@ctx`;
          nativeData.plugins[nativeKey] = [{
            version: manifest.version || '1.0.0',
            installPath: pluginDir,
            installedAt: installTimestamp,
            scope: 'user',
            source: sourceUrl,
            ...repoSourceMeta
          }];
          fs.writeFileSync(CLAUDE_INSTALLED_FILE, JSON.stringify(nativeData, null, 2), 'utf8');
        } catch (e) {
          console.error('[PluginsService] Failed to update native installed_plugins.json:', e.message);
        }
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
    if (this._isOpenCode()) {
      const pluginsDir = this._getOpenCodePluginsDir();
      let removed = false;

      // Remove from opencode config.plugin (npm plugins)
      const configured = this._listOpenCodeConfiguredPlugins();
      const next = configured.filter(p => p !== name);
      if (next.length !== configured.length) {
        this._setOpenCodeConfiguredPlugins(next);
        removed = true;
      }

      // Remove local plugin directory/file
      if (fs.existsSync(pluginsDir)) {
        const directPath = path.join(pluginsDir, name);
        if (fs.existsSync(directPath)) {
          fs.rmSync(directPath, { recursive: true, force: true });
          removed = true;
        } else {
          const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
          for (const entry of entries) {
            const baseName = entry.name.replace(path.extname(entry.name), '');
            if (entry.name === name || baseName === name) {
              fs.rmSync(path.join(pluginsDir, entry.name), { recursive: true, force: true });
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
    if (fs.existsSync(CLAUDE_INSTALLED_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(CLAUDE_INSTALLED_FILE, 'utf8'));
        if (data.plugins) {
          const keysToDelete = [];
          const baseName = name.split('/').pop(); // handle "plugins/pr-review-toolkit" → "pr-review-toolkit"
          for (const [key, installations] of Object.entries(data.plugins)) {
            const [pluginName] = key.split('@');
            if (pluginName === name || key === name || pluginName === baseName) {
              keysToDelete.push(key);
              // Delete install directories
              if (Array.isArray(installations)) {
                for (const install of installations) {
                  if (install.installPath && fs.existsSync(install.installPath)) {
                    try {
                      fs.rmSync(install.installPath, { recursive: true, force: true });
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
            const [pluginName] = key.split('@');
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
    if (this._isOpenCode()) {
      const configDir = path.join(OPENCODE_CONFIG_DIR, 'plugins-config');
      this._ensureDir(configDir);
      const configFile = path.join(configDir, `${name}.json`);
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

    const configFile = path.join(CONFIG_DIR, `${name}.json`);

    // Ensure config directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
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
    const filePath = this._isOpenCode() ? PATHS.pluginRepos.opencode : PATHS.pluginRepos.claude;
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
    if (!this._isOpenCode() && fs.existsSync(CLAUDE_MARKETPLACES_FILE)) {
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
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = normalizeRepoPath(path.relative(repoRoot, fullPath));
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
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
      return fs.readFileSync(path.join(repo.localPath, filePath), 'utf-8');
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

  copyDirRecursive(sourceDir, destDir) {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
        this.copyDirRecursive(sourcePath, destPath);
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
    if (this._isOpenCode()) {
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
    return {
      name: data.name,
      displayName: data.displayName || '',
      description: data.description || '',
      author: data.author || repo.owner || repo.projectPath || 'unknown',
      version: data.version || '1.0.0',
      category: data.category || 'general',
      repoUrl: data.repoUrl || repo.repoUrl || buildRepoUrl(repo),
      repoProvider: repo.provider,
      repoOwner: repo.owner || '',
      repoName: repo.name || '',
      repoBranch: repo.branch || 'main',
      repoHost: repo.host || '',
      repoProjectPath: repo.projectPath || '',
      repoLocalPath: repo.localPath || '',
      repoId: repo.id,
      directory: normalizeRepoPath(data.directory || data.name || ''),
      installSource: data.installSource || '',
      marketplaceFormat: data.marketplaceFormat || '',
      readmeUrl: this.buildRepoBrowserUrl(repo, data.directory || data.name || ''),
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
          installSource: githubRepo ? '' : installSource,
          marketplaceFormat: 'opencode-plugin-json',
          repoUrl
        });
      })
    );

    return results
      .filter(item => item.status === 'fulfilled' && item.value)
      .map(item => item.value);
  }

  /**
   * Get market plugins from configured repositories
   * @returns {Promise<Array>} List of available market plugins
   */
  async getMarketPlugins(forceRefresh = false) {
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

        // Try to fetch marketplace.json first (official format)
        if (fileMap.has('.claude-plugin/marketplace.json')) {
          const marketplace = await readJson('.claude-plugin/marketplace.json');
          if (marketplace && marketplace.plugins) {
            for (const plugin of marketplace.plugins) {
              marketPlugins.push(this.buildMarketPluginItem(repo, {
                name: plugin.name,
                description: plugin.description || '',
                author: plugin.author?.name || marketplace.owner?.name || repo.owner,
                version: plugin.version || '1.0.0',
                category: plugin.category || 'general',
                directory: plugin.source?.replace(/^\.\//, '') || plugin.name,
                lspServers: plugin.lspServers || null
              }));
            }
            continue; // Skip legacy format check
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
