'use strict';

const { isDeepStrictEqual } = require('util');
const { validateMcpId } = require('./project-config');

const REDACTED_VALUES = new Set(['[REDACTED]', '[redacted]', '[EXPRESSION]']);

function normalizeImportedSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  return { ...spec, type: spec.type || 'stdio' };
}

function restoreRedactedUrl(incoming, existing) {
  if (typeof incoming !== 'string' || typeof existing !== 'string') return incoming;
  try {
    const nextUrl = new URL(incoming);
    const previousUrl = new URL(existing);
    const isRedactedPart = value => {
      try {
        return REDACTED_VALUES.has(decodeURIComponent(value));
      } catch (_) {
        return false;
      }
    };
    const decodePart = value => {
      try {
        return decodeURIComponent(value);
      } catch (_) {
        return value;
      }
    };
    if (isRedactedPart(nextUrl.username) && previousUrl.username) {
      nextUrl.username = decodePart(previousUrl.username);
    }
    if (isRedactedPart(nextUrl.password) && previousUrl.password) {
      nextUrl.password = decodePart(previousUrl.password);
    }
    for (const [key, value] of nextUrl.searchParams.entries()) {
      if (REDACTED_VALUES.has(value) && previousUrl.searchParams.has(key)) {
        nextUrl.searchParams.set(key, previousUrl.searchParams.get(key));
      }
    }
    return nextUrl.toString();
  } catch (_) {
    return incoming;
  }
}

function restoreRedactedValues(incoming, existing, key = '') {
  if (REDACTED_VALUES.has(incoming)) return existing === undefined ? incoming : existing;
  if (key === 'url') return restoreRedactedUrl(incoming, existing);
  if (Array.isArray(incoming)) {
    const previous = Array.isArray(existing) ? existing : [];
    return incoming.map((value, index) => restoreRedactedValues(value, previous[index]));
  }
  if (!incoming || typeof incoming !== 'object') return incoming;
  const previous = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  return Object.fromEntries(Object.entries(incoming).map(([childKey, value]) => [
    childKey,
    restoreRedactedValues(value, previous[childKey], childKey)
  ]));
}

function importMcpServer(servers, { id, platform, spec, name } = {}) {
  let normalizedId;
  try {
    normalizedId = validateMcpId(id);
  } catch (_) {
    return false;
  }
  const importedSpec = normalizeImportedSpec(spec);
  const existing = servers[normalizedId];

  if (!existing) {
    const now = Date.now();
    servers[normalizedId] = {
      id: normalizedId,
      name: typeof name === 'string' && name.trim() ? name : normalizedId,
      server: importedSpec,
      apps: { [platform]: true },
      createdAt: now,
      updatedAt: now
    };
    return true;
  }

  // Treat imports as full snapshots, restoring only values hidden by the platform.
  const nextSpec = restoreRedactedValues(importedSpec, existing.server);
  const nextApps = {
    ...(existing.apps && typeof existing.apps === 'object' && !Array.isArray(existing.apps)
      ? existing.apps
      : {}),
    [platform]: true
  };
  const nextName = typeof name === 'string' && name.trim() ? name : existing.name || normalizedId;
  const changed = !isDeepStrictEqual(existing.server, nextSpec)
    || !isDeepStrictEqual(existing.apps || {}, nextApps)
    || existing.name !== nextName;

  existing.server = nextSpec;
  existing.apps = nextApps;
  existing.name = nextName;
  if (changed) existing.updatedAt = Date.now();
  return changed;
}

module.exports = { importMcpServer };
