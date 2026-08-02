const fs = require('fs');
const path = require('path');
const { PATHS } = require('../../config/paths');

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function itemIdentity(item) {
  if (!isObject(item)) return `${typeof item}:${JSON.stringify(item)}`;
  const identity = item.id
    || item.pluginId
    || item.source
    || item.sourceUri
    || item.repoUrl
    || item.url
    || item.localPath
    || item.name;
  return identity ? `object:${identity}` : `json:${JSON.stringify(item)}`;
}

function mergeValues(current, legacy) {
  if (Array.isArray(current) && Array.isArray(legacy)) {
    const result = current.map(clone);
    const indexes = new Map(result.map((item, index) => [itemIdentity(item), index]));
    for (const item of legacy) {
      const identity = itemIdentity(item);
      if (!indexes.has(identity)) {
        indexes.set(identity, result.length);
        result.push(clone(item));
        continue;
      }
      const index = indexes.get(identity);
      result[index] = mergeValues(result[index], item);
    }
    return result;
  }
  if (isObject(current) && isObject(legacy)) {
    const result = clone(current);
    for (const [key, value] of Object.entries(legacy)) {
      result[key] = Object.prototype.hasOwnProperty.call(result, key)
        ? mergeValues(result[key], value)
        : clone(value);
    }
    return result;
  }
  return clone(current);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function uniqueArchivePath(archiveRoot, category, sourcePath) {
  const base = path.join(archiveRoot, category, path.basename(sourcePath));
  if (!fs.existsSync(base)) return base;
  const extension = path.extname(base);
  const stem = extension ? base.slice(0, -extension.length) : base;
  let index = 1;
  while (fs.existsSync(`${stem}.${index}${extension}`)) index += 1;
  return `${stem}.${index}${extension}`;
}

function moveEntry(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  try {
    fs.renameSync(sourcePath, targetPath);
    return;
  } catch {
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      ensureDir(targetPath);
      for (const entry of fs.readdirSync(sourcePath)) {
        moveEntry(path.join(sourcePath, entry), path.join(targetPath, entry));
      }
      fs.rmdirSync(sourcePath);
      return;
    }
    fs.copyFileSync(sourcePath, targetPath);
    fs.unlinkSync(sourcePath);
  }
}

function archiveEntry(sourcePath, archiveRoot, category) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return '';
  const targetPath = uniqueArchivePath(archiveRoot, category, sourcePath);
  moveEntry(sourcePath, targetPath);
  return targetPath;
}

function mergeJsonFile(sourcePath, targetPath, archiveRoot, category) {
  if (!sourcePath || !targetPath || !fs.existsSync(sourcePath)) return false;
  const legacy = readJson(sourcePath);
  const merged = fs.existsSync(targetPath)
    ? mergeValues(readJson(targetPath), legacy)
    : legacy;
  writeJson(targetPath, merged);
  archiveEntry(sourcePath, archiveRoot, category);
  return true;
}

function mergeDirectory(sourceDir, targetDir, archiveRoot) {
  if (!sourceDir || !targetDir || !fs.existsSync(sourceDir)) return false;
  ensureDir(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (!fs.existsSync(targetPath)) {
      moveEntry(sourcePath, targetPath);
      continue;
    }
    if (entry.isDirectory() && fs.statSync(targetPath).isDirectory()) {
      mergeDirectory(sourcePath, targetPath, archiveRoot);
      continue;
    }
    if (entry.isFile() && path.extname(entry.name) === '.json') {
      try {
        mergeJsonFile(sourcePath, targetPath, archiveRoot, 'local-skill-conflicts');
        continue;
      } catch {
        // Non-JSON conflicts are archived without replacing the OMP copy.
      }
    }
    archiveEntry(sourcePath, archiveRoot, 'local-skill-conflicts');
  }
  try {
    fs.rmdirSync(sourceDir);
  } catch {
    // A partially migrated directory is intentionally left for the next retry.
  }
  return true;
}

function siblingFile(targetPath, fileName) {
  return targetPath ? path.join(path.dirname(targetPath), fileName) : '';
}

function siblingDir(targetPath, directoryName) {
  return targetPath ? path.join(path.dirname(targetPath), directoryName) : '';
}

