const fs = require('fs');
const path = require('path');
const os = require('os');

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

function getTokensFilePath() {
  const dir = path.join(os.homedir(), '.claude', 'cc-tool');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'oauth-tokens.json');
}

function loadTokens() {
  const filePath = getTokensFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Error loading oauth tokens:', error);
  }
  return { tokens: {} };
}

function saveTokens(data) {
  const filePath = getTokensFilePath();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

  // Set file permissions to 0600 (owner read/write only) on non-Windows
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(filePath, 0o600);
    } catch (error) {
      console.error('Error setting oauth tokens file permissions:', error);
    }
  }
}

function getToken(tokenId) {
  const data = loadTokens();
  return data.tokens[tokenId] || null;
}

function saveToken(tokenData) {
  const data = loadTokens();
  const id = tokenData.id || `token-${Date.now()}`;
  const now = Date.now();

  data.tokens[id] = {
    ...tokenData,
    id,
    createdAt: tokenData.createdAt || now,
    updatedAt: now
  };

  saveTokens(data);
  return data.tokens[id];
}

function updateToken(tokenId, updates) {
  const data = loadTokens();

  if (!data.tokens[tokenId]) {
    throw new Error('Token not found');
  }

  data.tokens[tokenId] = {
    ...data.tokens[tokenId],
    ...updates,
    id: tokenId, // prevent id override
    updatedAt: Date.now()
  };

  saveTokens(data);
  return data.tokens[tokenId];
}

function deleteToken(tokenId) {
  const data = loadTokens();

  if (!data.tokens[tokenId]) {
    throw new Error('Token not found');
  }

  delete data.tokens[tokenId];
  saveTokens(data);
  return { success: true };
}

function maskSensitiveField(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }
  if (value.length <= 8) {
    return '***';
  }
  return value.substring(0, 8) + '...';
}

function getAllTokens() {
  const data = loadTokens();
  return Object.values(data.tokens).map(token => ({
    ...token,
    accessToken: maskSensitiveField(token.accessToken),
    refreshToken: maskSensitiveField(token.refreshToken)
  }));
}

function getTokensByProvider(provider) {
  const all = getAllTokens();
  return all.filter(token => token.provider === provider);
}

function isTokenExpired(token) {
  if (!token || !token.expiresAt) {
    return true;
  }
  return Date.now() >= (token.expiresAt - TOKEN_EXPIRY_BUFFER_MS);
}

module.exports = {
  loadTokens,
  saveTokens,
  getToken,
  saveToken,
  updateToken,
  deleteToken,
  getAllTokens,
  getTokensByProvider,
  isTokenExpired,
  getTokensFilePath
};
