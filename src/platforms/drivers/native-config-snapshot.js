'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const IGNORE_DIRS = new Set(['.git']);
const IGNORE_FILES = new Set(['.DS_Store']);

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveSafePath(baseDir, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return null;
  const base = path.resolve(baseDir);
  const target = path.resolve(base, relativePath);
  return target === base || target.startsWith(`${base}${path.sep}`) ? target : null;
}

function readDirectory(directory) {
  const files = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) stack.push(path.join(current, entry.name));
      } else if (entry.isFile() && !IGNORE_FILES.has(entry.name)) {
        const filePath = path.join(current, entry.name);
        files.push({
          path: path.relative(directory, filePath),
          encoding: 'base64',
          content: fs.readFileSync(filePath).toString('base64')
        });
      }
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function readEntry(spec) {
  if (!spec?.path || !fs.existsSync(spec.path)) return null;
  if (spec.format === 'directory') {
    const files = readDirectory(spec.path);
    return files.length > 0 ? { format: 'directory', fileName: path.basename(spec.path), files } : null;
  }
  const raw = fs.readFileSync(spec.path, 'utf8');
  let content = raw;
  if (spec.format === 'json') {
    try { content = JSON.parse(raw); } catch { /* retain malformed JSON as text */ }
  } else if (spec.format === 'yaml') {
    try { content = yaml.load(raw) || {}; } catch { /* retain malformed YAML as text */ }
  }
  return { format: spec.format || 'text', fileName: path.basename(spec.path), content };
}

function writeEntry(spec, entry, overwrite) {
  if (!spec?.path || !entry) return 'failed';
  if (spec.format === 'directory' || entry.format === 'directory') {
    if (!Array.isArray(entry.files) || entry.files.length === 0) return 'skipped';
    if (fs.existsSync(spec.path) && !overwrite) return 'skipped';
    fs.rmSync(spec.path, { recursive: true, force: true });
    fs.mkdirSync(spec.path, { recursive: true });
    for (const file of entry.files) {
      const filePath = resolveSafePath(spec.path, file.path);
      if (!filePath) return 'failed';
      ensureDir(filePath);
      fs.writeFileSync(filePath, Buffer.from(file.content || '', file.encoding || 'utf8'));
    }
    return 'success';
  }
  if (entry.content === undefined) return 'failed';
  if (fs.existsSync(spec.path) && !overwrite) return 'skipped';
  ensureDir(spec.path);
  let content = entry.content;
  const format = entry.format || spec.format || 'text';
  if (format === 'json' && typeof content === 'object') content = JSON.stringify(content, null, 2);
  if (format === 'yaml' && typeof content === 'object') content = yaml.dump(content, { lineWidth: 120, noRefs: true, sortKeys: false });
  fs.writeFileSync(spec.path, String(content), 'utf8');
  if (spec.mode) fs.chmodSync(spec.path, spec.mode);
  return 'success';
}

function createNativeSnapshotMethods(specs, { platform, runtime } = {}) {
  const methods = {
    exportSnapshot() {
      return Object.fromEntries(Object.entries(specs || {})
        .map(([key, spec]) => [key, readEntry(spec)])
        .filter(([, entry]) => entry));
    },
    importSnapshot(snapshot = {}, { overwrite = true } = {}) {
      const result = { success: 0, imported: 0, skipped: 0, failed: 0 };
      for (const [key, entry] of Object.entries(snapshot || {})) {
        const status = writeEntry(specs[key], entry, overwrite);
        if (status === 'success') {
          result.success += 1;
          result.imported += 1;
        } else if (status === 'skipped') {
          result.skipped += 1;
        } else {
          result.failed += 1;
        }
      }
      return result;
    }
  };
  if (platform && runtime?.getDriver) {
    methods.syncChannels = (channels = [], options = {}) => {
      const channelDriver = runtime.getDriver(platform, 'channels');
      if (typeof channelDriver?.writeMultiChannelConfig === 'function') {
        return channelDriver.writeMultiChannelConfig(channels, options);
      }
      const primary = channels.find(channel => channel && channel.enabled !== false) || channels[0];
      if (primary?.id && typeof channelDriver?.applyChannelToSettings === 'function') {
        return channelDriver.applyChannelToSettings(primary.id);
      }
      return { success: true, skipped: true };
    };
  }
  return methods;
}

module.exports = { createNativeSnapshotMethods };
