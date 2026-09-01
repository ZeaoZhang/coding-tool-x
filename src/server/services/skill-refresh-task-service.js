'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ACTIVE_STATES = new Set(['queued', 'running']);
const TERMINAL_STATES = new Set(['succeeded', 'partial', 'failed', 'interrupted']);
const RESULT_STATES = new Set(['succeeded', 'partial', 'failed']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, '$1?[REDACTED]')
    .replace(/([?&](?:access[_-]?token|api[_-]?key|token|password|secret|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(authorization\s*[:=]\s*)[^,\s}]+/gi, '$1[REDACTED]');
}

function sanitizeRepoProgress(progress = {}) {
  if (!progress || typeof progress !== 'object') return {};
  return Object.fromEntries(Object.entries(progress).map(([repoId, value]) => {
    if (!value || typeof value !== 'object') return [repoId, { status: sanitizeText(value) }];
    return [repoId, {
      status: sanitizeText(value.status),
      ...(value.error ? { error: sanitizeText(value.error) } : {}),
      ...(Number.isFinite(value.skillCount) ? { skillCount: value.skillCount } : {})
    }];
  }));
}

function sanitizeFailedRepos(repos) {
  if (!Array.isArray(repos)) return [];
  return repos.map(repo => ({
    repoId: sanitizeText(repo?.repoId || repo?.id || 'unknown'),
    ...(repo?.error ? { error: sanitizeText(repo.error) } : {}),
    ...(repo?.status ? { status: sanitizeText(repo.status) } : {})
  }));
}

class SkillRefreshTaskService {
  constructor({ worker, persistencePath = null, fsImpl = fs, clock = () => Date.now() } = {}) {
    if (typeof worker !== 'function') throw new Error('SkillRefreshTaskService worker is required');
    this.worker = worker;
    this.persistencePath = persistencePath;
    this.fs = fsImpl;
    this.clock = clock;
    this.tasks = new Map();
    this.waiters = new Map();
    this._load();
  }

  _canonicalProjectPath(scope, projectPath) {
    if (scope === 'user') return null;
    if (scope !== 'project' || typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
      throw new Error('Project refresh requires a canonical absolute projectPath');
    }
    try {
      return this.fs.realpathSync(path.resolve(projectPath));
    } catch (error) {
      throw new Error('Project refresh requires an existing projectPath', { cause: error });
    }
  }

  _taskKey({ platform, scope, projectPath }) {
    return `${platform}:${scope}:${projectPath || ''}`;
  }

