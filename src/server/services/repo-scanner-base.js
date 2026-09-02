/**
 * 仓库扫描基础服务
 *
 * 提供从 GitHub 仓库扫描配置文件的通用能力
 * 支持指定仓库的子目录路径
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execFileSync } = require('child_process');
const { createWriteStream } = require('fs');
const AdmZip = require('adm-zip');
const { PATHS, getRepoScannerReposPath, getRepoScannerCachePath } = require('../../config/paths');
const remoteCredentialCache = require('./remote-credential-cache');
const {
  normalizeSafeRelativePath,
  resolveInsideRoot
} = require('../../shared/config-artifact-paths');

// 缓存有效期（5分钟）

function extractHostname(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    return new URL(input).hostname || '';
  } catch (_) {
    return input.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  }
}
const CACHE_TTL = 5 * 60 * 1000;

/**
 * 仓库配置结构
 * @typedef {Object} RepoConfig
 * @property {string} owner - 仓库所有者
 * @property {string} name - 仓库名称
 * @property {string} branch - 分支名称
 * @property {string} [directory] - 扫描的子目录路径（可选，默认为根目录）
 * @property {boolean} enabled - 是否启用
 */

class RepoScannerBase {
  /**
   * @param {Object} options
   * @param {string} options.type - 类型标识（commands/agents）
   * @param {string} options.installDir - 本地安装目录
   * @param {string} options.markerFile - 标识文件名（如 SKILL.md, COMMAND.md 等，可选）
   * @param {string} options.fileExtension - 文件扩展名（如 .md）
   * @param {RepoConfig[]} options.defaultRepos - 默认仓库列表
   */
  constructor(options) {
    this.type = options.type;
    this.installDir = options.installDir;
    this.markerFile = options.markerFile || null;
    this.fileExtension = options.fileExtension || '.md';
    this.defaultRepos = options.defaultRepos || [];

    this.configDir = PATHS.config;
    this.reposConfigPath = getRepoScannerReposPath(this.type);
    this.cachePath = getRepoScannerCachePath(this.type);
    // Remote item refreshes are shared per scanner instance.
    this.itemsCache = null;
    this.cacheTime = 0;
    this.itemsRefreshPromise = null;
    this.itemsFetchedAt = 0;
    this._cacheGeneration = 0;

    // 确保目录存在
    this.ensureDirs();
  }

