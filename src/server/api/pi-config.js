const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const {
  getPiPaths,
  getPiStatus,
  readJsonFile,
  readPiSettings
} = require('../services/pi-config');

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
    platform: 'pi',
    native: {
      settings: true,
      extensions: true,
      skills: true,
      promptTemplates: true,
      packages: true,
      rpc: true,
      sessions: true
    },
    mapped: {
      command: 'promptTemplates',
      plugin: 'packages/extensions',
      mcp: 'extension/package capability',
      agent: 'extension/package capability'
    },
    writable: {
      settings: true,
      skills: true,
      promptTemplates: true,
      packages: true,
      extensions: true,
      mcp: false,
      agent: false
    },
    notes: [
      'Pi does not expose native MCP or sub-agent config files; coding-tool-x treats them as package/extension capabilities.',
      'Provider channels are enabled by writing a managed Pi extension that calls pi.registerProvider().'
    ]
  };
}

router.get('/', (req, res) => {
  try {
    const paths = getPiPaths();
    const settings = readPiSettings();
    const resources = {
      settings: readJsonFile(paths.settings, {}),
      auth: fs.existsSync(paths.auth) ? { exists: true, path: paths.auth } : { exists: false, path: paths.auth },
      models: readJsonFile(paths.models, {}),
      packages: normalizeArray(settings.packages),
      disabledPackages: normalizeArray(settings.disabledPackages),
      skills: listDirEntries(paths.skills),
      prompts: listDirEntries(paths.prompts, { extensions: ['.md'], includeDirectories: true }),
      extensions: listDirEntries(paths.extensions, { extensions: ['.js', '.mjs', '.cjs', '.ts'], includeDirectories: true }),
      sessionsDir: paths.sessions
    };

    res.json({
      success: true,
      status: getPiStatus(),
      capabilities: buildCapabilities(),
      resources
    });
  } catch (error) {
    console.error('[Pi Config API] Failed to read config:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/capabilities', (req, res) => {
  res.json({
    success: true,
    platform: 'pi',
    capabilities: buildCapabilities()
  });
});

router.get('/resources', (req, res) => {
  try {
    const paths = getPiPaths();
    const settings = readPiSettings();
    res.json({
      success: true,
      paths,
      packages: normalizeArray(settings.packages),
      skills: listDirEntries(paths.skills),
      prompts: listDirEntries(paths.prompts, { extensions: ['.md'], includeDirectories: true }),
      extensions: listDirEntries(paths.extensions, { extensions: ['.js', '.mjs', '.cjs', '.ts'], includeDirectories: true })
    });
  } catch (error) {
    console.error('[Pi Config API] Failed to list resources:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
