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

const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode'];
const SUPPORTED_REPO_PROVIDERS = ['github', 'gitlab', 'local'];
const DEFAULT_GITHUB_HOST = 'https://github.com';
const DEFAULT_GITLAB_HOST = 'https://gitlab.com';

function normalizePlatform(platform) {
  return SUPPORTED_PLATFORMS.includes(platform) ? platform : 'claude';
}

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

const DEFAULT_REPOS_BY_PLATFORM = {
  claude: [],
  codex: [],
  gemini: [],
  opencode: []
};

const PLATFORM_CONFIG = {
  claude: {
    installDir: path.join(HOME_DIR, '.claude', 'skills'),
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
  }
};

// 缓存有效期（5分钟）
const CACHE_TTL = 5 * 60 * 1000;

class SkillService {
  constructor(platform = 'claude') {
    this.platform = normalizePlatform(platform);
    this.configDir = PATHS.config;

    const platformConfig = PLATFORM_CONFIG[this.platform];
    this.installDir = platformConfig.installDir;
    this.storageDir = platformConfig.storageDir;
    this.reposConfigPath = platformConfig.reposFile;
    this.cachePath = platformConfig.cacheFile;

    // 内存缓存
    this.skillsCache = null;
    this.cacheTime = 0;

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

  clearCache({ removeFile = false } = {}) {
    this.skillsCache = null;
    this.cacheTime = 0;

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

  prepareSkills(skills = []) {
    const preparedSkills = Array.isArray(skills)
      ? skills.map(skill => ({ ...skill }))
      : [];

    this.mergeLocalSkills(preparedSkills);
    this.deduplicateSkills(preparedSkills);
    preparedSkills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    this.updateInstallStatus(preparedSkills);

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
  async listSkills(forceRefresh = false) {
    // 强制刷新时仅清空内存缓存，保留磁盘缓存作为回退来源
    if (forceRefresh) {
      this.clearCache();
    }

    const fileCache = this.loadCacheFromFile();

    // 检查内存缓存
    if (!forceRefresh && Array.isArray(this.skillsCache) && this.skillsCache.length > 0) {
      if (Array.isArray(fileCache) && fileCache.length > this.skillsCache.length) {
        this.skillsCache = this.prepareSkills(fileCache);
        this.cacheTime = Date.now();
        return this.skillsCache;
      }
      this.skillsCache = this.prepareSkills(this.skillsCache);
      this.cacheTime = Date.now();
      return this.skillsCache;
    }

    // 检查文件缓存
    if (!forceRefresh) {
      if (fileCache && fileCache.length > 0) {
        this.skillsCache = this.prepareSkills(fileCache);
        this.cacheTime = Date.now();
        return this.skillsCache;
      }
    }

    const repos = this.loadRepos();
    const skills = [];

    // 并行获取所有启用仓库的技能（带超时保护）
    const enabledRepos = repos.filter(r => r.enabled);
    const enabledRemoteRepos = enabledRepos.filter(repo => repo.provider !== 'local');
    let remoteFailureCount = 0;

    if (enabledRepos.length > 0) {
      const results = await Promise.allSettled(
        enabledRepos.map(repo =>
          Promise.race([
            this.fetchRepoSkills(repo),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Fetch timeout')), 30000)  // 30秒超时
            )
          ])
        )
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const repo = enabledRepos[i];
        const repoInfo = `${repo.owner}/${repo.name}`;
        if (result.status === 'fulfilled') {
          skills.push(...result.value);
        } else {
          console.warn(`[SkillService] Fetch repo ${repoInfo} failed:`, result.reason?.message);
          if (repo.provider !== 'local') {
            remoteFailureCount++;
          }
        }
      }
    }

    const preparedSkills = this.prepareSkills(skills);

    const hasUsableFileCache = Array.isArray(fileCache) && fileCache.length > 0;
    const preparedFileCache = hasUsableFileCache ? this.prepareSkills(fileCache) : null;
    const shouldUseStaleFileCache = hasUsableFileCache && (
      (enabledRemoteRepos.length > 0 && remoteFailureCount === enabledRemoteRepos.length) ||
      (remoteFailureCount > 0 && preparedFileCache.length > preparedSkills.length)
    );

    if (shouldUseStaleFileCache) {
      this.skillsCache = preparedFileCache;
      this.cacheTime = Date.now();
      return this.skillsCache;
    }

    // 更新缓存
    this.skillsCache = preparedSkills;
    this.cacheTime = Date.now();
    this.saveCacheToFile(preparedSkills);

    return preparedSkills;
  }

  /**
   * 从文件加载缓存
   */
  loadCacheFromFile() {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
        if (Array.isArray(data.skills)) {
          return data.skills;
        }
      }
    } catch (err) {
      // 忽略缓存读取错误
    }
    return null;
  }

