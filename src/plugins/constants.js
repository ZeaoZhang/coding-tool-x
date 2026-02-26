const path = require('path');
const { PATHS, ensureStorageDirMigrated } = require('../config/paths');

ensureStorageDirMigrated();
const PLUGINS_DIR = path.join(PATHS.base, 'plugins');
const REGISTRY_FILE = path.join(PLUGINS_DIR, 'registry.json');
const CONFIG_DIR = path.join(PLUGINS_DIR, 'config');
const INSTALLED_DIR = path.join(PLUGINS_DIR, 'installed');

module.exports = {
  PLUGINS_DIR,
  REGISTRY_FILE,
  CONFIG_DIR,
  INSTALLED_DIR,
};
