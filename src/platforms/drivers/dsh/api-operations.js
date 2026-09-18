'use strict';

const { createDriver: createNativeConfigDriver } = require('./native-config');
const { createDriver: createProjectsDriver } = require('./projects');
const { createDriver: createSessionsDriver } = require('./sessions');
const { listProfiles, listProfilePlugins, listProfileCapabilities, listProfileMcp, listProfilePrompts, listPlugins, upsertProfilePatchRow, deleteProfilePatchRow } = require('./common');
const { listSkills, getSkill, createSkill, updateSkill, deleteSkill } = require('./resources');
const { installPlugin, uninstallPlugin, updatePlugin } = require('./plugin-manager');
const { createDriver: createChannelsDriver } = require('./channels');
const { createDriver: createProxyDriver } = require('./proxy');

function requiredId(value, label) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error(`${label} must be a safe identifier`);
  return id;
}

function profilePatchOptions(request = {}) {
  const body = request.body || {};
  return { expectedRevision: body.expectedRevision };
}

function mcpConfigFromRequest(request = {}) {
  const body = request.body || {};
  const source = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config : body;
  const config = { ...source };
  delete config.id;
  delete config.name;
  delete config.profile;
  delete config.expectedRevision;
  delete config.enabled;
  delete config.disabled;
  delete config.scope;
  delete config.cwd;
  if (!['stdio', 'streamable-http'].includes(config.transport)) throw new Error('MCP transport must be stdio or streamable-http');
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(config.serverName || '').trim())) throw new Error('MCP serverName must be 1-32 ASCII letters, digits, underscores, or hyphens');
  return config;
}

function promptConfigFromRequest(request = {}) {
  const body = request.body || {};
  const source = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config : body;
  const config = { ...source };
  delete config.id;
  delete config.name;
  delete config.profile;
  delete config.expectedRevision;
  delete config.enabled;
  delete config.disabled;
  delete config.scope;
  delete config.cwd;
  return config;
}

function patchResult(context, request, profileName, operation, patch) {
  return {
    profile: profileName,
    operation,
    patch,
    mcp: listProfileMcp(context, profileName),
    prompts: listProfilePrompts(context, profileName)
  };
}

function requirePatchResult(patch, profileName) {
  if (patch) return patch;
  const error = new Error(`DSH profile not found: ${profileName}`);
  error.statusCode = 404;
  throw error;
}

function resultFor(context = {}, status, data, error, cause) {
  const route = context.route || {};
  const result = {
    status,
    platform: context.platform || 'dsh',
    capability: route.capability || 'api',
    operation: route.operation || context.operation
  };
  if (status === 'ok') result.data = data;
  if (error) result.error = error instanceof Error ? error.message : String(error);
  if (cause) Object.defineProperty(result, 'cause', { value: cause, enumerable: false });
  return result;
}

