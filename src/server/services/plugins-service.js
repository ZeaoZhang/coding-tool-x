/**
 * Plugins Service
 *
 * Wraps the plugin system for API access
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { listPlugins, getPlugin, updatePlugin: updatePluginRegistry } = require('../../plugins/registry');
const { installPlugin: installPluginCore, uninstallPlugin: uninstallPluginCore } = require('../../plugins/plugin-installer');
const { initializePlugins, shutdownPlugins } = require('../../plugins/plugin-manager');
const { INSTALLED_DIR, CONFIG_DIR } = require('../../plugins/constants');
const { NATIVE_PATHS } = require('../../config/paths');

const CLAUDE_PLUGINS_DIR = path.join(os.homedir(), '.claude', 'plugins');
const CLAUDE_INSTALLED_FILE = path.join(CLAUDE_PLUGINS_DIR, 'installed_plugins.json');
const CLAUDE_MARKETPLACES_FILE = path.join(CLAUDE_PLUGINS_DIR, 'known_marketplaces.json');
const OPENCODE_CONFIG_DIR = NATIVE_PATHS.opencode.config;
const DEFAULT_REPOS_BY_PLATFORM = {
  claude: [],
  opencode: [
    {
      owner: 'Tommertom',
      name: 'opencode-plugin-marketplace',
      url: 'https://github.com/Tommertom/opencode-plugin-marketplace',
      branch: 'main',
      enabled: true,
      source: 'opencode-default'
    },
    {
      owner: 'avifenesh',
      name: 'awesome-slash',
      url: 'https://github.com/avifenesh/awesome-slash',
      branch: 'main',
      enabled: true,
      source: 'opencode-default'
    },
    {
      owner: 'NeoLabHQ',
      name: 'context-engineering-kit',
      url: 'https://github.com/NeoLabHQ/context-engineering-kit',
      branch: 'master',
      enabled: true,
      source: 'opencode-default'
    }
  ]
};

function cloneRepos(repos = []) {
  return repos.map(repo => ({ ...repo }));
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
    this.ccToolConfigDir = path.join(os.homedir(), '.cc-tool');
    this.opencodePluginsDir = path.join(OPENCODE_CONFIG_DIR, 'plugins');
    this.opencodeLegacyPluginsDir = path.join(OPENCODE_CONFIG_DIR, 'plugin');
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
          pluginType: 'local'
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
              let repoUrl = '';

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
              }

              // Parse repoUrl from source if available
              if (source) {
                const match = source.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
                if (match) {
                  repoUrl = `https://github.com/${match[1]}/${match[2]}`;
                }
              }

              plugins.push({
                name,
                marketplace,
                version: install.version || '1.0.0',
                installPath: install.installPath,
                installedAt: install.installedAt,
                scope: install.scope,
                enabled: true,
                description,
                source,
                repoUrl
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
      if (repoInfo && repoInfo.owner && repoInfo.name && repoInfo.directory) {
        return this._installFromGitHubDirectory(repoInfo, { installRoot: this._getOpenCodePluginsDir() });
      }

      const treeMatch = source.match(/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/);
      if (treeMatch) {
        const [, owner, name, branch, directory] = treeMatch;
        return this._installFromGitHubDirectory({ owner, name, branch, directory }, { installRoot: this._getOpenCodePluginsDir() });
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

    // If repoInfo is provided, download from GitHub directly
    if (repoInfo && repoInfo.owner && repoInfo.name && repoInfo.directory) {
      return await this._installFromGitHubDirectory(repoInfo);
    }

    // Parse tree URL format: https://github.com/owner/repo/tree/branch/path
    const treeMatch = source.match(/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/);
    if (treeMatch) {
      const [, owner, name, branch, directory] = treeMatch;
      return await this._installFromGitHubDirectory({ owner, name, branch, directory });
    }

    // Fallback to original git clone method
    return await installPluginCore(source);
  }

  /**
   * Install plugin from GitHub directory
   * @private
   */
  async _installFromGitHubDirectory(repoInfo, options = {}) {
    const { owner, name, branch, directory } = repoInfo;
    const https = require('https');
    const pluginName = directory.split('/').pop();
    const installRoot = options.installRoot || INSTALLED_DIR;

    try {
      // Fetch plugin.json from the directory
      const manifestUrl = `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${directory}/plugin.json`;
      let manifest;

      try {
        manifest = await this._fetchJson(manifestUrl);
      } catch (e) {
        // No plugin.json, create a basic manifest
        manifest = { name: pluginName, version: '1.0.0' };
      }

      // Create plugin directory
      const pluginDir = path.join(installRoot, manifest.name || pluginName);
      if (!fs.existsSync(pluginDir)) {
        fs.mkdirSync(pluginDir, { recursive: true });
      }

      // Download all files from the directory
      const contentsUrl = `https://api.github.com/repos/${owner}/${name}/contents/${directory}?ref=${branch}`;
      const contents = await this._fetchJson(contentsUrl);

      for (const item of contents) {
        if (item.type === 'file') {
          const fileContent = await this._fetchRawFile(item.download_url);
          fs.writeFileSync(path.join(pluginDir, item.name), fileContent);
        }
      }

      // Write plugin.json if not exists
      const manifestPath = path.join(pluginDir, 'plugin.json');
      if (!fs.existsSync(manifestPath)) {
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }

      if (!this._isOpenCode()) {
        // Register plugin for Claude plugin runtime
        const { addPlugin } = require('../../plugins/registry');
        addPlugin(manifest.name || pluginName, {
          version: manifest.version || '1.0.0',
          enabled: true,
          installedAt: new Date().toISOString(),
          source: `https://github.com/${owner}/${name}/tree/${branch}/${directory}`
        });
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
   * Fetch raw file content
   * @private
   */
  async _fetchRawFile(url) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: { 'User-Agent': 'coding-tool-x' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }).on('error', reject);
    });
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

    return uninstallPluginCore(name);
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

    const plugin = getPlugin(name);
    if (!plugin) {
      throw new Error(`Plugin "${name}" not found`);
    }

    updatePluginRegistry(name, { enabled });

    return {
      name,
      ...getPlugin(name)
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
    this._ensureDir(this.ccToolConfigDir);
    if (this._isOpenCode()) {
      return path.join(this.ccToolConfigDir, 'opencode-plugin-repos.json');
    }
    return path.join(this.ccToolConfigDir, 'plugin-repos.json');
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
      return { repos: defaultRepos };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (parsed && Array.isArray(parsed.repos)) {
        return parsed;
      }
      return { repos: defaultRepos };
    } catch (err) {
      console.error('Failed to load repos config:', err);
      return { repos: defaultRepos };
    }
  }

  /**
   * Save repos to config file
   * @param {Object} config - Config object with repos array
   */
  saveReposConfig(config) {
    const configPath = this.getReposConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
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
      if (!repo || !repo.owner || !repo.name) return;
      const key = `${repo.owner}/${repo.name}`;
      if (seenRepos.has(key)) return;
      repos.push(repo);
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
            owner: parsed.owner,
            name: parsed.name,
            url: parsed.url,
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

    // Parse URL if provided
    let owner = repo.owner;
    let name = repo.name;
    let url = repo.url;

    if (url && !owner && !name) {
      // Extract owner/name from URL
      const match = url.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
      if (match) {
        owner = match[1];
        name = match[2];
      }
    }

    if (!owner || !name) {
      throw new Error('Repository owner and name are required');
    }

    // Construct URL if not provided
    if (!url) {
      url = `https://github.com/${owner}/${name}`;
    }

    // Check if repo already exists
    const exists = config.repos.some(r => r.owner === owner && r.name === name);
    if (exists) {
      throw new Error(`Repository ${owner}/${name} already exists`);
    }

    // Add new repo
    const newRepo = {
      owner,
      name,
      url,
      branch: repo.branch || 'main',
      enabled: repo.enabled !== false,
      addedAt: new Date().toISOString()
    };

    config.repos.push(newRepo);
    this.saveReposConfig(config);

    return config.repos;
  }

  /**
   * Remove repository
   * @param {string} owner - Repository owner
   * @param {string} name - Repository name
   * @returns {Array} Updated repos list
   */
  removeRepo(owner, name) {
    const config = this.loadReposConfig();
    config.repos = config.repos.filter(r => !(r.owner === owner && r.name === name));
    this.saveReposConfig(config);
    return config.repos;
  }

  /**
   * Toggle repository enabled status
   * @param {string} owner - Repository owner
   * @param {string} name - Repository name
   * @param {boolean} enabled - Enable or disable
   * @returns {Array} Updated repos list
   */
  toggleRepo(owner, name, enabled) {
    const config = this.loadReposConfig();
    const repo = config.repos.find(r => r.owner === owner && r.name === name);
    if (!repo) {
      throw new Error(`Repository ${owner}/${name} not found`);
    }
    repo.enabled = enabled;
    this.saveReposConfig(config);
    return config.repos;
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
      try {
        execSync(`claude plugin marketplace add ${repo.url}`, {
          encoding: 'utf8',
          timeout: 30000,
          stdio: 'pipe'
        });
        results.push({ repo: repo.url, success: true });
      } catch (err) {
        results.push({ repo: repo.url, success: false, error: err.message });
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
   * Fetch JSON from URL
   * @private
   */
  async _fetchJson(url) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          'User-Agent': 'coding-tool-x',
          'Accept': 'application/vnd.github.v3+json'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Get plugin README content
   * @param {Object} plugin - Plugin object with name, repoUrl, source, or repoInfo
   * @returns {Promise<string>} README content or empty string
   */
  async getPluginReadme(plugin) {
    try {
      let readmeUrl = null;

      // Case 1: Market plugin with repoInfo
      if (plugin.repoOwner && plugin.repoName && plugin.directory) {
        const branch = plugin.repoBranch || 'main';
        readmeUrl = `https://raw.githubusercontent.com/${plugin.repoOwner}/${plugin.repoName}/${branch}/${plugin.directory}/README.md`;
      }
      // Case 2: Installed plugin with source URL
      else if (plugin.source) {
        const treeMatch = plugin.source.match(/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/);
        if (treeMatch) {
          const [, owner, name, branch, directory] = treeMatch;
          readmeUrl = `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${directory}/README.md`;
        } else {
          // Try to parse as regular repo URL
          const repoMatch = plugin.source.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
          if (repoMatch) {
            const [, owner, name] = repoMatch;
            readmeUrl = `https://raw.githubusercontent.com/${owner}/${name}/main/README.md`;
          }
        }
      }
      // Case 3: Plugin with repoUrl
      else if (plugin.repoUrl) {
        const match = plugin.repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
        if (match) {
          const [, owner, name] = match;
          readmeUrl = `https://raw.githubusercontent.com/${owner}/${name}/main/README.md`;
        }
      }

      if (!readmeUrl) {
        return '';
      }

      // Fetch README content
      const content = await this._fetchRawFile(readmeUrl);
      return content;
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

  async _fetchOpenCodeMarketplacePlugins(repo, branch) {
    if (!this._isOpenCode()) return [];

    let entries;
    try {
      const indexUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents/plugins?ref=${branch}`;
      entries = await this._fetchJson(indexUrl);
    } catch (err) {
      return [];
    }

    if (!Array.isArray(entries)) return [];

    const manifestFiles = entries.filter(
      item => item.type === 'file' && item.name.endsWith('.plugin.json')
    );
    if (manifestFiles.length === 0) return [];

    const results = await Promise.allSettled(
      manifestFiles.map(async (file) => {
        const fileUrl = file.download_url ||
          `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${file.path}`;
        const manifest = await this._fetchJson(fileUrl);

        const author = Array.isArray(manifest.authors)
          ? manifest.authors.map(item => item?.name).filter(Boolean).join(', ')
          : '';
        const firstCategory = Array.isArray(manifest.categories) ? manifest.categories[0] : '';
        const repoUrl = manifest.links?.repository || `https://github.com/${repo.owner}/${repo.name}`;
        // OpenCode supports npm package plugins via opencode.json "plugin" array.
        // Use package name as install source so UI install button is enabled.
        const installSource = String(manifest.name || '').trim();
        const githubRepo = this._parseGitHubRepo(repoUrl);

        return {
          name: manifest.name || file.name.replace(/\.plugin\.json$/, ''),
          displayName: manifest.displayName || '',
          description: manifest.description || '',
          author: author || repo.owner,
          version: manifest.version || manifest.opencode?.minimumVersion || '1.0.0',
          category: firstCategory ? String(firstCategory).toLowerCase() : 'general',
          repoUrl,
          repoOwner: '',
          repoName: '',
          repoBranch: githubRepo ? 'main' : branch,
          directory: file.path,
          installSource,
          marketplaceFormat: 'opencode-plugin-json',
          isInstalled: false
        };
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
  async getMarketPlugins() {
    const repos = this.getRepos().filter(r => r.enabled);
    const marketPlugins = [];

    for (const repo of repos) {
      try {
        const branch = repo.branch || 'main';

        // Try to fetch marketplace.json first (official format)
        try {
          const marketplaceUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/.claude-plugin/marketplace.json`;
          const marketplace = await this._fetchJson(marketplaceUrl);

          if (marketplace && marketplace.plugins) {
            for (const plugin of marketplace.plugins) {
              marketPlugins.push({
                name: plugin.name,
                description: plugin.description || '',
                author: plugin.author?.name || marketplace.owner?.name || repo.owner,
                version: plugin.version || '1.0.0',
                category: plugin.category || 'general',
                repoUrl: `https://github.com/${repo.owner}/${repo.name}`,
                repoOwner: repo.owner,
                repoName: repo.name,
                repoBranch: branch,
                directory: plugin.source?.replace(/^\.\//, '') || plugin.name,
                lspServers: plugin.lspServers || null,
                isInstalled: false
              });
            }
            continue; // Skip legacy format check
          }
        } catch (e) {
          // marketplace.json not found, try legacy format
        }

        // OpenCode plugin marketplace format: plugins/*.plugin.json
        if (this._isOpenCode()) {
          const openCodeMarketplacePlugins = await this._fetchOpenCodeMarketplacePlugins(repo, branch);
          if (openCodeMarketplacePlugins.length > 0) {
            marketPlugins.push(...openCodeMarketplacePlugins);
            continue;
          }
        }

        // Legacy format: each directory is a plugin with plugin.json/package.json
        const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/contents?ref=${branch}`;
        const contents = await this._fetchJson(apiUrl);
        const pluginDirs = contents.filter(item => item.type === 'dir' && !item.name.startsWith('.'));

        for (const dir of pluginDirs) {
          try {
            const manifestUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${dir.name}/plugin.json`;
            const manifest = await this._fetchJson(manifestUrl);

            marketPlugins.push({
              name: manifest.name || dir.name,
              description: manifest.description || '',
              author: manifest.author || repo.owner,
              version: manifest.version || '1.0.0',
              repoUrl: `https://github.com/${repo.owner}/${repo.name}`,
              repoOwner: repo.owner,
              repoName: repo.name,
              repoBranch: branch,
              directory: dir.name,
              commands: manifest.commands || [],
              hooks: manifest.hooks || [],
              isInstalled: false
            });
          } catch (e) {
            // OpenCode 仓库常见 package.json 格式
            if (this._isOpenCode()) {
              try {
                const pkgUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${dir.name}/package.json`;
                const pkg = await this._fetchJson(pkgUrl);
                const pluginName = pkg.name || dir.name;
                marketPlugins.push({
                  name: pluginName,
                  description: pkg.description || '',
                  author: pkg.author || repo.owner,
                  version: pkg.version || '1.0.0',
                  repoUrl: `https://github.com/${repo.owner}/${repo.name}`,
                  repoOwner: repo.owner,
                  repoName: repo.name,
                  repoBranch: branch,
                  directory: dir.name,
                  isInstalled: false
                });
              } catch (pkgErr) {
                // neither plugin.json nor package.json
              }
            }
          }
        }
      } catch (err) {
        console.error(`[PluginsService] Failed to fetch plugins from ${repo.owner}/${repo.name}:`, err.message);
      }
    }

    // Mark installed plugins
    const installedPlugins = this.listPlugins().plugins;
    const installedNames = new Set(installedPlugins.map(p => p.name));

    marketPlugins.forEach(plugin => {
      plugin.isInstalled = installedNames.has(plugin.name);
    });

    return marketPlugins;
  }
}

module.exports = { PluginsService };
