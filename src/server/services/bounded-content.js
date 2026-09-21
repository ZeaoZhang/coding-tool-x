'use strict';

const fs = require('fs');

function normalizeLimit(maxBytes) {
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('A positive byte limit is required');
  }
  return limit;
}

function truncateUtf8(value, maxBytes) {
  const limit = normalizeLimit(maxBytes);
  const text = String(value ?? '');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= limit) {
    return { text, bytes, truncated: false };
  }
  return {
    text: Buffer.from(text, 'utf8').subarray(0, limit).toString('utf8'),
    bytes,
    truncated: true
  };
}

function readTextFileLimited(filePath, maxBytes, fsImpl = fs) {
  const limit = normalizeLimit(maxBytes);
  const totalBytes = fsImpl.statSync(filePath).size;
  if (totalBytes <= limit) {
    return {
      text: fsImpl.readFileSync(filePath, 'utf8'),
      bytes: totalBytes,
      truncated: false
    };
  }

  const fd = fsImpl.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(limit);
    let offset = 0;
    while (offset < limit) {
      const bytesRead = fsImpl.readSync(fd, buffer, offset, limit - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return {
      text: buffer.subarray(0, offset).toString('utf8'),
      bytes: totalBytes,
      truncated: true
    };
  } finally {
    fsImpl.closeSync(fd);
  }
}

module.exports = {
  readTextFileLimited,
  truncateUtf8
};