function createDriver(context = {}) {
  const native = createNativeConfigDriver(context);
  const projects = createProjectsDriver(context);
  const sessions = createSessionsDriver(context);
  const channels = createChannelsDriver(context);
  const proxy = createProxyDriver(context);
  const driver = {
    ...projects,
    ...sessions,
    platform: 'dsh',
    capability: 'api'
  };

  // Keep the aggregate DSH API driver compatible with the manifest consistency
  // contract. Actual descriptor requests are still dispatched by capability.
  for (const operation of ['list', 'current', 'enabled', 'create', 'update', 'remove', 'applyToSettings', 'sync', 'order']) {
    driver[operation] = (...args) => channels[operation](...args);
  }
  for (const operation of ['status', 'start', 'stop']) {
    driver[operation] = (...args) => proxy[operation](...args);
  }

  driver.getConfig = async request => resultFor(request, 'ok', native.getConfig());
  driver.updateConfig = async request => {
    try {
      return resultFor(request, 'ok', native.updateConfig(request));
    } catch (error) {
      return resultFor(request, error.statusCode === 409 ? 'conflict' : 'failed', undefined, error, error);
    }
  };
  driver.getConfigCapabilities = async request => resultFor(request, 'ok', native.getConfigCapabilities());
  driver.getConfigAuthProviders = async request => resultFor(request, 'ok', native.getConfigAuthProviders());
  driver.getConfigResources = async request => resultFor(request, 'ok', native.getConfigResources(request));
  driver.listProfiles = async request => resultFor(request, 'ok', { profiles: listProfiles(context) });
  driver.listPlugins = request => resultFor(request, 'ok', listPlugins(context));
  driver.listProfilePlugins = async (request = {}) => {
    const profile = request.params?.profileName;
    const result = listProfilePlugins(context, profile);
    return result ? resultFor(request, 'ok', result) : resultFor(request, 'unsupported');
  };
  driver.listProfileCapabilities = async (request = {}) => {
    const profile = request.params?.profileName;
    const result = listProfileCapabilities(context, profile);
    return result ? resultFor(request, 'ok', result) : resultFor(request, 'unsupported');
  };
  driver.listProfileMcp = async (request = {}) => {
    const profile = request.params?.profileName;
    const result = listProfileMcp(context, profile);
    return result ? resultFor(request, 'ok', result) : resultFor(request, 'unsupported');
  };
  driver.listProfilePrompts = async (request = {}) => {
    const profile = request.params?.profileName;
    const result = listProfilePrompts(context, profile);
    return result ? resultFor(request, 'ok', result) : resultFor(request, 'unsupported');
  };
  driver.installPlugin = async (request = {}) => {
    const result = await installPlugin(context, request);
    return resultFor(request, 'ok', result);
  };
  driver.uninstallPlugin = async (request = {}) => {
    const result = await uninstallPlugin(context, request);
    return resultFor(request, 'ok', result);
  };
  driver.updatePlugin = async (request = {}) => {
    const result = await updatePlugin(context, request);
    return resultFor(request, 'ok', result);
  };
  driver.upsertMcp = async (request = {}) => {
    const profileName = request.params?.profileName;
    const body = request.body || {};
    const config = mcpConfigFromRequest(request);
    const serverName = String(config.serverName).trim();
    const id = requiredId(request.params?.serverId || body.id || `mcp-${serverName}`, 'MCP id');
    const entry = {
      id,
      name: '@deepseek-ai/dsh-mcp-client',
      ...(body.disabled === true || body.enabled === false ? { disabled: true } : {}),
      config
    };
    const patch = requirePatchResult(
      upsertProfilePatchRow(context, profileName, entry, profilePatchOptions(request)),
      profileName
    );
    return resultFor(request, 'ok', patchResult(context, request, profileName, 'upsertMcp', patch));
  };
  driver.deleteMcp = async (request = {}) => {
    const profileName = request.params?.profileName;
    const body = request.body || {};
    const id = requiredId(request.params?.serverId || body.id, 'MCP id');
    const patch = requirePatchResult(
      deleteProfilePatchRow(context, profileName, id, profilePatchOptions(request)),
      profileName
    );
    return resultFor(request, 'ok', patchResult(context, request, profileName, 'deleteMcp', patch));
  };
  driver.upsertPrompt = async (request = {}) => {
    const profileName = request.params?.profileName;
    const body = request.body || {};
    const id = requiredId(request.params?.promptId || body.id, 'prompt id');
    const patch = requirePatchResult(
      upsertProfilePatchRow(context, profileName, {
        id,
        name: '@deepseek-ai/dsh-system-prompt',
        ...(body.disabled === true || body.enabled === false ? { disabled: true } : {}),
        config: promptConfigFromRequest(request)
      }, profilePatchOptions(request)),
      profileName
    );
    return resultFor(request, 'ok', patchResult(context, request, profileName, 'upsertPrompt', patch));
  };
  driver.deletePrompt = async (request = {}) => {
    const profileName = request.params?.profileName;
    const body = request.body || {};
    const id = requiredId(request.params?.promptId || body.id, 'prompt id');
    const patch = requirePatchResult(
      deleteProfilePatchRow(context, profileName, id, profilePatchOptions(request)),
      profileName
    );
    return resultFor(request, 'ok', patchResult(context, request, profileName, 'deletePrompt', patch));
  };
  driver.listSkills = async (request = {}) => resultFor(request, 'ok', listSkills(context, {
    profile: request.query?.profile,
    cwd: request.query?.cwd,
    scope: request.query?.scope,
    includeContent: request.query?.includeContent === '1'
  }));
  driver.getSkill = async (request = {}) => {
    const result = getSkill(context, request.query?.profile, request.params?.skillName, {
      cwd: request.query?.cwd,
      scope: request.query?.scope
    });
    return result ? resultFor(request, 'ok', result) : resultFor(request, 'unsupported');
  };
  driver.createSkill = async (request = {}) => resultFor(request, 'ok', createSkill(context, request));
  driver.updateSkill = async (request = {}) => resultFor(request, 'ok', updateSkill(context, request));
  driver.deleteSkill = async (request = {}) => resultFor(request, 'ok', deleteSkill(context, request));

  return driver;
}

module.exports = { createDriver };
