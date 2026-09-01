'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_CONTROL_MANIFEST } = require('./control-manifest-store');

const VALID_SCOPES = new Set(['user', 'project']);
const VALID_TRUST = new Set(['pending', 'approved', 'blocked', 'needs_review']);
const VALID_MCP_TRUST = new Set(['pending', 'approved', 'blocked']);
const VALID_MCP_RISK_TIERS = new Set(['read_only', 'local_exec', 'external_write']);
const VALID_ARTIFACT_STATES = new Set(['ready', 'metadata_only', 'stale', 'missing', 'pending', 'orphaned', 'failed', 'unsupported']);
const VALID_MCP_TRANSPORTS = new Set(['stdio', 'streamable_http', 'sse']);
const SKILL_CONTROL_KEYS = new Set([
  'kind', 'controlKey', 'platform', 'scope', 'projectPath', 'sourceKey', 'source', 'artifact',
  'targetDirectory', 'cached', 'enabled', 'trust', 'projection', 'managed', 'lastError',
  'createdAt', 'updatedAt', 'name', 'description', 'sourceProvider', 'sourceScope',
  'fullDirectory', 'revision', 'repoId', 'repoProvider', 'repoOwner', 'repoName',
  'repoBranch', 'repoDirectory', 'repoHost', 'repoProjectPath', 'repoLocalPath', 'repoUrl',
  'readmeUrl', 'license', 'readonly', 'protected', 'isLocal'
]);
const FORBIDDEN_SECRET_KEYS = new Set([
  'env',
  'environment',
  'envvars',
  'experimentalenvironment',
  'headers',
  'httpheaders',
  'token',
  'accesstoken',
  'password',
  'secret',
  'secretvalue',
  'authorization',
  'apikey',
  'privatekey',
  'credential',
  'credentials',
  'clientsecret',
  'bearertokenenvvar',
  'auth',
  'oauth',
  'serverspec',
  'command',
  'args',
  'url'
]);

function deriveMcpPolicy({ transport = 'stdio', scope = 'user' } = {}) {
  const normalizedTransport = VALID_MCP_TRANSPORTS.has(transport) ? transport : 'stdio';
  const remote = normalizedTransport !== 'stdio';
  return {
    transport: normalizedTransport,
    riskTier: remote ? 'external_write' : 'local_exec',
    egressProfile: remote
      ? (scope === 'project' ? 'project-network' : 'network')
      : (scope === 'project' ? 'project-local-process' : 'local-process')
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedSecretKey(key) {
  return String(key).replace(/[_-]/g, '').toLowerCase();
}

function assertNoSecretValues(value, label = 'control entry') {
  if (Array.isArray(value)) {
    value.forEach(item => assertNoSecretValues(item, label));
    return;
  }
  if (!isPlainObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEYS.has(normalizedSecretKey(key))) {
      throw new Error(`${label} contains forbidden secret or server field: ${key}`);
    }
    assertNoSecretValues(child, label);
  }
}

function sanitizeSkillEntry(entry) {
  assertNoSecretValues(entry, 'Skill control entry');
  const safe = Object.fromEntries(
    Object.entries(entry).filter(([key]) => SKILL_CONTROL_KEYS.has(key))
  );
  return safe;
}

function normalizeProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
    throw new Error('Project scope requires a canonical absolute projectPath');
  }
  try {
    return fs.realpathSync(projectPath);
  } catch (error) {
    throw new Error('Project scope requires an existing canonical projectPath', { cause: error });
  }
}

function normalizeScope(scope = 'user', projectPath = null) {
  if (!VALID_SCOPES.has(scope)) {
    throw new Error('Invalid scope: expected "user" or "project"');
  }
  if (scope === 'user') {
    if (projectPath !== null && projectPath !== undefined) {
      throw new Error('User scope cannot include projectPath');
    }
    return { scope, projectPath: null };
  }
  return { scope, projectPath: normalizeProjectPath(projectPath) };
}

function sourceKeyFor(entry = {}) {
  if (entry.sourceKey) return String(entry.sourceKey);
  const source = isPlainObject(entry.source) ? entry.source : {};
  const sourceKind = source.kind || entry.source || 'unknown';
  const repoId = source.repoId || source.repoUrl || '';
  const fullDirectory = source.fullDirectory || entry.fullDirectory || entry.targetDirectory || entry.directory || entry.name || '';
  return [sourceKind, repoId, fullDirectory].map(value => String(value || '')).join(':');
}

