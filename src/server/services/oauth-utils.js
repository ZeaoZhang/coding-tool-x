const fs = require('fs');
const crypto = require('crypto');

function maskToken(value) {
  const token = String(value || '').trim();
  if (!token) {
    return '';
  }
  if (token.length <= 8) {
    return `${token.slice(0, 2)}***`;
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function decodeJwtPayload(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return null;
  }

  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function removeFileIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore cleanup failures
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

module.exports = {
  maskToken,
  decodeJwtPayload,
  removeFileIfExists,
  sha256
};
