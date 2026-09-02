const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const {
  getOmpPaths,
  getOmpStatus,
  readJsonFile,
  readYamlFile
} = require('../../platforms/drivers/omp/config');
const {
  getOmpAuthProviderSnapshot
} = require('../../platforms/drivers/omp/auth-providers');

function listDirEntries(dirPath, options = {}) {
  const { extensions = null, includeDirectories = true } = options;
  if (!fs.existsSync(dirPath)) return [];
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(entry => !entry.name.startsWith('.'))
      .filter((entry) => {
        if (entry.isDirectory()) return includeDirectories;
        if (!Array.isArray(extensions) || extensions.length === 0) return true;
        return extensions.includes(path.extname(entry.name).toLowerCase());
      })
      .map((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const stat = fs.statSync(fullPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          path: fullPath,
          size: stat.size,
          updatedAt: new Date(stat.mtimeMs).toISOString()
        };
      });
  } catch {
    return [];
  }
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildCapabilities() {
  return {
    platform: 'omp',
    runtime: 'omp',
    native: {
      config: true,
      settings: true,
      models: true,
      commands: true,
      notes: true,
      extensions: true,
      skills: true,
      promptTemplates: true,
      packages: true,
      rpc: true,
      sessions: true
    },
    mapped: {
      command: 'commands/prompts',
      plugin: 'packages/extensions',
      mcp: 'mcp.json',
      agent: 'OMP discovery capability'
    },
    writable: {
      config: true,
      models: true,
      commands: true,
      notes: true,
      settings: true,
      skills: true,
      promptTemplates: true,
      packages: true,
      extensions: true,
      mcp: true,
      agent: false
    },
    notes: [
      'The omp channel is backed by OMP and uses omp as its platform key.',
      'Dynamic mode exposes managed ctx-* providers through the loopback OMP HTTP gateway; disabling it restores native OMP configuration.'
    ]
  };
}

router.get('/', (req, res) => {
  try {
    const paths = getOmpPaths(process.env, { resolveRuntime: false });
    const settings = readYamlFile(paths.settings, readJsonFile(paths.settingsJsonLegacy, {}));
    const resources = {
      config: readYamlFile(paths.config, {}),
      settings: readYamlFile(paths.settings, {}),
      auth: fs.existsSync(paths.auth) ? { exists: true, path: paths.auth } : { exists: false, path: paths.auth },
      models: readYamlFile(paths.modelsYml, {}),
      legacyModels: readJsonFile(paths.modelsJsonLegacy, {}),
      packages: normalizeArray(settings.packages),
      disabledPackages: normalizeArray(settings.disabledPackages),
      skills: listDirEntries(paths.skills),
      prompts: listDirEntries(paths.prompts, { extensions: ['.md'], includeDirectories: true }),
      commands: listDirEntries(paths.commands, { extensions: ['.md'], includeDirectories: true }),
      notes: listDirEntries(paths.notes, { extensions: ['.md'], includeDirectories: true }),
      extensions: listDirEntries(paths.extensions, { extensions: ['.js', '.mjs', '.cjs', '.ts'], includeDirectories: true }),
      sessionsDir: paths.sessions
    };

    res.json({
      success: true,
      status: getOmpStatus(process.env, { resolveRuntime: false }),
      capabilities: buildCapabilities(),
      resources
    });
  } catch (error) {
    console.error('[OMP Config API] Failed to read config:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/capabilities', (req, res) => {
  res.json({
    success: true,
    platform: 'omp',
    capabilities: buildCapabilities()
  });
});

router.get('/auth-providers', (req, res) => {
  try {
    const forceRefresh = req.query.forceRefresh === 'true';
    res.json({
      success: true,
      ...getOmpAuthProviderSnapshot({ forceRefresh })
    });
  } catch (error) {
    console.error('[OMP Config API] Failed to list auth providers:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/resources', (req, res) => {
  try {
    const paths = getOmpPaths(process.env, { resolveRuntime: false });
    const settings = readYamlFile(paths.settings, readJsonFile(paths.settingsJsonLegacy, {}));
    res.json({
      success: true,
      paths,
      packages: normalizeArray(settings.packages),
      skills: listDirEntries(paths.skills),
      prompts: listDirEntries(paths.prompts, { extensions: ['.md'], includeDirectories: true }),
      commands: listDirEntries(paths.commands, { extensions: ['.md'], includeDirectories: true }),
      notes: listDirEntries(paths.notes, { extensions: ['.md'], includeDirectories: true }),
      extensions: listDirEntries(paths.extensions, { extensions: ['.js', '.mjs', '.cjs', '.ts'], includeDirectories: true })
    });
  } catch (error) {
    console.error('[OMP Config API] Failed to list resources:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
