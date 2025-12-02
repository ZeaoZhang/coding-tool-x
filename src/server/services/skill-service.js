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

// 默认仓库源 - 只预设官方仓库，其他由用户手动添加
const DEFAULT_REPOS = [
  { owner: 'anthropics', name: 'skills', branch: 'main', enabled: true }
];

// 缓存有效期（5分钟）
const CACHE_TTL = 5 * 60 * 1000;

class SkillService {
  constructor() {
    this.installDir = path.join(os.homedir(), '.claude', 'skills');
    this.configDir = path.join(os.homedir(), '.claude', 'cc-tool');
    this.reposConfigPath = path.join(this.configDir, 'skill-repos.json');
    this.cachePath = path.join(this.configDir, 'skills-cache.json');

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
        return data.repos || DEFAULT_REPOS;
      }
    } catch (err) {
      console.error('[SkillService] Load repos config error:', err.message);
    }
    return DEFAULT_REPOS;
  }

  /**
   * 保存仓库配置
   */
  saveRepos(repos) {
    fs.writeFileSync(this.reposConfigPath, JSON.stringify({ repos }, null, 2));
  }

  /**
   * 添加仓库
   */
  addRepo(repo) {
    const repos = this.loadRepos();
    const existingIndex = repos.findIndex(r => r.owner === repo.owner && r.name === repo.name);

    if (existingIndex >= 0) {
      repos[existingIndex] = repo;
    } else {
      repos.push(repo);
    }

    this.saveRepos(repos);
    return repos;
  }

  /**
   * 删除仓库
   */
  removeRepo(owner, name) {
    const repos = this.loadRepos();
    const filtered = repos.filter(r => !(r.owner === owner && r.name === name));
    this.saveRepos(filtered);
    return filtered;
  }

  /**
   * 切换仓库启用状态
   */
  toggleRepo(owner, name, enabled) {
    const repos = this.loadRepos();
    const repo = repos.find(r => r.owner === owner && r.name === name);
    if (repo) {
      repo.enabled = enabled;
      this.saveRepos(repos);
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

      // 找到所有 SKILL.md 文件
      const skillFiles = tree.tree.filter(item =>
        item.type === 'blob' && item.path.endsWith('/SKILL.md')
      );

      // 并行获取所有 SKILL.md 的内容（限制并发数）
      const batchSize = 5;

      for (let i = 0; i < skillFiles.length; i += batchSize) {
        const batch = skillFiles.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(file => this.fetchAndParseSkill(file, repo))
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
   */
  async fetchAndParseSkill(file, repo) {
    try {
      // 从路径提取目录名 (e.g., "algorithmic-art/SKILL.md" -> "algorithmic-art")
      const directory = file.path.replace(/\/SKILL\.md$/, '');

      // 使用 raw.githubusercontent.com 获取文件内容（不消耗 API 限额）
      const content = await this.fetchBlobContent(file.sha, repo, file.path);
      const metadata = this.parseSkillMd(content);

      return {
        key: `${repo.owner}/${repo.name}:${directory}`,
        name: metadata.name || directory.split('/').pop(),
        description: metadata.description || '',
        directory,
        installed: this.isInstalled(directory),
        readmeUrl: `https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch}/${directory}`,
        repoOwner: repo.owner,
        repoName: repo.name,
        repoBranch: repo.branch,
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
   * 解析 SKILL.md 文件
   */
  parseSkillMd(content) {
    const result = {
      name: null,
      description: null,
      license: null,
      allowedTools: [],
      metadata: {}
    };

    // 移除 BOM
    content = content.trim().replace(/^\uFEFF/, '');

    // 解析 YAML frontmatter
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return result;

    const frontmatter = match[1];

    // 简单解析 YAML
    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();

      // 去除引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      switch (key) {
        case 'name':
          result.name = value;
          break;
        case 'description':
          result.description = value;
          break;
        case 'license':
          result.license = value;
          break;
      }
    }

    return result;
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
   */
  async installSkill(directory, repo) {
    const dest = path.join(this.installDir, directory);

    // 已安装则跳过
    if (fs.existsSync(dest)) {
      return { success: true, message: 'Already installed' };
    }

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
      const sourceDir = path.join(repoDir, directory);

      if (!fs.existsSync(sourceDir)) {
        throw new Error(`Skill directory not found: ${directory}`);
      }

      // 复制到安装目录
      fs.mkdirSync(dest, { recursive: true });
      this.copyDirRecursive(sourceDir, dest);

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
   * 创建自定义技能
   */
  createCustomSkill({ name, directory, description, content }) {
    const dest = path.join(this.installDir, directory);

    // 检查是否已存在
    if (fs.existsSync(dest)) {
      throw new Error(`技能目录 "${directory}" 已存在`);
    }

    // 创建目录
    fs.mkdirSync(dest, { recursive: true });

    // 生成 SKILL.md 内容
    const skillMdContent = `---
name: "${name}"
description: "${description}"
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

    // 如果本地没有，尝试从缓存的技能列表中获取仓库信息
    const cachedSkill = this.skillsCache?.find(s => s.directory === directory);

    if (cachedSkill && cachedSkill.repoOwner && cachedSkill.repoName) {
      // 从 GitHub 获取内容
      try {
        const repo = {
          owner: cachedSkill.repoOwner,
          name: cachedSkill.repoName,
          branch: cachedSkill.repoBranch || 'main'
        };

        // 获取文件树找到 SKILL.md 的 SHA
        const treeUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${repo.branch}?recursive=1`;
        const tree = await this.fetchGitHubApi(treeUrl);

        const skillFile = tree.tree?.find(item =>
          item.type === 'blob' && item.path === `${directory}/SKILL.md`
        );

        if (skillFile) {
          const content = await this.fetchBlobContent(skillFile.sha, repo, skillFile.path);
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
        }
      } catch (err) {
        console.warn('[SkillService] Fetch remote skill detail error:', err.message);
      }
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
  DEFAULT_REPOS
};