function migratePiStorage(paths = PATHS) {
  const archiveRoot = path.join(paths?.legacy?.dir || path.dirname(paths?.channels?.omp || process.cwd()), 'pi-omp');
  const warnings = [];
  let migrated = 0;
  const migrations = [
    ['channels', siblingFile(paths?.channels?.omp, 'pi.json'), paths?.channels?.omp],
    ['active-channel', siblingFile(paths?.activeChannel?.omp, 'pi.json'), paths?.activeChannel?.omp],
    ['skill-repos', siblingFile(paths?.skillRepos?.omp, 'pi.json'), paths?.skillRepos?.omp],
    ['plugin-repos', siblingFile(paths?.pluginRepos?.omp, 'pi.json'), paths?.pluginRepos?.omp]
  ];

  for (const [category, source, target] of migrations) {
    try {
      if (mergeJsonFile(source, target, archiveRoot, category)) migrated += 1;
    } catch (error) {
      warnings.push(`Failed to migrate legacy pi ${category}: ${error.message}`);
    }
  }

  try {
    if (mergeDirectory(
      siblingDir(paths?.localSkills?.omp, 'pi'),
      paths?.localSkills?.omp,
      archiveRoot
    )) migrated += 1;
  } catch (error) {
    warnings.push(`Failed to migrate legacy pi local skills: ${error.message}`);
  }

  for (const [category, target, legacyName] of [
    ['skill-cache', paths?.skillCaches?.omp, 'pi.json'],
    ['plugin-cache', paths?.pluginMarketCache?.omp, 'pi-market.json']
  ]) {
    const source = siblingFile(target, legacyName);
    if (!source || !fs.existsSync(source)) continue;
    try {
      archiveEntry(source, archiveRoot, category);
      archiveEntry(target, archiveRoot, category);
      migrated += 1;
    } catch (error) {
      warnings.push(`Failed to archive legacy pi ${category}: ${error.message}`);
    }
  }

  return { migrated, warnings };
}

function marketplaceSource(repo = {}) {
  if (typeof repo === 'string') return repo.trim();
  return String(
    repo.source
    || repo.sourceUri
    || repo.repoUrl
    || repo.url
    || repo.localPath
    || (repo.owner && repo.name ? `${repo.owner}/${repo.name}` : '')
  ).trim();
}

function loadImportState(statePath) {
  try {
    const state = readJson(statePath);
    return isObject(state) ? state : { imported: {} };
  } catch {
    return { imported: {} };
  }
}

function importLegacyPluginRepos(adapter, paths = PATHS, options = {}) {
  const configPath = paths?.pluginRepos?.omp;
  const statePath = path.join(paths?.legacy?.dir || path.dirname(configPath || process.cwd()), 'pi-omp-marketplace-import.json');
  const warnings = [];
  if (!configPath || !fs.existsSync(configPath)) return { warnings, imported: 0 };

  let config;
  try {
    config = readJson(configPath);
  } catch (error) {
    return {
      warnings: [`Legacy OMP marketplace config is invalid and was retained: ${error.message}`],
      imported: 0
    };
  }

  const repos = Array.isArray(config?.repos) ? config.repos : [];
  const state = loadImportState(statePath);
  state.imported = isObject(state.imported) ? state.imported : {};
  const nativeRepos = adapter.listMarketplaces(options);
  const existing = new Set();
  for (const repo of nativeRepos) {
    for (const identity of [repo.id, repo.name, repo.source, repo.sourceUri]) {
      if (identity) existing.add(String(identity));
    }
  }

  let imported = 0;
  for (const repo of repos) {
    const source = marketplaceSource(repo);
    if (!source || state.imported[source] || existing.has(source)) continue;
    try {
      adapter.addMarketplace(source, options);
      state.imported[source] = { importedAt: new Date().toISOString() };
      writeJson(statePath, state);
      existing.add(source);
      imported += 1;
    } catch (error) {
      warnings.push(`Failed to import legacy OMP marketplace "${source}": ${error.message}`);
    }
  }

  return { warnings, imported };
}

module.exports = {
  importLegacyPluginRepos,
  marketplaceSource,
  mergeValues,
  migratePiStorage
};
