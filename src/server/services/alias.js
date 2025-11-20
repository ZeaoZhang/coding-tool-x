const fs = require('fs');
const path = require('path');
const os = require('os');

const ALIAS_DIR = path.join(os.homedir(), '.claude', 'cc-tool');
const ALIAS_FILE = path.join(ALIAS_DIR, 'aliases.json');

// Ensure alias directory exists
function ensureAliasDir() {
  if (!fs.existsSync(ALIAS_DIR)) {
    fs.mkdirSync(ALIAS_DIR, { recursive: true });
  }
}

// Load all aliases
function loadAliases() {
  ensureAliasDir();

  if (!fs.existsSync(ALIAS_FILE)) {
    return {};
  }

  try {
    const content = fs.readFileSync(ALIAS_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error loading aliases:', error);
    return {};
  }
}

// Save aliases
function saveAliases(aliases) {
  ensureAliasDir();

  try {
    fs.writeFileSync(ALIAS_FILE, JSON.stringify(aliases, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving aliases:', error);
    throw error;
  }
}

// Set alias for a session
function setAlias(sessionId, alias) {
  const aliases = loadAliases();
  aliases[sessionId] = alias;
  saveAliases(aliases);
  return aliases;
}

// Delete alias
function deleteAlias(sessionId) {
  const aliases = loadAliases();
  delete aliases[sessionId];
  saveAliases(aliases);
  return aliases;
}

// Get alias for a session
function getAlias(sessionId) {
  const aliases = loadAliases();
  return aliases[sessionId] || null;
}

module.exports = {
  loadAliases,
  setAlias,
  deleteAlias,
  getAlias
};
