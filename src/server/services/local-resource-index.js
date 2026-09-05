'use strict';

const fs = require('fs');
const path = require('path');

/**
 * A small, process-local index for file-backed resources.
 *
 * The scanner deliberately only receives file metadata.  Consumers can keep
 * expensive/full file reads in `detailFile`, which is called by `get()`.
 */
class LocalResourceIndex {
  constructor({ key, roots, scanFile, detailFile, ttlMs = 5000 } = {}) {
    if (!key) throw new TypeError('LocalResourceIndex requires a key');
    if (typeof scanFile !== 'function') throw new TypeError('LocalResourceIndex requires scanFile');
    if (typeof detailFile !== 'function') throw new TypeError('LocalResourceIndex requires detailFile');

    this.key = String(key);
    this.roots = (Array.isArray(roots) ? roots : [roots]).filter(Boolean).map((root) => path.resolve(root));
    this.scanFile = scanFile;
    this.detailFile = detailFile;
    this.ttlMs = Math.max(0, Number(ttlMs) || 0);
    this._value = null;
    this._fingerprints = new Map();
    this._scannedAt = 0;
    this._invalidated = true;
    this._inflight = null;
    this._inflightGeneration = null;
    this._generation = 0;
    this._invalidationVersion = 0;
    this._disposed = false;
    this._watchers = new Map();
    this._watching = false;
    this._setupWatchers();
  }

  _warn(message, error) {
    const suffix = error && error.message ? `: ${error.message}` : '';
    console.warn(`[LocalResourceIndex:${this.key}] ${message}${suffix}`);
  }

  _dropWatcher(watchPath, watcher) {
    if (this._watchers.get(watchPath) !== watcher) return;
    this._watchers.delete(watchPath);
    this._invalidated = true;
    this._invalidationVersion += 1;
  }

  _markInvalidated() {
    this._invalidated = true;
    this._invalidationVersion += 1;
  }
  _watchPath(watchPath) {
    if (this._disposed || this._watchers.has(watchPath)) return;
    try {
      const watcher = fs.watch(watchPath, { persistent: false }, () => this._markInvalidated());
      if (typeof watcher.unref === 'function') watcher.unref();
      watcher.on('error', () => this._dropWatcher(watchPath, watcher));
      watcher.on('close', () => this._dropWatcher(watchPath, watcher));
      this._watchers.set(watchPath, watcher);
    } catch (error) {
      // Missing roots/files are normal; TTL remains the fallback when watch
      // cannot be established.
      this._warn(`Failed to watch ${watchPath}; using TTL freshness`, error);
    }
  }

  _setupWatchers() {
    if (this._watching) return;
    this._watching = true;
    for (const root of this.roots) this._watchPath(root);
  }

  _isFresh() {
    return !this._invalidated && this._value && Date.now() - this._scannedAt < this.ttlMs;
  }