  _readPersisted() {
    if (!this.persistencePath || !this.fs.existsSync(this.persistencePath)) return [];
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.persistencePath, 'utf8'));
      return Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    } catch {
      return [];
    }
  }

  _load() {
    const persisted = this._readPersisted();
    let changed = false;
    for (const item of persisted) {
      if (!item || typeof item !== 'object' || !item.id) continue;
      const task = this._sanitizeTask(item);
      if (ACTIVE_STATES.has(task.status)) {
        task.status = 'interrupted';
        task.finishedAt = this.clock();
        changed = true;
      }
      this.tasks.set(task.id, task);
    }
    if (changed) this._persist();
  }

  _sanitizeTask(task) {
    const safe = {
      id: sanitizeText(task.id),
      key: sanitizeText(task.key),
      platform: sanitizeText(task.platform),
      scope: task.scope === 'project' ? 'project' : 'user',
      projectPath: task.projectPath ? path.resolve(String(task.projectPath)) : null,
      reason: sanitizeText(task.reason || 'manual'),
      status: TERMINAL_STATES.has(task.status) || ACTIVE_STATES.has(task.status) ? task.status : 'failed',
      createdAt: Number(task.createdAt || 0) || this.clock(),
      startedAt: task.startedAt ? Number(task.startedAt) : null,
      finishedAt: task.finishedAt ? Number(task.finishedAt) : null,
      ...(task.fetchedRepos !== undefined ? { fetchedRepos: task.fetchedRepos } : {}),
      ...(task.fetchedSkills !== undefined ? { fetchedSkills: task.fetchedSkills } : {}),
      failedRepos: sanitizeFailedRepos(task.failedRepos),
      updatedControlKeys: Array.isArray(task.updatedControlKeys)
        ? task.updatedControlKeys.map(value => sanitizeText(value))
        : [],
      repoProgress: sanitizeRepoProgress(task.repoProgress),
      error: task.error ? sanitizeText(task.error) : null
    };
    return safe;
  }

  _persist() {
    if (!this.persistencePath) return;
    const tasks = Array.from(this.tasks.values());
    const terminal = tasks.filter(task => TERMINAL_STATES.has(task.status));
    const active = tasks.filter(task => ACTIVE_STATES.has(task.status));
    const retained = [...active, ...terminal.slice(-50)];
    const retainedIds = new Set(retained.map(task => task.id));
    for (const id of this.tasks.keys()) {
      if (!retainedIds.has(id)) this.tasks.delete(id);
    }

    const directory = path.dirname(this.persistencePath);
    const tempPath = `${this.persistencePath}.tmp-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
    try {
      this.fs.mkdirSync(directory, { recursive: true });
      this.fs.writeFileSync(tempPath, `${JSON.stringify({ version: 1, tasks: retained }, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      if (typeof this.fs.chmodSync === 'function') this.fs.chmodSync(tempPath, 0o600);
      this.fs.renameSync(tempPath, this.persistencePath);
      if (typeof this.fs.chmodSync === 'function') this.fs.chmodSync(this.persistencePath, 0o600);
    } catch (error) {
      try {
        if (this.fs.existsSync(tempPath)) this.fs.unlinkSync(tempPath);
      } catch (_) {}
      throw error;
    }
  }

  _publicTask(task, extra = {}) {
    return { ...clone(task), ...extra };
  }

  enqueue({ platform, scope = 'user', projectPath = null, reason = 'manual' } = {}) {
    const normalizedPlatform = String(platform || '').trim().toLowerCase();
    if (!normalizedPlatform) throw new Error('Refresh platform is required');
    const canonicalProjectPath = this._canonicalProjectPath(scope, projectPath);
    const key = this._taskKey({ platform: normalizedPlatform, scope, projectPath: canonicalProjectPath });
    const active = Array.from(this.tasks.values()).find(task => task.key === key && ACTIVE_STATES.has(task.status));
    if (active) return this._publicTask(active, { deduplicated: true });

    const task = this._sanitizeTask({
      id: crypto.randomUUID(),
      key,
      platform: normalizedPlatform,
      scope,
      projectPath: canonicalProjectPath,
      reason,
      status: 'queued',
      createdAt: this.clock(),
      startedAt: null,
      finishedAt: null,
      failedRepos: [],
      updatedControlKeys: [],
      repoProgress: {},
      error: null
    });
    this.tasks.set(task.id, task);
    this._persist();
    queueMicrotask(() => {
      this._run(task.id);
    });
    return this._publicTask(task);
  }

  async _run(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'queued') return;
    task.status = 'running';
    task.startedAt = this.clock();
    this._persist();
    const reportProgress = progress => {
      if (!this.tasks.has(taskId)) return;
      task.repoProgress = sanitizeRepoProgress({ ...task.repoProgress, ...(progress || {}) });
      this._persist();
    };

    try {
      const result = await this.worker({
        platform: task.platform,
        scope: task.scope,
        projectPath: task.projectPath,
        taskId: task.id,
        reportProgress
      });
      const status = RESULT_STATES.has(result?.status) ? result.status : 'succeeded';
      task.status = status;
      if (result?.fetchedRepos !== undefined) task.fetchedRepos = result.fetchedRepos;
      if (result?.fetchedSkills !== undefined) task.fetchedSkills = result.fetchedSkills;
      task.failedRepos = sanitizeFailedRepos(result?.failedRepos);
      task.updatedControlKeys = Array.isArray(result?.updatedControlKeys)
        ? result.updatedControlKeys.map(value => sanitizeText(value))
        : [];
      if (result?.error) task.error = sanitizeText(result.error);
    } catch (error) {
      task.status = 'failed';
      task.error = sanitizeText(error?.message || error);
    } finally {
      task.finishedAt = this.clock();
      this._persist();
      const waiters = this.waiters.get(taskId) || [];
      this.waiters.delete(taskId);
      waiters.forEach(resolve => resolve(this._publicTask(task)));
    }
  }

  get(taskId) {
    const task = this.tasks.get(String(taskId || ''));
    return task ? this._publicTask(task) : null;
  }

  getActive({ platform, scope = 'user', projectPath = null } = {}) {
    const canonicalProjectPath = this._canonicalProjectPath(scope, projectPath);
    const key = this._taskKey({
      platform: String(platform || '').trim().toLowerCase(),
      scope,
      projectPath: canonicalProjectPath
    });
    const task = Array.from(this.tasks.values()).find(item => item.key === key && ACTIVE_STATES.has(item.status));
    return task ? this._publicTask(task) : null;
  }

  listRecent({ platform, scope = 'user', projectPath = null, limit = 10 } = {}) {
    const canonicalProjectPath = this._canonicalProjectPath(scope, projectPath);
    const key = this._taskKey({
      platform: String(platform || '').trim().toLowerCase(),
      scope,
      projectPath: canonicalProjectPath
    });
    return Array.from(this.tasks.values())
      .filter(task => task.key === key)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(0, Number(limit) || 10))
      .map(task => this._publicTask(task));
  }

  waitFor(taskId) {
    const task = this.tasks.get(String(taskId || ''));
    if (!task) return Promise.reject(new Error('Refresh task not found'));
    if (TERMINAL_STATES.has(task.status)) return Promise.resolve(this._publicTask(task));
    return new Promise(resolve => {
      const waiters = this.waiters.get(task.id) || [];
      waiters.push(resolve);
      this.waiters.set(task.id, waiters);
    });
  }
}

module.exports = {
  SkillRefreshTaskService,
  ACTIVE_STATES,
  TERMINAL_STATES
};
