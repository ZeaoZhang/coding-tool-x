const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('../../config/paths');

const SECURITY_DIR = PATHS.base;
const SECURITY_FILE = path.join(SECURITY_DIR, 'security.json');

const DEFAULT_SECURITY_CONFIG = {
  passwordHash: '',
  salt: '',
  updatedAt: null
};

const PBKDF2_ITERATIONS = 120000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';

function ensureSecurityDir() {
  if (!fs.existsSync(SECURITY_DIR)) {
    fs.mkdirSync(SECURITY_DIR, { recursive: true });
  }
}

function readSecurityConfig() {
  ensureSecurityDir();

  if (!fs.existsSync(SECURITY_FILE)) {
    return { ...DEFAULT_SECURITY_CONFIG };
  }

  try {
    const content = fs.readFileSync(SECURITY_FILE, 'utf8');
    const data = JSON.parse(content);
    return {
      ...DEFAULT_SECURITY_CONFIG,
      ...data
    };
  } catch (error) {
    console.error('Error loading security config:', error);
    return { ...DEFAULT_SECURITY_CONFIG };
  }
}

function writeSecurityConfig(config) {
  ensureSecurityDir();
  fs.writeFileSync(SECURITY_FILE, JSON.stringify(config, null, 2), 'utf8');
  try {
    fs.chmodSync(SECURITY_FILE, 0o600);
  } catch (error) {
    console.warn('Failed to set security config permissions:', error);
  }
}

function hasPassword(config) {
  return Boolean(config.passwordHash && config.salt);
}

function hashPassword(password, salt) {
  return crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
}

function safeEqualHash(a, b) {
  try {
    const bufferA = Buffer.from(a, 'hex');
    const bufferB = Buffer.from(b, 'hex');
    if (bufferA.length !== bufferB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufferA, bufferB);
  } catch (error) {
    return false;
  }
}

function getSecurityStatus() {
  const config = readSecurityConfig();
  return { hasPassword: hasPassword(config) };
}

function verifySecurityPassword(password) {
  const config = readSecurityConfig();
  if (!hasPassword(config)) {
    return { ok: false, reason: 'not_set' };
  }
  const hash = hashPassword(password, config.salt);
  return { ok: safeEqualHash(hash, config.passwordHash) };
}

function setSecurityPassword({ currentPassword, newPassword }) {
  if (typeof newPassword !== 'string' || newPassword.length < 4) {
    const error = new Error('新密码至少 4 位');
    error.code = 'WEAK_PASSWORD';
    throw error;
  }

  const config = readSecurityConfig();
  if (hasPassword(config)) {
    if (typeof currentPassword !== 'string' || !currentPassword) {
      const error = new Error('请输入当前密码');
      error.code = 'CURRENT_REQUIRED';
      throw error;
    }
    const verifyResult = verifySecurityPassword(currentPassword);
    if (!verifyResult.ok) {
      const error = new Error('当前密码错误');
      error.code = 'INVALID_PASSWORD';
      throw error;
    }
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(newPassword, salt);
  const nextConfig = {
    ...config,
    passwordHash,
    salt,
    updatedAt: new Date().toISOString()
  };

  writeSecurityConfig(nextConfig);
  return { hasPassword: true };
}

module.exports = {
  getSecurityStatus,
  verifySecurityPassword,
  setSecurityPassword
};