  _fingerprint(filePath, stat) {
    let realPath = filePath;
    try {
      realPath = fs.realpathSync(filePath);
    } catch (_) {
      // stat succeeded, and a subsequent read can still be valid. Keep the
      // absolute path in the fingerprint if realpath is unavailable.
    }
    return { size: stat.size, mtimeMs: stat.mtimeMs, realPath };
  }
  _collectFiles() {
    const files = [];
    const addFile = (fullPath, root) => {
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) return;
        files.push({ fullPath, root, relativePath: path.relative(root, fullPath), stat, fingerprint: this._fingerprint(fullPath, stat) });
      } catch (error) {
        if (!error || !['ENOENT', 'ENOTDIR'].includes(error.code)) this._warn(`Failed to stat ${fullPath}`, error);
      }
    };
    const visit = (directory, root) => {
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch (error) {
        if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return;
        this._warn(`Failed to scan ${directory}`, error);
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          visit(fullPath, root);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            files.push({
              fullPath,
              root,
              relativePath: path.relative(root, fullPath),
              stat,
              fingerprint: this._fingerprint(fullPath, stat)
            });
          } catch (error) {
            this._warn(`Failed to stat ${fullPath}`, error);
          }
        }
      }
    };
    for (const root of this.roots) visit(root, root);
    return files;
  }
  async _collectFilesAsync() {
    const files = [];
    const visit = async (directory, root) => {
      let entries;
      try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
      catch (error) { if (!error || !['ENOENT', 'ENOTDIR'].includes(error.code)) this._warn(`Failed to scan ${directory}`, error); return; }
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) await visit(fullPath, root);
        else if (entry.isFile()) {
          try {
            const stat = await fs.promises.stat(fullPath);
            const realPath = await fs.promises.realpath(fullPath).catch(() => fullPath);
            files.push({ fullPath, root, relativePath: path.relative(root, fullPath), stat, fingerprint: { size: stat.size, mtimeMs: stat.mtimeMs, realPath } });
          } catch (error) { this._warn(`Failed to stat ${fullPath}`, error); }
        }
      }
    };
    for (const root of this.roots) await visit(root, root);
    return files;
  }
  _buildSummary(descriptor, summary, summaries, fingerprints) {
    fingerprints.set(descriptor.fullPath, descriptor.fingerprint);
    if (summary == null) return;
    const values = Array.isArray(summary) ? summary : [summary];
    for (const value of values) {
      if (value == null) continue;
      const safeSummary = { ...value };
      delete safeSummary.fullContent;
      delete safeSummary.systemPrompt;
      delete safeSummary.body;
      safeSummary.fullPath = safeSummary.fullPath || descriptor.fullPath;
      safeSummary.path = safeSummary.path || descriptor.relativePath;
      safeSummary.fingerprint = descriptor.fingerprint;
      summaries.push(safeSummary);
    }
  }
  _finishScan(summaries, fingerprints, generation = this._generation, startVersion = this._invalidationVersion) {
    if (this._disposed || generation !== this._generation) return this._value || [];
    for (const [watchPath, watcher] of this._watchers) {
      if (this.roots.includes(watchPath) || fingerprints.has(watchPath)) continue;
      this._watchers.delete(watchPath);
      try { watcher.close(); } catch (_) { /* watcher already closed */ }
    }
    for (const filePath of fingerprints.keys()) this._watchPath(filePath);
    if (generation !== this._generation) return this._value || [];
    summaries.sort((a, b) => String(a.name || '').toLowerCase().localeCompare(String(b.name || '').toLowerCase()));
    const changedDuringScan = startVersion !== this._invalidationVersion;
    this._value = summaries;
    this._scannedAt = Date.now();
    this._invalidated = changedDuringScan;
    return summaries;
  }

  _scan() {
    const summaries = [];
    const fingerprints = new Map();
    const startVersion = this._invalidationVersion;
    for (const descriptor of this._collectFiles()) {
      try {
        const summary = this.scanFile(descriptor);
        if (summary && typeof summary.then === 'function') throw new TypeError('scanFile must be synchronous for listSync');
        this._buildSummary(descriptor, summary, summaries, fingerprints);
      } catch (error) {
        this._warn(`Failed to parse ${descriptor.fullPath}`, error);
      }
    }
    return this._finishScan(summaries, fingerprints, this._generation, startVersion);
  }
  async _scanAsync(generation = this._generation) {
    const summaries = [];
    const fingerprints = new Map();
    const startVersion = this._invalidationVersion;
    for (const descriptor of await this._collectFilesAsync()) {
      try {
        this._buildSummary(descriptor, await this.scanFile(descriptor), summaries, fingerprints);
      } catch (error) {
        this._warn(`Failed to parse ${descriptor.fullPath}`, error);
      }
    }
    return this._finishScan(summaries, fingerprints, generation, startVersion);
  }

  _listSync({ force = false } = {}) {
    if (!force && this._isFresh()) return this._value.map((item) => ({ ...item }));
    return this._scan().map((item) => ({ ...item }));
  }

  async list({ force = false } = {}) {
    if (!force && this._isFresh()) return this._value.map((item) => ({ ...item }));
    if (this._inflight && this._inflightGeneration === this._generation) return this._inflight;
    if (this._inflight) {
      const stalePromise = this._inflight;
      const staleGeneration = this._inflightGeneration;
      try { await stalePromise; } catch (_) { /* stale refresh errors are retried below */ }
      if (this._inflight === stalePromise && this._inflightGeneration === staleGeneration) {
        this._inflight = null;
        this._inflightGeneration = null;
      }
      if (this._inflight && this._inflightGeneration === this._generation) return this._inflight;
    }
    const generation = this._generation;
    const promise = Promise.resolve().then(() => this._scanAsync(generation)).then((value) => value.map((item) => ({ ...item })));
    this._inflight = promise;
    this._inflightGeneration = generation;
    try {
      return await promise;
    } finally {
      if (this._inflight === promise) {
        this._inflight = null;
        this._inflightGeneration = null;
      }
    }
  }

  /** Synchronous adapter for legacy service APIs. */
  listSync({ force = false } = {}) {
    if (this._inflight && this._inflightGeneration === this._generation && this._value) return this._value.map((item) => ({ ...item }));
    if (this._inflight && this._inflightGeneration !== this._generation) return this._listSync({ force: true });
    return this._listSync({ force });
  }
  getSync(identity) {
    const summaries = this.listSync();
    const item = summaries.find((candidate) => this._matches(candidate, identity));
    if (!item) return null;
    try {
      const detail = this.detailFile(item);
      return detail == null ? null : { ...item, ...detail };
    } catch (error) {
      this._warn(`Failed to read detail for ${item.fullPath}`, error);
      return null;
    }
  }

  _matches(candidate, identity) {
    const normalizePath = (value) => typeof value === 'string' ? value.replace(/\\/g, '/') : value;
    const matches = (left, right) => normalizePath(left) === normalizePath(right);
    if (typeof identity === 'string') {
      return matches(candidate.key, identity) || matches(candidate.fullPath, identity) || matches(candidate.path, identity) || matches(candidate.name, identity) || matches(candidate.fileName, identity);
    }
    if (!identity || typeof identity !== 'object') return false;
    return (identity.key && matches(candidate.key, identity.key)) ||
      (identity.fullPath && matches(candidate.fullPath, identity.fullPath)) ||
      (identity.path && matches(candidate.path, identity.path)) ||
      (identity.name && matches(candidate.name, identity.name)) ||
      (identity.fileName && matches(candidate.fileName, identity.fileName));
  }

  async get(identity) {
    const summaries = await this.list();
    const item = summaries.find((candidate) => this._matches(candidate, identity));
    if (!item) return null;
    try {
      const detail = await this.detailFile(item);
      return detail == null ? null : { ...item, ...detail };
    } catch (error) {
      this._warn(`Failed to read detail for ${item.fullPath}`, error);
      return null;
    }
  }

  invalidate() {
    this._generation += 1;
    this._markInvalidated();
    this._value = null;
    this._fingerprints.clear();
  }

  dispose() {
    this._disposed = true;
    this._generation += 1;
    for (const watcher of this._watchers.values()) {
      try { watcher.close(); } catch (_) { /* watcher already closed */ }
    }
    this._watchers.clear();
    this._inflight = null;
    this._inflightGeneration = null;
    this._value = null;
    this._fingerprints.clear();
    this._invalidated = true;
  }
}

module.exports = { LocalResourceIndex };