  ensureDirs() {
    if (!fs.existsSync(this.installDir)) {
      fs.mkdirSync(this.installDir, { recursive: true });
    }
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    const reposDir = path.dirname(this.reposConfigPath);
    if (!fs.existsSync(reposDir)) {
      fs.mkdirSync(reposDir, { recursive: true });
    }
    const cacheDir = path.dirname(this.cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  }

  // ==================== 仓库配置管理 ====================

  /**
   * 加载仓库配置
   */
  loadRepos() {
    try {
      if (fs.existsSync(this.reposConfigPath)) {
        const data = JSON.parse(fs.readFileSync(this.reposConfigPath, 'utf-8'));
        return data.repos || this.defaultRepos;
      }
    } catch (err) {
      console.error(`[${this.type}RepoScanner] Load repos config error:`, err.message);
    }
    return this.defaultRepos;
  }

  /**
   * 保存仓库配置
   */
  saveRepos(repos) {
    fs.writeFileSync(this.reposConfigPath, JSON.stringify({ repos }, null, 2));
  }

  /**
   * 添加仓库
   * @param {RepoConfig} repo
   */
  addRepo(repo) {
    const repos = this.loadRepos();
    // 使用 owner/name/directory 作为唯一标识
    const existingIndex = repos.findIndex(r =>
      r.owner === repo.owner &&
      r.name === repo.name &&
      (r.directory || '') === (repo.directory || '')
    );

    if (existingIndex >= 0) {
      repos[existingIndex] = repo;
    } else {
      repos.push(repo);
    }

    this.saveRepos(repos);
    // 清除缓存
    this.clearCache();
    return repos;
  }

  /**
   * 删除仓库
   */
  removeRepo(owner, name, directory = '') {
    const repos = this.loadRepos();
    const filtered = repos.filter(r => !(
      r.owner === owner &&
      r.name === name &&
      (r.directory || '') === directory
    ));
    this.saveRepos(filtered);
    this.clearCache();
    return filtered;
  }

  /**
   * 切换仓库启用状态
   */
  toggleRepo(owner, name, directory = '', enabled) {
    const repos = this.loadRepos();
    const repo = repos.find(r =>
      r.owner === owner &&
      r.name === name &&
      (r.directory || '') === directory
    );
    if (repo) {
      repo.enabled = enabled;
      this.saveRepos(repos);
      this.clearCache();
    }
    return repos;
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this._cacheGeneration++;
    this.itemsCache = null;
    this.cacheTime = 0;
    this.itemsFetchedAt = 0;
    this.itemsRefreshPromise = null;
    remoteCredentialCache.clear();
    try {
      if (fs.existsSync(this.cachePath)) {
        fs.unlinkSync(this.cachePath);
      }
    } catch (err) {
      // Ignore cache removal failures.
    }
  }

  // ==================== 远程仓库扫描 ====================

  _reposFingerprint(repos) {
    return JSON.stringify((Array.isArray(repos) ? repos : []).map(repo => ({
      owner: repo.owner || '',
      name: repo.name || '',
      branch: repo.branch || '',
      directory: repo.directory || '',
      enabled: repo.enabled !== false
    })));
  }

  _setItemsCache(items, fetchedAt = Date.now()) {
    this.itemsCache = Array.isArray(items) ? items : [];
    this.cacheTime = Date.now();
    this.itemsFetchedAt = fetchedAt;
    return this.itemsCache;
  }

  async _refreshRemoteItems(repos, reposFingerprint, staleItems = null) {
    if (this.itemsRefreshPromise) return this.itemsRefreshPromise;
    const generation = this._cacheGeneration;
    const refreshPromise = (async () => {
      const items = [];
      const enabledRepos = repos.filter(repo => repo.enabled);
      const failedRepos = [];

      const results = await Promise.allSettled(
        enabledRepos.map(async repo => {
          let timer;
          try {
            return await Promise.race([
              this.fetchRepoItems(repo),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Fetch timeout')), 30000);
              })
            ]);
          } finally {
            clearTimeout(timer);
          }
        })
      );

      results.forEach((result, index) => {
        const repo = enabledRepos[index];
        if (result.status === 'fulfilled') {
          items.push(...(Array.isArray(result.value) ? result.value : []));
          return;
        }
        failedRepos.push(repo);
        const label = `${repo.owner || repo.projectPath || ''}/${repo.name || ''}`;
        console.warn(`[${this.type}RepoScanner] Fetch repo ${label} failed:`, result.reason?.message);
      });

      const useStale = Array.isArray(staleItems)
        && items.length === 0
        && (failedRepos.length > 0 || enabledRepos.length === 0);
      if (useStale) items.push(...staleItems);

      this.deduplicateItems(items);
      items.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));
      const fetchedAt = useStale ? 0 : Date.now();
      if (generation === this._cacheGeneration) {
        this._setItemsCache(items, fetchedAt);
        if (!useStale) this.saveCacheToFile(items, fetchedAt, reposFingerprint);
      }
      return items;
    })();

    const trackedPromise = refreshPromise.finally(() => {
      if (this.itemsRefreshPromise === trackedPromise) {
        this.itemsRefreshPromise = null;
      }
    });
    this.itemsRefreshPromise = trackedPromise;
    return trackedPromise;
  }

  /**
   * 获取所有项目列表（带缓存）
   * @param {boolean} forceRefresh - 强制刷新
   */
  async listRemoteItems(forceRefresh = false) {
    const repos = this.loadRepos();
    const reposFingerprint = this._reposFingerprint(repos);
    const now = Date.now();

    if (!forceRefresh && this.itemsCache && now - this.cacheTime < CACHE_TTL) {
      return this.itemsCache;
    }

    const diskCache = this.loadCacheEnvelope();
    const staleItems = Array.isArray(this.itemsCache) && this.itemsCache.length > 0
      ? this.itemsCache
      : (Array.isArray(diskCache?.items) ? diskCache.items : null);
    if (!forceRefresh && diskCache?.fetchedAt
      && now - diskCache.fetchedAt < CACHE_TTL
      && (!diskCache.reposFingerprint || diskCache.reposFingerprint === reposFingerprint)) {
      return this._setItemsCache(diskCache.items, diskCache.fetchedAt);
    }

    if (this.itemsRefreshPromise) return this.itemsRefreshPromise;
    return this._refreshRemoteItems(repos, reposFingerprint, staleItems);
  }

  /**
   * 从 GitHub 仓库获取项目列表
   * @param {RepoConfig} repo
   */
  async fetchRepoItems(repo) {
    const items = [];

    try {
      // 使用 GitHub Tree API 获取文件列表
      const treeUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${repo.branch}?recursive=1`;
      const tree = await this.fetchGitHubApi(treeUrl);

      if (!tree || !tree.tree) {
        console.warn(`[${this.type}RepoScanner] Empty tree for ${repo.owner}/${repo.name}`);
        return items;
      }

      // 过滤出目标目录下的文件
      const baseDir = repo.directory || '';
      const baseDirPrefix = baseDir ? `${baseDir}/` : '';

      let targetFiles;

      if (this.markerFile) {
        // 查找标识文件（如 SKILL.md）
        targetFiles = tree.tree.filter(item =>
          item.type === 'blob' &&
          item.path.startsWith(baseDirPrefix) &&
          item.path.endsWith(`/${this.markerFile}`)
        );
      } else {
        // 直接查找指定扩展名的文件
        targetFiles = tree.tree.filter(item =>
          item.type === 'blob' &&
          item.path.startsWith(baseDirPrefix) &&
          item.path.endsWith(this.fileExtension)
        );
      }

      // 并行获取文件内容（限制并发数）
      const batchSize = 5;

      for (let i = 0; i < targetFiles.length; i += batchSize) {
        const batch = targetFiles.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(file => this.fetchAndParseItem(file, repo, baseDir))
        );

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            items.push(result.value);
          }
        }
      }
    } catch (err) {
      console.error(`[${this.type}RepoScanner] Fetch repo ${repo.owner}/${repo.name} error:`, err.message);
      throw err;
    }

    return items;
  }

  /**
   * 获取并解析单个文件（子类需要重写）
   * @param {Object} file - GitHub tree 文件对象
   * @param {RepoConfig} repo - 仓库配置
   * @param {string} baseDir - 基础目录
   * @returns {Promise<Object|null>}
   */
  async fetchAndParseItem(file, repo, baseDir) {
    // 子类需要重写此方法
    throw new Error('fetchAndParseItem must be implemented by subclass');
  }

  /**
   * 去重项目列表（子类可重写）
   * @param {Array} items
   */
  deduplicateItems(items) {
    const seen = new Map();

    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const key = this.getDedupeKey(item);

      if (seen.has(key)) {
        // 保留已安装的版本
        const existingIndex = seen.get(key);
        if (item.installed && !items[existingIndex].installed) {
          items.splice(existingIndex, 1);
          seen.set(key, i - 1);
        } else {
          items.splice(i, 1);
        }
      } else {
        seen.set(key, i);
      }
    }
  }

  /**
   * 获取去重 key（子类可重写）
   */
  getDedupeKey(item) {
    return (item.name || item.fileName || '').toLowerCase();
  }

  // ==================== 安装/卸载 ====================

  /**
   * 从仓库安装项目
   * @param {string} itemPath - 项目在仓库中的路径
   * @param {RepoConfig} repo - 仓库配置
   * @param {string} targetName - 安装后的目标名称
   */
  async installFromRepo(itemPath, repo, targetName) {
    const safeItemPath = normalizeSafeRelativePath(itemPath, 'item path');
    const safeTargetName = normalizeSafeRelativePath(targetName, 'target name');
    const dest = resolveInsideRoot(this.installDir, safeTargetName, 'Target path');

    // 已存在则跳过
    if (fs.existsSync(dest)) {
      return { success: true, message: 'Already installed' };
    }

    // 下载仓库 ZIP
    const zipUrl = `https://github.com/${repo.owner}/${repo.name}/archive/refs/heads/${repo.branch}.zip`;
    const tempDir = path.join(os.tmpdir(), `${this.type}-${Date.now()}`);
    const zipPath = path.join(tempDir, 'repo.zip');

    try {
      fs.mkdirSync(tempDir, { recursive: true });

      // 下载 ZIP
      await this.downloadFile(zipUrl, zipPath);

      // 解压
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempDir, true);

      // 找到解压后的目录
      const extractedDirs = fs.readdirSync(tempDir).filter(f =>
        fs.statSync(path.join(tempDir, f)).isDirectory()
      );

      if (extractedDirs.length === 0) {
        throw new Error('Empty archive');
      }

      const repoDir = path.join(tempDir, extractedDirs[0]);
      const sourceFile = resolveInsideRoot(repoDir, safeItemPath, 'Source path');

      if (!fs.existsSync(sourceFile)) {
        throw new Error(`File not found: ${safeItemPath}`);
      }

      // 确保目标目录存在
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      // 复制文件或目录
      if (fs.statSync(sourceFile).isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        this.copyDirRecursive(sourceFile, dest);
      } else {
        fs.copyFileSync(sourceFile, dest);
      }

      // 清除缓存
      this.clearCache();

      return { success: true, message: 'Installed successfully' };
    } finally {
      // 清理临时目录
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        // 忽略清理错误
      }
    }
  }

  /**
   * 卸载项目
   */
  uninstall(targetName) {
    const safeTargetName = normalizeSafeRelativePath(targetName, 'target name');
    const dest = resolveInsideRoot(this.installDir, safeTargetName, 'Target path');

    if (fs.existsSync(dest)) {
      if (fs.statSync(dest).isDirectory()) {
        fs.rmSync(dest, { recursive: true, force: true });
      } else {
        fs.unlinkSync(dest);
      }
      this.clearCache();
      return { success: true, message: 'Uninstalled successfully' };
    }

    return { success: true, message: 'Not installed' };
  }

  // ==================== 工具方法 ====================

  /**
   * 从文件加载缓存
   */
  loadCacheEnvelope() {
    try {
      if (!fs.existsSync(this.cachePath)) return null;
      const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
      if (Array.isArray(data)) {
        return { fetchedAt: 0, reposFingerprint: null, items: data };
      }
      if (Array.isArray(data?.items)) {
        return {
          fetchedAt: Number(data.fetchedAt || data.time || 0) || 0,
          reposFingerprint: typeof data.reposFingerprint === 'string' ? data.reposFingerprint : null,
          items: data.items
        };
      }
    } catch (err) {
      // Ignore malformed cache files and refresh remotely.
    }
    return null;
  }

  loadCacheFromFile() {
    const cached = this.loadCacheEnvelope();
    return cached?.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL
      ? cached.items
      : null;
  }

  saveCacheToFile(items, fetchedAt = Date.now(), reposFingerprint = null) {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify({
        fetchedAt,
        time: fetchedAt,
        reposFingerprint,
        items
      }));
    } catch (err) {
      // Ignore cache write failures.
    }
  }

  /**
   * 获取 GitHub Token
   */
  getTokenFromCommand(command, args = []) {
    try {
      return execFileSync(command, args, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      }).trim() || null;
    } catch (_) {
      return null;
    }
  }

  getTokenFromGitCredential(host) {
    const hostname = extractHostname(host);
    if (!hostname) return null;
    try {
      const output = execFileSync('git', ['credential', 'fill'], {
        input: `protocol=https\nhost=${hostname}\n\n`,
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      });
      const line = output.split(/\r?\n/).find(item => item.startsWith('password='));
      return line ? line.slice('password='.length).trim() || null : null;
    } catch (_) {
      return null;
    }
  }

  getGitHubToken(host = 'https://github.com') {
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
    try {
      const configPath = path.join(this.configDir, 'github-token.txt');
      if (fs.existsSync(configPath)) {
        const token = fs.readFileSync(configPath, 'utf8').trim();
        if (token) return token;
      }
    } catch (err) {
      // Continue to host-specific credential providers.
    }

    const hostname = extractHostname(host) || 'github.com';
    const cached = remoteCredentialCache.get('github', hostname);
    if (cached.hit) return cached.value;

    const hostToken = this.getTokenFromCommand('gh', ['auth', 'token', '--hostname', hostname]);
    if (hostToken) return remoteCredentialCache.set('github', hostname, hostToken);
    const globalToken = this.getTokenFromCommand('gh', ['auth', 'token']);
    if (globalToken) return remoteCredentialCache.set('github', hostname, globalToken);
    return remoteCredentialCache.set('github', hostname, this.getTokenFromGitCredential(host));
  }

  /**
   * GitHub API 请求
   */
  async fetchGitHubApi(url) {
    const token = this.getGitHubToken(url);
    const headers = {
      'User-Agent': 'cc-cli-repo-scanner',
      'Accept': 'application/vnd.github.v3+json'
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
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
            } catch (e) {
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

  /**
   * 获取原始文件内容
   */
  async fetchRawContent(repo, filePath) {
    const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.branch}/${filePath}`;

    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': 'cc-cli-repo-scanner' },
        timeout: 15000
      }, (res) => {
        // 处理重定向
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            https.get(redirectUrl, {
              headers: { 'User-Agent': 'cc-cli-repo-scanner' },
              timeout: 15000
            }, (res2) => {
              let data = '';
              res2.on('data', chunk => data += chunk);
              res2.on('end', () => {
                if (res2.statusCode === 200) {
                  resolve(data);
                } else {
                  reject(new Error(`Raw fetch error: ${res2.statusCode}`));
                }
              });
            }).on('error', reject);
            return;
          }
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`Raw fetch error: ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Raw fetch timeout'));
      });
    });
  }

  /**
   * 下载文件
   */
  async downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(dest);

      const request = https.get(url, {
        headers: { 'User-Agent': 'cc-cli-repo-scanner' },
        timeout: 60000
      }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          this.downloadFile(response.headers.location, dest).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });

      request.on('timeout', () => {
        request.destroy();
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * 递归复制目录
   */
  copyDirRecursive(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 解析 YAML frontmatter
   */
  parseFrontmatter(content) {
    const result = {
      frontmatter: {},
      body: content
    };

    content = content.trim().replace(/^\uFEFF/, '');

    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!match) {
      return result;
    }

    const frontmatterText = match[1];
    result.body = match[2].trim();

    const lines = frontmatterText.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result.frontmatter[key] = value;
    }

    return result;
  }
}

module.exports = {
  RepoScannerBase,
  CACHE_TTL
};
