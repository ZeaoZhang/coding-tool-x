'use strict';

const fs = require('fs');
const path = require('path');
const platformRuntime = require('../../platforms/runtime');
const { validateKnownProjectCwd } = require('./project-path-validation');
const {
  assertExistingProjectRoot,
  redactSecrets
} = require('./project-config-adapters/shared');
const { createProjectConfigAdapters } = require('./project-config-adapters');

const PROJECT_SCOPES = new Set(['user', 'project']);

function normalizePlatform(platform) {
  const normalized = String(platform || '').trim().toLowerCase();
  if (!normalized) throw new Error('Platform is required');
  return normalized;
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
    mcpClientFactory = null,
    fsImpl = fs
  } = {}) {
    this.registry = registry;
    this.fs = fsImpl;
    this.validateProjectPath = validateProjectPath;
    this.adapters = adapters || createProjectConfigAdapters({ registry, fsImpl });
    this.skillServiceFactory = skillServiceFactory;
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

    if (!this.skillServiceFactory) {
      return {
        supported: true,
        project: [],
        inherited: [],
        path: description.canonicalRoot,
        platform: key
      };
    }

    const service = this.skillServiceFactory(key, { registry: this.registry });
    const skills = await service.listSkills(false, { scope: 'project', cwd: projectRoot });
    const project = skills.filter(skill => skill.scope === 'project' || skill.sourceScope === 'project');
    const inherited = skills.filter(skill => skill.scope === 'user' || skill.sourceScope === 'user');
    return {
      supported: true,
      project,
      inherited,
      path: description.canonicalRoot,
      platform: key
    };
  }

  async installProjectSkill(projectPath, platform, input = {}) {
    const { key, projectRoot } = await this._resolve(projectPath, platform);
    const service = this.skillServiceFactory
      ? this.skillServiceFactory(key, { registry: this.registry })
      : new (require('./skill-service').SkillService)(key, { registry: this.registry });
    const options = { scope: 'project', cwd: projectRoot };
    const directory = input.directory || input.name;
    if (!directory) throw new Error('Skill directory is required');

    if (input.repo) {
      return service.installSkill(directory, input.repo, input.fullDirectory || null, options);
    }
    return service.installLocalSkill(directory, options);
  }

  async removeProjectSkill(projectPath, platform, directory) {
    const { key, projectRoot } = await this._resolve(projectPath, platform);
    if (!directory) throw new Error('Skill directory is required');
    const service = this.skillServiceFactory
      ? this.skillServiceFactory(key, { registry: this.registry })
      : new (require('./skill-service').SkillService)(key, { registry: this.registry });
    return service.uninstallSkill(directory, { scope: 'project', cwd: projectRoot });
  }

  async listProjectMcp(projectPath, platform) {
    const { adapter, projectRoot } = await this._resolve(projectPath, platform);
    const description = adapter.describe().mcp;
    const result = adapter.readProjectMcp(projectRoot);
    return {
      supported: result.supported !== undefined ? result.supported : description.supported,
      path: result.path ?? description.path,
      format: result.format || description.format,
      servers: (result.servers || []).map(server => redactSecrets({ ...server, scope: 'project' }))
    };
  }

  async upsertProjectMcp(projectPath, platform, id, spec) {
    if (!id || !String(id).trim()) throw new Error('MCP server ID is required');
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new Error('MCP server spec must be an object');
    }
    const { validateServerSpec } = require('./mcp-service');
    validateServerSpec(spec);
    const { adapter, projectRoot } = await this._resolve(projectPath, platform);
    const result = adapter.upsertProjectMcp(projectRoot, String(id).trim(), spec);
    return redactSecrets({ ...result, id: String(id).trim(), scope: 'project' });
  }

  async removeProjectMcp(projectPath, platform, id) {
    if (!id || !String(id).trim()) throw new Error('MCP server ID is required');
    const { adapter, projectRoot } = await this._resolve(projectPath, platform);
    const result = adapter.removeProjectMcp(projectRoot, String(id).trim());
    return redactSecrets({ ...result, id: String(id).trim(), scope: 'project' });
  }

  async testProjectMcp(projectPath, platform, id) {
    if (!id || !String(id).trim()) throw new Error('MCP server ID is required');
    const { key, adapter, projectRoot } = await this._resolve(projectPath, platform);
    const description = adapter.describe().mcp;
    if (!description.supported) {
      return { success: false, status: 'unsupported', platform: key, id: String(id).trim() };
    }

    const spec = adapter.readProjectMcpSpec(projectRoot, String(id).trim());
    if (!spec) throw new Error(`MCP server "${id}" is not configured for this project`);
    const effectiveSpec = { ...spec };
    if ((effectiveSpec.type || 'stdio') === 'stdio' && !effectiveSpec.cwd) {
      effectiveSpec.cwd = projectRoot;
    }
    const client = this.mcpClientFactory
      ? this.mcpClientFactory(effectiveSpec, { projectPath: projectRoot, platform: key })
      : new (require('./mcp-client').McpClient)(effectiveSpec);
    const startedAt = Date.now();

    try {
      await client.connect();
      const tools = typeof client.listTools === 'function' ? await client.listTools() : [];
      return {
        success: true,
        platform: key,
        id: String(id).trim(),
        scope: 'project',
        tools: Array.isArray(tools) ? tools.map(tool => ({ name: tool.name })) : [],
        duration: Date.now() - startedAt
      };
    } catch (error) {
      return {
        success: false,
        platform: key,
        id: String(id).trim(),
        scope: 'project',
        message: error.message,
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
    const mcp = adapter.readProjectMcp(projectRoot);
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
