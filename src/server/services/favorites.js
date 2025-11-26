const fs = require('fs');
const path = require('path');
const os = require('os');

const FAVORITES_DIR = path.join(os.homedir(), '.claude', 'cc-tool');
const FAVORITES_FILE = path.join(FAVORITES_DIR, 'favorites.json');

// 内存缓存
let favoritesCache = null;
let cacheInitialized = false;

const DEFAULT_FAVORITES = {
  claude: [],
  codex: [],
  gemini: []
};

// Ensure favorites directory exists
function ensureFavoritesDir() {
  if (!fs.existsSync(FAVORITES_DIR)) {
    fs.mkdirSync(FAVORITES_DIR, { recursive: true });
  }
}

// 从文件读取并缓存
function readFavoritesFromFile() {
  ensureFavoritesDir();

  if (!fs.existsSync(FAVORITES_FILE)) {
    return { ...DEFAULT_FAVORITES };
  }

  try {
    const content = fs.readFileSync(FAVORITES_FILE, 'utf8');
    const data = JSON.parse(content);
    return {
      claude: data.claude || [],
      codex: data.codex || [],
      gemini: data.gemini || []
    };
  } catch (error) {
    console.error('Error reading favorites file:', error);
    return { ...DEFAULT_FAVORITES };
  }
}

// 初始化缓存（延迟初始化）
function initializeCache() {
  if (cacheInitialized) return;
  favoritesCache = readFavoritesFromFile();
  cacheInitialized = true;

  // 监听文件变化，更新缓存
  try {
    fs.watchFile(FAVORITES_FILE, { persistent: false }, () => {
      favoritesCache = readFavoritesFromFile();
    });
  } catch (err) {
    console.error('Failed to watch favorites file:', err);
  }
}

// Load all favorites（使用缓存）
function loadFavorites() {
  if (!cacheInitialized) {
    initializeCache();
  }
  return JSON.parse(JSON.stringify(favoritesCache)); // 深拷贝返回
}

// Save favorites（同时更新缓存）
function saveFavorites(favorites) {
  ensureFavoritesDir();

  try {
    fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2), 'utf8');
    // 同时更新缓存
    favoritesCache = JSON.parse(JSON.stringify(favorites));
  } catch (error) {
    console.error('Error saving favorites:', error);
    throw error;
  }
}

// Add a favorite
function addFavorite(channel, sessionData) {
  const favorites = loadFavorites();

  if (!favorites[channel]) {
    favorites[channel] = [];
  }

  // Check if already exists
  const exists = favorites[channel].some(
    fav => fav.sessionId === sessionData.sessionId && fav.projectName === sessionData.projectName
  );

  if (!exists) {
    favorites[channel].push({
      ...sessionData,
      addedAt: Date.now()
    });
    saveFavorites(favorites);
    return { success: true, favorites };
  }

  return { success: false, message: 'Already exists', favorites };
}

// Remove a favorite
function removeFavorite(channel, projectName, sessionId) {
  const favorites = loadFavorites();

  if (!favorites[channel]) {
    return { success: false, message: 'Channel not found', favorites };
  }

  const index = favorites[channel].findIndex(
    fav => fav.sessionId === sessionId && fav.projectName === projectName
  );

  if (index > -1) {
    favorites[channel].splice(index, 1);
    saveFavorites(favorites);
    return { success: true, favorites };
  }

  return { success: false, message: 'Not found', favorites };
}

// Check if a session is favorited
function isFavorite(channel, projectName, sessionId) {
  const favorites = loadFavorites();

  if (!favorites[channel]) {
    return false;
  }

  return favorites[channel].some(
    fav => fav.sessionId === sessionId && fav.projectName === projectName
  );
}

// Get favorites for a specific channel
function getFavorites(channel) {
  const favorites = loadFavorites();
  return favorites[channel] || [];
}

// Get all favorites
function getAllFavorites() {
  return loadFavorites();
}

module.exports = {
  loadFavorites,
  saveFavorites,
  addFavorite,
  removeFavorite,
  isFavorite,
  getFavorites,
  getAllFavorites
};
