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
const { createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const AdmZip = require('adm-zip');
const {
  parseSkillContent,
} = require('./format-converter');
const { NATIVE_PATHS } = require('../../config/paths');

const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode'];
const OPENCODE_SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function normalizePlatform(platform) {
  return SUPPORTED_PLATFORMS.includes(platform) ? platform : 'claude';
}

function cloneRepos(repos = []) {
  return repos.map(repo => ({ ...repo }));
}

const DEFAULT_REPOS_BY_PLATFORM = {
  claude: [
    { owner: 'anthropics', name: 'skills', branch: 'main', directory: '', enabled: true }
  ],
  codex: [
    { owner: 'openai', name: 'skills', branch: 'main', directory: 'skills/.curated', enabled: true }
  ],
  gemini: [
    { owner: 'google-gemini', name: 'gemini-cli', branch: 'main', directory: '.gemini/skills', enabled: true }
  ],
  opencode: [
    { owner: 'darrenhinde', name: 'OpenAgentsControl', branch: 'main', directory: '.opencode/skills', enabled: true }
  ]
};

const PLATFORM_CONFIG = {
  claude: {
    installDir: path.join(os.homedir(), '.claude', 'skills'),
    reposFile: 'skill-repos.json',
    cacheFile: 'skills-cache.json'
  },
  codex: {
    installDir: path.join(os.homedir(), '.codex', 'skills'),
    reposFile: 'codex-skill-repos.json',
    cacheFile: 'codex-skills-cache.json'
  },
  gemini: {
    installDir: path.join(os.homedir(), '.gemini', 'skills'),
    reposFile: 'gemini-skill-repos.json',
    cacheFile: 'gemini-skills-cache.json'
  },
  opencode: {
    installDir: path.join(NATIVE_PATHS.opencode.config, 'skills'),
    reposFile: 'opencode-skill-repos.json',
    cacheFile: 'opencode-skills-cache.json'
  }
};

// 缓存有效期（5分钟）
const CACHE_TTL = 5 * 60 * 1000;

class SkillService {
  constructor(platform = 'claude') {
    this.platform = normalizePlatform(platform);
    this.configDir = path.join(os.homedir(), '.cc-tool');

    const platformConfig = PLATFORM_CONFIG[this.platform];
    this.installDir = platformConfig.installDir;
    this.reposConfigPath = path.join(this.configDir, platformConfig.reposFile);
    this.cachePath = path.join(this.configDir, platformConfig.cacheFile);

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
  }

  /**
   * 加载仓库配置
   */
  loadRepos() {
    try {
      if (fs.existsSync(this.reposConfigPath)) {
        const data = JSON.parse(fs.readFileSync(this.reposConfigPath, 'utf-8'));
        if (Array.isArray(data.repos)) {
          return data.repos;
        }
      }
    } catch (err) {
      console.error('[SkillService] Load repos config error:', err.message);
    }
    return cloneRepos(DEFAULT_REPOS_BY_PLATFORM[this.platform] || DEFAULT_REPOS_BY_PLATFORM.claude);
  }

  /**
   * 保存仓库配置
   */
  saveRepos(repos) {
    fs.writeFileSync(this.reposConfigPath, JSON.stringify({ repos }, null, 2));
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
    this.skillsCache = null;
    this.cacheTime = 0;
    return repos;
  }

  /**
   * 删除仓库
   * @param {string} owner - 仓库所有者
   * @param {string} name - 仓库名称
   * @param {string} [directory=''] - 子目录路径
   */
  removeRepo(owner, name, directory = '') {
    const repos = this.loadRepos();
    const filtered = repos.filter(r => !(
      r.owner === owner &&
      r.name === name &&
      (r.directory || '') === directory
    ));
    this.saveRepos(filtered);
    // 清除缓存
    this.skillsCache = null;
    this.cacheTime = 0;
    return filtered;
  }

  /**
   * 切换仓库启用状态
   * @param {string} owner - 仓库所有者
   * @param {string} name - 仓库名称
   * @param {string} [directory=''] - 子目录路径
   * @param {boolean} enabled - 是否启用
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
      // 清除缓存
      this.skillsCache = null;
      this.cacheTime = 0;
    }
    return repos;
  }

  /**
   * 获取所有技能列表（带缓存）
   */
  async listSkills(forceRefresh = false) {
    // 强制刷新时清除缓存
    if (forceRefresh) {
      this.skillsCache = null;
      this.cacheTime = 0;
      // 删除文件缓存
      try {
        if (fs.existsSync(this.cachePath)) {
          fs.unlinkSync(this.cachePath);
        }
      } catch (err) {
        console.warn('[SkillService] Failed to delete cache file:', err.message);
      }
    }

    // 检查内存缓存
    if (!forceRefresh && this.skillsCache && (Date.now() - this.cacheTime < CACHE_TTL)) {
      this.updateInstallStatus(this.skillsCache);
      return this.skillsCache;
    }

    // 检查文件缓存
    if (!forceRefresh) {
      const fileCache = this.loadCacheFromFile();
      if (fileCache) {
        this.skillsCache = fileCache;
        this.cacheTime = Date.now();
        this.updateInstallStatus(this.skillsCache);
        return this.skillsCache;
      }
    }

    const repos = this.loadRepos();
    const skills = [];

    // 并行获取所有启用仓库的技能（带超时保护）
    const enabledRepos = repos.filter(r => r.enabled);

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
        const repoInfo = `${enabledRepos[i].owner}/${enabledRepos[i].name}`;
        if (result.status === 'fulfilled') {
          skills.push(...result.value);
        } else {
          console.warn(`[SkillService] Fetch repo ${repoInfo} failed:`, result.reason?.message);
        }
      }
    }

    // 合并本地已安装的技能
    this.mergeLocalSkills(skills);

    // 去重并排序
    this.deduplicateSkills(skills);
    skills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    // 更新缓存
    this.skillsCache = skills;
    this.cacheTime = Date.now();
    this.saveCacheToFile(skills);

    return skills;
  }

  /**
   * 从文件加载缓存
   */
  loadCacheFromFile() {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
        if (data.time && (Date.now() - data.time < CACHE_TTL)) {
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
    const skills = [];

    try {
      // 使用 GitHub Tree API 一次性获取所有文件
      const treeUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${repo.branch}?recursive=1`;
      const tree = await this.fetchGitHubApi(treeUrl);

      if (!tree || !tree.tree) {
        console.warn(`[SkillService] Empty tree for ${repo.owner}/${repo.name}`);
        return skills;
      }

      // 获取基础目录（如果配置了 directory）
      const baseDir = repo.directory || '';
      const baseDirPrefix = baseDir ? `${baseDir}/` : '';

      // 找到所有 SKILL.md 文件（如果配置了子目录，只扫描该目录下的）
      const skillFiles = tree.tree.filter(item => {
        if (item.type !== 'blob' || !item.path.endsWith('/SKILL.md')) {
          return false;
        }
        // 如果配置了子目录，只返回该子目录下的文件
        if (baseDir && !item.path.startsWith(baseDirPrefix)) {
          return false;
        }
        return true;
      });

      // 并行获取所有 SKILL.md 的内容（限制并发数）
      const batchSize = 5;

      for (let i = 0; i < skillFiles.length; i += batchSize) {
        const batch = skillFiles.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(file => this.fetchAndParseSkill(file, repo, baseDir))
        );

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            skills.push(result.value);
          }
        }
      }
    } catch (err) {
      console.error(`[SkillService] Fetch repo ${repo.owner}/${repo.name} error:`, err.message);
      throw err;
    }

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
      // 从路径提取目录名 (e.g., "algorithmic-art/SKILL.md" -> "algorithmic-art")
      const fullDirectory = file.path.replace(/\/SKILL\.md$/, '');

      // 计算相对于 baseDir 的目录名（用于显示和安装）
      const directory = baseDir ? fullDirectory.slice(baseDir.length + 1) : fullDirectory;

      // 使用 raw.githubusercontent.com 获取文件内容（不消耗 API 限额）
      const content = await this.fetchBlobContent(file.sha, repo, file.path);
      const metadata = this.parseSkillMd(content);

      return {
        key: `${repo.owner}/${repo.name}:${fullDirectory}`,
        name: metadata.name || directory.split('/').pop(),
        description: metadata.description || '',
        directory,  // 相对目录（用于安装）
        fullDirectory,  // 完整目录（用于从仓库下载）
        installed: this.isInstalled(directory),
        readmeUrl: `https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch}/${fullDirectory}`,
        repoOwner: repo.owner,
        repoName: repo.name,
        repoBranch: repo.branch,
        repoDirectory: repo.directory || '',  // 仓库配置的子目录
        license: metadata.license
      };
    } catch (err) {
      console.warn(`[SkillService] Parse skill ${file.path} error:`, err.message);
      return null;
    }
  }

  /**
   * 使用 raw.githubusercontent.com 获取文件内容（不消耗 API 限额）
   */
  async fetchBlobContent(sha, repo, filePath) {
    // raw.githubusercontent.com 不走 API 限流
    const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.branch}/${filePath}`;

    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'cc-cli-skill-service'
        },
        timeout: 15000
      }, (res) => {
        // 处理重定向
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            https.get(redirectUrl, {
              headers: { 'User-Agent': 'cc-cli-skill-service' },
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
   * 获取 GitHub Token（从环境变量或配置文件）
   */
  getGitHubToken() {
    // 优先从环境变量获取
    if (process.env.GITHUB_TOKEN) {
      return process.env.GITHUB_TOKEN;
    }
    // 从配置文件获取
    try {
      const configPath = path.join(this.configDir, 'github-token.txt');
      if (fs.existsSync(configPath)) {
        return fs.readFileSync(configPath, 'utf-8').trim();
      }
    } catch (err) {
      // ignore
    }
    return null;
  }

  /**
   * 通用 GitHub API 请求
   */
  async fetchGitHubApi(url) {
    const token = this.getGitHubToken();
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

  /**
   * 使用 GitHub API 获取目录内容
   */
  async fetchGitHubContents(owner, name, path, branch) {
    const url = `https://api.github.com/repos/${owner}/${name}/contents/${path}?ref=${branch}`;

    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'cc-cli-skill-service',
          'Accept': 'application/vnd.github.v3+json'
        },
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
        const subContents = await this.fetchGitHubContents(repo.owner, repo.name, dir.path, repo.branch);
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

  validateOpenCodeSkillMetadata({ name, description }, directory) {
    const expectedName = this.normalizeSkillDirectoryName(directory);
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedDescription = typeof description === 'string' ? description.trim() : '';

    if (!expectedName) {
      return '技能目录不能为空';
    }
    if (!normalizedName) {
      return 'SKILL.md frontmatter 缺少 name';
    }
    if (!normalizedDescription) {
      return 'SKILL.md frontmatter 缺少 description';
    }
    if (normalizedName.length < 1 || normalizedName.length > 64) {
      return 'name 必须为 1-64 个字符';
    }
    if (!OPENCODE_SKILL_NAME_REGEX.test(normalizedName)) {
      return 'name 必须为小写字母/数字，并使用单个连字符连接';
    }
    if (normalizedName !== expectedName) {
      return `name 必须与目录名一致（期望: ${expectedName}）`;
    }
    if (normalizedDescription.length < 1 || normalizedDescription.length > 1024) {
      return 'description 必须为 1-1024 个字符';
    }

    return null;
  }

  validateOpenCodeSkillContent(content, directory) {
    const metadata = this.parseSkillMd(content);
    return this.validateOpenCodeSkillMetadata(metadata, directory);
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
   * 合并本地已安装的技能
   */
  mergeLocalSkills(skills) {
    if (!fs.existsSync(this.installDir)) return;

    // 递归扫描本地技能目录
    this.scanLocalDir(this.installDir, this.installDir, skills);
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
      const dirName = directory.split('/').pop().toLowerCase();
      const existing = skills.find(s => {
        const remoteDirName = s.directory.split('/').pop().toLowerCase();
        return remoteDirName === dirName;
      });

      if (existing) {
        existing.installed = true;
      } else {
        // 添加本地独有的技能
        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const metadata = this.parseSkillMd(content);

          skills.push({
            key: `local:${directory}`,
            name: metadata.name || directory,
            description: metadata.description || '',
            directory,
            installed: true,
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
      // 使用目录名（不含路径前缀）作为去重 key
      const key = skill.directory.split('/').pop().toLowerCase();

      if (seen.has(key)) {
        // 保留已安装的版本
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

    // 已安装则跳过
    if (fs.existsSync(dest)) {
      return { success: true, message: 'Already installed' };
    }

    // 使用 fullDirectory（仓库中的完整路径）或 directory（向后兼容）
    const sourcePath = fullDirectory || directory;

    // 下载仓库 ZIP
    const zipUrl = `https://github.com/${repo.owner}/${repo.name}/archive/refs/heads/${repo.branch}.zip`;
    const tempDir = path.join(os.tmpdir(), `skill-${Date.now()}`);
    const zipPath = path.join(tempDir, 'repo.zip');

    try {
      fs.mkdirSync(tempDir, { recursive: true });

      // 下载 ZIP
      await this.downloadFile(zipUrl, zipPath);

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

      if (this.platform === 'opencode') {
        const skillMdPath = path.join(dest, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          const validationError = this.validateOpenCodeSkillContent(
            fs.readFileSync(skillMdPath, 'utf-8'),
            directory
          );
          if (validationError) {
            fs.rmSync(dest, { recursive: true, force: true });
            throw new Error(`OpenCode skill 格式不符合要求: ${validationError}`);
          }
        }
      }

      // 清除缓存，让列表刷新
      this.skillsCache = null;
      this.cacheTime = 0;

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
  async downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(dest);

      const request = https.get(url, {
        headers: { 'User-Agent': 'cc-cli-skill-service' },
        timeout: 60000
      }, (response) => {
        // 处理重定向
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
    const dest = path.join(this.installDir, directory);
    const normalizedDirectory = this.normalizeSkillDirectoryName(directory);

    // 检查是否已存在
    if (fs.existsSync(dest)) {
      throw new Error(`技能目录 "${directory}" 已存在`);
    }

    if (this.platform === 'opencode') {
      if (!OPENCODE_SKILL_NAME_REGEX.test(normalizedDirectory)) {
        throw new Error('OpenCode skill 目录名必须是小写字母/数字，并使用单个连字符连接');
      }
    }

    const normalizedDescription = (description || '').trim();
    const skillName = this.platform === 'opencode'
      ? normalizedDirectory
      : (name || directory);

    if (this.platform === 'opencode') {
      const validationError = this.validateOpenCodeSkillMetadata(
        {
          name: skillName,
          description: normalizedDescription
        },
        normalizedDirectory
      );
      if (validationError) {
        throw new Error(`OpenCode skill 格式不符合要求: ${validationError}`);
      }
    }

    // 创建目录
    fs.mkdirSync(dest, { recursive: true });

    // 生成 SKILL.md 内容
    const skillMdContent = this.platform === 'opencode'
      ? `---
name: ${skillName}
description: "${normalizedDescription}"
---

${content}
`
      : `---
name: "${skillName}"
description: "${normalizedDescription}"
---

${content}
`;

    // 写入文件
    fs.writeFileSync(path.join(dest, 'SKILL.md'), skillMdContent, 'utf-8');

    // 清除缓存，让列表刷新
    this.skillsCache = null;
    this.cacheTime = 0;

    return { success: true, message: '技能创建成功', directory };
  }

  /**
   * 创建带多文件的技能
   * @param {string} directory - 技能目录名
   * @param {Array<{path: string, content: string}>} files - 文件数组
   * @returns {Object} 创建结果
   */
  createSkillWithFiles({ directory, files }) {
    const dest = path.join(this.installDir, directory);
    const normalizedDirectory = this.normalizeSkillDirectoryName(directory);

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

    if (this.platform === 'opencode') {
      if (!OPENCODE_SKILL_NAME_REGEX.test(normalizedDirectory)) {
        throw new Error('OpenCode skill 目录名必须是小写字母/数字，并使用单个连字符连接');
      }

      const skillMdFile = files.find(f => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'));
      const skillMdContent = skillMdFile
        ? (skillMdFile.isBase64 ? Buffer.from(skillMdFile.content, 'base64').toString('utf-8') : skillMdFile.content)
        : '';
      const validationError = this.validateOpenCodeSkillContent(skillMdContent, normalizedDirectory);
      if (validationError) {
        throw new Error(`OpenCode skill 格式不符合要求: ${validationError}`);
      }
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

    // 清除缓存
    this.skillsCache = null;
    this.cacheTime = 0;

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
    const normalizedDirectory = this.normalizeSkillDirectoryName(directory);

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${directory}" 不存在`);
    }

    if (this.platform === 'opencode') {
      const incomingSkillMd = files.find(f => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'));
      if (incomingSkillMd) {
        const content = incomingSkillMd.isBase64
          ? Buffer.from(incomingSkillMd.content, 'base64').toString('utf-8')
          : incomingSkillMd.content;
        const validationError = this.validateOpenCodeSkillContent(content, normalizedDirectory);
        if (validationError) {
          throw new Error(`OpenCode skill 格式不符合要求: ${validationError}`);
        }
      }
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

    // 清除缓存
    this.skillsCache = null;
    this.cacheTime = 0;

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

    // 清除缓存
    this.skillsCache = null;
    this.cacheTime = 0;

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
    const normalizedDirectory = this.normalizeSkillDirectoryName(directory);

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${directory}" 不存在`);
    }

    const fullPath = path.join(skillPath, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件 "${filePath}" 不存在`);
    }

    if (this.platform === 'opencode' && /(^|\/)SKILL\.md$/i.test(filePath)) {
      const textContent = isBase64 ? Buffer.from(content, 'base64').toString('utf-8') : content;
      const validationError = this.validateOpenCodeSkillContent(textContent, normalizedDirectory);
      if (validationError) {
        throw new Error(`OpenCode skill 格式不符合要求: ${validationError}`);
      }
    }

    if (isBase64) {
      fs.writeFileSync(fullPath, Buffer.from(content, 'base64'));
    } else {
      fs.writeFileSync(fullPath, content, 'utf-8');
    }

    // 清除缓存
    this.skillsCache = null;
    this.cacheTime = 0;

    return { success: true, updated: filePath };
  }


  /**
   * 卸载技能
   */
  uninstallSkill(directory) {
    const dest = path.join(this.installDir, directory);

    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
      // 清除缓存
      this.skillsCache = null;
      this.cacheTime = 0;
      return { success: true, message: 'Uninstalled successfully' };
    }

    return { success: true, message: 'Not installed' };
  }

  /**
   * 获取技能详情（完整内容）
   */
  async getSkillDetail(directory) {
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

    const normalizeRepoPath = (input = '') =>
      String(input)
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');

    const parseRemoteSkillContent = (content, repo) => {
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
        source: 'github',
        repoOwner: repo.owner,
        repoName: repo.name
      };
    };

    const tryLoadRemoteDetailFromRepo = async (repo, extraCandidateDirs = []) => {
      try {
        const treeUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${repo.branch}?recursive=1`;
        const tree = await this.fetchGitHubApi(treeUrl);
        if (!tree?.tree) return null;

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
          if (!candidateDir) continue;
          skillFile = tree.tree.find(item =>
            item.type === 'blob' && item.path === `${candidateDir}/SKILL.md`
          );
          if (skillFile) break;
        }

        if (!skillFile) {
          const targetBaseName = normalizedDirectory.split('/').pop();
          skillFile = tree.tree.find(item => {
            if (item.type !== 'blob' || !item.path.endsWith('/SKILL.md')) return false;
            const parts = item.path.split('/');
            const parentDir = parts.length >= 2 ? parts[parts.length - 2] : '';
            return parentDir === targetBaseName;
          });
        }

        if (!skillFile) return null;

        const content = await this.fetchBlobContent(skillFile.sha, repo, skillFile.path);
        return parseRemoteSkillContent(content, repo);
      } catch (err) {
        console.warn('[SkillService] Fetch remote skill detail error:', err.message);
        return null;
      }
    };

    // 先尝试使用缓存中的 repo 信息（最快）
    const cachedSkill = this.skillsCache?.find(s => s.directory === directory);
    if (cachedSkill && cachedSkill.repoOwner && cachedSkill.repoName) {
      const cachedRepo = {
        owner: cachedSkill.repoOwner,
        name: cachedSkill.repoName,
        branch: cachedSkill.repoBranch || 'main',
        directory: cachedSkill.repoDirectory || ''
      };

      const detail = await tryLoadRemoteDetailFromRepo(cachedRepo, [
        cachedSkill.fullDirectory || '',
        cachedSkill.repoDirectory ? `${cachedSkill.repoDirectory}/${directory}` : ''
      ]);
      if (detail) return detail;
    }

    // 缓存缺失或过期时，回退到遍历仓库配置，避免详情页报错
    const repos = this.loadRepos().filter(repo => repo.enabled !== false);
    for (const repo of repos) {
      const detail = await tryLoadRemoteDetailFromRepo(
        {
          owner: repo.owner,
          name: repo.name,
          branch: repo.branch || 'main',
          directory: repo.directory || ''
        },
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
