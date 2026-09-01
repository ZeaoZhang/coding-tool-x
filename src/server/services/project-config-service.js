'use strict';

const fs = require('fs');
const path = require('path');
const platformRuntime = require('../../platforms/runtime');
const { PATHS } = require('../../config/paths');
const { ControlManifestStore } = require('./control-manifest-store');
const { EffectiveControlService, deriveMcpPolicy } = require('./effective-control-service');
const { validateKnownProjectCwd } = require('./project-path-validation');
const {
  assertExistingProjectRoot,
  assertNoSymlinkComponents,
  redactSecrets,
  validateMcpId,
  mergeMcpPatch
} = require('./project-config-adapters/shared');
const { createProjectConfigAdapters } = require('./project-config-adapters');
const PROJECT_SCOPES = new Set(['user', 'project']);

function normalizePlatform(platform) {
  const normalized = String(platform || '').trim().toLowerCase();
  if (!normalized) throw new Error('Platform is required');
  return normalized;
}

function secretRefsForMcpSpec(spec = {}) {
  const env = spec.env && typeof spec.env === 'object' && !Array.isArray(spec.env) ? spec.env : {};
  const headers = spec.headers && typeof spec.headers === 'object' && !Array.isArray(spec.headers) ? spec.headers : {};
  const refs = [];
  for (const key of Object.keys(env)) refs.push(`env:${key}`);
  for (const key of Object.keys(headers)) refs.push(`header:${key}`);
  if (spec.url) refs.push('url:configured');
  return refs;
}