  /**
   * 保存缓存到文件
   */
  saveCacheToFile(skills) {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify({
        time: Date.now(),
        skills
      }));
    } catch (err) {
      // 忽略缓存写入错误
    }
  }

  /**
   * 更新技能的安装状态
   */
  updateInstallStatus(skills) {
    for (const skill of skills) {
      skill.installed = this.isInstalled(skill.directory);
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
    const scanRoot = repo.directory
      ? path.join(repoRoot, repo.directory)
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
      const localFilePath = path.join(repo.localPath, file.path);
      return fs.readFileSync(localFilePath, 'utf-8');
    }
    return this.fetchGitHubBlobContent(file.sha, repo);
  }

  /**
   * 使用 GitHub Blob API 获取文件内容
   */
  async fetchGitHubBlobContent(sha, repo) {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/blobs/${sha}`;
    const data = await this.fetchGitHubApi(url);
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
      if (repoToken) {
        return repoToken;
      }
    }

    const host = typeof repoOrHost === 'string'
      ? repoOrHost
      : (repoOrHost?.host || DEFAULT_GITHUB_HOST);

    // 优先从环境变量获取
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
    const parsed = parseSkillContent(content);

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

  /**
   * 检查技能是否已安装
   */
  isInstalled(directory) {
    const skillPath = path.join(this.installDir, directory);
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    return fs.existsSync(skillMdPath);
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
   * 递归扫描本地目录
   */
  scanLocalDir(currentDir, baseDir, skills) {
    const skillMdPath = path.join(currentDir, 'SKILL.md');

    if (fs.existsSync(skillMdPath)) {
      const directory = currentDir === baseDir
        ? path.basename(currentDir)
        : path.relative(baseDir, currentDir);

      // 检查是否已在列表中（比较目录名，去掉前缀路径）
      const normalizedDirectory = normalizeRepoPath(directory).toLowerCase();
      const existing = skills.find(s => {
        return normalizeRepoPath(s.directory).toLowerCase() === normalizedDirectory;
      });

      // 判断是否已安装到平台目录
      const isInstalled = fs.existsSync(path.join(this.installDir, directory, 'SKILL.md'));

      if (existing) {
        existing.installed = isInstalled;
        existing.isLocal = true;
      } else {
        // 添加 cc-tool 托管的技能
        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const metadata = this.parseSkillMd(content);

          skills.push({
            key: `local:${directory}`,
            name: metadata.name || directory,
            description: metadata.description || '',
            directory,
            installed: isInstalled,
            isLocal: true,
            readmeUrl: null,
            repoOwner: null,
            repoName: null,
            repoBranch: null,
            license: metadata.license
          });
        } catch (err) {
          console.warn(`[SkillService] Parse local skill ${directory} error:`, err.message);
        }
      }

      return; // 找到 SKILL.md 后不再递归
    }

    // 递归子目录
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          this.scanLocalDir(path.join(currentDir, entry.name), baseDir, skills);
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
    const seen = new Map();

    for (let i = skills.length - 1; i >= 0; i--) {
      const skill = skills[i];
      const key = [
        normalizeRepoPath(skill.directory).toLowerCase(),
        skill.repoId || '',
        skill.installed ? 'installed' : 'remote'
      ].join('::');

      if (seen.has(key)) {
        const existingIndex = seen.get(key);
        if (skill.installed && !skills[existingIndex].installed) {
          skills.splice(existingIndex, 1);
          seen.set(key, i - 1);
        } else {
          skills.splice(i, 1);
        }
      } else {
        seen.set(key, i);
      }
    }
  }

  /**
   * 安装技能
   * @param {string} directory - 本地安装目录（相对于 installDir）
   * @param {Object} repo - 仓库配置
   * @param {string} [fullDirectory] - 仓库中的完整路径（可选，默认与 directory 相同）
   */
  async installSkill(directory, repo, fullDirectory = null) {
    const dest = path.join(this.installDir, directory);
    const normalizedRepo = this.normalizeRepoConfig(repo);

    // 已安装则跳过
    if (fs.existsSync(dest)) {
      return { success: true, message: 'Already installed' };
    }

    // 使用 fullDirectory（仓库中的完整路径）或 directory（向后兼容）
    const sourcePath = fullDirectory || directory;

    if (normalizedRepo.provider === 'local') {
      const sourceDir = sourcePath
        ? path.join(normalizedRepo.localPath, sourcePath)
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
      const sourceDir = path.join(repoDir, sourcePath);

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
    const dest = path.join(this.storageDir, directory);

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

    return { success: true, message: '技能创建成功', directory };
  }

  /**
   * 创建带多文件的技能
   * @param {string} directory - 技能目录名
   * @param {Array<{path: string, content: string}>} files - 文件数组
   * @returns {Object} 创建结果
   */
  createSkillWithFiles({ directory, files }) {
    const dest = path.join(this.storageDir, directory);

    // 检查是否已存在
    if (fs.existsSync(dest)) {
      throw new Error(`技能目录 "${directory}" 已存在`);
    }

    // 验证必须包含 SKILL.md
    const hasSkillMd = files.some(f =>
      f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md')
    );
    if (!hasSkillMd) {
      throw new Error('技能必须包含 SKILL.md 文件');
    }

    // 创建目录
    fs.mkdirSync(dest, { recursive: true });

    // 写入所有文件
    for (const file of files) {
      const filePath = path.join(dest, file.path);
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
      directory,
      fileCount: files.length
    };
  }

  /**
   * 获取技能目录下所有文件列表
   * @param {string} directory - 技能目录名
   * @returns {Array<{path: string, size: number, isDirectory: boolean}>}
   */
  getSkillFiles(directory) {
    const skillPath = path.join(this.installDir, directory);

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${directory}" 不存在`);
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
    const fullPath = path.join(this.installDir, directory, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件 "${filePath}" 不存在`);
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
    const skillPath = path.join(this.installDir, directory);

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${directory}" 不存在`);
    }

    const added = [];
    for (const file of files) {
      const filePath = path.join(skillPath, file.path);
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
      added.push(file.path);
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
    const skillPath = path.join(this.installDir, directory);

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${directory}" 不存在`);
    }

    // 不允许删除 SKILL.md
    if (filePath === 'SKILL.md') {
      throw new Error('不能删除 SKILL.md 文件');
    }

    const fullPath = path.join(skillPath, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件 "${filePath}" 不存在`);
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }

    this.clearCache({ removeFile: true });

    return { success: true, deleted: filePath };
  }

  /**
   * 更新技能文件内容
   * @param {string} directory - 技能目录名
   * @param {string} filePath - 文件相对路径
   * @param {string} content - 新内容
   * @param {boolean} isBase64 - 是否为 base64 编码
   */
  updateSkillFile(directory, filePath, content, isBase64 = false) {
    const skillPath = path.join(this.installDir, directory);

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${directory}" 不存在`);
    }

    const fullPath = path.join(skillPath, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件 "${filePath}" 不存在`);
    }

    if (isBase64) {
      fs.writeFileSync(fullPath, Buffer.from(content, 'base64'));
    } else {
      fs.writeFileSync(fullPath, content, 'utf-8');
    }

    this.clearCache({ removeFile: true });

    return { success: true, updated: filePath };
  }


  /**
   * 安装 cc-tool 本地托管的技能（从 storageDir cp 到 installDir）
   */
  installLocalSkill(directory) {
    const src = path.join(this.storageDir, directory);
    const dest = path.join(this.installDir, directory);

    if (!fs.existsSync(src)) {
      throw new Error(`本地技能 "${directory}" 不存在`);
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
  uninstallSkill(directory) {
    const dest = path.join(this.installDir, directory);

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
    // 先检查本地是否安装
    const localPath = path.join(this.installDir, directory, 'SKILL.md');

    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, 'utf-8');
      const metadata = this.parseSkillMd(content);

      // 提取正文内容（去除 frontmatter）
      const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1].trim() : content;

      return {
        directory,
        name: metadata.name || directory,
        description: metadata.description || '',
        content: body,
        fullContent: content,
        installed: true,
        source: 'local'
      };
    }

    const parseRemoteSkillContent = (content, repo, fullDirectory = '') => {
      const metadata = this.parseSkillMd(content);
      const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1].trim() : content;

      return {
        directory,
        name: metadata.name || directory,
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
        repoUrl: repo.repoUrl || buildRepoUrl(repo)
      };
    };

    const tryLoadRemoteDetailFromRepo = async (repo, extraCandidateDirs = []) => {
      try {
        if (repo.provider === 'local') {
          const normalizedDirectory = normalizeRepoPath(directory);
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
            return parseRemoteSkillContent(content, repo, candidateDir);
          }
          return null;
        }

        const treeItems = repo.provider === 'gitlab'
          ? await this.fetchGitLabTree(repo)
          : await this.fetchGitHubRepoTree(repo);
        if (!treeItems?.length) return null;

        const normalizedDirectory = normalizeRepoPath(directory);
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
        console.warn('[SkillService] Fetch remote skill detail error:', err.message);
        return null;
      }
    };

    if (repoHint) {
      try {
        const normalizedRepoHint = this.normalizeRepoConfig(repoHint);
        const detail = await tryLoadRemoteDetailFromRepo(normalizedRepoHint, [
          fullDirectoryHint || '',
          repoHint.directory ? `${repoHint.directory}/${directory}` : '',
          repoHint.fullDirectory || ''
        ]);
        if (detail) return detail;
      } catch (err) {
        console.warn('[SkillService] Invalid repo hint for detail:', err.message);
      }
    }

    // 先尝试使用缓存中的 repo 信息（最快）
    const cachedSkill = this.skillsCache?.find(s =>
      normalizeRepoPath(s.directory) === normalizeRepoPath(directory)
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
        cachedSkill.repoDirectory ? `${cachedSkill.repoDirectory}/${directory}` : ''
      ]);
      if (detail) return detail;
    }

    // 缓存缺失或过期时，回退到遍历仓库配置，避免详情页报错
    const repos = this.loadRepos().filter(repo => repo.enabled !== false);
    for (const repo of repos) {
      const detail = await tryLoadRemoteDetailFromRepo(
        repo,
        [repo.directory ? `${repo.directory}/${directory}` : '']
      );
      if (detail) return detail;
    }

    throw new Error('技能不存在或无法获取');
  }

  /**
   * 获取已安装技能列表
   */
  getInstalledSkills() {
    const skills = [];
    this.scanLocalDir(this.installDir, this.installDir, skills);
    return skills;
  }
}

module.exports = {
  SkillService,
  DEFAULT_REPOS: DEFAULT_REPOS_BY_PLATFORM.claude,
  DEFAULT_REPOS_BY_PLATFORM
};
