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

const CLAUDE_PLUGINS_DIR = path.join(os.homedir(), '.claude', 'plugins');
const CLAUDE_INSTALLED_FILE = path.join(CLAUDE_PLUGINS_DIR, 'installed_plugins.json');
const CLAUDE_MARKETPLACES_FILE = path.join(CLAUDE_PLUGINS_DIR, 'known_marketplaces.json');

class PluginsService {
  /**
   * List all installed plugins with their status
   * Reads from Claude Code's native installed_plugins.json
   * @returns {Object} { plugins: Array }
   */
  listPlugins() {
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
  async _installFromGitHubDirectory(repoInfo) {
    const { owner, name, branch, directory } = repoInfo;
    const https = require('https');
    const pluginName = directory.split('/').pop();

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
      const pluginDir = path.join(INSTALLED_DIR, manifest.name || pluginName);
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

      // Register plugin
      const { addPlugin } = require('../../plugins/registry');
      addPlugin(manifest.name || pluginName, {
        version: manifest.version || '1.0.0',
        enabled: true,
        installedAt: new Date().toISOString(),
        source: `https://github.com/${owner}/${name}/tree/${branch}/${directory}`
      });

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
    return uninstallPluginCore(name);
  }

  /**
   * Toggle plugin enabled/disabled
   * @param {string} name - Plugin name
   * @param {boolean} enabled - Enable or disable
   * @returns {Object} Updated plugin info
   */
  togglePlugin(name, enabled) {
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
    const os = require('os');
    const configDir = path.join(os.homedir(), '.claude', 'cc-tool');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    return path.join(configDir, 'plugin-repos.json');
  }

  /**
   * Load repos from config file
   * @returns {Object} Config object with repos array
   */
  loadReposConfig() {
    const configPath = this.getReposConfigPath();
    if (!fs.existsSync(configPath)) {
      return { repos: [] };
    }
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.error('Failed to load repos config:', err);
      return { repos: [] };
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

    // 1. Load our own config
    const config = this.loadReposConfig();
    for (const repo of config.repos || []) {
      const key = `${repo.owner}/${repo.name}`;
      if (!seenRepos.has(key)) {
        repos.push(repo);
        seenRepos.add(key);
      }
    }

    // 2. Load Claude Code's native marketplace config
    if (fs.existsSync(CLAUDE_MARKETPLACES_FILE)) {
      try {
        const marketplaces = JSON.parse(fs.readFileSync(CLAUDE_MARKETPLACES_FILE, 'utf8'));

        for (const [marketplaceName, marketplaceData] of Object.entries(marketplaces)) {
          if (marketplaceData.source && marketplaceData.source.url) {
            const url = marketplaceData.source.url;
            const match = url.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);

            if (match) {
              const [, owner, name] = match;
              const key = `${owner}/${name}`;

              if (!seenRepos.has(key)) {
                repos.push({
                  owner,
                  name,
                  url,
                  branch: 'main', // Default branch
                  enabled: true,
                  source: 'claude-native',
                  lastUpdated: marketplaceData.lastUpdated
                });
                seenRepos.add(key);
              }
            }
          }
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

        // Legacy format: each directory is a plugin with plugin.json
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
            // No plugin.json in this directory, skip
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