function skillIdentity(entry = {}) {
  return `${entry.platform || ''}:${sourceKeyFor(entry)}`;
}


function buildControlKey(entry, scope, projectPath) {
  const location = scope === 'project' ? projectPath : 'user';
  return entry.controlKey || `skill:${entry.platform}:${scope}:${location}:${sourceKeyFor(entry)}`;
}

function ensureMap(manifest, key) {
  if (!isPlainObject(manifest[key])) manifest[key] = {};
  return manifest[key];
}

class EffectiveControlService {
  constructor({ store, projection = null, clock = () => Date.now() } = {}) {
    if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') {
      throw new Error('EffectiveControlService requires a control manifest store');
    }
    this.store = store;
    this.projection = projection;
    this.clock = clock;
  }

  _scopeOptions(options = {}) {
    return normalizeScope(options.scope || 'user', options.projectPath ?? null);
  }

  _skillTargetKey(entry) {
    return [
      entry.platform || '',
      entry.targetDirectory || ''
    ].join(':');
  }

  _readScope(scopeOptions) {
    return this.store.read(scopeOptions);
  }

  _writeScope(scopeOptions, manifest) {
    manifest.updatedAt = this.clock();
    return this.store.write(scopeOptions, manifest);
  }

  _normalizeSkill(entry = {}) {
    if (!isPlainObject(entry) || entry.kind !== 'skill') {
      throw new Error('Invalid Skill control entry');
    }
    const safeEntry = sanitizeSkillEntry(entry);
    const scopeOptions = normalizeScope(safeEntry.scope || 'user', safeEntry.projectPath ?? null);
    if (!safeEntry.platform || typeof safeEntry.platform !== 'string') {
      throw new Error('Skill control entry requires platform');
    }

    const now = this.clock();
    const artifact = isPlainObject(safeEntry.artifact) ? clone(safeEntry.artifact) : null;
    if (artifact && !VALID_ARTIFACT_STATES.has(artifact.state)) artifact.state = 'missing';
    const normalized = clone({
      ...safeEntry,
      controlKey: buildControlKey(safeEntry, scopeOptions.scope, scopeOptions.projectPath),
      sourceKey: sourceKeyFor(safeEntry),
      scope: scopeOptions.scope,
      projectPath: scopeOptions.projectPath,
      managed: true,
      cached: safeEntry.cached !== false,
      enabled: safeEntry.enabled === true,
      trust: VALID_TRUST.has(safeEntry.trust) ? safeEntry.trust : 'pending',
      artifact,
      projection: isPlainObject(safeEntry.projection)
        ? safeEntry.projection
        : { mode: 'unsupported', state: 'unsupported', path: null, updatedAt: null },
      createdAt: safeEntry.createdAt || now,
      updatedAt: now,
      lastError: safeEntry.lastError || null
    });

    if (normalized.trust !== 'approved') normalized.enabled = false;
    if (normalized.trust === 'blocked') {
      normalized.projection = { ...normalized.projection, state: 'blocked', updatedAt: now };
    }
    return normalized;
  }

  _normalizeMcp(entry = {}) {
    if (!isPlainObject(entry) || entry.kind !== 'mcp') {
      throw new Error('Invalid MCP control entry');
    }
    assertNoSecretValues(entry, 'MCP control entry');
    const scopeOptions = normalizeScope(entry.scope || 'user', entry.projectPath ?? null);
    if (!entry.platform || typeof entry.platform !== 'string') {
      throw new Error('MCP control entry requires platform');
    }
    const now = this.clock();
    const policy = deriveMcpPolicy({
      transport: entry.transport,
      scope: scopeOptions.scope
    });
    return clone({
      ...entry,
      controlKey: String(entry.controlKey || `mcp:${entry.platform}:${scopeOptions.scope}:${entry.name || now}`),
      kind: 'mcp',
      ...policy,
      platform: entry.platform,
      scope: scopeOptions.scope,
      projectPath: scopeOptions.projectPath,
      managed: entry.managed !== false,
      enabled: entry.enabled === true,
      trust: VALID_MCP_TRUST.has(entry.trust) ? entry.trust : 'pending',
      secretRefs: Array.isArray(entry.secretRefs) ? entry.secretRefs.map(ref => String(ref)) : [],
      createdAt: entry.createdAt || now,
      updatedAt: now
    });
  }

  registerSkill(entry) {
    const normalized = this._normalizeSkill(entry);
    const scopeOptions = { scope: normalized.scope, projectPath: normalized.projectPath };
    const manifest = this._readScope(scopeOptions);
    const skills = ensureMap(manifest, 'skills');
    const identity = skillIdentity(normalized);

    for (const [key, existing] of Object.entries(skills)) {
      if (key !== normalized.controlKey && existing && skillIdentity(existing) === identity) {
        delete skills[key];
      }
    }
    skills[normalized.controlKey] = normalized;
    this._writeScope(scopeOptions, manifest);
    return clone(normalized);
  }

  getSkill(controlKey, options = {}) {
    if (!controlKey) return null;
    const scopeOptions = this._scopeOptions(options);
    const manifest = this._readScope(scopeOptions);
    const entry = manifest.skills?.[controlKey];
    return entry ? clone(entry) : null;
  }

  _updateSkill(controlKey, scopeOptions, updater) {
    const manifest = this._readScope(scopeOptions);
    const skills = ensureMap(manifest, 'skills');
    const current = skills[controlKey];
    if (!current) throw new Error('Skill control entry not found');
    if (current.scope !== scopeOptions.scope) {
      throw new Error('Skill control entry scope does not match the request');
    }
    if (scopeOptions.scope === 'project' && current.projectPath !== scopeOptions.projectPath) {
      throw new Error('Skill control entry projectPath does not match the request');
    }
    if (scopeOptions.scope === 'user' && current.projectPath !== null) {
      throw new Error('User Skill control entry cannot include projectPath');
    }
    const next = updater(clone(current));
    skills[controlKey] = next;
    this._writeScope(scopeOptions, manifest);
    return clone(next);
  }

  setSkillEnabled({ platform = null, controlKey, scope = 'user', projectPath = null, enabled } = {}) {
    const scopeOptions = normalizeScope(scope, projectPath);
    const requested = enabled === true;
    const manifest = this._readScope(scopeOptions);
    const current = manifest.skills?.[controlKey];
    if (!current) throw new Error('Skill control entry not found');
    if (platform && current.platform !== platform) {
      throw new Error('Skill control entry platform does not match the request');
    }
    if (current.scope !== scopeOptions.scope) {
      throw new Error('Skill control entry scope does not match the request');
    }
    if (scopeOptions.scope === 'project' && current.projectPath !== scopeOptions.projectPath) {
      throw new Error('Skill control entry projectPath does not match the request');
    }
    if (scopeOptions.scope === 'user' && current.projectPath !== null) {
      throw new Error('User Skill control entry cannot include projectPath');
    }
    if (requested && current.trust === 'blocked') {
      return { ...clone(current), status: 'blocked' };
    }
    if (requested && current.trust !== 'approved') {
      return { ...clone(current), status: 'needs_approval' };
    }
    const conflictPool = scopeOptions.scope === 'project'
      ? this.getEffectiveSnapshot({
        platform: current.platform,
        scope: scopeOptions.scope,
        projectPath: scopeOptions.projectPath
      }).skills.active
      : Object.values(manifest.skills || {});
    const conflicts = conflictPool
      .filter(entry => (
        entry?.controlKey !== controlKey
        && entry?.managed === true
        && entry.enabled === true
        && entry.trust === 'approved'
        && entry.artifact?.state === 'ready'
        && this._skillTargetKey(entry) === this._skillTargetKey(current)
      ))
      .map(entry => entry);
    if (requested && conflicts.length > 0) {
      return {
        ...clone(current),
        status: 'conflict',
        conflictWith: conflicts.map(entry => entry.controlKey)
      };
    }
    const projectionOwner = current.projection?.sourceKey;
    const preserveProjection = !requested && (
      conflicts.length > 0
      || (projectionOwner && projectionOwner !== current.sourceKey)
    );

    const next = {
      ...clone(current),
      enabled: requested,
      projection: {
        ...(current.projection || {}),
        state: requested ? 'enabled' : 'disabled',
        updatedAt: this.clock()
      },
      updatedAt: this.clock()
    };
    try {
      const projectionResult = requested
        ? this.projection?.enable?.(next)
        : (preserveProjection ? null : this.projection?.disable?.(next));
      if (projectionResult && typeof projectionResult.then !== 'function') {
        if (projectionResult.status === 'conflict' || projectionResult.state === 'conflict') {
          const conflicted = {
            ...next,
            enabled: false,
            projection: { ...next.projection, ...clone(projectionResult) },
            status: 'conflict'
          };
          manifest.skills[controlKey] = conflicted;
          this._writeScope(scopeOptions, manifest);
          return clone(conflicted);
        }
        if (projectionResult.status === 'unsupported' || projectionResult.state === 'unsupported') {
          return { ...clone(current), projection: clone(projectionResult), status: 'unsupported' };
        }
        next.projection = { ...next.projection, ...projectionResult };
      }
    } catch (error) {
      next.enabled = false;
      next.projection = { ...next.projection, state: 'error', updatedAt: this.clock() };
      next.lastError = error.message;
      next.status = 'projection_failed';
    }

    manifest.skills[controlKey] = next;
    this._writeScope(scopeOptions, manifest);
    return clone(next);
  }
  setSkillTrust({ platform = null, controlKey, scope = 'user', projectPath = null, trust } = {}) {
    if (!VALID_TRUST.has(trust)) throw new Error('Invalid Skill trust state');
    const scopeOptions = normalizeScope(scope, projectPath);
    return this._updateSkill(controlKey, scopeOptions, current => {
      if (platform && current.platform !== platform) {
        throw new Error('Skill control entry platform does not match the request');
      }
      const next = { ...current, trust };
      if (trust !== 'approved') {
        next.enabled = false;
        next.projection = {
          ...(current.projection || {}),
          state: trust === 'blocked' ? 'blocked' : 'disabled',
          updatedAt: this.clock()
        };
        try {
          const projectionResult = this.projection?.disable?.(next);
          if (projectionResult && typeof projectionResult.then !== 'function') {
            next.projection = { ...next.projection, ...projectionResult };
          }
        } catch (error) {
          next.projection = { ...next.projection, state: 'error', status: 'error', updatedAt: this.clock() };
          next.lastError = error.message;
        }
      }
      return next;
    });
  }

  registerMcp(entry) {
    const normalized = this._normalizeMcp(entry);
    const scopeOptions = { scope: normalized.scope, projectPath: normalized.projectPath };
    const manifest = this._readScope(scopeOptions);
    const mcp = ensureMap(manifest, 'mcp');
    mcp[normalized.controlKey] = normalized;
    this._writeScope(scopeOptions, manifest);
    return clone(normalized);
  }

  getMcp(controlKey, options = {}) {
    if (!controlKey) return null;
    const scopeOptions = this._scopeOptions(options);
    const manifest = this._readScope(scopeOptions);
    const entry = manifest.mcp?.[controlKey];
    return entry ? clone(entry) : null;
  }

  removeMcp({ controlKey, scope = 'user', projectPath = null } = {}) {
    const scopeOptions = normalizeScope(scope, projectPath);
    const manifest = this._readScope(scopeOptions);
    if (!manifest.mcp || !Object.prototype.hasOwnProperty.call(manifest.mcp, controlKey)) return false;
    delete manifest.mcp[controlKey];
    this._writeScope(scopeOptions, manifest);
    return true;
  }

  setMcpPolicy({ platform = null, controlKey, scope = 'user', projectPath = null, enabled, trust } = {}) {
    const scopeOptions = normalizeScope(scope, projectPath);
    const manifest = this._readScope(scopeOptions);
    const current = manifest.mcp?.[controlKey];
    if (!current) throw new Error('MCP control entry not found');
    if (platform && current.platform !== platform) {
      throw new Error('MCP control entry platform does not match the request');
    }
    if (trust !== undefined && !VALID_MCP_TRUST.has(trust)) throw new Error('Invalid MCP trust state');
    if (enabled === true && (trust || current.trust) !== 'approved') {
      return { ...clone(current), status: (trust || current.trust) === 'blocked' ? 'blocked' : 'needs_approval' };
    }
    const next = {
      ...current,
      ...(enabled !== undefined ? { enabled: enabled === true } : {}),
      ...(trust !== undefined ? { trust } : {}),
      updatedAt: this.clock()
    };
    if (next.trust !== 'approved') next.enabled = false;
    manifest.mcp[controlKey] = next;
    this._writeScope(scopeOptions, manifest);
    return clone(next);
  }

  getEffectiveSnapshot({ platform, scope = 'user', projectPath = null } = {}) {
    const scopeOptions = normalizeScope(scope, projectPath);
    const requestedManifest = this._readScope(scopeOptions);
    const requested = Object.values(requestedManifest.skills || {})
      .filter(entry => (
        entry
        && entry.platform === platform
        && entry.scope === scopeOptions.scope
        && (scopeOptions.scope === 'user' ? entry.projectPath === null : entry.projectPath === scopeOptions.projectPath)
      ));

    if (scopeOptions.scope === 'user') {
      return {
        skills: { active: requested.map(clone), inherited: [] },
        mcp: {
          active: Object.values(requestedManifest.mcp || {})
            .filter(entry => entry && entry.platform === platform && entry.scope === 'user' && entry.projectPath === null)
            .map(clone),
          inherited: []
        }
      };
    }

    const userManifest = this._readScope({ scope: 'user', projectPath: null });
    const userSkills = Object.values(userManifest.skills || {})
      .filter(entry => entry && entry.platform === platform && entry.scope === 'user' && entry.projectPath === null);
    const projectIdentities = new Set(requested.map(skillIdentity));
    const active = [
      ...requested,
      ...userSkills.filter(entry => !projectIdentities.has(skillIdentity(entry)))
    ];

    const userMcp = Object.values(userManifest.mcp || {})
      .filter(entry => entry && entry.platform === platform && entry.scope === 'user' && entry.projectPath === null);
    const projectMcp = Object.values(requestedManifest.mcp || {})
      .filter(entry => entry && entry.platform === platform && entry.scope === 'project' && entry.projectPath === scopeOptions.projectPath);
    const projectMcpKeys = new Set(projectMcp.map(entry => entry.controlKey));
    return {
      skills: { active: active.map(clone), inherited: userSkills.map(clone) },
      mcp: {
        active: [
          ...projectMcp,
          ...userMcp.filter(entry => !projectMcpKeys.has(entry.controlKey))
        ].map(clone),
        inherited: userMcp.map(clone)
      }
    };
  }

  reconcile({ platform, scope = 'user', projectPath = null } = {}) {
    const snapshot = this.getEffectiveSnapshot({ platform, scope, projectPath });
    const results = [];
    const owners = new Map();
    for (const entry of snapshot.skills.active) {
      if (!entry.managed || !entry.enabled || entry.trust !== 'approved' || entry.artifact?.state !== 'ready') continue;
      const targetKey = this._skillTargetKey(entry);
      if (owners.has(targetKey)) {
        results.push({
          controlKey: entry.controlKey,
          status: 'conflict',
          conflictWith: owners.get(targetKey)
        });
        continue;
      }
      try {
        const projection = this.projection?.enable?.(entry);
        if (projection?.status === 'unsupported' || projection?.state === 'unsupported') {
          results.push({ controlKey: entry.controlKey, status: 'unsupported' });
          continue;
        }
        if (projection?.status === 'conflict' || projection?.state === 'conflict') {
          results.push({
            controlKey: entry.controlKey,
            status: 'conflict',
            conflictWith: projection.conflictWith || 'unknown'
          });
          continue;
        }
        owners.set(targetKey, entry.controlKey);
        results.push({ controlKey: entry.controlKey, status: 'enabled' });
      } catch (error) {
        results.push({ controlKey: entry.controlKey, status: 'error', error: error.message });
      }
    }
    return { ...snapshot, projection: results };
  }
}
module.exports = {
  EffectiveControlService,
  VALID_SCOPES,
  VALID_TRUST,
  deriveMcpPolicy,
  DEFAULT_CONTROL_MANIFEST
};