function assertProjectSecretReferences(spec = {}) {
  const safeLiteralEnvKeys = new Set(['DEBUG', 'LOG_LEVEL', 'NODE_ENV', 'PYTHONUNBUFFERED']);
  const safeLiteralHeaderKeys = new Set(['accept', 'content-type', 'user-agent']);
  const environmentReference = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
  const sensitiveUrlKey = /^(?:token|secret|password|api[-_]?key|access[-_]?token|authorization|key)$/i;
  const forbiddenFields = new Set([
    'envvars',
    'experimentalenvironment',
    'auth',
    'oauth',
    'bearertokenenvvar',
    'accesstoken',
    'clientsecret',
    'credential',
    'credentials',
    'secret',
    'secretrefs',
    'authorization'
  ]);
  const normalizeKey = key => String(key).replace(/[_-]/g, '').toLowerCase();
  const assertMapReferences = (container, values) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error(`Project MCP ${container} must be an object`);
    }
    for (const [key, value] of Object.entries(values)) {
      const normalizedKey = key.toLowerCase();
      const safeLiteral = container === 'env'
        ? safeLiteralEnvKeys.has(key)
        : safeLiteralHeaderKeys.has(normalizedKey);
      if (safeLiteral && typeof value === 'string' && !value.includes('\n')) continue;
      if (typeof value !== 'string' || !environmentReference.test(value)) {
        throw new Error(`Project MCP ${container}.${key} must reference an environment variable`);
      }
    }
  };
  const commandFlagPattern = /^(?:--?|\/)(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key|auth|credential|client[-_]?secret|bearer)$/i;
  const commandInlinePattern = /^((?:--?|\/)(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key|auth|credential|client[-_]?secret|bearer)=)(.*)$/i;
  const assertCommandReferences = (container, value) => {
    const assertValue = (candidate) => {
      if (typeof candidate !== 'string' || !environmentReference.test(candidate)) {
        throw new Error(`Project MCP ${container} secrets must reference an environment variable`);
      }
    };
    if (Array.isArray(value)) {
      let expectsValue = false;
      for (const item of value) {
        if (typeof item !== 'string') {
          throw new Error(`Project MCP ${container} arguments must be strings`);
        }
        if (expectsValue) {
          assertValue(item);
          expectsValue = false;
          continue;
        }
        if (commandFlagPattern.test(item)) {
          expectsValue = true;
          continue;
        }
        const inline = item.match(commandInlinePattern);
        if (inline) {
          assertValue(inline[2]);
        }
      }
      if (expectsValue) throw new Error(`Project MCP ${container} secret flag requires an environment reference`);
      return;
    }
    if (typeof value !== 'string') {
      throw new Error(`Project MCP ${container} must be a string or string array`);
    }
    const matches = [...value.matchAll(/(?:^|\s)(?:--?|\/)(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key|auth|credential|client[-_]?secret|bearer)(?:=|\s+)(\S+)/gi)];
    matches.forEach(match => assertValue(match[1]));
  };
  const inspect = (value, parentKey = '') => {
    if (Array.isArray(value)) {
      value.forEach(item => inspect(item, parentKey));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = normalizeKey(key);
      if (normalizedKey === 'env' || normalizedKey === 'environment') {
        assertMapReferences('env', child);
        continue;
      }
      if (normalizedKey === 'headers' || normalizedKey === 'httpheaders') {
        assertMapReferences('headers', child);
        continue;
      }
      if (normalizedKey === 'command' || normalizedKey === 'args') {
        assertCommandReferences(key, child);
        continue;
      }
      if (forbiddenFields.has(normalizedKey) || /(?:token|secret|password|apikey|privatekey)/i.test(normalizedKey)) {
        throw new Error(`Project MCP field ${parentKey ? `${parentKey}.` : ''}${key} must not contain inline secrets`);
      }
      inspect(child, key);
    }
  };
  inspect(spec);
  if (typeof spec.url === 'string') {
    try {
      const parsed = new URL(spec.url);
      if (
        parsed.username
        || parsed.password
        || [...parsed.searchParams.keys()].some(key => sensitiveUrlKey.test(key))
      ) {
        throw new Error('Project MCP URL must not contain inline credentials');
      }
    } catch (error) {
      if (error.message === 'Project MCP URL must not contain inline credentials') throw error;
      if (/\/\/[^/@\s]+(?:\/|$)/.test(spec.url) && /\/\/[^/@\s]+@/.test(spec.url)) {
        throw new Error('Project MCP URL must not contain inline credentials');
      }
      if (/[?&](?:token|secret|password|api[-_]?key|access[-_]?token|authorization|key)=/i.test(spec.url)) {
        throw new Error('Project MCP URL must not contain inline credentials');
      }
    }
  }
}
function sanitizeErrorText(value) {
  return String(value || '')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, '$1?[REDACTED]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:access[_-]?token|api[-_]?key|token|secret|password|authorization|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:access[_-]?token|api[-_]?key|token|secret|password|authorization|key)\s*[:=]\s*)[^,\s}]+/gi, '$1[REDACTED]');
}

function resolveProjectMcpCwd(projectRoot, cwd, fsImpl = fs) {
  const candidate = cwd
    ? (path.isAbsolute(String(cwd)) ? path.resolve(String(cwd)) : path.resolve(projectRoot, String(cwd)))
    : projectRoot;
  const canonical = assertExistingProjectRoot(candidate, fsImpl);
  const relative = path.relative(projectRoot, canonical);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Project MCP cwd must remain inside the project root');
  }
  assertNoSymlinkComponents(projectRoot, canonical, fsImpl);
  return canonical;
}

function unsupportedResource(pathname = null) {
  return {
    supported: false,
    path: pathname,
    exists: false,
    content: '',
    updatedAt: null
  };
}

class ProjectConfigService {
  constructor({
    registry = platformRuntime.getPlatformRegistry(),
    adapters = null,
    validateProjectPath = validateKnownProjectCwd,
    skillServiceFactory = null,
    controlService = null,
    mcpClientFactory = null,
    fsImpl = fs
  } = {}) {
    this.registry = registry;
    this.fs = fsImpl;
    this.validateProjectPath = validateProjectPath;
    this.adapters = adapters || createProjectConfigAdapters({ registry, fsImpl });
    this.skillServiceFactory = skillServiceFactory;
    this.controlService = controlService || (
      PATHS.effectiveControlManifest
        ? new EffectiveControlService({
          store: new ControlManifestStore({
            userPath: PATHS.effectiveControlManifest,
            projectPathResolver: ({ projectPath }) => path.join(projectPath, '.ctx-control.json'),
            fsImpl
          })
        })
        : null
    );
    this.mcpClientFactory = mcpClientFactory;
  }

