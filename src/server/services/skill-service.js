/**
 * Skills 技能服务
 *
 * 管理 Claude Code Skills 的获取、安装、卸载
 * Skills 安装目录: ~/.claude/skills/
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const {
  parseSkillContent,
} = require('./format-converter');
const { maskToken } = require('./oauth-utils');
const { NATIVE_PATHS, HOME_DIR, PATHS } = require('../../config/paths');
const { getOmpPaths } = require('../../platforms/drivers/omp/config');
const { discoverOmpSkills } = require('../../platforms/drivers/omp/skill-discovery');
const { migratePiStorage } = require('./pi-omp-migration');
const { resolveManagedPlatform } = require('./platform-resolution');
const {
  normalizeSafeRelativePath,
  pathHasProtectedSegment,
  resolveInsideRoot
} = require('../../shared/config-artifact-paths');
const remoteCredentialCache = require('./remote-credential-cache');
const { getPlatformContext } = require('../platform-context');
const {
  assertExistingProjectRoot,
  assertNoSymlinkComponents,
  resolveProjectTarget
} = require('../../shared/project-config');
const { ControlManifestStore } = require('./control-manifest-store');
const { EffectiveControlService } = require('./effective-control-service');
const { SkillArtifactStore } = require('./skill-artifact-store');
const { SkillFormatAdapter } = require('./skill-format-adapters');
const { SkillProjectionService } = require('./skill-projection-service');

const SUPPORTED_REPO_PROVIDERS = ['github', 'gitlab', 'local'];
const DEFAULT_GITHUB_HOST = 'https://github.com';
const DEFAULT_GITLAB_HOST = 'https://gitlab.com';
const CACHE_TTL = 5 * 60 * 1000;

function sanitizeRefreshError(value) {
  return String(value || '')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, '$1?[REDACTED]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:access[_-]?token|api[-_]?key|token|password|secret|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:token|secret|password|api[-_]?key|authorization)\s*[:=]\s*)[^,\s}]+/gi, '$1[REDACTED]');
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

function resolveExistingLocalRepoRoot(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Missing local repository path');
  const resolved = path.resolve(value);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    throw new Error(`Local repo path not found: ${resolved}`, { cause: error });
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Local repo root contains symlink: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Local repo path is not a directory: ${resolved}`);
  }
  return fs.realpathSync(resolved);
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

function sanitizeRepoUrl(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
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

class SkillService {
  constructor(
    platform = 'claude',
    {
      registry = getPlatformContext().registry,
      controlService = null,
      artifactStore = null,
      formatAdapter = null
    } = {}
  ) {
    this.registry = registry;
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
    this.artifactStore = artifactStore || (
      PATHS.skillArtifacts
        ? new SkillArtifactStore({ root: PATHS.skillArtifacts })
        : null
    );
    this.formatAdapter = formatAdapter || new SkillFormatAdapter();
    this.controlService = controlService || (
      PATHS.effectiveControlManifest
        ? new EffectiveControlService({
          store: new ControlManifestStore({
            userPath: PATHS.effectiveControlManifest,
            projectPathResolver: ({ projectPath }) => path.join(projectPath, '.ctx-control.json')
          }),
          projection: new SkillProjectionService({ registry: this.registry })
        })
        : null
    );

    // Prepared projections are keyed by scope and canonical cwd; raw repository skills are cwd-independent.
    this.skillsCache = null;
    this.cacheTime = 0;
    this._preparedSkillsCache = new Map();
    this._cacheGeneration = 0;
    this._remoteSkillsCache = null;
    this._remoteSkillsFetchedAt = 0;
    this._legacyMigrationChecked = false;

    this.githubTokenCache = new Map();

    // 确保目录存在
    this.ensureDirs();
  }

  refreshOmpPaths() {
    if (this.platform !== 'omp') return;
    const nextInstallDir = getOmpPaths().skills;
    if (this.installDir !== nextInstallDir) {
      this.installDir = nextInstallDir;
      this.clearCache();
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
    if (this.artifactStore?.root && !fs.existsSync(this.artifactStore.root)) {
      fs.mkdirSync(this.artifactStore.root, { recursive: true });
    }
  }

  clearCache({ removeFile = false } = {}) {
    this._cacheGeneration++;
    this.skillsCache = null;
    this.cacheTime = 0;
    this._preparedSkillsCache.clear();
    this._remoteSkillsCache = null;
    this._remoteSkillsFetchedAt = 0;
    this.githubTokenCache.clear();
    remoteCredentialCache.clear('github');
    remoteCredentialCache.clear('gitlab');

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
    if (!options.cwd) return '';
    const resolved = path.resolve(options.cwd);
    try {
      return fs.realpathSync(resolved);
    } catch {
      return resolved;
    }
  }

  _skillCacheKey(options = {}) {
    const scope = options.scope || 'user';
    return `${scope}:${this._skillCwdKey(options)}`;
  }


  _storePrepared(cacheKey, skills, generation = this._cacheGeneration) {
    const value = Array.isArray(skills) ? skills.map(skill => ({ ...skill })) : [];
    if (generation !== this._cacheGeneration) {
      return value.map(skill => ({ ...skill }));
    }
    const entry = { value, cachedAt: Date.now(), generation };
    this._preparedSkillsCache.set(cacheKey, entry);
    if (cacheKey === 'user:') {
      this.skillsCache = value;
      this.cacheTime = entry.cachedAt;
    }
    return value.map(skill => ({ ...skill }));
  }

  _artifactSkills(options = {}) {
    if (!this.artifactStore || typeof this.artifactStore.list !== 'function') return [];
    const artifacts = this.artifactStore.list({ platform: this.platform });
    const projectPath = options.scope === 'project' ? this._skillCwdKey(options) : null;
    return artifacts.map(artifact => {
      if (!artifact || typeof artifact.root !== 'string') return null;
      const artifactScope = artifact.sourceScope || 'user';
      if (
        (artifactScope === 'project' && (!projectPath || artifact.projectPath !== projectPath))
        || (artifactScope !== 'project' && artifact.projectPath && artifact.projectPath !== projectPath)
      ) return null;
      const skillPath = path.join(artifact.root, 'SKILL.md');
      try {
        if (!fs.existsSync(skillPath) || fs.lstatSync(skillPath).isSymbolicLink()) return null;
        const metadata = this.parseSkillMd(fs.readFileSync(skillPath, 'utf8'));
        const rawSourceProvider = artifact.sourceProvider || 'remote';
        const sourceProvider = rawSourceProvider === 'remote'
          ? (artifact.repoProvider || 'remote')
          : rawSourceProvider;
        const source = rawSourceProvider === 'remote'
          ? 'remote'
          : (rawSourceProvider === 'local-repo' ? 'local-repo' : 'provider-installed');
        const directory = artifact.targetDirectory
          || artifact.directory
          || artifact.fullDirectory
          || metadata.name;
        return {
          key: `artifact:${this.platform}:${artifact.sourceKey}:${artifact.format}`,
          sourceKey: artifact.sourceKey,
          name: metadata.name || artifact.name || directory,
          description: metadata.description || artifact.description || '',
          directory,
          fullDirectory: artifact.fullDirectory || directory,
          installed: false,
          cached: true,
          isLocal: ['local', 'local-repo', 'template'].includes(sourceProvider),
          source,
          sourceProvider,
          sourceScope: artifactScope,
          projectPath: artifact.projectPath || null,
          sourcePath: skillPath,
          artifact: {
            root: artifact.root,
            contentHash: artifact.contentHash || null,
            format: artifact.format || null,
            state: artifact.state || 'ready',
            fetchedAt: artifact.fetchedAt || null
          },
          repoProvider: artifact.repoProvider || null,
          repoOwner: artifact.repoOwner || null,
          repoName: artifact.repoName || null,
          repoBranch: artifact.repoBranch || null,
          repoDirectory: artifact.repoDirectory || artifact.fullDirectory || directory,
          repoHost: artifact.repoHost || null,
          repoProjectPath: artifact.repoProjectPath || null,
          repoLocalPath: artifact.repoLocalPath || null,
          repoUrl: artifact.repoUrl || null,
          protected: false,
          shadowedSources: [],
          readmeUrl: artifact.readmeUrl || null,
          license: metadata.license || null
        };
      } catch (error) {
        console.warn(`[SkillService] Read artifact ${artifact.sourceKey || ''} error:`, error.message);
        return null;
      }
    }).filter(Boolean);
  }
  _legacyCachedSkills(options = {}) {
    const cached = this._readRawRemoteCache();
    if (!cached || !Array.isArray(cached.skills)) return [];
    const scope = options.scope || 'user';
    const projectPath = scope === 'project' ? this._skillCwdKey(options) : null;
    return cached.skills
      .filter(skill => {
        const skillScope = skill.sourceScope || 'user';
        if (skillScope === 'project') {
          return scope === 'project' && skill.projectPath === projectPath;
        }
        return !skill.projectPath || skill.projectPath === projectPath;
      })
      .map(skill => ({
        ...skill,
        source: skill.source || 'remote',
        sourceProvider: skill.sourceProvider || 'remote',
        sourceScope: skill.sourceScope || 'user',
        sourceKey: skill.sourceKey || `legacy-cache:${this.platform}:${skill.repoId || skill.repoName || ''}:${skill.fullDirectory || skill.directory || skill.name || ''}`,
        cached: false,
        artifactRoot: null,
        artifactState: 'metadata_only',
        artifact: {
          ...(skill.artifact || {}),
          root: null,
          state: 'metadata_only'
        }
      }));
  }

  _sourceKeyForSkill(skill = {}, options = {}) {
    const sourceProvider = skill.sourceProvider || skill.source || 'native';
    const isProjectLocal = options.scope === 'project'
      && skill.sourceScope === 'project'
      && sourceProvider !== 'remote'
      && !skill.repoId;
    const projectPath = isProjectLocal ? this._skillCwdKey(options) : '';
    const addProjectIdentity = sourceKey => (
      isProjectLocal && projectPath && !sourceKey.includes(':project:')
        ? `${sourceKey}:project:${projectPath}`
        : sourceKey
    );
    if (skill.sourceKey) return addProjectIdentity(String(skill.sourceKey));
    const directory = skill.fullDirectory || skill.directory || skill.name || '';
    let sourceKey;
    if (sourceProvider === 'native' || sourceProvider === 'native-installed') {
      sourceKey = `native:${this.platform}:${directory}`;
    } else if (sourceProvider === 'cc-tool' || sourceProvider === 'local') {
      sourceKey = `local:${this.platform}:${directory}`;
    } else {
      const repo = skill.repoId || [skill.repoOwner, skill.repoName, skill.repoBranch].filter(Boolean).join('/');
      sourceKey = repo
        ? `repo:${repo}:${directory}`
        : `${sourceProvider}:${this.platform}:${skill.realPath || skill.sourcePath || directory}`;
    }
    return addProjectIdentity(sourceKey);
  }

  _controlKeyForSkill(skill, scope, projectPath, sourceKey) {
    const location = scope === 'project' ? projectPath : 'user';
    return skill.controlKey || `skill:${this.platform}:${scope}:${location}:${sourceKey}`;
  }

  _materializeLocalArtifact(skill, sourceKey, options = {}) {
    if (!this.artifactStore || !skill.sourcePath) return null;
    if (skill.source === 'remote' || skill.sourceProvider === 'remote' || skill.artifactRoot) return null;
    const root = path.dirname(skill.sourcePath);
    const projectPath = skill.sourceScope === 'project' && options.scope === 'project'
      ? this._skillCwdKey(options)
      : null;
    try {
      const files = this._collectLocalSkillFiles(root);
      const normalized = this.formatAdapter.normalize({
        platform: this.platform,
        files,
        sourceMetadata: {
          name: skill.name || skill.directory,
          sourceScope: skill.sourceScope || 'user',
          projectPath
        }
      });
      const existing = this.artifactStore.get?.({
        platform: this.platform,
        sourceKey,
        format: normalized.format
      });
      const contentHash = this.artifactStore.hashFileTree?.(normalized.files);
      if (existing && (!contentHash || existing.contentHash === contentHash)) return existing;
      return this.artifactStore.publishSkill({
        platform: this.platform,
        sourceKey,
        format: normalized.format,
        files: normalized.files,
        metadata: {
          name: skill.name || skill.directory,
          description: skill.description || '',
          directory: skill.directory,
          fullDirectory: skill.fullDirectory || skill.directory,
          sourceProvider: skill.sourceProvider || skill.source || 'native',
          sourceScope: skill.sourceScope || 'user',
          ...(projectPath ? { projectPath } : {}),
          revision: skill.revision || null
        }
      });
    } catch (error) {
      console.warn(`[SkillService] Materialize local Skill ${skill.directory || ''} failed:`, error.message);
      return {
        root: null,
        contentHash: null,
        state: 'unsupported',
        fetchedAt: null,
        lastError: error.message
      };
    }
  }

  _skillProjectionCapability(scope) {
    const capability = this.controlService?.projection?.getCapability?.(this.platform, scope);
    if (capability) return capability;
    const mapping = this.registry?.resolve?.(this.platform)?.projectResources?.skills;
    return mapping || scope === 'user'
      ? { mode: 'native-copy', format: null }
      : { mode: 'unsupported', format: null };
  }

  _buildSkillControlEntry(skill, options = {}) {
    const sourceScope = skill.sourceScope === 'project' && options.scope === 'project'
      ? 'project'
      : 'user';
    const projectPath = sourceScope === 'project' ? this._skillCwdKey(options) : null;
    const sourceKey = this._sourceKeyForSkill(skill, options);
    const controlKey = this._controlKeyForSkill(skill, sourceScope, projectPath, sourceKey);
    const isRemote = skill.source === 'remote'
      || skill.sourceProvider === 'remote'
      || skill.artifactState === 'metadata_only'
      || Boolean(skill.repoId);
    const projectionCapability = this._skillProjectionCapability(sourceScope);
    const localArtifact = this._materializeLocalArtifact(skill, sourceKey, options);
    const artifact = localArtifact || skill.artifact || null;
    const artifactRoot = skill.artifactRoot || artifact?.root || (
      skill.sourcePath ? path.dirname(skill.sourcePath) : null
    );
    const projectionUnsupported = skill.protected
      || skill.readonly === true
      || artifact?.state === 'unsupported'
      || projectionCapability.mode !== 'native-copy';
    return {
      kind: 'skill',
      controlKey,
      platform: this.platform,
      scope: sourceScope,
      projectPath,
      sourceKey,
      source: {
        kind: skill.sourceProvider || skill.source || 'native',
        repoId: skill.repoId || null,
        fullDirectory: skill.fullDirectory || skill.directory || '',
        revision: skill.revision || null
      },
      artifact: {
        ...(artifact || {}),
        root: artifactRoot,
        contentHash: skill.contentHash || artifact?.contentHash || null,
        state: skill.artifactState || artifact?.state || (isRemote ? 'metadata_only' : 'ready'),
        fetchedAt: artifact?.fetchedAt || null
      },
      targetDirectory: skill.directory,
      cached: skill.cached !== false && skill.artifactState !== 'metadata_only',
      enabled: isRemote ? false : skill.installed !== false,
      trust: isRemote ? 'pending' : 'approved',
      projection: {
        mode: projectionUnsupported ? 'unsupported' : projectionCapability.mode,
        sourceKey: !projectionUnsupported
          && !isRemote
          && (
            skill.sourceProvider === 'native'
            || skill.source === 'native-installed'
            || skill.source === 'project-installed'
          )
          ? sourceKey
          : null,
        path: null,
        updatedAt: null
      },
      managed: true,
      lastError: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  _applyControlState(skills, options = {}) {
    if (!this.controlService) {
      return skills.map(skill => ({
        ...skill,
        managed: true,
        cached: skill.cached !== false,
        enabled: skill.enabled === true || skill.installed === true,
        trust: skill.trust || (skill.source === 'remote' ? 'pending' : 'approved'),
        installed: skill.enabled === true || skill.installed === true
      }));
    }

    return skills.map(skill => {
      const candidate = this._buildSkillControlEntry(skill, options);
      const scopeOptions = { scope: candidate.scope, projectPath: candidate.projectPath };
      let entry = this.controlService.getSkill(candidate.controlKey, scopeOptions);
      if (!entry && (skill.sourceProvider === 'native' || skill.source === 'native-installed')) {
        const effective = this.controlService.getEffectiveSnapshot?.({
          platform: this.platform,
          scope: candidate.scope,
          projectPath: candidate.projectPath
        });
        entry = effective?.skills?.active?.find(item => (
          item.scope === candidate.scope
          && item.projectPath === candidate.projectPath
          && item.targetDirectory === candidate.targetDirectory
          && item.sourceKey !== candidate.sourceKey
          && item.artifact?.root
        )) || null;
      }
      if (!entry) {
        entry = this.controlService.registerSkill(candidate);
      } else if (
        candidate.artifact?.root
        && candidate.artifact?.contentHash
        && candidate.artifact.contentHash !== entry.artifact?.contentHash
      ) {
        if (entry.enabled || entry.projection?.state === 'enabled') {
          try {
            this.controlService.setSkillEnabled({
              platform: this.platform,
              controlKey: entry.controlKey,
              scope: candidate.scope,
              projectPath: candidate.projectPath,
              enabled: false
            });
          } catch (error) {
            candidate.lastError = error.message;
          }
        }
        entry = this.controlService.registerSkill({
          ...entry,
          artifact: { ...(entry.artifact || {}), ...candidate.artifact },
          cached: candidate.cached,
          enabled: false,
          trust: 'needs_review',
          projection: { ...(entry.projection || {}), state: 'disabled', updatedAt: Date.now() },
          lastError: candidate.lastError || null,
          updatedAt: Date.now()
        });
      } else if (
        (skill.sourceProvider === 'native' || skill.source === 'native-installed')
        && entry.sourceKey === candidate.sourceKey
        && !entry.projection?.sourceKey
        && candidate.projection?.sourceKey
      ) {
        entry = this.controlService.registerSkill({
          ...entry,
          projection: {
            ...(entry.projection || {}),
            sourceKey: candidate.projection.sourceKey,
            state: entry.enabled ? 'enabled' : (entry.projection?.state || 'disabled'),
            updatedAt: Date.now()
          },
          updatedAt: Date.now()
        });
      }
      const loadable = entry.trust === 'approved' && entry.artifact?.state === 'ready';
      return {
        ...skill,
        controlKey: entry.controlKey,
        sourceKey: entry.sourceKey || candidate.sourceKey,
        scope: entry.scope,
        sourceScope: entry.scope,
        projectPath: entry.projectPath,
        managed: true,
        cached: entry.cached,
        enabled: loadable && entry.enabled === true,
        trust: entry.trust,
        artifact: entry.artifact,
        installed: loadable && entry.enabled === true,
        lastError: entry.lastError || null
      };
    });
  }

  _latestRefreshTask(options = {}) {
    if (!PATHS.skillRefreshTasks || !fs.existsSync(PATHS.skillRefreshTasks)) return null;
    try {
      const persisted = JSON.parse(fs.readFileSync(PATHS.skillRefreshTasks, 'utf8'));
      const scope = options.scope || 'user';
      const projectPath = scope === 'project' ? this._skillCwdKey(options) : null;
      return (Array.isArray(persisted?.tasks) ? persisted.tasks : [])
        .filter(task => (
          task?.platform === this.platform
          && (task.scope || 'user') === scope
          && (task.projectPath || null) === projectPath
        ))
        .sort((a, b) => Number(b.finishedAt || b.createdAt || 0) - Number(a.finishedAt || a.createdAt || 0))[0] || null;
    } catch {
      return null;
    }
  }

  _refreshSnapshot(options = {}) {
    const scope = options.scope || 'user';
    const projectPath = scope === 'project' ? this._skillCwdKey(options) : null;
    const cached = this._readRawRemoteCache();
    const matchesScope = item => {
      const itemScope = item?.sourceScope || 'user';
      if (itemScope === 'project') {
        return scope === 'project' && item.projectPath === projectPath;
      }
      return !item.projectPath || item.projectPath === projectPath;
    };
    const cachedSkills = Array.isArray(cached?.skills)
      ? cached.skills.filter(matchesScope)
      : [];
    const cachedFetchedAt = cachedSkills.reduce(
      (latest, skill) => Math.max(latest, Number(skill.fetchedAt || 0)),
      0
    ) || (cachedSkills.length > 0 ? Number(cached?.fetchedAt || 0) : 0);
    const artifactFetchedAt = (this.artifactStore?.list?.({ platform: this.platform }) || [])
      .filter(matchesScope)
      .filter(artifact => artifact.sourceProvider === 'remote' || artifact.source === 'remote' || artifact.repoId)
      .reduce((latest, artifact) => Math.max(latest, Number(artifact.fetchedAt || 0)), 0);
    const fetchedAt = Math.max(cachedFetchedAt, artifactFetchedAt);
    const task = this._latestRefreshTask(options);
    return {
      state: task?.status || (fetchedAt > 0 ? 'idle' : 'never_fetched'),
      taskId: task?.id || null,
      fetchedAt: fetchedAt || null,
      error: task?.error ? sanitizeRefreshError(task.error) : null
    };
  }

  _ensureLegacyControlMigration() {
    if (this._legacyMigrationChecked || !this.controlService || !PATHS.configRegistry || !PATHS.configs) {
      return;
    }
    this._legacyMigrationChecked = true;
    try {
      const { ConfigRegistryService } = require('./config-registry-service');
      new ConfigRegistryService({ controlService: this.controlService }).migrateSkillControls();
    } catch (error) {
      this._legacyMigrationChecked = false;
      console.warn('[SkillService] Legacy control migration skipped:', error.message);
    }
  }

  _controlOnlySkills(options = {}, knownControlKeys = new Set()) {
    if (!this.controlService?.getEffectiveSnapshot) return [];
    const scope = options.scope || 'user';
    const projectPath = scope === 'project' ? this._skillCwdKey(options) : null;
    const snapshot = this.controlService.getEffectiveSnapshot({
      platform: this.platform,
      scope,
      projectPath
    });
    return (snapshot.skills?.active || [])
      .filter(entry => entry?.controlKey && !knownControlKeys.has(entry.controlKey))
      .map(entry => {
        const artifactRoot = typeof entry.artifact?.root === 'string' ? entry.artifact.root : null;
        const skillFile = artifactRoot ? path.join(artifactRoot, 'SKILL.md') : null;
        const artifactAllowed = !artifactRoot || !this.artifactStore?.root || (() => {
          try {
            assertNoSymlinkComponents(this.artifactStore.root, artifactRoot, fs);
            const relative = path.relative(path.resolve(this.artifactStore.root), path.resolve(artifactRoot));
            return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
          } catch {
            return false;
          }
        })();
        const available = Boolean(
          artifactAllowed
          && skillFile
          && path.isAbsolute(artifactRoot)
          && fs.existsSync(skillFile)
          && !fs.lstatSync(artifactRoot).isSymbolicLink()
          && !fs.lstatSync(skillFile).isSymbolicLink()
        );
        const artifactState = available ? (entry.artifact?.state || 'ready') : 'missing';
        const loadable = available && artifactState === 'ready' && entry.trust === 'approved';
        const source = entry.source || {};
        const sourceKind = typeof source === 'string' ? source : source.kind || 'unknown';
        const directory = String(entry.targetDirectory || source.fullDirectory || entry.name || entry.controlKey);
        return {
          key: entry.controlKey,
          controlKey: entry.controlKey,
          sourceKey: entry.sourceKey || null,
          name: entry.name || path.basename(directory),
          description: entry.description || '',
          directory,
          installed: loadable && entry.enabled === true,
          enabled: loadable && entry.enabled === true,
          cached: available && entry.cached !== false,
          isLocal: sourceKind === 'local' || sourceKind === 'template',
          source: sourceKind === 'remote' || sourceKind === 'git' ? 'remote' : sourceKind,
          sourceProvider: sourceKind,
          sourceScope: entry.scope,
          scope: entry.scope,
          projectPath: entry.projectPath || null,
          sourcePath: skillFile,
          artifact: {
            ...(entry.artifact || {}),
            root: artifactRoot,
            state: artifactState
          },
          artifactRoot,
          projectionOverlay: true,
          artifactState,
          contentHash: entry.artifact?.contentHash || null,
          revision: source.revision || null,
          repoId: source.repoId || null,
          cachedAt: entry.artifact?.fetchedAt || null,
          trust: entry.trust || 'pending',
          managed: true,
          projection: entry.projection || { mode: 'unsupported', state: 'unsupported' },
          lastError: entry.lastError || (!available ? 'Skill artifact is missing' : null),
          readonly: sourceKind === 'remote' || sourceKind === 'git',
          protected: false,
          shadowedSources: [],
          readmeUrl: null,
          license: null
        };
      });
  }

  async scanSkills(options = {}) {
    this._ensureLegacyControlMigration();
    const scope = options.scope || 'user';
    const scopeOptions = scope === 'project'
      ? this.resolveScopeOptions(options)
      : { scope: 'user', cwd: '' };
    const normalizedOptions = {
      ...options,
      scope,
      ...(scope === 'project' ? { cwd: scopeOptions.cwd } : {})
    };
    const cacheKey = this._skillCacheKey({
      scope,
      cwd: options.cwd || (scope === 'project' ? scopeOptions.cwd : '')
    });
    const generation = this._cacheGeneration;
    const rawSkills = [
      ...this._artifactSkills(normalizedOptions),
      ...this._legacyCachedSkills(normalizedOptions)
    ];
    const prepared = this.prepareSkills(rawSkills, normalizedOptions);
    const controlled = this._applyControlState(prepared, normalizedOptions);
    const knownControlKeys = new Set(controlled.map(skill => skill.controlKey).filter(Boolean));
    const missingControls = this._controlOnlySkills(normalizedOptions, knownControlKeys);
    const skills = [...controlled, ...missingControls];
    this.deduplicateSkills(skills);
    const preparedSkills = this._storePrepared(cacheKey, skills, generation);
    return {
      skills: preparedSkills,
      refresh: this._refreshSnapshot(normalizedOptions)
    };
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
      this.mergeInstalledSkills(preparedSkills, options);
      if (options.scope === 'project') {
        this.mergeProjectSkills(preparedSkills, options);
      }
    }
    this.deduplicateSkills(preparedSkills);
    preparedSkills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    this.updateInstallStatus(preparedSkills, {
      pathsRefreshed: this.platform === 'omp',
      options
    });

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
      if (!normalized.projectPath || normalized.projectPath.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
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

    normalized.repoUrl = sanitizeRepoUrl(repo.repoUrl, buildRepoUrl(normalized));
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
    const removedRepoIds = new Set(
      repos
        .filter(r => {
          if (repoId) {
            return r.id === repoId;
          }
          return (
            (r.owner || '') === owner &&
            (r.name || '') === name &&
            normalizeRepoDirectory(r.directory) === normalizedDirectory
          );
        })
        .map(r => r.id)
        .filter(Boolean)
    );
    const filtered = repos.filter(r => !removedRepoIds.has(r.id) && !(
      !repoId &&
      (r.owner || '') === owner &&
      (r.name || '') === name &&
      normalizeRepoDirectory(r.directory) === normalizedDirectory
    ));
    if (this.artifactStore && removedRepoIds.size > 0) {
      const disabledControlKeys = new Set();
      for (const artifact of this.artifactStore.list({ platform: this.platform })) {
        if (!removedRepoIds.has(artifact.repoId)) continue;
        const scope = artifact.sourceScope || 'user';
        const projectPath = scope === 'project' ? artifact.projectPath : null;
        const controlKey = `skill:${this.platform}:${scope}:${projectPath || 'user'}:${artifact.sourceKey}`;
        if (!disabledControlKeys.has(controlKey) && this.controlService?.getSkill && this.controlService?.setSkillEnabled) {
          let existing = null;
          try {
            existing = this.controlService.getSkill(controlKey, { scope, projectPath });
          } catch (_) {
            // A deleted project has no readable project control manifest.
          }
          if (existing) {
            try {
              const disabled = this.controlService.setSkillEnabled({
                platform: this.platform,
                controlKey,
                scope,
                projectPath,
                enabled: false
              });
              if (disabled?.enabled !== false && this.controlService.registerSkill) {
                this.controlService.registerSkill({
                  ...existing,
                  enabled: false,
                  projection: {
                    ...(existing.projection || {}),
                    ...(disabled?.projection || {}),
                    state: disabled?.projection?.state || 'conflict',
                    status: disabled?.projection?.status || 'conflict',
                    updatedAt: Date.now()
                  },
                  lastError: disabled?.lastError || 'Skill projection ownership could not be verified',
                  updatedAt: Date.now()
                });
              }
            } catch (error) {
              if (this.controlService.registerSkill) {
                this.controlService.registerSkill({
                  ...existing,
                  enabled: false,
                  projection: { ...(existing.projection || {}), state: 'error', status: 'error', updatedAt: Date.now() },
                  lastError: error.message,
                  updatedAt: Date.now()
                });
              }
            }
          }
          disabledControlKeys.add(controlKey);
        }
        this.artifactStore.markState({
          platform: this.platform,
          sourceKey: artifact.sourceKey,
          format: artifact.format,
          state: 'orphaned'
        });
      }
    }
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
   * 获取本地 Skill 列表。网络刷新必须由显式 refresh task 触发。
   *
   * @deprecated 内部调用请使用 scanSkills；此方法只保留现有脚本的数组响应兼容性。
   */
  async listSkills(options = {}, legacyOptions = {}) {
    const scanOptions = typeof options === 'boolean'
      ? {
        ...legacyOptions,
        ...(options ? { force: true } : {}),
        scope: legacyOptions.scope || (legacyOptions.cwd ? 'project' : 'user')
      }
      : options;
    const result = await this.scanSkills(scanOptions || {});
    return result.skills;
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
  updateInstallStatus(skills, { pathsRefreshed = false, options = {} } = {}) {
    if (this.platform === 'omp' && !pathsRefreshed) {
      this.refreshOmpPaths();
    }

    for (const skill of skills) {
      if (skill.sourceScope === 'project') {
        skill.installed = true;
      } else if (skill.sourceProvider || skill.sourcePath || skill.readonly) {
        skill.installed = skill.installed !== false;
      } else {
        const installOptions = options.scope === 'project'
          ? { scope: 'project', cwd: options.cwd, refresh: false }
          : { scope: 'user', refresh: false };
        skill.installed = this.isInstalled(skill.directory, installOptions);
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

  _skillBundleSourceKey(repo, fullDirectory) {
    return `repo:${repo.id || buildRepoId(repo)}:${normalizeRepoPath(fullDirectory)}`;
  }

  _treeSkillRoots(treeItems, repo) {
    const baseDir = normalizeRepoDirectory(repo.directory);
    if (baseDir) {
      normalizeSkillRelativePath(baseDir, 'skill repository directory', { allowHiddenSegments: true });
    }
    const basePrefix = baseDir ? `${baseDir}/` : '';
    return treeItems
      .filter(item => {
        if (!item || item.type !== 'blob' || !isRootSkillFile(item.path)) return false;
        const normalizedPath = normalizeRepoPath(item.path);
        try {
          normalizeSkillRelativePath(normalizedPath, 'skill repository file path', { allowHiddenSegments: true });
        } catch {
          return false;
        }
        return !baseDir || normalizedPath === baseDir || normalizedPath.startsWith(basePrefix);
      })
      .map(item => ({
        file: item,
        fullDirectory: normalizeRepoPath(item.path).replace(/\/SKILL\.md$/i, '')
      }))
      .filter(item => item.fullDirectory)
      .sort((a, b) => a.fullDirectory.length - b.fullDirectory.length);
  }

  async _fetchGitSkillBundles(repo, treeItems, revision = null) {
    const roots = this._treeSkillRoots(treeItems, repo);
    const rootPaths = roots.map(item => item.fullDirectory);
    const bundles = [];

    for (const root of roots) {
      const prefix = `${root.fullDirectory}/`;
      const nestedRoots = rootPaths.filter(candidate => (
        candidate !== root.fullDirectory && candidate.startsWith(prefix)
      ));
      const files = treeItems
        .filter(item => {
          if (!item || item.type !== 'blob') return false;
          const filePath = normalizeRepoPath(item.path);
          if (filePath !== `${root.fullDirectory}/SKILL.md` && !filePath.startsWith(prefix)) return false;
          normalizeSkillRelativePath(filePath, 'skill repository file path', { allowHiddenSegments: true });
          if (item.mode === '120000' || item.type === 'symlink') {
            throw new Error(`Skill repository contains symlink: ${filePath}`);
          }
          return !nestedRoots.some(nested => filePath === nested || filePath.startsWith(`${nested}/`));
        })
        .map(item => ({
          relativePath: normalizeRepoPath(item.path).slice(prefix.length),
          source: item
        }));
      const contentFiles = [];
      for (const file of files) {
        const content = await this.fetchSkillFileContent(repo, file.source);
        contentFiles.push({ relativePath: file.relativePath, content });
      }
      const skillMd = contentFiles.find(file => file.relativePath === 'SKILL.md');
      if (!skillMd) continue;
      const metadata = this.parseSkillMd(String(skillMd.content));
      const directory = this.resolveSkillDirectory(root.fullDirectory, repo.directory || '', repo);
      bundles.push({
        sourceKey: this._skillBundleSourceKey(repo, root.fullDirectory),
        directory,
        fullDirectory: root.fullDirectory,
        files: contentFiles,
        metadata: {
          name: metadata.name || directory,
          description: metadata.description || '',
          revision: revision || repo.revision || repo.commit || null,
          repoId: repo.id,
          repoOwner: repo.owner || null,
          repoName: repo.name || null,
          repoBranch: repo.branch || null,
          repoProvider: repo.provider,
          repoUrl: repo.repoUrl || buildRepoUrl(repo),
          readmeUrl: this.buildSkillReadmeUrl(repo, root.fullDirectory)
        }
      });
    }
    return bundles;
  }

  _collectLocalSkillFiles(skillDir) {
    const files = [];
    const visit = currentDir => {
      let entries;
      try {
        if (fs.lstatSync(currentDir).isSymbolicLink()) {
          throw new Error(`Skill repository contains symlink: ${currentDir}`);
        }
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (error) {
        if (error.message.includes('symlink')) throw error;
        throw new Error(`Unable to read local Skill directory: ${currentDir}`, { cause: error });
      }
      for (const entry of entries) {
        const sourcePath = path.join(currentDir, entry.name);
        if (entry.isSymbolicLink()) {
          throw new Error(`Skill repository contains symlink: ${sourcePath}`);
        }
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          if (currentDir !== skillDir && fs.existsSync(path.join(sourcePath, 'SKILL.md'))) {
            continue;
          }
          visit(sourcePath);
          continue;
        }
        if (!entry.isFile()) continue;
        const relativePath = normalizeSkillRelativePath(path.relative(skillDir, sourcePath), 'skill file path', {
          allowHiddenSegments: true
        });
        files.push({ relativePath, content: fs.readFileSync(sourcePath) });
      }
    };
    visit(skillDir);
    return files;
  }

  _registerCreatedSkill({ root, directory, scope = 'user', cwd = null }) {
    const files = this._collectLocalSkillFiles(root);
    const normalized = this.formatAdapter.normalize({
      platform: this.platform,
      files,
      sourceMetadata: { name: directory }
    });
    const projectPath = scope === 'project' ? this._skillCwdKey({ cwd }) : null;
    const sourceKey = projectPath
      ? `local:${this.platform}:project:${projectPath}:${directory}`
      : `local:${this.platform}:${directory}`;
    const controlKey = `skill:${this.platform}:${scope}:${projectPath || 'user'}:${sourceKey}`;
    const projectionCapability = this._skillProjectionCapability(scope);
    const published = this.artifactStore
      ? this.artifactStore.publishSkill({
        platform: this.platform,
        sourceKey,
        format: normalized.format,
        files: normalized.files,
        metadata: {
          name: directory,
          directory,
          sourceProvider: 'local',
          sourceScope: scope,
          ...(projectPath ? { projectPath } : {}),
          revision: null
        }
      })
      : {
        root,
        state: 'ready',
        contentHash: null,
        fetchedAt: Date.now()
      };
    const entry = {
      kind: 'skill',
      controlKey,
      platform: this.platform,
      scope,
      projectPath,
      sourceKey,
      source: {
        kind: 'local',
        repoId: null,
        fullDirectory: directory,
        revision: null
      },
      artifact: {
        root: published.root,
        contentHash: published.contentHash || null,
        state: published.state || 'ready',
        fetchedAt: published.fetchedAt || Date.now()
      },
      targetDirectory: directory,
      cached: true,
      enabled: false,
      trust: 'pending',
      projection: {
        mode: projectionCapability.mode,
        state: projectionCapability.mode === 'native-copy' ? 'disabled' : 'unsupported',
        path: null,
        updatedAt: null
      },
      managed: true,
      lastError: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const registered = this.controlService?.registerSkill
      ? this.controlService.registerSkill(entry)
      : entry;
    return {
      controlKey: registered.controlKey,
      artifact: registered.artifact,
      cached: true,
      enabled: false,
      trust: 'pending',
      managed: true,
      warnings: normalized.warnings
    };
  }

  registerTemplateSkill({ directory, files = null, repo = null, fullDirectory = null, scope = 'user', cwd = null } = {}) {
    const safeDirectory = this.normalizeSkillDirectory(directory);
    const projectPath = scope === 'project' ? this._skillCwdKey({ cwd }) : null;
    const projectionCapability = this._skillProjectionCapability(scope);
    if (scope === 'project' && !projectPath) {
      throw new Error('Project template Skill requires a valid cwd');
    }

    if (repo) {
      const normalizedRepo = this.normalizeRepoConfig(repo);
      const sourceDirectory = fullDirectory || safeDirectory;
      const sourceKey = this._skillBundleSourceKey(normalizedRepo, sourceDirectory);
      const controlKey = `skill:${this.platform}:user:user:${sourceKey}`;
      const existing = this.controlService?.getSkill?.(controlKey, { scope: 'user' }) || null;
      const entry = existing || {
        kind: 'skill',
        controlKey,
        platform: this.platform,
        scope: 'user',
        projectPath: null,
        sourceKey,
        source: {
          kind: 'remote',
          repoId: normalizedRepo.id,
          fullDirectory: sourceDirectory,
          revision: null
        },
        artifact: { root: null, contentHash: null, state: 'metadata_only', fetchedAt: null },
        targetDirectory: safeDirectory,
        cached: false,
        enabled: false,
        trust: 'pending',
        projection: {
          mode: projectionCapability.mode,
          state: projectionCapability.mode === 'native-copy' ? 'disabled' : 'unsupported',
          path: null,
          updatedAt: null
        },
        managed: true,
        lastError: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const registered = existing || this.controlService?.registerSkill?.(entry) || entry;
      return {
        status: 'pending_refresh',
        controlKey: registered.controlKey,
        cached: registered.cached,
        enabled: registered.enabled,
        trust: registered.trust,
        managed: true
      };
    }

    let sourceFiles = files;
    if (!Array.isArray(sourceFiles)) {
      const localRoot = this.resolveStoragePath(safeDirectory).path;
      if (!fs.existsSync(localRoot)) throw new Error(`本地模板 Skill "${safeDirectory}" 不存在`);
      sourceFiles = this._collectLocalSkillFiles(localRoot);
    } else {
      sourceFiles = sourceFiles.map(file => ({
        relativePath: file.relativePath || file.path,
        content: file.content,
        ...(file.encoding ? { encoding: file.encoding } : {}),
        ...(file.mode ? { mode: file.mode } : {})
      }));
    }
    const normalized = this.formatAdapter.normalize({
      platform: this.platform,
      files: sourceFiles,
      sourceMetadata: { name: safeDirectory }
    });
    const sourceKey = projectPath
      ? `template:${this.platform}:project:${projectPath}:${safeDirectory}`
      : `template:${this.platform}:${safeDirectory}`;
    const controlKey = `skill:${this.platform}:${scope}:${projectPath || 'user'}:${sourceKey}`;
    const scopeOptions = { scope, projectPath };
    const existing = this.controlService?.getSkill?.(controlKey, scopeOptions) || null;
    if (existing) {
      return {
        status: 'pending',
        controlKey: existing.controlKey,
        cached: existing.cached,
        enabled: existing.enabled,
        trust: existing.trust,
        managed: true
      };
    }
    const published = this.artifactStore?.publishSkill?.({
      platform: this.platform,
      sourceKey,
      format: normalized.format,
      files: normalized.files,
      metadata: {
        name: safeDirectory,
        directory: safeDirectory,
        sourceProvider: 'template',
        sourceScope: scope,
        ...(projectPath ? { projectPath } : {}),
        revision: null
      }
    }) || {
      root: null,
      contentHash: null,
      state: 'ready',
      fetchedAt: Date.now()
    };
    const entry = {
      kind: 'skill',
      controlKey,
      platform: this.platform,
      scope,
      projectPath,
      sourceKey,
      source: { kind: 'template', repoId: null, fullDirectory: safeDirectory, revision: null },
      artifact: {
        root: published.root,
        contentHash: published.contentHash,
        state: published.state || 'ready',
        fetchedAt: published.fetchedAt || Date.now()
      },
      targetDirectory: safeDirectory,
      cached: true,
      enabled: false,
      trust: 'pending',
      projection: {
        mode: projectionCapability.mode,
        state: projectionCapability.mode === 'native-copy' ? 'disabled' : 'unsupported',
        path: null,
        updatedAt: null
      },
      managed: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const registered = this.controlService?.registerSkill?.(entry) || entry;
    return {
      status: 'pending',
      controlKey: registered.controlKey,
      cached: registered.cached,
      enabled: registered.enabled,
      trust: registered.trust,
      managed: true,
      warnings: normalized.warnings
    };
  }

  _collectLocalSkillBundles(repo) {
    const repoRoot = resolveExistingLocalRepoRoot(repo.localPath);
    const safeDirectory = normalizeSkillRelativePath(repo.directory || '', 'skill repository directory', {
      allowEmpty: true
    });
    const scanRoot = safeDirectory
      ? resolveInsideRoot(repoRoot, safeDirectory, 'Skill repository directory', { allowHiddenSegments: true })
      : repoRoot;
    assertNoSymlinkComponents(repoRoot, scanRoot, fs);
    if (!fs.existsSync(scanRoot)) throw new Error(`Local repo path not found: ${scanRoot}`);

    const bundles = [];
    const visit = currentDir => {
      if (fs.lstatSync(currentDir).isSymbolicLink()) {
        throw new Error(`Skill repository contains symlink: ${currentDir}`);
      }
      const skillMdPath = path.join(currentDir, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        if (fs.lstatSync(skillMdPath).isSymbolicLink()) {
          throw new Error(`Skill repository contains symlink: ${skillMdPath}`);
        }
        const files = this._collectLocalSkillFiles(currentDir);
        const skillMd = files.find(file => file.relativePath === 'SKILL.md');
        const metadata = this.parseSkillMd(String(skillMd.content));
        const fullDirectory = normalizeRepoPath(path.relative(repoRoot, currentDir));
        const directory = this.resolveSkillDirectory(fullDirectory, repo.directory || '', repo);
        bundles.push({
          sourceKey: this._skillBundleSourceKey(repo, fullDirectory),
          directory,
          fullDirectory,
          files,
          metadata: {
            name: metadata.name || directory,
            description: metadata.description || '',
            revision: repo.revision || null,
            repoId: repo.id,
            repoProvider: 'local',
            repoLocalPath: repo.localPath,
            readmeUrl: null
          }
        });
        return;
      }
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        visit(path.join(currentDir, entry.name));
      }
    };
    visit(scanRoot);
    return bundles;
  }

  async fetchRepoSkillBundles(repo) {
    if (repo.provider === 'local') {
      return this._collectLocalSkillBundles(repo);
    }
    const tree = repo.provider === 'gitlab'
      ? await this.fetchGitLabTree(repo)
      : await this.fetchGitHubRepoTree(repo);
    return this._fetchGitSkillBundles(repo, tree, tree.revision || repo.revision || repo.commit || null);
  }

  _controlEntryForBundle(bundle, repo, artifact, scope = 'user', projectPath = null) {
    const normalizedProjectPath = scope === 'project' ? String(projectPath || '').trim() : null;
    if (scope === 'project' && !normalizedProjectPath) {
      throw new Error('Project Skill refresh requires a canonical projectPath');
    }
    const sourceKey = bundle.sourceKey;
    const location = normalizedProjectPath || 'user';
    const controlKey = `skill:${this.platform}:${scope}:${location}:${sourceKey}`;
    const existing = this.controlService?.getSkill?.(controlKey, {
      scope,
      projectPath: normalizedProjectPath
    }) || null;
    const revision = bundle.metadata?.revision || null;
    const changed = !existing
      || existing.artifact?.contentHash !== artifact.contentHash
      || (existing.source?.revision || null) !== revision;
    let staleProjectionError = null;
    if (changed && (existing?.enabled || existing?.projection?.state === 'enabled') && this.controlService?.setSkillEnabled) {
      try {
        const disabled = this.controlService.setSkillEnabled({
          platform: this.platform,
          controlKey,
          scope,
          projectPath: normalizedProjectPath,
          enabled: false
        });
        if (disabled?.status === 'projection_failed') staleProjectionError = disabled.lastError || 'Unable to remove previous projection';
      } catch (error) {
        staleProjectionError = error.message;
      }
    }
    const next = {
      ...bundle.metadata,
      kind: 'skill',
      controlKey,
      platform: this.platform,
      scope,
      projectPath: normalizedProjectPath,
      sourceKey,
      source: {
        kind: repo.provider === 'local' ? 'local' : 'remote',
        repoId: repo.id || null,
        fullDirectory: bundle.fullDirectory,
        revision
      },
      artifact: {
        root: artifact.root,
        contentHash: artifact.contentHash,
        format: artifact.format || null,
        state: artifact.state || 'ready',
        fetchedAt: artifact.fetchedAt || Date.now()
      },
      targetDirectory: bundle.directory,
      cached: true,
      enabled: changed ? false : existing.enabled === true,
      trust: changed ? 'needs_review' : (existing.trust || 'pending'),
      projection: changed
        ? { ...(existing?.projection || {}), mode: existing?.projection?.mode || 'native-copy', state: 'disabled', updatedAt: Date.now() }
        : (existing?.projection || { mode: 'native-copy', state: 'disabled', updatedAt: Date.now() }),
      managed: true,
      lastError: staleProjectionError,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    return this.controlService?.registerSkill
      ? this.controlService.registerSkill(next)
      : next;
  }

  async refreshRemoteSkills({ platform = this.platform, scope = 'user', projectPath = null, reportProgress = () => {} } = {}) {
    if (platform !== this.platform) throw new Error(`SkillService platform mismatch: ${platform}`);
    if (!['user', 'project'].includes(scope)) throw new Error('Invalid Skill refresh scope');
    const normalizedProjectPath = scope === 'project' ? this._skillCwdKey({ cwd: projectPath }) : null;
    if (scope === 'project' && !normalizedProjectPath) {
      throw new Error('Project Skill refresh requires a canonical projectPath');
    }
    const repos = this.loadRepos().filter(repo => repo.enabled);
    const successfulSkills = [];
    const failedRepos = [];
    const updatedControlKeys = [];
    const results = await Promise.allSettled(repos.map(async repo => {
      const repoId = repo.id || buildRepoLabel(repo);
      reportProgress({ [repoId]: { status: 'running' } });
      try {
        const bundles = await this.fetchRepoSkillBundles(repo);
        for (const bundle of bundles) {
          const scopedSourceKey = scope === 'project'
            ? `${bundle.sourceKey}:project:${normalizedProjectPath}`
            : bundle.sourceKey;
          const scopedBundle = scopedSourceKey === bundle.sourceKey
            ? bundle
            : { ...bundle, sourceKey: scopedSourceKey };
          const normalized = this.formatAdapter.normalize({
            platform: this.platform,
            files: scopedBundle.files,
            sourceMetadata: scopedBundle.metadata
          });
          if (!this.artifactStore) throw new Error('Skill artifact store is unavailable');
          const artifact = await this.artifactStore.publishSkill({
            platform: this.platform,
            sourceKey: scopedBundle.sourceKey,
            format: normalized.format,
            files: normalized.files,
            metadata: {
              ...scopedBundle.metadata,
              directory: scopedBundle.directory,
              fullDirectory: scopedBundle.fullDirectory,
              sourceProvider: repo.provider === 'local' ? 'local-repo' : 'remote',
              sourceScope: scope,
              ...(normalizedProjectPath ? { projectPath: normalizedProjectPath } : {}),
              revision: scopedBundle.metadata?.revision || null
            }
          });
          const control = this._controlEntryForBundle(
            scopedBundle,
            repo,
            artifact,
            scope,
            normalizedProjectPath
          );
          if (control?.controlKey) updatedControlKeys.push(control.controlKey);
          successfulSkills.push({ ...scopedBundle, artifact, warnings: normalized.warnings });
        }
        reportProgress({ [repoId]: { status: 'succeeded', skillCount: bundles.length } });
        return { repo, bundles };
      } catch (error) {
        const safeError = sanitizeRefreshError(error?.message || error);
        failedRepos.push({ repoId, error: safeError });
        reportProgress({ [repoId]: { status: 'failed', error: safeError } });
        throw error;
      }
    }));

    const fetchedRepos = results.filter(result => result.status === 'fulfilled').length;
    const fetchedSkills = successfulSkills.length;
    const status = failedRepos.length === 0
      ? 'succeeded'
      : (fetchedRepos > 0 || fetchedSkills > 0 ? 'partial' : 'failed');
    if (fetchedSkills > 0) {
      const fetchedAt = Date.now();
      const summaries = successfulSkills.map(bundle => ({
        ...this.createSkillListItem({
          metadata: bundle.metadata,
          repo: repos.find(repo => repo.id === bundle.metadata?.repoId) || {},
          directory: bundle.directory,
          fullDirectory: bundle.fullDirectory
        }),
        sourceKey: bundle.sourceKey,
        sourceProvider: bundle.metadata?.repoProvider === 'local' ? 'local-repo' : 'remote',
        sourceScope: scope,
        projectPath: normalizedProjectPath,
        artifactRoot: bundle.artifact.root,
        artifactState: bundle.artifact.state || 'ready',
        contentHash: bundle.artifact.contentHash,
        revision: bundle.metadata?.revision || null,
        cached: true,
        installed: false,
        fetchedAt
      }));
      this._remoteSkillsCache = summaries;
      this._remoteSkillsFetchedAt = fetchedAt;
      this.saveCacheToFile(summaries, fetchedAt);
    }
    return {
      status,
      fetchedRepos,
      fetchedSkills,
      failedRepos,
      updatedControlKeys
    };
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
    const repoRoot = resolveExistingLocalRepoRoot(repo.localPath);
    const safeDirectory = normalizeSkillRelativePath(repo.directory || '', 'skill repository directory', {
      allowEmpty: true
    });
    const scanRoot = safeDirectory
      ? resolveInsideRoot(repoRoot, safeDirectory, 'Skill repository directory', { allowHiddenSegments: true })
      : repoRoot;
    assertNoSymlinkComponents(repoRoot, scanRoot, fs);

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
    try {
      if (fs.lstatSync(currentDir).isSymbolicLink()) return;
    } catch {
      return;
    }

    const skillMdPath = path.join(currentDir, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      try {
        if (fs.lstatSync(skillMdPath).isSymbolicLink()) return;
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
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
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
      const repoRoot = resolveExistingLocalRepoRoot(repo.localPath);
      const safeFilePath = normalizeSkillRelativePath(file.path, 'skill repository file path');
      const localFilePath = resolveInsideRoot(repoRoot, safeFilePath, 'Skill repository file path', { allowHiddenSegments: true });
      assertNoSymlinkComponents(repoRoot, localFilePath, fs);
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
    const items = Array.isArray(tree?.tree) ? tree.tree : [];
    Object.defineProperty(items, 'revision', {
      value: tree?.sha || repo.revision || repo.commit || null,
      enumerable: false,
      configurable: true
    });
    return items;
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

    Object.defineProperty(tree, 'revision', {
      value: repo.revision || repo.commit || null,
      enumerable: false,
      configurable: true
    });
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
  async fetchFileContent(url, { allowedHost = null, redirects = 0 } = {}) {
    const currentUrl = new URL(String(url));
    if (!['http:', 'https:'].includes(currentUrl.protocol)) {
      throw new Error('Skill file download requires HTTP(S)');
    }
    const host = allowedHost || currentUrl.host;
    if (currentUrl.host !== host) {
      throw new Error('Skill file redirect leaves the provider host');
    }
    if (redirects > 5) throw new Error('Skill file download redirected too many times');
    const protocol = currentUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = protocol.get(currentUrl, {
        headers: { 'User-Agent': 'cc-cli-skill-service' },
        timeout: 10000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let nextUrl;
          try {
            nextUrl = new URL(res.headers.location, currentUrl);
          } catch {
            reject(new Error('Invalid Skill file redirect'));
            return;
          }
          if (nextUrl.host !== host) {
            reject(new Error('Skill file redirect leaves the provider host'));
            return;
          }
          this.fetchFileContent(nextUrl.toString(), { allowedHost: host, redirects: redirects + 1 })
            .then(resolve)
            .catch(reject);
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

  resolveScopeOptions(options = {}) {
    const scope = options.scope || 'user';
    if (scope === 'user') {
      return {
        scope,
        cwd: '',
        roots: [this.installDir],
        writeRoot: this.installDir
      };
    }
    if (scope !== 'project') {
      throw new Error('Invalid scope: expected "user" or "project"');
    }
    if (!options.cwd) {
      throw new Error('Project scope requires a valid cwd');
    }

    const projectRoot = assertExistingProjectRoot(options.cwd, fs);
    const mapping = this.registry?.resolve?.(this.platform)?.projectResources?.skills;
    if (!mapping) {
      throw new Error(`Project Skills are not supported for ${this.platform}`);
    }

    const roots = mapping.readRoots.map(relativeRoot => resolveProjectTarget(
      projectRoot,
      relativeRoot,
      'project skill root',
      { allowRoot: true },
      fs
    ));
    const writeRoot = resolveProjectTarget(
      projectRoot,
      mapping.canonicalRoot,
      'project skill root',
      { allowRoot: true },
      fs
    );
    return { scope, cwd: projectRoot, roots, writeRoot };
  }

  resolveInstallPath(directory, label = 'skill directory', options = {}) {
    if (options.refresh !== false) {
      this.refreshOmpPaths();
    }
    const safeDirectory = this.normalizeSkillDirectory(directory, label);
    const scopeOptions = this.resolveScopeOptions(options);
    const target = resolveInsideRoot(scopeOptions.writeRoot, safeDirectory, label, { allowHiddenSegments: true });
    assertNoSymlinkComponents(scopeOptions.writeRoot, target, fs);
    return {
      safeDirectory,
      scope: scopeOptions.scope,
      path: target
    };
  }


  resolveStoragePath(directory, label = 'skill directory') {
    const safeDirectory = this.normalizeSkillDirectory(directory, label);
    const target = resolveInsideRoot(this.storageDir, safeDirectory, label, { allowHiddenSegments: true });
    assertNoSymlinkComponents(this.storageDir, target, fs);
    return {
      safeDirectory,
      path: target
    };
  }

  resolveWritableSkillPath(directory, options = {}) {
    if (options.scope === 'project') {
      return this.resolveInstallPath(directory, 'skill directory', options);
    }
    return this.resolveStoragePath(directory);
  }

  _writeSkillFileAtomic(filePath, content, targetRoot = this.storageDir) {
    const parentDir = path.dirname(filePath);
    assertNoSymlinkComponents(targetRoot, parentDir, fs);
    assertNoSymlinkComponents(targetRoot, filePath, fs);
    fs.mkdirSync(parentDir, { recursive: true });
    assertNoSymlinkComponents(targetRoot, parentDir, fs);
    const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    let descriptor;
    try {
      const flags = fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW || 0);
      descriptor = fs.openSync(tempPath, flags, 0o600);
      fs.writeFileSync(descriptor, content);
      fs.closeSync(descriptor);
      descriptor = undefined;
      const tempRealPath = fs.realpathSync(tempPath);
      const rootRealPath = fs.realpathSync(targetRoot);
      const relative = path.relative(rootRealPath, tempRealPath);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Skill file escapes target root');
      }
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch (_) {}
      }
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (_) {}
      throw error;
    }
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
  mergeInstalledSkills(skills, options = {}) {
    if (!fs.existsSync(this.installDir)) return;
    this.scanLocalDir(this.installDir, this.installDir, skills, {
      includeHiddenDirs: this.platform === 'codex',
      forceInstalled: true,
      source: 'native-installed',
      sourceScope: 'user',
      installOptions: { scope: 'user', refresh: false }
    });
  }

  mergeProjectSkills(skills, options = {}) {
    const scopeOptions = this.resolveScopeOptions(options);
    for (const root of scopeOptions.roots) {
      if (!fs.existsSync(root)) continue;
      this.scanLocalDir(root, root, skills, {
        includeHiddenDirs: true,
        forceInstalled: true,
        source: 'project-installed',
        sourceScope: 'project',
        installOptions: { scope: 'project', cwd: scopeOptions.cwd, refresh: false }
      });
    }
  }

  /**
   * 递归扫描本地目录
   */
  scanLocalDir(currentDir, baseDir, skills, options = {}) {
    try {
      if (fs.lstatSync(currentDir).isSymbolicLink()) return;
    } catch (error) {
      if (error.code !== 'ENOENT') return;
    }

    const skillMdPath = path.join(currentDir, 'SKILL.md');
    try {
      if (fs.existsSync(skillMdPath) && fs.lstatSync(skillMdPath).isSymbolicLink()) return;
    } catch {
      return;
    }

    if (fs.existsSync(skillMdPath)) {
      const directory = currentDir === baseDir
        ? path.basename(currentDir)
        : path.relative(baseDir, currentDir);

      const protectedSkill = this.isProtectedSkillDirectory(directory);
      const skillSource = protectedSkill ? 'system-installed' : (options.source || 'local');
      const sourceScope = options.sourceScope || 'user';
      const sourceProvider = options.source === 'native-installed' ? 'native' : 'cc-tool';

      let isInstalled = options.forceInstalled === true;
      if (!isInstalled) {
        try {
          isInstalled = fs.existsSync(path.join(
            this.resolveInstallPath(directory, 'skill directory', options.installOptions || {}).path,
            'SKILL.md'
          ));
        } catch {
          isInstalled = false;
        }
      }

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const metadata = this.parseSkillMd(content);
        const sourceKey = protectedSkill
          ? `system:${this.platform}:${directory}`
          : (sourceProvider === 'native'
            ? `native:${this.platform}:${directory}`
            : `local:${this.platform}:${directory}`);

        const skill = {
          key: `local:${sourceScope}:${directory}`,
          sourceKey,
          name: metadata.name || directory,
          description: metadata.description || '',
          directory,
          installed: isInstalled,
          isLocal: skillSource === 'local',
          source: skillSource,
          protected: protectedSkill,
          readonly: false,
          sourceProvider,
          sourceScope,
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

      return;
    }

    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory()
          && !entry.isSymbolicLink()
          && (options.includeHiddenDirs || !entry.name.startsWith('.'))
        ) {
          this.scanLocalDir(path.join(currentDir, entry.name), baseDir, skills, options);
        }
      }
    } catch {
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
    const artifactTargets = new Map();
    const priority = skill => {
      const isArtifact = Boolean(skill.artifactRoot || skill.artifact?.root);
      const sourceProvider = skill.sourceProvider || skill.source;
      if (!isArtifact && skill.sourceScope === 'project') return 4;
      if (!isArtifact && ['cc-tool', 'native', 'local'].includes(sourceProvider)) return 3;
      if (skill.sourceScope === 'project' || isArtifact) return 2;
      if (skill.sourceProvider === 'native' || skill.source === 'native-installed') return 1;
      if (skill.installed) return 1;
      return 0;
    };

    for (const skill of skills) {
      const normalizedDirectory = normalizeRepoPath(skill.directory).toLowerCase();
      const identity = this.platform === 'omp'
        ? (skill.sourceKey || `${skill.sourceProvider || skill.source || 'unknown'}:${String(skill.name || skill.directory).toLowerCase()}`)
        : (skill.sourceKey || [
          normalizedDirectory,
          skill.repoId || ''
        ].join('::'));
      let realPath = skill.realPath || '';
      if (!realPath && skill.sourcePath) {
        try {
          if (!fs.lstatSync(skill.sourcePath).isSymbolicLink()) {
            realPath = fs.realpathSync(skill.sourcePath);
          }
        } catch {
          realPath = '';
        }
      }
      const isArtifact = Boolean(skill.artifactRoot || skill.artifact?.root);
      const isManagedOverlay = skill.projectionOverlay || (!skill.repoId && (
        skill.sourceProvider === 'cc-tool'
        || skill.sourceProvider === 'native'
        || ['local', 'native-installed', 'system-installed'].includes(skill.source)
      ));
      const existingIndex = identityMap.get(identity)
        ?? (realPath ? realPathMap.get(realPath) : undefined)
        ?? (isManagedOverlay ? managedOverlayTargets.get(normalizedDirectory) : undefined)
        ?? (isManagedOverlay ? artifactTargets.get(normalizedDirectory) : undefined);

      if (existingIndex == null) {
        identityMap.set(identity, deduplicated.length);
        if (realPath) realPathMap.set(realPath, deduplicated.length);
        if (isManagedOverlay && !managedOverlayTargets.has(normalizedDirectory)) {
          managedOverlayTargets.set(normalizedDirectory, deduplicated.length);
        }
        if (isArtifact && !artifactTargets.has(normalizedDirectory)) {
          artifactTargets.set(normalizedDirectory, deduplicated.length);
        }
        deduplicated.push(skill);
        continue;
      }

      const existing = deduplicated[existingIndex];
      const incomingShadow = skill.sourceProvider || skill.sourcePath
        ? {
          sourceProvider: skill.sourceProvider || skill.source || 'unknown',
          sourceScope: skill.sourceScope || 'user',
          sourcePath: skill.sourcePath || ''
        }
        : null;
      const existingShadow = existing.sourceProvider || existing.sourcePath
        ? {
          sourceProvider: existing.sourceProvider || existing.source || 'unknown',
          sourceScope: existing.sourceScope || 'user',
          sourcePath: existing.sourcePath || ''
        }
        : null;
      if (
        (skill.sourceProvider === 'native' || skill.source === 'native-installed')
        && existing.artifactRoot
        && (existing.source === 'remote' || existing.sourceProvider === 'local-repo' || existing.repoId)
        && existing.sourceScope === (skill.sourceScope || 'user')
      ) {
        existing.shadowedSources = [
          ...(existing.shadowedSources || []),
          ...(incomingShadow ? [incomingShadow] : [])
        ];
        if (skill.installed) existing.installed = true;
        continue;
      }

      if (priority(skill) > priority(existing)) {
        deduplicated[existingIndex] = {
          ...skill,
          installed: Boolean(skill.installed || existing.installed),
          shadowedSources: [
            ...(existing.shadowedSources || []),
            ...(existingShadow ? [existingShadow] : [])
          ]
        };
        if (isArtifact) artifactTargets.set(normalizedDirectory, existingIndex);
      } else {
        existing.shadowedSources = [
          ...(existing.shadowedSources || []),
          ...(incomingShadow ? [incomingShadow] : [])
        ];
        if (skill.installed) existing.installed = true;
      }
    }

    skills.splice(0, skills.length, ...deduplicated);
  }


  /**
   * 创建自定义技能
   */
  createCustomSkill({ name, directory, description, content, scope = 'user', cwd } = {}) {
    const options = { scope, ...(cwd ? { cwd } : {}) };
    const { safeDirectory, path: dest } = this.resolveWritableSkillPath(directory, options);
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

    const projectRoot = scope === 'project' ? this.resolveScopeOptions(options).cwd : null;
    this._writeSkillFileAtomic(
      path.join(dest, 'SKILL.md'),
      skillMdContent,
      projectRoot || this.storageDir
    );
    const control = this._registerCreatedSkill({
      root: dest,
      directory: safeDirectory,
      scope,
      cwd
    });
    if (scope === 'project') {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    this.clearCache({ removeFile: true });

    return { success: true, message: '技能创建成功', directory: safeDirectory, ...control };
  }

  /**
   * 创建带多文件的技能
   * @param {string} directory - 技能目录名
   * @param {Array<{path: string, content: string}>} files - 文件数组
   * @returns {Object} 创建结果
   */
  createSkillWithFiles({ directory, files, scope = 'user', cwd } = {}) {
    const options = { scope, ...(cwd ? { cwd } : {}) };
    const { safeDirectory, path: dest } = this.resolveWritableSkillPath(directory, options);

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

    const projectRoot = scope === 'project' ? this.resolveScopeOptions(options).cwd : null;
    const targetRoot = projectRoot || this.storageDir;
    for (const file of safeFiles) {
      const filePath = resolveInsideRoot(dest, file.safePath, 'skill file path', { allowHiddenSegments: true });
      const fileContent = file.isBase64
        ? Buffer.from(file.content, 'base64')
        : Buffer.from(file.content, 'utf8');
      this._writeSkillFileAtomic(filePath, fileContent, targetRoot);
    }

    const control = this._registerCreatedSkill({
      root: dest,
      directory: safeDirectory,
      scope,
      cwd
    });
    if (scope === 'project') {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    this.clearCache({ removeFile: true });

    return {
      success: true,
      message: '技能创建成功',
      directory: safeDirectory,
      fileCount: files.length,
      ...control
    };
  }

  /**
   * 获取技能目录下所有文件列表
   * @param {string} directory - 技能目录名
   * @returns {Array<{path: string, size: number, isDirectory: boolean}>}
   */
  getSkillFiles(directory, options = {}) {
    const { safeDirectory, path: skillPath } = this.resolveInstallPath(directory, 'skill directory', options);

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
    try {
      if (fs.lstatSync(currentDir).isSymbolicLink()) return;
    } catch {
      return;
    }
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        files.push({
          path: relativePath,
          size: 0,
          isDirectory: true
        });
        this._scanFilesRecursive(fullPath, baseDir, files);
      } else if (entry.isFile()) {
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
  getSkillFileContent(directory, filePath, options = {}) {
    const { path: skillPath } = this.resolveInstallPath(directory, 'skill directory', options);
    const safeFilePath = normalizeSkillRelativePath(filePath, 'skill file path');
    const fullPath = resolveInsideRoot(skillPath, safeFilePath, 'skill file path', { allowHiddenSegments: true });
    assertNoSymlinkComponents(skillPath, fullPath, fs);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件 "${safeFilePath}" 不存在`);
    }
    if (fs.lstatSync(fullPath).isSymbolicLink()) {
      throw new Error(`skill file path contains symlink: ${safeFilePath}`);
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
  addSkillFiles(directory, files, options = {}) {
    const { safeDirectory, path: skillPath } = this.resolveInstallPath(directory, 'skill directory', options);
    if (this.isProtectedSkillDirectory(safeDirectory)) {
      throw new Error('不能修改 Codex 系统技能');
    }

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${safeDirectory}" 不存在`);
    }

    const projectRoot = options.scope === 'project' ? this.resolveScopeOptions(options).cwd : null;
    const targetRoot = projectRoot || this.installDir;

    const added = [];
    for (const file of files) {
      const safeFilePath = normalizeSkillRelativePath(file.path, 'skill file path');
      const filePath = resolveInsideRoot(skillPath, safeFilePath, 'skill file path', { allowHiddenSegments: true });
      assertNoSymlinkComponents(targetRoot, filePath, fs);
      if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
        throw new Error(`skill file path contains symlink: ${safeFilePath}`);
      }

      const fileContent = file.isBase64
        ? Buffer.from(file.content, 'base64')
        : Buffer.from(file.content, 'utf8');
      this._writeSkillFileAtomic(filePath, fileContent, targetRoot);
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
  deleteSkillFile(directory, filePath, options = {}) {
    const { safeDirectory, path: skillPath } = this.resolveInstallPath(directory, 'skill directory', options);
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
    assertNoSymlinkComponents(skillPath, fullPath, fs);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件 "${safeFilePath}" 不存在`);
    }
    if (fs.lstatSync(fullPath).isSymbolicLink()) {
      throw new Error(`skill file path contains symlink: ${safeFilePath}`);
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
  updateSkillFile(directory, filePath, content, isBase64 = false, options = {}) {
    const { safeDirectory, path: skillPath } = this.resolveInstallPath(directory, 'skill directory', options);
    if (this.isProtectedSkillDirectory(safeDirectory)) {
      throw new Error('不能修改 Codex 系统技能');
    }

    if (!fs.existsSync(skillPath)) {
      throw new Error(`技能 "${safeDirectory}" 不存在`);
    }

    const safeFilePath = normalizeSkillRelativePath(filePath, 'skill file path');
    const fullPath = resolveInsideRoot(skillPath, safeFilePath, 'skill file path', { allowHiddenSegments: true });
    assertNoSymlinkComponents(skillPath, fullPath, fs);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`文件 "${safeFilePath}" 不存在`);
    }
    if (fs.lstatSync(fullPath).isSymbolicLink()) {
      throw new Error(`skill file path contains symlink: ${safeFilePath}`);
    }

    const fileContent = isBase64
      ? Buffer.from(content, 'base64')
      : Buffer.from(content, 'utf8');
    const projectRoot = options.scope === 'project' ? this.resolveScopeOptions(options).cwd : null;
    this._writeSkillFileAtomic(fullPath, fileContent, projectRoot || this.installDir);

    this.clearCache({ removeFile: true });

    return { success: true, updated: safeFilePath };
  }



  /**
   * 获取本地 Skill 详情。远端内容只能来自已经发布的 artifact。
   */
  async getSkillDetail(directory, repoHint = null, fullDirectoryHint = '', options = {}) {
    const safeDirectory = this.normalizeSkillDirectory(directory);
    const scope = options.scope || 'user';

    const readDetail = (root, metadata = {}, controlEntry = null) => {
      const skillPath = path.resolve(root);
      const skillFile = path.join(skillPath, 'SKILL.md');
      if (!fs.existsSync(skillFile) || fs.lstatSync(skillFile).isSymbolicLink()) {
        throw new Error('Skill detail contains an unavailable or symlinked SKILL.md');
      }
      const content = fs.readFileSync(skillFile, 'utf8');
      const parsed = this.parseSkillMd(content);
      const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1].trim() : content;
      const enabled = controlEntry?.enabled === true || (
        controlEntry == null && metadata.enabled === true
      );
      return {
        directory: safeDirectory,
        name: parsed.name || metadata.name || safeDirectory,
        description: parsed.description || metadata.description || '',
        content: body,
        fullContent: content,
        installed: enabled,
        enabled,
        cached: metadata.cached !== false,
        trust: controlEntry?.trust || metadata.trust || (metadata.source === 'remote' ? 'pending' : 'approved'),
        managed: true,
        controlKey: controlEntry?.controlKey || metadata.controlKey || null,
        scope: controlEntry?.scope || scope,
        sourceScope: controlEntry?.scope || metadata.sourceScope || scope,
        path: skillPath,
        fullPath: skillFile,
        installPath: skillPath,
        source: metadata.source || 'local',
        sourceProvider: metadata.sourceProvider || null,
        sourceKey: metadata.sourceKey || null,
        repoProvider: metadata.repoProvider || null,
        repoOwner: metadata.repoOwner || null,
        repoName: metadata.repoName || null,
        repoBranch: metadata.repoBranch || null,
        repoDirectory: metadata.repoDirectory || '',
        repoHost: metadata.repoHost || null,
        repoProjectPath: metadata.repoProjectPath || null,
        repoLocalPath: metadata.repoLocalPath || null,
        repoId: metadata.repoId || null,
        repoUrl: metadata.repoUrl || null,
        protected: this.isProtectedSkillDirectory(safeDirectory),
        readonly: metadata.readonly === true
      };
    };

    const previousSkillsCache = Array.isArray(this.skillsCache)
      ? this.skillsCache.map(skill => ({ ...skill }))
      : null;
    const scanResult = await this.scanSkills({
      ...options,
      scope,
      ...(scope === 'project' && options.cwd ? { cwd: options.cwd } : {})
    });
    const candidates = (scanResult.skills || []).filter(skill => (
      normalizeRepoPath(skill.directory) === normalizeRepoPath(safeDirectory)
      || (fullDirectoryHint && normalizeRepoPath(skill.fullDirectory) === normalizeRepoPath(fullDirectoryHint))
    ));
    const hinted = candidates.find(skill => (
      repoHint && (
        (repoHint.id && skill.repoId === repoHint.id)
        || (repoHint.owner && repoHint.name && skill.repoOwner === repoHint.owner && skill.repoName === repoHint.name)
      )
    ));
    const selected = hinted || candidates[0];
    if (selected) {
      const selectedScope = selected.scope || (selected.sourceScope === 'project' ? 'project' : 'user');
      const selectedProjectPath = selectedScope === 'project'
        ? (selected.projectPath || this._skillCwdKey(options))
        : null;
      const controlEntry = selected.controlKey
        ? this.controlService?.getSkill?.(selected.controlKey, {
          scope: selectedScope,
          projectPath: selectedProjectPath
        })
        : null;
      const root = selected.artifact?.root
        || selected.artifactRoot
        || (selected.sourcePath ? path.dirname(selected.sourcePath) : null);
      if (root && fs.existsSync(root) && !fs.lstatSync(root).isSymbolicLink()) {
        return readDetail(root, selected, controlEntry);
      }
    }

    const localSkillDir = this.resolveInstallPath(safeDirectory, 'skill directory', options).path;
    const localPath = path.join(localSkillDir, 'SKILL.md');
    if (fs.existsSync(localPath) && !fs.lstatSync(localPath).isSymbolicLink()) {
      const projectPath = scope === 'project' ? this._skillCwdKey(options) : null;
      const sourceKey = projectPath
        ? `native:${this.platform}:${safeDirectory}:project:${projectPath}`
        : `native:${this.platform}:${safeDirectory}`;
      const controlKey = `skill:${this.platform}:${scope}:${projectPath || 'user'}:${sourceKey}`;
      const controlEntry = this.controlService?.getSkill?.(controlKey, {
        scope,
        projectPath
      }) || null;
      return readDetail(localSkillDir, {
        source: scope === 'project' ? 'project' : 'native',
        sourceProvider: 'native',
        sourceScope: scope,
        enabled: true,
        cached: true,
        readonly: false
      }, controlEntry);
    }

    const localStoragePath = this.resolveStoragePath(safeDirectory).path;
    const localStorageSkillPath = path.join(localStoragePath, 'SKILL.md');
    if (fs.existsSync(localStorageSkillPath) && !fs.lstatSync(localStorageSkillPath).isSymbolicLink()) {
      const sourceKey = `local:${this.platform}:${safeDirectory}`;
      const controlKey = `skill:${this.platform}:user:user:${sourceKey}`;
      const controlEntry = this.controlService?.getSkill?.(controlKey, { scope: 'user' }) || null;
      return readDetail(localStoragePath, {
        source: 'local',
        sourceProvider: 'cc-tool',
        sourceScope: 'user',
        sourceKey
      }, controlEntry);
    }

    const cachedSkills = previousSkillsCache || this.skillsCache;
    const cachedLocalSkill = Array.isArray(cachedSkills)
      ? cachedSkills.find(skill => (
        normalizeRepoPath(skill.directory) === normalizeRepoPath(safeDirectory)
        && (skill.sourcePath || skill.realPath)
        && !(skill.repoOwner || skill.repoProjectPath || skill.repoLocalPath)
      ))
      : null;
    const cachedSkillPath = cachedLocalSkill?.realPath || cachedLocalSkill?.sourcePath;
    if (cachedSkillPath && fs.existsSync(cachedSkillPath) && !fs.lstatSync(cachedSkillPath).isSymbolicLink()) {
      return readDetail(path.dirname(cachedSkillPath), {
        ...cachedLocalSkill,
        source: cachedLocalSkill.source || 'provider-installed',
        enabled: cachedLocalSkill.enabled !== false && cachedLocalSkill.installed !== false,
        cached: true,
        readonly: cachedLocalSkill.readonly === true
      });
    }

    const requestedProjectPath = scope === 'project' ? this._skillCwdKey(options) : null;
    const artifact = this.artifactStore?.list?.({ platform: this.platform }).find(item => {
      const artifactScope = item?.sourceScope || 'user';
      if (artifactScope === 'project') {
        if (scope !== 'project' || item.projectPath !== requestedProjectPath) return false;
      } else if (item.projectPath && item.projectPath !== requestedProjectPath) {
        return false;
      }
      const itemDirectory = item.targetDirectory || item.directory || item.fullDirectory || '';
      return normalizeRepoPath(itemDirectory) === normalizeRepoPath(safeDirectory)
        || (fullDirectoryHint && normalizeRepoPath(item.fullDirectory) === normalizeRepoPath(fullDirectoryHint));
    });
    if (artifact) {
      const sourceKey = artifact.sourceKey || '';
      const artifactScope = artifact.sourceScope || 'user';
      const artifactProjectPath = artifactScope === 'project' ? artifact.projectPath : null;
      const controlKey = `skill:${this.platform}:${artifactScope}:${artifactProjectPath || 'user'}:${sourceKey}`;
      const controlEntry = this.controlService?.getSkill?.(controlKey, {
        scope: artifactScope,
        projectPath: artifactProjectPath
      }) || null;
      return readDetail(artifact.root, {
        ...artifact,
        source: artifact.source || 'remote',
        sourceProvider: artifact.sourceProvider || 'remote',
        sourceScope: artifactScope,
        projectPath: artifactProjectPath,
        sourceKey,
        cached: true,
        readonly: true
      }, controlEntry);
    }

    if (this.platform === 'omp') {
      const discovered = discoverOmpSkills(this, {
        ...options,
        cwd: options.cwd || null,
        force: false
      }).find(skill => normalizeRepoPath(skill.directory) === normalizeRepoPath(safeDirectory));
      const discoveredPath = discovered?.realPath || discovered?.sourcePath;
      if (discoveredPath && fs.existsSync(discoveredPath) && !fs.lstatSync(discoveredPath).isSymbolicLink()) {
        return readDetail(path.dirname(discoveredPath), {
          ...discovered,
          source: discovered.source || 'provider-installed',
          sourceProvider: discovered.sourceProvider,
          sourceScope: discovered.sourceScope,
          enabled: true,
          readonly: discovered.readonly !== false
        });
      }
    }

    throw new Error('技能未缓存，请手动点击 Skill 面板的“刷新”后重试');
  }

  /**
   * 获取已安装技能列表
   */
  getInstalledSkills(options = {}) {
    this.refreshOmpPaths();
    if (this.platform === 'omp') {
      return this.prepareSkills([], options);
    }
    if (options.scope === 'project') {
      const skills = [];
      this.mergeProjectSkills(skills, options);
      return skills;
    }
    const skills = [];
    this.scanLocalDir(this.installDir, this.installDir, skills, {
      includeHiddenDirs: this.platform === 'codex',
      forceInstalled: true,
      source: 'native-installed',
      sourceScope: 'user'
    });
    return skills;
  }
}

module.exports = {
  SkillService,
  DEFAULT_REPOS: DEFAULT_REPOS_BY_PLATFORM.claude,
  DEFAULT_REPOS_BY_PLATFORM
};
