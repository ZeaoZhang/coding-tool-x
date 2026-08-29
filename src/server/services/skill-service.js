/**
 * Skills 技能服务
 *
 * 管理 Claude Code Skills 的获取、安装、卸载
 * Skills 安装目录: ~/.claude/skills/
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execFileSync } = require('child_process');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const AdmZip = require('adm-zip');
const {
  parseSkillContent,
} = require('./format-converter');
const { maskToken } = require('./oauth-utils');
const { NATIVE_PATHS, HOME_DIR, PATHS } = require('../../config/paths');
const { getOmpPaths } = require('./omp-config');
const { discoverOmpSkills } = require('./omp-skill-discovery');
const { migratePiStorage } = require('./pi-omp-migration');
const { resolveManagedPlatform } = require('./platform-resolution');
const {
  normalizeSafeRelativePath,
  pathHasProtectedSegment,
  resolveInsideRoot
} = require('./config-artifact-paths');
const remoteCredentialCache = require('./remote-credential-cache');

const SUPPORTED_REPO_PROVIDERS = ['github', 'gitlab', 'local'];
const DEFAULT_GITHUB_HOST = 'https://github.com';
const DEFAULT_GITLAB_HOST = 'https://gitlab.com';

function cloneRepos(repos = []) {
  return repos.map(repo => ({ ...repo }));
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

function normalizeRepoToken(token = '') {
  return String(token || '').trim();
}

function isWindowsAbsolutePath(input = '') {
  return /^[a-zA-Z]:[\\/]/.test(String(input || ''));
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

function expandHomePath(input = '') {
  const normalized = String(input || '').trim();
  if (!normalized) return '';
  if (normalized.startsWith('~/')) {
    return path.join(HOME_DIR, normalized.slice(2));
  }
  if (normalized === '~') {
    return HOME_DIR;
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
  const directory = normalizeRepoDirectory(repo.directory);
  const branch = String(repo.branch || 'main').trim() || 'main';
  if (repo.provider === 'local') {
    return `local:${repo.localPath}::${directory}`;
  }
  if (repo.provider === 'gitlab') {
    return `gitlab:${repo.host}::${repo.projectPath}::${branch}::${directory}`;
  }
  return `github:${repo.host}::${repo.owner}/${repo.name}::${branch}::${directory}`;
}

function isRootSkillFile(filePath = '') {
  return filePath === 'SKILL.md' || filePath.endsWith('/SKILL.md');
}

function normalizeSkillRelativePath(input, label = 'skill directory', options = {}) {
  return normalizeSafeRelativePath(input, label, {
    allowHiddenSegments: true,
    ...options
  });
}

const DEFAULT_REPOS_BY_PLATFORM = {
  claude: [],
  codex: [],
  gemini: [],
  opencode: [],
  omp: []
};

const CLAUDE_SKILLS_DIR = NATIVE_PATHS.claude.skills
  || path.join(NATIVE_PATHS.claude.dir || path.dirname(NATIVE_PATHS.claude.settings), 'skills');

const PLATFORM_CONFIG = {
  claude: {
    installDir: CLAUDE_SKILLS_DIR,
    storageDir: PATHS.localSkills.claude,
    reposFile: PATHS.skillRepos.claude,
    cacheFile: PATHS.skillCaches.claude
  },
  codex: {
    installDir: path.join(HOME_DIR, '.codex', 'skills'),
    storageDir: PATHS.localSkills.codex,
    reposFile: PATHS.skillRepos.codex,
    cacheFile: PATHS.skillCaches.codex
  },
  gemini: {
    installDir: path.join(HOME_DIR, '.gemini', 'skills'),
    storageDir: PATHS.localSkills.gemini,
    reposFile: PATHS.skillRepos.gemini,
    cacheFile: PATHS.skillCaches.gemini
  },
  opencode: {
    installDir: path.join(NATIVE_PATHS.opencode.config, 'skills'),
    storageDir: PATHS.localSkills.opencode,
    reposFile: PATHS.skillRepos.opencode,
    cacheFile: PATHS.skillCaches.opencode
  },
  omp: {
    // Resolved dynamically through getOmpPaths(); this value is only a
    // compatibility fallback for callers inspecting PLATFORM_CONFIG.
    installDir: NATIVE_PATHS.omp.skills,
    storageDir: PATHS.localSkills.omp,
    reposFile: PATHS.skillRepos.omp,
    cacheFile: PATHS.skillCaches.omp
  }
};

// 缓存有效期（5分钟）
const CACHE_TTL = 5 * 60 * 1000;
const OMP_REMOTE_REFRESH_TIMEOUT_MS = 3000;

class SkillService {
  constructor(platform = 'claude') {
    this.platform = resolveManagedPlatform(platform).platform;
    if (this.platform === 'omp') {
      const migration = migratePiStorage(PATHS);
      for (const warning of migration.warnings) {
        console.warn(`[SkillService] ${warning}`);
      }
    }
    this.configDir = PATHS.config;

    const platformConfig = PLATFORM_CONFIG[this.platform];
    this.installDir = this.platform === 'omp'
      ? getOmpPaths().skills
      : platformConfig.installDir;
    this.storageDir = platformConfig.storageDir;
    this.reposConfigPath = platformConfig.reposFile;
    this.cachePath = platformConfig.cacheFile;

    // Prepared projections are keyed by cwd; raw repository skills are cwd-independent.
    this.skillsCache = null;
    this.cacheTime = 0;
    this._preparedSkillsCache = new Map();
    this._listSkillsInflight = new Map();
    this._remoteSkillsCache = null;
    this._remoteSkillsFetchedAt = 0;
    this._remoteRefreshPromise = null;
    this._cacheGeneration = 0;
    this.ompRemoteSkillsCache = null;
    this.ompRemoteRefreshPromise = null;
    this.ompRemoteRefreshTimeoutMs = OMP_REMOTE_REFRESH_TIMEOUT_MS;
    this.ompRemoteRefreshGeneration = 0;
    this._ompPreparedSkillsCache = new Map();
    this._ompListInflight = new Map();
    this._ompRemoteFetchedAt = 0;
    this.ompPreparedSkillsCache = null;
    this.ompPreparedSkillsCacheKey = null;

    this.githubTokenCache = new Map();

    // 确保目录存在
    this.ensureDirs();
  }

  refreshOmpPaths() {
    if (this.platform !== 'omp') return;
    const nextInstallDir = getOmpPaths().skills;
    if (this.installDir !== nextInstallDir) {
      this.installDir = nextInstallDir;
      this.clearCache({ invalidateRemoteRefresh: true });
    }
  }

  ensureDirs() {
    if (!fs.existsSync(this.installDir)) {
      fs.mkdirSync(this.installDir, { recursive: true });
    }
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
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

  clearCache({ removeFile = false, invalidateRemoteRefresh = removeFile } = {}) {
    this._cacheGeneration++;
    this.skillsCache = null;
    this.cacheTime = 0;
    this._preparedSkillsCache.clear();
    this._listSkillsInflight.clear();
    this._remoteSkillsCache = null;
    this._remoteSkillsFetchedAt = 0;
    this._remoteRefreshPromise = null;
    this._ompPreparedSkillsCache.clear();
    this._ompListInflight.clear();
    this._ompRemoteFetchedAt = 0;
    this.ompPreparedSkillsCache = null;
    this.ompPreparedSkillsCacheKey = null;
    this.ompRemoteSkillsCache = null;
    this.githubTokenCache.clear();
    remoteCredentialCache.clear('github');
    remoteCredentialCache.clear('gitlab');
    if (invalidateRemoteRefresh) {
      this.ompRemoteRefreshGeneration++;
      this.ompRemoteRefreshPromise = null;
    }

    if (removeFile) {
      try {
        if (fs.existsSync(this.cachePath)) {
          fs.unlinkSync(this.cachePath);
        }
      } catch (err) {
        console.warn('[SkillService] Failed to delete cache file:', err.message);
      }
    }
  }

  _skillCwdKey(options = {}) {
    return options.cwd ? path.resolve(options.cwd) : '';
  }

  _preparedEntry(cwdKey) {
    const cached = this._preparedSkillsCache.get(cwdKey);
    if (cached) return cached;
    if (!cwdKey && Array.isArray(this.skillsCache) && this.cacheTime > 0) {
      return { value: this.skillsCache, cachedAt: this.cacheTime, generation: this._cacheGeneration };
    }
    return null;
  }

  _storePrepared(cwdKey, skills, generation = this._cacheGeneration) {
    const value = Array.isArray(skills) ? skills.map(skill => ({ ...skill })) : [];
    if (generation !== this._cacheGeneration) {
      return value.map(skill => ({ ...skill }));
    }
    const entry = { value, cachedAt: Date.now(), generation };
    this._preparedSkillsCache.set(cwdKey, entry);
    if (!cwdKey) {
      this.skillsCache = value;
      this.cacheTime = entry.cachedAt;
    }
    return value.map(skill => ({ ...skill }));
  }

  _readRawRemoteCache() {
    const now = Date.now();
    if (Array.isArray(this._remoteSkillsCache)) {
      return {
        skills: this._remoteSkillsCache,
        fetchedAt: this._remoteSkillsFetchedAt,
        fresh: this._remoteSkillsFetchedAt > 0 && now - this._remoteSkillsFetchedAt < CACHE_TTL
      };
    }

    const cached = this._readCacheEnvelope();
    if (!cached) return null;
    this._remoteSkillsCache = cached.skills;
    this._remoteSkillsFetchedAt = cached.fetchedAt;
    return {
      skills: cached.skills,
      fetchedAt: cached.fetchedAt,
      fresh: cached.fetchedAt > 0 && now - cached.fetchedAt < CACHE_TTL
    };
  }

  async _refreshRemoteSkills(staleSkills = null) {
    if (this._remoteRefreshPromise) return this._remoteRefreshPromise;
    const generation = this._cacheGeneration;
    const refreshPromise = (async () => {
      const repos = this.loadRepos();
      const enabledRepos = repos.filter(repo => repo.enabled);
      const enabledRemoteRepos = enabledRepos.filter(repo => repo.provider !== 'local');
      const skills = [];
      let remoteFailureCount = 0;
      const results = await Promise.allSettled(
        enabledRepos.map(async repo => {
          let timer;
          try {
            return await Promise.race([
              this.fetchRepoSkills(repo),
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
          skills.push(...(Array.isArray(result.value) ? result.value : []));
          return;
        }
        if (repo.provider !== 'local') remoteFailureCount++;
        console.warn(`[SkillService] Fetch repo ${repo.owner || repo.projectPath}/${repo.name || ''} failed:`, result.reason?.message);
      });

      const failureCount = results.filter(result => result.status === 'rejected').length;
      const useStale = Array.isArray(staleSkills)
        && enabledRemoteRepos.length > 0
        && (
          (remoteFailureCount === enabledRemoteRepos.length && skills.length === 0)
          || (remoteFailureCount > 0 && staleSkills.length > skills.length)
        );
      const publishedSkills = useStale ? staleSkills : skills;
      const fetchedAt = useStale ? 0 : Date.now();
      if (generation === this._cacheGeneration) {
        this._remoteSkillsCache = publishedSkills;
        this._remoteSkillsFetchedAt = fetchedAt;
        if (!useStale) this.saveCacheToFile(publishedSkills, fetchedAt);
      }
      return {
        skills: publishedSkills,
        enabledRemoteCount: enabledRemoteRepos.length,
        remoteFailureCount,
        failureCount,
        fetchedAt
      };
    })();

    const trackedPromise = refreshPromise.finally(() => {
      if (this._remoteRefreshPromise === trackedPromise) {
        this._remoteRefreshPromise = null;
      }
    });
    this._remoteRefreshPromise = trackedPromise;
    return trackedPromise;
  }

  async _listSkillsUncached(forceRefresh, options, cwdKey, generation) {
    const cached = this._readRawRemoteCache();
    if (!forceRefresh && cached?.fresh) {
      return this._storePrepared(cwdKey, this.prepareSkills(cached.skills, options), generation);
    }

    let refreshed;
    try {
      refreshed = await this._refreshRemoteSkills(cached?.skills || null);
    } catch (error) {
      if (cached) {
        return this._storePrepared(cwdKey, this.prepareSkills(cached.skills, options), generation);
      }
      throw error;
    }

    return this._storePrepared(cwdKey, this.prepareSkills(refreshed.skills, options), generation);
  }

  prepareSkills(skills = [], options = {}) {
    this.refreshOmpPaths();
    const preparedSkills = Array.isArray(skills)
      ? skills.map(skill => ({ ...skill }))
      : [];

    if (this.platform === 'omp') {
      preparedSkills.unshift(...discoverOmpSkills(this, options));
    }
    this.mergeLocalSkills(preparedSkills);
    if (this.platform !== 'omp') {
      this.mergeInstalledSkills(preparedSkills);
    }
    this.deduplicateSkills(preparedSkills);
    preparedSkills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    this.updateInstallStatus(preparedSkills, { pathsRefreshed: this.platform === 'omp' });

    return preparedSkills;
  }

  getDefaultSkillDirectory(repo) {
    if (repo.provider === 'local') {
      return path.basename(repo.localPath || '') || 'skill';
    }
    if (repo.provider === 'gitlab') {
      const projectPath = normalizeRepoPath(repo.projectPath);
      return projectPath.split('/').pop() || 'skill';
    }
    return repo.name || 'skill';
  }

  resolveSkillDirectory(fullDirectory, baseDir, repo) {
    const normalizedFullDirectory = normalizeRepoPath(fullDirectory);
    const normalizedBaseDir = normalizeRepoDirectory(baseDir);

    if (normalizedBaseDir) {
      if (normalizedFullDirectory === normalizedBaseDir) {
        return normalizeRepoPath(path.basename(normalizedBaseDir)) || this.getDefaultSkillDirectory(repo);
      }
      if (normalizedFullDirectory.startsWith(`${normalizedBaseDir}/`)) {
        return normalizedFullDirectory.slice(normalizedBaseDir.length + 1);
      }
    }

    if (!normalizedFullDirectory) {
      return this.getDefaultSkillDirectory(repo);
    }

    return normalizedFullDirectory;
  }

  normalizeRepoConfig(repo = {}) {
    const provider = SUPPORTED_REPO_PROVIDERS.includes(repo.provider)
      ? repo.provider
      : (repo.localPath ? 'local' : (repo.projectPath ? 'gitlab' : 'github'));

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
      normalized.projectPath = normalizeRepoPath(repo.projectPath || [repo.owner, repo.name].filter(Boolean).join('/'));
      if (!normalized.projectPath) {
        throw new Error('Missing GitLab project path');
      }
      normalized.name = stripGitSuffix(normalized.projectPath.split('/').pop() || '');
      normalized.owner = normalized.projectPath.split('/')[0] || '';
    } else {
      normalized.host = normalizeRepoHost(repo.host, 'github');
      normalized.owner = String(repo.owner || '').trim();
      normalized.name = stripGitSuffix(repo.name || '');
      if (!normalized.owner || !normalized.name) {
        throw new Error('Missing GitHub repo info');
      }
    }

    normalized.repoUrl = repo.repoUrl || buildRepoUrl(normalized);
    normalized.label = buildRepoLabel(normalized);
    normalized.id = buildRepoId(normalized);

    if (provider !== 'local') {
      const token = normalizeRepoToken(repo.token);
      if (token) {
        normalized.token = token;
      }
    }

    return normalized;
  }

  normalizeRepos(repos = []) {
    return repos.map(repo => this.normalizeRepoConfig(repo));
  }

  /**
   * 加载仓库配置
   */
  loadRepos() {
    try {
      if (fs.existsSync(this.reposConfigPath)) {
        const data = JSON.parse(fs.readFileSync(this.reposConfigPath, 'utf-8'));
        if (Array.isArray(data.repos)) {
          return this.normalizeRepos(data.repos);
        }
      }
    } catch (err) {
      console.error('[SkillService] Load repos config error:', err.message);
    }
    return this.normalizeRepos(cloneRepos(DEFAULT_REPOS_BY_PLATFORM[this.platform] || DEFAULT_REPOS_BY_PLATFORM.claude));
  }

  /**
   * 保存仓库配置
   */
  saveRepos(repos) {
    const normalizedRepos = this.normalizeRepos(repos);
    fs.writeFileSync(this.reposConfigPath, JSON.stringify({ repos: normalizedRepos }, null, 2));
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
    const sourceRepos = Array.isArray(repos) ? repos : this.loadRepos();
    return sourceRepos.map(repo => this.toClientRepo(repo));
  }

  findStoredRepo(repo = {}) {
    const repoId = String(repo.id || repo.repoId || '').trim();
    const repos = this.loadRepos();

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

  /**
   * 添加仓库
   * @param {Object} repo - 仓库配置
   * @param {string} repo.owner - 仓库所有者
   * @param {string} repo.name - 仓库名称
   * @param {string} repo.branch - 分支名称
   * @param {string} [repo.directory] - 扫描的子目录路径（可选）
   * @param {boolean} repo.enabled - 是否启用
   */
  addRepo(repo) {
    const repos = this.loadRepos();
    const normalizedRepo = this.normalizeRepoConfig(repo);
    const existingIndex = repos.findIndex(r => r.id === normalizedRepo.id);

    if (existingIndex >= 0) {
      repos[existingIndex] = normalizedRepo;
    } else {
      repos.push(normalizedRepo);
    }

    this.saveRepos(repos);
    this.clearCache({ removeFile: true });
    return this.loadRepos();
  }

  /**
   * 删除仓库
   * @param {string} owner - 仓库所有者
   * @param {string} name - 仓库名称
   * @param {string} [directory=''] - 子目录路径
   */
  removeRepo(owner, name, directory = '', repoId = '') {
    const repos = this.loadRepos();
    const normalizedDirectory = normalizeRepoDirectory(directory);
    const filtered = repos.filter(r => {
      if (repoId) {
        return r.id !== repoId;
      }
      return !(
        (r.owner || '') === owner &&
        (r.name || '') === name &&
        normalizeRepoDirectory(r.directory) === normalizedDirectory
      );
    });
    this.saveRepos(filtered);
    this.clearCache({ removeFile: true });
    return this.loadRepos();
  }

  /**
   * 切换仓库启用状态
   * @param {string} owner - 仓库所有者
   * @param {string} name - 仓库名称
   * @param {string} [directory=''] - 子目录路径
   * @param {boolean} enabled - 是否启用
   */
  toggleRepo(owner, name, directory = '', enabled, repoId = '') {
    const repos = this.loadRepos();
    const normalizedDirectory = normalizeRepoDirectory(directory);
    const repo = repos.find(r => {
      if (repoId) {
        return r.id === repoId;
      }
      return (
        (r.owner || '') === owner &&
        (r.name || '') === name &&
        normalizeRepoDirectory(r.directory) === normalizedDirectory
      );
    });
    if (repo) {
      repo.enabled = enabled;
      this.saveRepos(repos);
      this.clearCache({ removeFile: true });
    }
    return this.loadRepos();
  }

  updateRepoAuth(owner, name, directory = '', token = '', clearToken = false, repoId = '') {
    const repos = this.loadRepos();
    const normalizedDirectory = normalizeRepoDirectory(directory);
    const repo = repos.find(r => {
      if (repoId) {
        return r.id === repoId;
      }
      return (
        (r.owner || '') === owner &&
        (r.name || '') === name &&
        normalizeRepoDirectory(r.directory) === normalizedDirectory
      );
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

    this.saveRepos(repos);
    this.clearCache({ removeFile: true });
    return this.loadRepos();
  }

  /**
   * 获取所有技能列表（带缓存）
   */
  async listSkills(forceRefresh = false, options = {}) {
    if (this.platform === 'omp') {
      return this.listOmpSkills(forceRefresh, options);
    }

    const cwdKey = this._skillCwdKey(options);
    const now = Date.now();
    const prepared = this._preparedEntry(cwdKey);
    if (!forceRefresh && prepared && prepared.generation === this._cacheGeneration
      && now - prepared.cachedAt < CACHE_TTL) {
      return prepared.value.map(skill => ({ ...skill }));
    }

    const generation = this._cacheGeneration;
    const inflightKey = `${this.platform}:${cwdKey}:${generation}`;
    const existing = this._listSkillsInflight.get(inflightKey);
    if (existing) return existing;

    const promise = this._listSkillsUncached(forceRefresh, options, cwdKey, generation)
      .then(skills => skills.map(skill => ({ ...skill })))
      .finally(() => {
        if (this._listSkillsInflight.get(inflightKey) === promise) {
          this._listSkillsInflight.delete(inflightKey);
        }
      });
    this._listSkillsInflight.set(inflightKey, promise);
    return promise;
  }

  async listOmpSkills(forceRefresh = false, options = {}) {
    const cwdKey = this._skillCwdKey(options);
    const now = Date.now();
    const cached = this._ompPreparedSkillsCache.get(cwdKey)
      || (this.ompPreparedSkillsCacheKey === cwdKey && Array.isArray(this.ompPreparedSkillsCache)
        ? { value: this.ompPreparedSkillsCache, cachedAt: this.cacheTime, generation: this._cacheGeneration }
        : null);
    if (!forceRefresh && cached && cached.generation === this._cacheGeneration
      && now - cached.cachedAt < CACHE_TTL) {
      return cached.value.map(skill => ({ ...skill }));
    }

    const inflightKey = `omp:${cwdKey}:${this._cacheGeneration}:${this.ompRemoteRefreshGeneration}`;
    const existing = this._ompListInflight.get(inflightKey);
    if (existing) return existing;

    const promise = this._listOmpSkillsUncached(forceRefresh, {
      ...options,
      cwd: cwdKey || options.cwd,
      force: forceRefresh
    }, cwdKey)
      .then(skills => skills.map(skill => ({ ...skill })))
      .finally(() => {
        if (this._ompListInflight.get(inflightKey) === promise) {
          this._ompListInflight.delete(inflightKey);
        }
      });
    this._ompListInflight.set(inflightKey, promise);
    return promise;
  }

  async _listOmpSkillsUncached(forceRefresh, options, cwdKey) {
    const requestGeneration = this.ompRemoteRefreshGeneration;
    const envelope = this._readCacheEnvelope();
    const cachedRemoteSkills = Array.isArray(this.ompRemoteSkillsCache)
      ? this.ompRemoteSkillsCache
      : envelope?.skills;
    const fetchedAt = this._ompRemoteFetchedAt || envelope?.fetchedAt || 0;

    if (!forceRefresh && Array.isArray(cachedRemoteSkills)
      && fetchedAt > 0 && Date.now() - fetchedAt < CACHE_TTL) {
      return this.prepareAndCacheOmpSkills(cachedRemoteSkills, options, requestGeneration, cwdKey);
    }

    const timeoutToken = Symbol('omp-refresh-timeout');
    const refreshPromise = this.startOmpRemoteRefresh();
    const timeoutMs = Math.max(0, Number(this.ompRemoteRefreshTimeoutMs) || OMP_REMOTE_REFRESH_TIMEOUT_MS);
    let timeoutId;
    const timeoutPromise = new Promise(resolve => {
      timeoutId = setTimeout(() => resolve(timeoutToken), timeoutMs);
    });

    let remoteResult;
    try {
      remoteResult = await Promise.race([refreshPromise, timeoutPromise]);
    } catch (err) {
      console.warn('[SkillService] OMP remote refresh failed:', err.message);
    } finally {
      clearTimeout(timeoutId);
    }

    const hasCachedRemoteSkills = Array.isArray(cachedRemoteSkills);
    const hasRemoteResult = Boolean(remoteResult && remoteResult !== timeoutToken);
    const refreshIsCurrent = requestGeneration === this.ompRemoteRefreshGeneration
      && (!hasRemoteResult || remoteResult.refreshGeneration === this.ompRemoteRefreshGeneration);
    const failureCount = remoteResult?.failureCount ?? 1;
    let remoteSkills;

    if (!refreshIsCurrent) {
      remoteSkills = hasCachedRemoteSkills ? cachedRemoteSkills : [];
    } else if (hasRemoteResult && failureCount === 0) {
      remoteSkills = remoteResult.skills;
    } else if (hasRemoteResult && remoteResult.skills.length > 0) {
      remoteSkills = hasCachedRemoteSkills
        ? [...remoteResult.skills, ...cachedRemoteSkills]
        : remoteResult.skills;
    } else {
      remoteSkills = hasCachedRemoteSkills ? cachedRemoteSkills : [];
    }

    if (refreshIsCurrent && (!hasCachedRemoteSkills || (hasRemoteResult && remoteSkills.length > 0))) {
      this.ompRemoteSkillsCache = remoteSkills;
    }
    return this.prepareAndCacheOmpSkills(remoteSkills, options, requestGeneration, cwdKey);
  }

  _storeOmpPrepared(cwdKey, prepared) {
    const value = Array.isArray(prepared) ? prepared.map(skill => ({ ...skill })) : [];
    const entry = { value, cachedAt: Date.now(), generation: this._cacheGeneration };
    this._ompPreparedSkillsCache.set(cwdKey, entry);
    this.ompPreparedSkillsCache = value;
    this.ompPreparedSkillsCacheKey = cwdKey;
    this.skillsCache = value;
    this.cacheTime = entry.cachedAt;
    return value.map(skill => ({ ...skill }));
  }

  prepareAndCacheOmpSkills(
    remoteSkills,
    options = {},
    expectedGeneration = this.ompRemoteRefreshGeneration,
    cwdKey = this._skillCwdKey(options)
  ) {
    if (expectedGeneration !== this.ompRemoteRefreshGeneration) {
      return this.prepareSkills([], options);
    }

    const prepared = this.prepareSkills(remoteSkills, options);
    if (expectedGeneration !== this.ompRemoteRefreshGeneration) {
      return this.prepareSkills([], options);
    }

    return this._storeOmpPrepared(cwdKey, prepared);
  }

  startOmpRemoteRefresh() {
    if (this.ompRemoteRefreshPromise) {
      return this.ompRemoteRefreshPromise;
    }

    const refreshPromise = (async () => {
      const skills = [];
      const refreshGeneration = this.ompRemoteRefreshGeneration;

      const repos = this.loadRepos().filter(repo => repo.enabled);
      const results = await Promise.allSettled(repos.map(repo => this.fetchRepoSkills(repo)));
      let failureCount = 0;
      let remoteFailureCount = 0;

      results.forEach((result, index) => {
        const repo = repos[index];
        if (result.status === 'fulfilled') {
          skills.push(...result.value);
          return;
        }
        failureCount++;
        if (repo.provider !== 'local') {
          remoteFailureCount++;
        }
        console.warn(
          `[SkillService] Fetch OMP repo ${repo?.label || repo?.id || ''} failed:`,
          result.reason?.message
        );
      });

      if (
        refreshGeneration === this.ompRemoteRefreshGeneration &&
        (failureCount === 0 || skills.length > 0)
      ) {
        const cachedRemoteSkills = this.ompRemoteSkillsCache
          || this.loadCacheFromFile()
          || [];
        const publishedSkills = failureCount === 0
          ? skills
          : [...skills, ...cachedRemoteSkills];
        const publishedAt = Date.now();
        this.ompRemoteSkillsCache = publishedSkills;
        this._ompRemoteFetchedAt = publishedAt;
        this._ompPreparedSkillsCache.clear();
        this.ompPreparedSkillsCache = null;
        this.ompPreparedSkillsCacheKey = null;
        if (failureCount === 0) {
          this.saveCacheToFile(skills, publishedAt);
        }
      }

      return { skills, failureCount, remoteFailureCount, refreshGeneration };

    })();

    const trackedPromise = refreshPromise.finally(() => {
      if (this.ompRemoteRefreshPromise === trackedPromise) {
        this.ompRemoteRefreshPromise = null;
      }
    });
    this.ompRemoteRefreshPromise = trackedPromise;
    return trackedPromise;
  }

  /**
   * 从文件加载缓存
   */
  _readCacheEnvelope() {
    try {
      if (!fs.existsSync(this.cachePath)) return null;
      const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
      if (Array.isArray(data)) {
        return { skills: data, fetchedAt: 0 };
      }
      if (Array.isArray(data?.skills)) {
        return {
          skills: data.skills,
          fetchedAt: Number(data.fetchedAt || data.time || 0) || 0
        };
      }
    } catch (err) {
      // Ignore malformed cache files and refresh from repositories.
    }
    return null;
  }

  /**
   * 从文件加载缓存
   */
  loadCacheFromFile() {
    return this._readCacheEnvelope()?.skills || null;
  }

  /**
   * 保存缓存到文件
   */
  saveCacheToFile(skills, fetchedAt = Date.now()) {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify({
        fetchedAt,
        time: fetchedAt,
        skills
      }));
    } catch (err) {
      // Ignore cache write failures; callers retain the in-memory value.
    }
  }

  /**
   * 更新技能的安装状态
   */
  updateInstallStatus(skills, { pathsRefreshed = false } = {}) {
    if (this.platform === 'omp' && !pathsRefreshed) {
      this.refreshOmpPaths();
    }

    for (const skill of skills) {
      if (skill.sourceProvider || skill.sourcePath || skill.readonly) {
        skill.installed = skill.installed !== false;
      } else {
        skill.installed = this.isInstalled(skill.directory, { refresh: false });
      }
    }
  }

  /**
   * 从 GitHub 仓库获取技能列表（使用 Tree API 一次性获取）
   * 支持指定子目录扫描
   */
  async fetchRepoSkills(repo) {
    if (repo.provider === 'local') {
      return this.fetchLocalRepoSkills(repo);
    }

    if (repo.provider === 'gitlab') {
      return this.fetchGitLabRepoSkills(repo);
    }

    return this.fetchGitHubRepoSkills(repo);
  }

  async fetchGitHubRepoSkills(repo) {
    const skills = [];

    try {
      const treeItems = await this.fetchGitHubRepoTree(repo);

      if (!treeItems.length) {
        console.warn(`[SkillService] Empty tree for ${repo.owner}/${repo.name}`);
        return skills;
      }

      // 获取基础目录（如果配置了 directory）
      const baseDir = repo.directory || '';
      const baseDirPrefix = baseDir ? `${baseDir}/` : '';

      const skillFiles = treeItems.filter(item => {
        if (item.type !== 'blob' || !isRootSkillFile(item.path)) {
          return false;
        }
        if (baseDir && !item.path.startsWith(baseDirPrefix)) {
          return false;
        }
        return true;
      });

      // 并行获取所有 SKILL.md 的内容（限制并发数）
      const batchSize = 5;
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < skillFiles.length; i += batchSize) {
        const batch = skillFiles.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(file => this.fetchAndParseSkill(file, repo, baseDir))
        );

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            skills.push(result.value);
            successCount++;
          } else {
            failCount++;
          }
        }
      }

      console.log(`[SkillService] ${repo.owner}/${repo.name}: ${successCount} skills loaded, ${failCount} failed`);
    } catch (err) {
      console.error(`[SkillService] Fetch repo ${repo.owner}/${repo.name} error:`, err.message);
      throw err;
    }

    return skills;
  }

  async fetchGitLabRepoSkills(repo) {
    const skills = [];

    try {
      const tree = await this.fetchGitLabTree(repo);
      const baseDir = repo.directory || '';
      const baseDirPrefix = baseDir ? `${baseDir}/` : '';
      const skillFiles = tree.filter(item => {
        if (item.type !== 'blob' || !isRootSkillFile(item.path)) {
          return false;
        }
        if (baseDir && !item.path.startsWith(baseDirPrefix)) {
          return false;
        }
        return true;
      });

      const batchSize = 5;
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < skillFiles.length; i += batchSize) {
        const batch = skillFiles.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(file => this.fetchAndParseSkill(file, repo, baseDir))
        );

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            skills.push(result.value);
            successCount++;
          } else {
            failCount++;
          }
        }
      }

      console.log(`[SkillService] ${repo.projectPath}: ${successCount} skills loaded, ${failCount} failed`);
    } catch (err) {
      console.error(`[SkillService] Fetch GitLab repo ${repo.projectPath} error:`, err.message);
      throw err;
    }

    return skills;
  }

  async fetchLocalRepoSkills(repo) {
    const skills = [];
    const repoRoot = repo.localPath;
    const safeDirectory = normalizeSkillRelativePath(repo.directory || '', 'skill repository directory', {
      allowEmpty: true
    });
    const scanRoot = safeDirectory
      ? resolveInsideRoot(repoRoot, safeDirectory, 'Skill repository directory', { allowHiddenSegments: true })
      : repoRoot;

    if (!fs.existsSync(scanRoot)) {
      throw new Error(`Local repo path not found: ${scanRoot}`);
    }

    this.scanRepoLocalDir(scanRoot, repoRoot, skills, repo);
    return skills;
  }

  /**
   * 获取并解析单个 SKILL.md
   * @param {Object} file - GitHub tree 文件对象
   * @param {Object} repo - 仓库配置
   * @param {string} baseDir - 基础目录（用于计算相对路径）
   */
  async fetchAndParseSkill(file, repo, baseDir = '') {
    try {
      const fullDirectory = normalizeRepoPath(file.path.replace(/(^|\/)SKILL\.md$/, ''));
      const directory = this.resolveSkillDirectory(fullDirectory, baseDir, repo);
      const content = await this.fetchSkillFileContent(repo, file);
      const metadata = this.parseSkillMd(content);

      return this.createSkillListItem({
        metadata,
        repo,
        directory,
        fullDirectory
      });
    } catch (err) {
      return null;
    }
  }

  /**
   * 递归扫描外部本地仓库目录
   */
  scanRepoLocalDir(currentDir, repoRoot, skills, repo) {
    const skillMdPath = path.join(currentDir, 'SKILL.md');

    if (fs.existsSync(skillMdPath)) {
      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const metadata = this.parseSkillMd(content);
        const fullDirectory = normalizeRepoPath(path.relative(repoRoot, currentDir));
        const directory = this.resolveSkillDirectory(fullDirectory, repo.directory || '', repo);

        skills.push(this.createSkillListItem({
          metadata,
          repo,
          directory,
          fullDirectory
        }));
      } catch (err) {
        console.warn(`[SkillService] Parse local repo skill ${currentDir} error:`, err.message);
      }
      return;
    }

    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        this.scanRepoLocalDir(path.join(currentDir, entry.name), repoRoot, skills, repo);
      }
    } catch (err) {
      console.warn(`[SkillService] Scan local repo ${currentDir} error:`, err.message);
    }
  }

  createSkillListItem({ metadata, repo, directory, fullDirectory }) {
    const repoDirectory = normalizeRepoDirectory(repo.directory);
    const labelFallback = directory.split('/').pop() || this.getDefaultSkillDirectory(repo);

    return {
      key: `${repo.id}:${fullDirectory || directory}`,
      name: metadata.name || labelFallback,
      description: metadata.description || '',
      directory,
      fullDirectory,
      installed: this.isInstalled(directory),
      readmeUrl: this.buildSkillReadmeUrl(repo, fullDirectory),
      repoProvider: repo.provider,
      repoOwner: repo.owner || null,
      repoName: repo.name || null,
      repoBranch: repo.branch,
      repoDirectory,
      repoHost: repo.host || null,
      repoProjectPath: repo.projectPath || null,
      repoLocalPath: repo.localPath || null,
      repoId: repo.id,
      repoUrl: repo.repoUrl || buildRepoUrl(repo),
      source: repo.provider === 'local' ? 'local-repo' : repo.provider,
      license: metadata.license
    };
  }

  buildSkillReadmeUrl(repo, fullDirectory = '') {
    const normalizedDirectory = normalizeRepoPath(fullDirectory);
    if (repo.provider === 'local') {
      return null;
    }
    if (repo.provider === 'gitlab') {
      const suffix = normalizedDirectory ? `/-/tree/${repo.branch}/${normalizedDirectory}` : `/-/tree/${repo.branch}`;
      return `${repo.host}/${repo.projectPath}${suffix}`;
    }
    const suffix = normalizedDirectory ? `tree/${repo.branch}/${normalizedDirectory}` : `tree/${repo.branch}`;
    return `${repo.host}/${repo.owner}/${repo.name}/${suffix}`;
  }

  async fetchSkillFileContent(repo, file) {
    if (repo.provider === 'gitlab') {
      return this.fetchGitLabFileContent(repo, file.path);
    }
    if (repo.provider === 'local') {
      const safeFilePath = normalizeSkillRelativePath(file.path, 'skill repository file path');
      const localFilePath = resolveInsideRoot(repo.localPath, safeFilePath, 'Skill repository file path', { allowHiddenSegments: true });
      return fs.readFileSync(localFilePath, 'utf-8');
    }
    return this.fetchGitHubBlobContent(file.sha, repo);
  }

  /**
   * 使用 GitHub Blob API 获取文件内容
   */
  async fetchGitHubBlobContent(sha, repo) {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/blobs/${sha}`;
    const data = await this.fetchGitHubApi(url, repo);
    if (!data || typeof data.content !== 'string') {
      throw new Error('Invalid GitHub blob response');
    }
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
  }

  /**
   * 获取 GitHub Token（从环境变量或配置文件）
   */
  getTokenFromConfigFile(fileName) {
    try {
      const configPath = path.join(this.configDir, fileName);
      if (fs.existsSync(configPath)) {
        return fs.readFileSync(configPath, 'utf-8').trim() || null;
      }
    } catch (err) {
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
      if (repoToken) return repoToken;
    }

    const host = typeof repoOrHost === 'string'
      ? repoOrHost
      : (repoOrHost?.host || DEFAULT_GITHUB_HOST);
    const hostname = extractHostname(host) || 'github.com';

    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
    const configToken = this.getTokenFromConfigFile('github-token.txt');
    if (configToken) return configToken;

    const cached = remoteCredentialCache.get('github', hostname);
    if (cached.hit) return cached.value;

    if (hostname) {
      const ghHostToken = this.getTokenFromCommand('gh', ['auth', 'token', '--hostname', hostname]);
      if (ghHostToken) {
        return remoteCredentialCache.set('github', hostname, ghHostToken);
      }
    }

    const ghToken = this.getTokenFromCommand('gh', ['auth', 'token']);
    if (ghToken) {
      return remoteCredentialCache.set('github', hostname, ghToken);
    }

    const credentialToken = this.getTokenFromGitCredential(host);
    return remoteCredentialCache.set('github', hostname, credentialToken);
  }

  getGitLabToken(repoOrHost = DEFAULT_GITLAB_HOST) {
    if (repoOrHost && typeof repoOrHost === 'object') {
      const repoToken = this.resolveRepoToken(repoOrHost);
      if (repoToken) return repoToken;
    }

    const host = typeof repoOrHost === 'string'
      ? repoOrHost
      : (repoOrHost?.host || DEFAULT_GITLAB_HOST);
    const hostname = extractHostname(host) || 'gitlab.com';

    if (process.env.GITLAB_TOKEN) return process.env.GITLAB_TOKEN;
    if (process.env.GITLAB_PRIVATE_TOKEN) return process.env.GITLAB_PRIVATE_TOKEN;
    const configToken = this.getTokenFromConfigFile('gitlab-token.txt');
    if (configToken) return configToken;

    const cached = remoteCredentialCache.get('gitlab', hostname);
    if (cached.hit) return cached.value;

    const glabHostToken = this.getTokenFromCommand('glab', ['auth', 'token', '--hostname', hostname]);
    if (glabHostToken) {
      return remoteCredentialCache.set('gitlab', hostname, glabHostToken);
    }

    const glabToken = this.getTokenFromCommand('glab', ['auth', 'token']);
    if (glabToken) {
      return remoteCredentialCache.set('gitlab', hostname, glabToken);
    }

    const credentialToken = this.getTokenFromGitCredential(host);
    return remoteCredentialCache.set('gitlab', hostname, credentialToken);
  }

  /**
   * 通用 GitHub API 请求
   */
  async fetchGitHubApi(url, repo = null) {
    const token = this.getGitHubToken(repo || url);
    const headers = {
      'User-Agent': 'cc-cli-skill-service',
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

  async fetchGitHubRepoTree(repo) {
    const treeUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${repo.branch}?recursive=1`;
    const tree = await this.fetchGitHubApi(treeUrl, repo);
    if (tree?.truncated) {
      console.warn(`[SkillService] GitHub tree truncated for ${repo.owner}/${repo.name}`);
    }
    return tree?.tree || [];
  }

  async fetchGitLabApi(url, { raw = false, repo = null } = {}) {
    const token = this.getGitLabToken(repo || url);
    const headers = {
      'User-Agent': 'cc-cli-skill-service'
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
            } catch (e) {
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

  async fetchGitLabTree(repo) {
    const tree = [];
    const projectId = encodeURIComponent(repo.projectPath);
    let page = 1;

    while (page) {
      const url = `${repo.host}/api/v4/projects/${projectId}/repository/tree?ref=${encodeURIComponent(repo.branch)}&recursive=true&per_page=100&page=${page}`;
      const response = await this.fetchGitLabApi(url, { repo });
      tree.push(...(response.data || []).map(item => ({
        ...item,
        type: item.type === 'tree' ? 'tree' : 'blob'
      })));

      const nextPage = Number(response.headers['x-next-page'] || 0);
      page = Number.isFinite(nextPage) && nextPage > 0 ? nextPage : 0;
    }

    return tree;
  }

  async fetchGitLabFileContent(repo, filePath) {
    const projectId = encodeURIComponent(repo.projectPath);
    const normalizedFilePath = encodeURIComponent(normalizeRepoPath(filePath));
    const url = `${repo.host}/api/v4/projects/${projectId}/repository/files/${normalizedFilePath}/raw?ref=${encodeURIComponent(repo.branch)}`;
    return this.fetchGitLabApi(url, { raw: true, repo });
  }

  /**
   * 使用 GitHub API 获取目录内容
   */
  async fetchGitHubContents(owner, name, path, branch, repo = null) {
    const url = `https://api.github.com/repos/${owner}/${name}/contents/${path}?ref=${branch}`;
    const token = this.getGitHubToken(repo || url);
    const headers = {
      'User-Agent': 'cc-cli-skill-service',
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
            } catch (e) {
              reject(new Error('Invalid JSON response'));
            }
          } else if (res.statusCode === 404) {
            resolve([]);
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
   * 递归扫描仓库内容查找 SKILL.md
   */
  async scanRepoContents(contents, repo, currentPath, skills) {
    if (!Array.isArray(contents)) return;

    // 检查当前目录是否有 SKILL.md
    const skillMd = contents.find(item => item.name === 'SKILL.md' && item.type === 'file');

    if (skillMd) {
      // 找到技能，解析元数据
      try {
        const skillContent = await this.fetchFileContent(skillMd.download_url);
        const metadata = this.parseSkillMd(skillContent);

        const directory = currentPath || repo.name;

        skills.push({
          key: `${repo.owner}/${repo.name}:${directory}`,
          name: metadata.name || directory,
          description: metadata.description || '',
          directory,
          installed: this.isInstalled(directory),
          readmeUrl: `https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch}/${currentPath}`,
          repoOwner: repo.owner,
          repoName: repo.name,
          repoBranch: repo.branch,
          license: metadata.license
        });
      } catch (err) {
        console.warn(`[SkillService] Parse SKILL.md at ${currentPath} error:`, err.message);
      }

      // 找到 SKILL.md 后不再递归子目录
      return;
    }

    // 递归扫描子目录
    const dirs = contents.filter(item => item.type === 'dir');
    for (const dir of dirs) {
      // 跳过隐藏目录和特殊目录
      if (dir.name.startsWith('.') || dir.name === 'node_modules') continue;

      try {
        const subContents = await this.fetchGitHubContents(repo.owner, repo.name, dir.path, repo.branch, repo);
        await this.scanRepoContents(subContents, repo, dir.path, skills);
      } catch (err) {
        // 忽略子目录错误，继续扫描
      }
    }
  }

  /**
   * 获取文件内容
   */
  async fetchFileContent(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      const req = protocol.get(url, {
        headers: { 'User-Agent': 'cc-cli-skill-service' },
        timeout: 10000
      }, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.fetchFileContent(res.headers.location).then(resolve).catch(reject);
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
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
   * 解析 SKILL.md 文件（支持 Claude Code 和 Codex CLI 格式）
   */
  parseSkillMd(content) {
    // 使用格式转换器统一解析
    const parsed = parseSkillContent(content, { platform: this.platform });

    return {
      name: parsed.name || null,
      description: parsed.description || null,
      license: parsed.license || null,
      allowedTools: parsed.allowedTools ? [parsed.allowedTools] : [],
      metadata: parsed.metadata || {},
      shortDescription: parsed.shortDescription || null,
      format: parsed.format
    };
  }

  normalizeSkillDirectoryName(directory) {
    if (!directory) return '';
    return String(directory).replace(/\\/g, '/').split('/').pop();
  }

  normalizeSkillDirectory(directory, label = 'skill directory') {
    return normalizeSkillRelativePath(directory, label);
  }

  resolveInstallPath(directory, label = 'skill directory', { refresh = true } = {}) {
    if (refresh) {
      this.refreshOmpPaths();
    }
    const safeDirectory = this.normalizeSkillDirectory(directory, label);
    return {
      safeDirectory,
      path: resolveInsideRoot(this.installDir, safeDirectory, label, { allowHiddenSegments: true })
    };
  }


  resolveStoragePath(directory, label = 'skill directory') {
    const safeDirectory = this.normalizeSkillDirectory(directory, label);
    return {
      safeDirectory,
      path: resolveInsideRoot(this.storageDir, safeDirectory, label, { allowHiddenSegments: true })
    };
  }

  isProtectedSkillDirectory(directory) {
    return this.platform === 'codex' && pathHasProtectedSegment(directory, ['.system']);
  }

  /**
   * 检查技能是否已安装
   */
  isInstalled(directory, options = {}) {
    try {
      const { path: skillPath } = this.resolveInstallPath(directory, 'skill directory', options);
      return fs.existsSync(path.join(skillPath, 'SKILL.md'));
    } catch {
      return false;
    }
  }


  /**
   * 合并本地 cc-tool 托管的技能（扫描 storageDir，根据 installDir 判断安装状态）
   */
  mergeLocalSkills(skills) {
    if (!fs.existsSync(this.storageDir)) return;

    // 递归扫描 cc-tool 存储目录
    this.scanLocalDir(this.storageDir, this.storageDir, skills);
  }

  /**
   * 合并平台原生已安装技能（扫描 installDir）。
   */
  mergeInstalledSkills(skills) {
    if (!fs.existsSync(this.installDir)) return;
    this.scanLocalDir(this.installDir, this.installDir, skills, {
      includeHiddenDirs: this.platform === 'codex',
      forceInstalled: true,
      source: 'native-installed'
    });
  }

  /**
   * 递归扫描本地目录
   */
  scanLocalDir(currentDir, baseDir, skills, options = {}) {
    const skillMdPath = path.join(currentDir, 'SKILL.md');

    if (fs.existsSync(skillMdPath)) {
      const directory = currentDir === baseDir
        ? path.basename(currentDir)
        : path.relative(baseDir, currentDir);

      const protectedSkill = this.isProtectedSkillDirectory(directory);
      const skillSource = protectedSkill ? 'system-installed' : (options.source || 'local');

      // 判断是否已安装到平台目录
      let isInstalled = options.forceInstalled === true;
      if (!isInstalled) {
        try {
          isInstalled = fs.existsSync(path.join(this.resolveInstallPath(directory).path, 'SKILL.md'));
        } catch {
          isInstalled = false;
        }
      }

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const metadata = this.parseSkillMd(content);

        const skill = {
          key: `local:${directory}`,
          name: metadata.name || directory,
          description: metadata.description || '',
          directory,
          installed: isInstalled,
          isLocal: skillSource === 'local',
          source: skillSource,
          protected: protectedSkill,
          readonly: false,
          sourceProvider: options.source === 'native-installed' ? 'native' : 'cc-tool',
          sourceScope: 'user',
          sourcePath: skillMdPath,
          shadowedSources: [],
          readmeUrl: null,
          repoOwner: null,
          repoName: null,
          repoBranch: null,
          license: metadata.license
        };
        if (protectedSkill) {
          skill.key = `system:${this.platform}:${directory}`;
        } else if (options.source === 'native-installed') {
          skill.key = `native:${this.platform}:${directory}`;
        }
        skills.push(skill);
      } catch (err) {
        console.warn(`[SkillService] Parse local skill ${directory} error:`, err.message);
      }

      return; // 找到 SKILL.md 后不再递归
    }

    // 递归子目录
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && (options.includeHiddenDirs || !entry.name.startsWith('.'))) {
          this.scanLocalDir(path.join(currentDir, entry.name), baseDir, skills, options);
        }
      }
    } catch (err) {
      // 忽略读取错误
    }
  }

  /**
   * 去重技能列表
   */
  deduplicateSkills(skills) {
    const deduplicated = [];
    const identityMap = new Map();
    const realPathMap = new Map();
    const managedOverlayTargets = new Map();

    for (const skill of skills) {
      const normalizedDirectory = normalizeRepoPath(skill.directory).toLowerCase();
      const identity = this.platform === 'omp'
        ? `name:${String(skill.name || skill.directory).toLowerCase()}`
        : [
          normalizedDirectory,
          skill.repoId || ''
        ].join('::');
      const realPath = skill.realPath || (() => {
        try {
          return skill.sourcePath ? fs.realpathSync(skill.sourcePath) : '';
        } catch {
          return skill.sourcePath || '';
        }
      })();
      const isManagedOverlay = !skill.repoId && (
        skill.sourceProvider === 'cc-tool'
        || skill.sourceProvider === 'native'
        || ['local', 'native-installed', 'system-installed'].includes(skill.source)
      );
      const existingIndex = identityMap.get(identity)
        ?? (realPath ? realPathMap.get(realPath) : undefined)
        ?? (isManagedOverlay ? managedOverlayTargets.get(normalizedDirectory) : undefined);

      if (existingIndex == null) {
        identityMap.set(identity, deduplicated.length);
        if (realPath) realPathMap.set(realPath, deduplicated.length);
        if (skill.repoId && !managedOverlayTargets.has(normalizedDirectory)) {
          managedOverlayTargets.set(normalizedDirectory, deduplicated.length);
        }
        deduplicated.push(skill);
        continue;
      }

      const existing = deduplicated[existingIndex];
      const shadow = skill.sourceProvider || skill.sourcePath
        ? {
          sourceProvider: skill.sourceProvider || skill.source || 'unknown',
          sourceScope: skill.sourceScope || 'user',
          sourcePath: skill.sourcePath || ''
        }
        : null;
      if (shadow) {
        existing.shadowedSources = [...(existing.shadowedSources || []), shadow];
      }

      const shouldPreferIncoming = Boolean(skill.installed && !existing.installed);
      if (shouldPreferIncoming) {
        deduplicated[existingIndex] = {
          ...existing,
          ...skill,
          installed: true,
          shadowedSources: existing.shadowedSources || []
        };
      } else if (skill.installed) {
        existing.installed = true;
      }
    }

    skills.splice(0, skills.length, ...deduplicated);
  }

  /**
   * 安装技能
   * @param {string} directory - 本地安装目录（相对于 installDir）
   * @param {Object} repo - 仓库配置
   * @param {string} [fullDirectory] - 仓库中的完整路径（可选，默认与 directory 相同）
   */
  async installSkill(directory, repo, fullDirectory = null) {
    const { safeDirectory, path: dest } = this.resolveInstallPath(directory);
    if (this.isProtectedSkillDirectory(safeDirectory)) {
      throw new Error('不能安装到 Codex 系统技能目录');
    }
    const normalizedRepo = this.normalizeRepoConfig(repo);

    // 已安装则跳过
    if (fs.existsSync(dest)) {
      return { success: true, message: 'Already installed' };
    }

    // 使用 fullDirectory（仓库中的完整路径）或 directory（向后兼容）
    const sourcePath = fullDirectory || safeDirectory;
    const safeSourcePath = sourcePath
      ? normalizeSkillRelativePath(sourcePath, 'skill source directory')
      : '';

    if (normalizedRepo.provider === 'local') {
      const sourceDir = safeSourcePath
        ? resolveInsideRoot(normalizedRepo.localPath, safeSourcePath, 'Skill source directory', { allowHiddenSegments: true })
        : normalizedRepo.localPath;

      if (!fs.existsSync(sourceDir)) {
        throw new Error(`Skill directory not found: ${sourcePath || normalizedRepo.localPath}`);
      }

      fs.mkdirSync(dest, { recursive: true });
      this.copyDirRecursive(sourceDir, dest);

      this.clearCache({ removeFile: true });
      return { success: true, message: 'Installed successfully' };
    }

    const tempDir = path.join(os.tmpdir(), `skill-${Date.now()}`);
    const zipPath = path.join(tempDir, 'repo.zip');

    try {
      fs.mkdirSync(tempDir, { recursive: true });

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

      // 解压
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempDir, true);

      // 找到解压后的目录（GitHub ZIP 会有一个根目录）
      const extractedDirs = fs.readdirSync(tempDir).filter(f =>
        fs.statSync(path.join(tempDir, f)).isDirectory()
      );

      if (extractedDirs.length === 0) {
        throw new Error('Empty archive');
      }

      const repoDir = path.join(tempDir, extractedDirs[0]);
      const sourceDir = safeSourcePath
        ? resolveInsideRoot(repoDir, safeSourcePath, 'Skill source directory', { allowHiddenSegments: true })
        : repoDir;

      if (!fs.existsSync(sourceDir)) {
        throw new Error(`Skill directory not found: ${sourcePath}`);
      }

      // 复制到安装目录
      fs.mkdirSync(dest, { recursive: true });
      this.copyDirRecursive(sourceDir, dest);

      this.clearCache({ removeFile: true });

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
   * 下载文件
   */
  async downloadFile(url, dest, headers = {}) {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(dest);
      const transport = url.startsWith('http:') ? http : https;

      const request = transport.get(url, {
        headers: {
          'User-Agent': 'cc-cli-skill-service',
          ...headers
        },
        timeout: 60000
      }, (response) => {
        // 处理重定向
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          this.downloadFile(response.headers.location, dest, headers).then(resolve).catch(reject);
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
        fs.unlink(dest, () => { });
        reject(err);
      });

      request.on('timeout', () => {
        request.destroy();
        file.close();
        fs.unlink(dest, () => { });
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
   * 创建自定义技能
   */
  createCustomSkill({ name, directory, description, content }) {
    const { safeDirectory, path: dest } = this.resolveStoragePath(directory);

    // 检查是否已存在
    if (fs.existsSync(dest)) {
      throw new Error(`技能目录 "${directory}" 已存在`);
    }

    const normalizedDescription = (description || '').trim();
    const skillName = name || directory;

    // 创建目录
    fs.mkdirSync(dest, { recursive: true });

    // 生成 SKILL.md 内容
    const skillMdContent = `---
name: "${skillName}"
description: "${normalizedDescription}"
---

${content}
`;

    // 写入文件
    fs.writeFileSync(path.join(dest, 'SKILL.md'), skillMdContent, 'utf-8');

    this.clearCache({ removeFile: true });

    return { success: true, message: '技能创建成功', directory: safeDirectory };
  }

  /**
   * 创建带多文件的技能
   * @param {string} directory - 技能目录名
   * @param {Array<{path: string, content: string}>} files - 文件数组
   * @returns {Object} 创建结果
   */
  createSkillWithFiles({ directory, files }) {
    const { safeDirectory, path: dest } = this.resolveStoragePath(directory);

    // 检查是否已存在
    if (fs.existsSync(dest)) {
      throw new Error(`技能目录 "${directory}" 已存在`);
    }

    // 验证必须包含 SKILL.md
    const safeFiles = files.map(file => ({
      ...file,
      safePath: normalizeSkillRelativePath(file.path, 'skill file path')
    }));
    const hasSkillMd = safeFiles.some(f =>
      f.safePath === 'SKILL.md' || f.safePath.endsWith('/SKILL.md')
    );
    if (!hasSkillMd) {
      throw new Error('技能必须包含 SKILL.md 文件');
    }

    // 创建目录
    fs.mkdirSync(dest, { recursive: true });

    // 写入所有文件
    for (const file of safeFiles) {
      const filePath = resolveInsideRoot(dest, file.safePath, 'skill file path', { allowHiddenSegments: true });
      const fileDir = path.dirname(filePath);

      // 确保父目录存在
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      // 写入文件内容
      if (file.isBase64) {
        // 二进制文件使用 base64 编码
        fs.writeFileSync(filePath, Buffer.from(file.content, 'base64'));
      } else {
        fs.writeFileSync(filePath, file.content, 'utf-8');
      }
    }

    this.clearCache({ removeFile: true });

    return {
      success: true,
      message: '技能创建成功',
      directory: safeDirectory,
      fileCount: files.length
    };
  }

  /**
   * 获取技能目录下所有文件列表
   * @param {string} directory - 技能目录名
   * @returns {Array<{path: string, size: number, isDirectory: boolean}>}
   */
  getSkillFiles(directory) {
    const { safeDirectory, path: skillPath } = this.resolveInstallPath(directory);

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${safeDirectory}" 不存在`);
    }

    const files = [];
    this._scanFilesRecursive(skillPath, skillPath, files);
    return files;
  }

  /**
   * 递归扫描目录获取文件列表
   */
  _scanFilesRecursive(currentDir, baseDir, files) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        files.push({
          path: relativePath,
          size: 0,
          isDirectory: true
        });
        this._scanFilesRecursive(fullPath, baseDir, files);
      } else {
        const stats = fs.statSync(fullPath);
        files.push({
          path: relativePath,
          size: stats.size,
          isDirectory: false
        });
      }
    }
  }

  /**
   * 获取技能文件内容
   * @param {string} directory - 技能目录名
   * @param {string} filePath - 文件相对路径
   * @returns {Object} 文件内容
   */
  getSkillFileContent(directory, filePath) {
    const { path: skillPath } = this.resolveInstallPath(directory);
    const safeFilePath = normalizeSkillRelativePath(filePath, 'skill file path');
    const fullPath = resolveInsideRoot(skillPath, safeFilePath, 'skill file path', { allowHiddenSegments: true });

    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件 "${safeFilePath}" 不存在`);
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      throw new Error(`"${filePath}" 是目录，不是文件`);
    }

    // 判断是否是文本文件
    const textExtensions = ['.md', '.txt', '.json', '.js', '.ts', '.py', '.sh', '.yaml', '.yml', '.toml', '.xml', '.html', '.css'];
    const ext = path.extname(filePath).toLowerCase();
    const isText = textExtensions.includes(ext);

    if (isText) {
      return {
        path: filePath,
        content: fs.readFileSync(fullPath, 'utf-8'),
        isBase64: false,
        size: stats.size
      };
    } else {
      return {
        path: filePath,
        content: fs.readFileSync(fullPath).toString('base64'),
        isBase64: true,
        size: stats.size
      };
    }
  }

  /**
   * 添加文件到现有技能
   * @param {string} directory - 技能目录名
   * @param {Array<{path: string, content: string, isBase64?: boolean}>} files - 文件数组
   */
  addSkillFiles(directory, files) {
    const { safeDirectory, path: skillPath } = this.resolveInstallPath(directory);
    if (this.isProtectedSkillDirectory(safeDirectory)) {
      throw new Error('不能修改 Codex 系统技能');
    }

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${safeDirectory}" 不存在`);
    }

    const added = [];
    for (const file of files) {
      const safeFilePath = normalizeSkillRelativePath(file.path, 'skill file path');
      const filePath = resolveInsideRoot(skillPath, safeFilePath, 'skill file path', { allowHiddenSegments: true });
      const fileDir = path.dirname(filePath);

      // 确保父目录存在
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      // 写入文件
      if (file.isBase64) {
        fs.writeFileSync(filePath, Buffer.from(file.content, 'base64'));
      } else {
        fs.writeFileSync(filePath, file.content, 'utf-8');
      }
      added.push(safeFilePath);
    }

    this.clearCache({ removeFile: true });

    return { success: true, added };
  }

  /**
   * 删除技能中的文件
   * @param {string} directory - 技能目录名
   * @param {string} filePath - 文件相对路径
   */
  deleteSkillFile(directory, filePath) {
    const { safeDirectory, path: skillPath } = this.resolveInstallPath(directory);
    if (this.isProtectedSkillDirectory(safeDirectory)) {
      throw new Error('不能修改 Codex 系统技能');
    }

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${safeDirectory}" 不存在`);
    }

    // 不允许删除 SKILL.md
    if (filePath === 'SKILL.md') {
      throw new Error('不能删除 SKILL.md 文件');
    }

    const safeFilePath = normalizeSkillRelativePath(filePath, 'skill file path');
    if (safeFilePath === 'SKILL.md') {
      throw new Error('不能删除 SKILL.md 文件');
    }
    const fullPath = resolveInsideRoot(skillPath, safeFilePath, 'skill file path', { allowHiddenSegments: true });

    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件 "${safeFilePath}" 不存在`);
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }

    this.clearCache({ removeFile: true });

    return { success: true, deleted: safeFilePath };
  }

  /**
   * 更新技能文件内容
   * @param {string} directory - 技能目录名
   * @param {string} filePath - 文件相对路径
   * @param {string} content - 新内容
   * @param {boolean} isBase64 - 是否为 base64 编码
   */
  updateSkillFile(directory, filePath, content, isBase64 = false) {
    const { safeDirectory, path: skillPath } = this.resolveInstallPath(directory);
    if (this.isProtectedSkillDirectory(safeDirectory)) {
      throw new Error('不能修改 Codex 系统技能');
    }

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${safeDirectory}" 不存在`);
    }

    const safeFilePath = normalizeSkillRelativePath(filePath, 'skill file path');
    const fullPath = resolveInsideRoot(skillPath, safeFilePath, 'skill file path', { allowHiddenSegments: true });

    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件 "${safeFilePath}" 不存在`);
    }

    if (isBase64) {
      fs.writeFileSync(fullPath, Buffer.from(content, 'base64'));
    } else {
      fs.writeFileSync(fullPath, content, 'utf-8');
    }

    this.clearCache({ removeFile: true });

    return { success: true, updated: safeFilePath };
  }


  /**
   * 安装 cc-tool 本地托管的技能（从 storageDir cp 到 installDir）
   */
  installLocalSkill(directory) {
    const { safeDirectory, path: src } = this.resolveStoragePath(directory);
    const { path: dest } = this.resolveInstallPath(safeDirectory);
    if (this.isProtectedSkillDirectory(safeDirectory)) {
      throw new Error('不能安装到 Codex 系统技能目录');
    }

    if (!fs.existsSync(src)) {
      throw new Error(`本地技能 "${safeDirectory}" 不存在`);
    }

    if (fs.existsSync(dest)) {
      return { success: true, message: 'Already installed' };
    }

    fs.mkdirSync(dest, { recursive: true });
    this.copyDirRecursive(src, dest);
    this.clearCache({ removeFile: true });
    return { success: true, message: 'Installed successfully' };
  }

  /**
   * 卸载技能
   */
  uninstallSkill(directory, options = {}) {
    const safeDirectory = this.normalizeSkillDirectory(directory);
    const projectInstallDir = this.platform === 'omp' && options.scope === 'project' && options.cwd
      ? path.join(path.resolve(options.cwd), '.omp', 'skills')
      : null;
    const dest = projectInstallDir
      ? resolveInsideRoot(projectInstallDir, safeDirectory, 'skill directory', {
          allowHiddenSegments: true
        })
      : this.resolveInstallPath(safeDirectory).path;
    if (this.isProtectedSkillDirectory(safeDirectory)) {
      throw new Error('不能卸载 Codex 系统技能');
    }

    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
      this.clearCache({ removeFile: true });
      return { success: true, message: 'Uninstalled successfully' };
    }

    return { success: true, message: 'Not installed' };
  }

  /**
   * 获取技能详情（完整内容）
   */
  async getSkillDetail(directory, repoHint = null, fullDirectoryHint = '') {
    const safeDirectory = this.normalizeSkillDirectory(directory);
    // 先检查本地是否安装
    const localSkillDir = this.resolveInstallPath(safeDirectory).path;
    const localPath = path.join(localSkillDir, 'SKILL.md');

    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, 'utf-8');
      const metadata = this.parseSkillMd(content);

      // 提取正文内容（去除 frontmatter）
      const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1].trim() : content;

      return {
        directory: safeDirectory,
        name: metadata.name || safeDirectory,
        description: metadata.description || '',
        content: body,
        fullContent: content,
        installed: true,
        path: localSkillDir,
        fullPath: localPath,
        installPath: localSkillDir,
        source: this.isProtectedSkillDirectory(safeDirectory) ? 'system-installed' : 'local',
        protected: this.isProtectedSkillDirectory(safeDirectory)
      };
    }

    const parseRemoteSkillContent = (content, repo, fullDirectory = '') => {
      const metadata = this.parseSkillMd(content);
      const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1].trim() : content;

      return {
        directory: safeDirectory,
        name: metadata.name || safeDirectory,
        description: metadata.description || '',
        content: body,
        fullContent: content,
        installed: false,
        source: repo.provider === 'local' ? 'local-repo' : repo.provider,
        fullDirectory,
        repoProvider: repo.provider,
        repoOwner: repo.owner || null,
        repoName: repo.name || null,
        repoBranch: repo.branch || 'main',
        repoDirectory: repo.directory || '',
        repoHost: repo.host || null,
        repoProjectPath: repo.projectPath || null,
        repoLocalPath: repo.localPath || null,
        repoId: repo.id,
        repoUrl: repo.repoUrl || buildRepoUrl(repo),
        path: fullDirectory
      };
    };

    let lastRemoteError = null;
    const tryLoadRemoteDetailFromRepo = async (repo, extraCandidateDirs = []) => {
      try {
        if (repo.provider === 'local') {
          const normalizedDirectory = normalizeRepoPath(safeDirectory);
          const candidateDirs = new Set([
            normalizedDirectory,
            normalizeRepoPath(fullDirectoryHint || ''),
            ...extraCandidateDirs.map(candidate => normalizeRepoPath(candidate))
          ]);

          for (const candidateDir of candidateDirs) {
            const skillMdPath = candidateDir
              ? path.join(repo.localPath, candidateDir, 'SKILL.md')
              : path.join(repo.localPath, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) continue;
            const content = fs.readFileSync(skillMdPath, 'utf-8');
            return {
              ...parseRemoteSkillContent(content, repo, candidateDir),
              path: path.dirname(skillMdPath),
              fullPath: skillMdPath
            };
          }
          return null;
        }

        const treeItems = repo.provider === 'gitlab'
          ? await this.fetchGitLabTree(repo)
          : await this.fetchGitHubRepoTree(repo);
        if (!treeItems?.length) return null;

          const normalizedDirectory = normalizeRepoPath(safeDirectory);
        const candidateDirs = new Set();
        candidateDirs.add(normalizedDirectory);

        for (const candidate of extraCandidateDirs) {
          const normalized = normalizeRepoPath(candidate);
          if (normalized) candidateDirs.add(normalized);
        }

        if (repo.directory) {
          candidateDirs.add(normalizeRepoPath(`${repo.directory}/${normalizedDirectory}`));
        }

        let skillFile = null;
        for (const candidateDir of candidateDirs) {
          skillFile = treeItems.find(item =>
            item.type === 'blob' && (
              candidateDir
                ? item.path === `${candidateDir}/SKILL.md`
                : item.path === 'SKILL.md'
            )
          );
          if (skillFile) break;
        }

        if (!skillFile) return null;

        const content = await this.fetchSkillFileContent(repo, skillFile);
        const fullDirectory = normalizeRepoPath(skillFile.path.replace(/(^|\/)SKILL\.md$/, ''));
        return parseRemoteSkillContent(content, repo, fullDirectory);
      } catch (err) {
        lastRemoteError = err.message;
        console.warn('[SkillService] Fetch remote skill detail error:', err.message);
        return null;
      }
    };

    // OMP 平台：列表可来自多个发现源（agents/claude/codex/opencode/插件/自定义目录），
    // 原生安装目录未命中时，从列表缓存或重新发现结果中取真实文件路径直接读取，
    // 避免本地技能被误判为远端仓库而报「技能不存在」
    if (this.platform === 'omp') {
      const findLocalSkillOnDisk = (source) => (source || []).find(s =>
        normalizeRepoPath(s.directory) === normalizeRepoPath(safeDirectory) &&
        !(s.repoOwner || s.repoProjectPath || s.repoLocalPath) &&
        (s.sourcePath || s.realPath)
      );
      const cachedLocalSkill = findLocalSkillOnDisk(this.skillsCache)
        || findLocalSkillOnDisk(discoverOmpSkills(this, {}));
      if (cachedLocalSkill) {
        const skillFile = cachedLocalSkill.realPath || cachedLocalSkill.sourcePath;
        if (skillFile && fs.existsSync(skillFile)) {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const metadata = this.parseSkillMd(content);
          const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
          const body = bodyMatch ? bodyMatch[1].trim() : content;
          return {
            directory: safeDirectory,
            name: metadata.name || cachedLocalSkill.name || safeDirectory,
            description: metadata.description || '',
            content: body,
            fullContent: content,
            installed: true,
            path: path.dirname(skillFile),
            fullPath: skillFile,
            installPath: path.dirname(skillFile),
            source: cachedLocalSkill.source || 'provider-installed',
            sourceProvider: cachedLocalSkill.sourceProvider,
            sourceScope: cachedLocalSkill.sourceScope,
            protected: !!cachedLocalSkill.protected,
            readonly: cachedLocalSkill.readonly !== false
          };
        }
      }
    }

    if (repoHint) {
      try {
        const normalizedRepoHint = this.normalizeRepoConfig(repoHint);
        const detail = await tryLoadRemoteDetailFromRepo(normalizedRepoHint, [
          fullDirectoryHint || '',
              repoHint.directory ? `${repoHint.directory}/${safeDirectory}` : '',
          repoHint.fullDirectory || ''
        ]);
        if (detail) return detail;
      } catch (err) {
        console.warn('[SkillService] Invalid repo hint for detail:', err.message);
      }
    }

    // 先尝试使用缓存中的 repo 信息（最快）
    const cachedSkill = this.skillsCache?.find(s =>
      normalizeRepoPath(s.directory) === normalizeRepoPath(safeDirectory)
    );
    if (cachedSkill && (cachedSkill.repoOwner || cachedSkill.repoProjectPath || cachedSkill.repoLocalPath)) {
      const cachedRepo = this.normalizeRepoConfig({
        provider: cachedSkill.repoProvider || (cachedSkill.repoLocalPath ? 'local' : (cachedSkill.repoProjectPath ? 'gitlab' : 'github')),
        owner: cachedSkill.repoOwner,
        name: cachedSkill.repoName,
        branch: cachedSkill.repoBranch || 'main',
        directory: cachedSkill.repoDirectory || '',
        host: cachedSkill.repoHost,
        projectPath: cachedSkill.repoProjectPath,
        localPath: cachedSkill.repoLocalPath,
        repoUrl: cachedSkill.repoUrl
      });
      const detail = await tryLoadRemoteDetailFromRepo(cachedRepo, [
        fullDirectoryHint || '',
        cachedSkill.fullDirectory || '',
        cachedSkill.repoDirectory ? `${cachedSkill.repoDirectory}/${safeDirectory}` : ''
      ]);
      if (detail) return detail;
    }

    // 缓存缺失或过期时，回退到遍历仓库配置，避免详情页报错
    const repos = this.loadRepos().filter(repo => repo.enabled !== false);
    for (const repo of repos) {
      const detail = await tryLoadRemoteDetailFromRepo(
        repo,
        [repo.directory ? `${repo.directory}/${safeDirectory}` : '']
      );
      if (detail) return detail;
    }

    if (lastRemoteError) {
      throw new Error(`技能不存在或无法获取（远端仓库获取失败: ${lastRemoteError}）`);
    }
    throw new Error('技能不存在或无法获取');
  }

  /**
   * 获取已安装技能列表
   */
  getInstalledSkills() {
    this.refreshOmpPaths();
    if (this.platform === 'omp') {
      return this.prepareSkills([]);
    }
    const skills = [];
    this.scanLocalDir(this.installDir, this.installDir, skills, {
      includeHiddenDirs: this.platform === 'codex',
      forceInstalled: true,
      source: 'native-installed'
    });
    return skills;
  }
}

module.exports = {
  SkillService,
  DEFAULT_REPOS: DEFAULT_REPOS_BY_PLATFORM.claude,
  DEFAULT_REPOS_BY_PLATFORM
};