  getAdapter(platform) {
    const key = normalizePlatform(platform);
    if (!this.registry?.resolve?.(key)) {
      throw new Error(`Unsupported platform: ${key}`);
    }

    const adapter = this.adapters instanceof Map ? this.adapters.get(key) : this.adapters?.[key];
    if (!adapter) throw new Error(`Project configuration is not supported for ${key}`);
    return { key, adapter };
  }

  async _canonicalProjectPath(projectPath) {
    try {
      if (typeof projectPath !== 'string' || !projectPath.trim()) {
        throw new Error('projectPath is required');
      }
      const validated = await this.validateProjectPath(projectPath);
      if (!validated) throw new Error('projectPath is required');
      return assertExistingProjectRoot(validated, this.fs);
    } catch (error) {
      if (error?.message?.startsWith('Invalid project path')) throw error;
      const wrapped = new Error(`Invalid project path: ${error?.message || String(error)}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async _resolve(projectPath, platform) {
    const { key, adapter } = this.getAdapter(platform);
    const projectRoot = await this._canonicalProjectPath(projectPath);
    return { key, adapter, projectRoot };
  }

  async readInstruction(projectPath, platform) {
    const { adapter, projectRoot } = await this._resolve(projectPath, platform);
    return adapter.readInstruction(projectRoot);
  }

  async writeInstruction(projectPath, platform, content) {
    if (typeof content !== 'string') throw new Error('Instruction content must be a string');
    const { adapter, projectRoot } = await this._resolve(projectPath, platform);
    return adapter.writeInstruction(projectRoot, content);
  }

  async deleteInstruction(projectPath, platform) {
    const { adapter, projectRoot } = await this._resolve(projectPath, platform);
    return adapter.deleteInstruction(projectRoot);
  }




  async listProjectSkills(projectPath, platform) {
    const { key, adapter, projectRoot } = await this._resolve(projectPath, platform);
    const description = adapter.describe().skills;
    if (!description.supported) {
      return { supported: false, project: [], inherited: [], path: null };
    }

    const service = this.skillServiceFactory
      ? this.skillServiceFactory(key, { registry: this.registry })
      : new (require('./skill-service').SkillService)(key, { registry: this.registry });
    const scanResult = typeof service.scanSkills === 'function'
      ? await service.scanSkills({ scope: 'project', cwd: projectRoot })
      : { skills: await service.listSkills(false, { scope: 'project', cwd: projectRoot }) };
    const skills = scanResult.skills || [];
    const project = skills.filter(skill => skill.scope === 'project' || skill.sourceScope === 'project');
    const inherited = skills.filter(skill => skill.scope === 'user' || skill.sourceScope === 'user');
    return {
      supported: true,
      project,
      inherited,
      path: description.canonicalRoot,
      platform: key,
      ...(scanResult.refresh ? { refresh: scanResult.refresh } : {})
    };
  }

  async setProjectSkillEnabled(projectPath, platform, controlKey, enabled) {
    if (!controlKey || !String(controlKey).trim()) {
      throw new Error('Skill controlKey is required');
    }
    const { key, projectRoot } = await this._resolve(projectPath, platform);
    const service = this.skillServiceFactory
      ? this.skillServiceFactory(key, { registry: this.registry })
      : new (require('./skill-service').SkillService)(key, { registry: this.registry });
    const controlService = service.controlService || this.controlService;
    if (!controlService || typeof controlService.setSkillEnabled !== 'function') {
      throw new Error('Effective control service is unavailable');
    }
    return controlService.setSkillEnabled({
      platform: key,
      controlKey: String(controlKey).trim(),
      scope: 'project',
      projectPath: projectRoot,
      enabled: enabled === true
    });
  }


  async listProjectMcp(projectPath, platform) {
    const { key, adapter, projectRoot } = await this._resolve(projectPath, platform);
    const description = adapter.describe().mcp;
    const result = adapter.readProjectMcp(projectRoot);
    const servers = (result.servers || []).map(server => {
      const controlKey = `mcp:${key}:project:${server.id}`;
      let controlled = this.controlService?.getMcp?.(controlKey, {
        scope: 'project',
        projectPath: projectRoot
      }) || null;
      if (!controlled && this.controlService?.registerMcp) {
        controlled = this.controlService.registerMcp({
          kind: 'mcp',
          controlKey,
          platform: key,
          scope: 'project',
          projectPath: projectRoot,
          name: server.id,
          source: 'project-native',
          enabled: server.enabled !== false,
          trust: 'approved',
          ...deriveMcpPolicy({ transport: server.server?.type, scope: 'project' }),
          secretRefs: secretRefsForMcpSpec(server.server || {}),
          managed: false
        });
      }
      return {
        ...redactSecrets({ ...server, scope: 'project' }),
        controlKey,
        managed: controlled?.managed === true,
        external: controlled ? controlled.managed !== true : true,
        riskTier: controlled?.riskTier || deriveMcpPolicy({ transport: server.server?.type, scope: 'project' }).riskTier,
        egressProfile: controlled?.egressProfile || deriveMcpPolicy({ transport: server.server?.type, scope: 'project' }).egressProfile,
        trust: controlled?.trust || 'approved',
        enabled: controlled?.managed === true
          ? controlled.enabled === true
          : server.enabled !== false
      };
    });
    return {
      supported: result.supported !== undefined ? result.supported : description.supported,
      path: result.path ?? description.path,
      format: result.format || description.format,
      servers
    };
  }

  async upsertProjectMcp(projectPath, platform, id, spec) {
    const normalizedId = validateMcpId(id);
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new Error('MCP server spec must be an object');
    }
    const { key, adapter, projectRoot } = await this._resolve(projectPath, platform);
    const existingSpec = adapter.readProjectMcpSpec(projectRoot, normalizedId) || {};
    const controlKey = `mcp:${key}:project:${normalizedId}`;
    const existingControl = this.controlService?.getMcp?.(controlKey, {
      scope: 'project',
      projectPath: projectRoot
    }) || null;
    if ((existingControl && existingControl.managed !== true) || (!existingControl && Object.keys(existingSpec).length > 0)) {
      return {
        success: false,
        status: 'unsupported',
        external: true,
        managed: false,
        id: normalizedId,
        scope: 'project'
      };
    }
    const { validateServerSpec } = require('./mcp-service');
    const mergedSpec = mergeMcpPatch(existingSpec, spec);
    assertProjectSecretReferences(mergedSpec);
    validateServerSpec(mergedSpec);
    const result = adapter.upsertProjectMcp(projectRoot, normalizedId, spec);
    if (this.controlService?.registerMcp) {
      const persistedSpec = adapter.readProjectMcpSpec(projectRoot, normalizedId) || {};
      const managed = existingControl
        ? existingControl.managed === true
        : Object.keys(existingSpec).length === 0;
      this.controlService.registerMcp({
        ...(existingControl || {}),
        kind: 'mcp',
        controlKey,
        platform: key,
        scope: 'project',
        projectPath: projectRoot,
        name: normalizedId,
        source: existingControl?.source || 'project-native',
        enabled: existingControl ? existingControl.enabled === true : result.enabled !== false,
        trust: existingControl?.trust || 'approved',
        ...deriveMcpPolicy({ transport: persistedSpec?.type, scope: 'project' }),
        secretRefs: secretRefsForMcpSpec(persistedSpec),
        managed
      });
    }
    return redactSecrets({ ...result, id: normalizedId, scope: 'project' });
  }

  async removeProjectMcp(projectPath, platform, id) {
    const normalizedId = validateMcpId(id);
    const { key, adapter, projectRoot } = await this._resolve(projectPath, platform);
    const controlKey = `mcp:${key}:project:${normalizedId}`;
    const controlled = this.controlService?.getMcp?.(controlKey, {
      scope: 'project',
      projectPath: projectRoot
    }) || null;
    if (!controlled || controlled.managed !== true) {
      return {
        success: false,
        status: 'unsupported',
        external: true,
        managed: false,
        id: normalizedId,
        scope: 'project'
      };
    }
    const result = adapter.removeProjectMcp(projectRoot, normalizedId);
    this.controlService?.removeMcp?.({
      controlKey,
      scope: 'project',
      projectPath: projectRoot
    });
    return redactSecrets({ ...result, id: normalizedId, scope: 'project' });
  }
  async testProjectMcp(projectPath, platform, id) {
    const normalizedId = validateMcpId(id);
    const { key, adapter, projectRoot } = await this._resolve(projectPath, platform);
    const description = adapter.describe().mcp;
    if (!description.supported) {
      return { success: false, status: 'unsupported', platform: key, id: normalizedId };
    }
    const spec = adapter.readProjectMcpSpec(projectRoot, normalizedId);
    if (!spec) throw new Error(`MCP server "${normalizedId}" is not configured for this project`);
    const effectiveSpec = { ...spec };
    if ((effectiveSpec.type || 'stdio') === 'stdio') {
      effectiveSpec.cwd = resolveProjectMcpCwd(projectRoot, effectiveSpec.cwd, this.fs);
    }
    const controlKey = `mcp:${key}:project:${normalizedId}`;
    const control = this.controlService?.getMcp?.(controlKey, {
      scope: 'project',
      projectPath: projectRoot
    });
    if (!control || control.managed !== true || control.trust !== 'approved' || control.enabled !== true) {
      const error = new Error('MCP server is disabled by the effective control policy');
      error.code = 'MCP_DISABLED';
      throw error;
    }
    const client = this.mcpClientFactory
      ? this.mcpClientFactory(effectiveSpec, { projectPath: projectRoot, platform: key })
      : new (require('./mcp-client').McpClient)(effectiveSpec);
    const startedAt = Date.now();

    try {
      await client.connect();
      if (typeof client.initialize === 'function') {
        await client.initialize();
      }
      const tools = typeof client.listTools === 'function' ? await client.listTools() : [];
      return {
        success: true,
        platform: key,
        id: normalizedId,
        scope: 'project',
        tools: Array.isArray(tools) ? tools.map(tool => ({ name: tool.name })) : [],
        duration: Date.now() - startedAt
      };
    } catch (error) {
      return {
        success: false,
        platform: key,
        id: normalizedId,
        scope: 'project',
        message: sanitizeErrorText(error.message),
        duration: Date.now() - startedAt
      };
    } finally {
      try {
        if (typeof client.disconnect === 'function') {
          await client.disconnect();
        } else {
          await client.close?.();
        }
      } catch (_) {}
    }
  }

  async getSnapshot(projectPath, platform) {
    const { key, adapter, projectRoot } = await this._resolve(projectPath, platform);
    const description = adapter.describe();
    const instruction = adapter.readInstruction(projectRoot);
    const mcp = await this.listProjectMcp(projectRoot, key);
    const skills = description.skills?.supported !== false
      ? await this.listProjectSkills(projectRoot, key)
      : { supported: false, project: [], inherited: [], path: null };

    return {
      success: true,
      projectPath: projectRoot,
      platform: key,
      instruction,
      skills,
      mcp: {
        supported: mcp.supported !== undefined ? mcp.supported : description.mcp?.supported === true,
        path: mcp.path ?? description.mcp?.path ?? null,
        format: mcp.format || description.mcp?.format || 'none',
        servers: (mcp.servers || []).map(server => redactSecrets({ ...server, scope: 'project' }))
      },
      capabilities: {
        instruction: description.instruction?.supported === true,
        skills: description.skills?.supported === true,
        mcp: description.mcp?.supported === true
      }
    };
  }
}

module.exports = {
  ProjectConfigService,
  PROJECT_SCOPES
};
