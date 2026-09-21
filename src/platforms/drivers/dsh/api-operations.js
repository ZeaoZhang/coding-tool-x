'use strict';

const { createDriver: createNativeConfigDriver } = require('./native-config');
const { createDriver: createProjectsDriver } = require('./projects');
const { createDriver: createSessionsDriver } = require('./sessions');
const { listProfiles, listProfilePlugins, listProfileCapabilities, listProfileMcp, listProfilePrompts, listPlugins, upsertProfilePatchRow, deleteProfilePatchRow } = require('./common');
const { listSkills, getSkill, createSkill, updateSkill, deleteSkill } = require('./resources');
const { installPlugin, uninstallPlugin, updatePlugin } = require('./plugin-manager');
const { createDriver: createChannelsDriver } = require('./channels');
const { createDriver: createProxyDriver } = require('./proxy');
const { createDriver: createStatisticsDriver } = require('./statistics');

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
    capability: route.capability || context.capability || 'api',
    operation: route.operation || context.operation
  };
  if (status === 'ok') result.data = data;
  if (error) result.error = error instanceof Error ? error.message : String(error);
  if (cause) Object.defineProperty(result, 'cause', { value: cause, enumerable: false });
  return result;
}

function resolveProfileName(context = {}, requested = '') {
  const profiles = listProfiles(context);
  const requestedName = String(requested || '').trim();
  if (requestedName) return requestedName;
  const envProfile = String(process.env.DSH_PROFILE || '').trim();
  if (envProfile && profiles.some(profile => profile.name === envProfile)) return envProfile;
  return profiles.find(profile => profile.name === 'default')?.name || profiles[0]?.name || null;
}

function profileNameForRequest(context = {}, request = {}) {
  return resolveProfileName(
    context,
    request.profile
      || request.query?.profile
      || request.body?.profile
      || request.params?.profileName
  );
}

function dshMcpConfigToSpec(config = {}) {
  const transport = config.transport === 'streamable-http' ? 'streamable_http' : config.transport || 'stdio';
  const spec = { type: transport };
  if (transport === 'stdio') {
    if (config.command) spec.command = config.command;
    if (Array.isArray(config.args)) spec.args = [...config.args];
    if (config.env && typeof config.env === 'object') spec.env = { ...config.env };
  } else {
    if (config.url) spec.url = config.url;
    if (config.headers && typeof config.headers === 'object') spec.headers = { ...config.headers };
  }
  return spec;
}

function dshMcpSpecToConfig(spec = {}, serverName) {
  const type = spec.type === 'streamable_http' ? 'streamable-http' : spec.type || 'stdio';
  if (!['stdio', 'streamable-http'].includes(type)) {
    throw new Error(`DSH MCP does not support transport: ${spec.type || type}`);
  }
  const config = { serverName, transport: type };
  if (type === 'stdio') {
    if (spec.command) config.command = spec.command;
    if (Array.isArray(spec.args)) config.args = [...spec.args];
    if (spec.env && typeof spec.env === 'object') config.env = { ...spec.env };
  } else {
    if (spec.url) config.url = spec.url;
    if (spec.headers && typeof spec.headers === 'object') config.headers = { ...spec.headers };
  }
  return config;
}

function readDshMcpEntries(context = {}) {
  const profile = resolveProfileName(context);
  if (!profile) return {};
  const result = listProfileMcp(context, profile);
  const entries = {};
  for (const server of result?.servers || []) {
    if (!server?.id || server.disabled) continue;
    entries[server.id] = dshMcpConfigToSpec(server.config || {});
  }
  return entries;
}

function promptContentFromDshConfig(config = {}) {
  for (const key of ['content', 'prompt', 'text']) {
    if (typeof config[key] === 'string') return config[key];
  }
  return [config.personaPrefix, config.personaSuffix]
    .filter(value => typeof value === 'string' && value.trim())
    .join('\n')
    .trim();
}

function readDshPrompt(context = {}) {
  const profile = resolveProfileName(context);
  if (!profile) return '';
  const result = listProfilePrompts(context, profile);
  const prompt = [...(result?.prompts || [])]
    .filter(entry => entry && entry.disabled !== true)
    .pop();
  return promptContentFromDshConfig(prompt?.config || {});
}

function dshCapabilityContext(context, capability, operation) {
  return { ...context, capability, operation };
}

function createDriver(context = {}) {
  const native = createNativeConfigDriver(context);
  const projects = createProjectsDriver(context);
  const sessions = createSessionsDriver(context);
  const channels = createChannelsDriver(context);
  const proxy = createProxyDriver(context);
  const statistics = createStatisticsDriver(context);
  const driver = {
    ...projects,
    ...sessions,
    platform: 'dsh',
    capability: context.capability || 'api'
  };

  // Keep the aggregate DSH API driver compatible with the manifest consistency
  // contract. Actual descriptor requests are still dispatched by capability.
  for (const operation of ['list', 'current', 'enabled', 'create', 'update', 'remove', 'applyToSettings', 'sync', 'order', 'models', 'probeModels', 'speedTest']) {
    driver[operation] = (...args) => channels[operation](...args);
  }
  for (const operation of ['status', 'start', 'stop']) {
    driver[operation] = (...args) => proxy[operation](...args);
  }
  for (const operation of ['summary', 'today', 'daily']) {
    driver[operation] = (...args) => statistics[operation](...args);
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

  if (context.capability === 'mcp') {
    const mcpContext = operation => dshCapabilityContext(context, 'mcp', operation);
    driver.entries = () => resultFor(mcpContext('entries'), 'ok', readDshMcpEntries(context));
    driver.read = () => resultFor(mcpContext('read'), 'ok', { mcpServers: readDshMcpEntries(context) });
    driver.normalize = spec => resultFor(mcpContext('normalize'), 'ok', spec);
    driver.sync = async server => {
    const profileName = profileNameForRequest(context, server);
    const id = String(server?.id || '').trim();
    if (!id) throw new Error('MCP server id is required');
    const patch = requirePatchResult(
      upsertProfilePatchRow(context, profileName, {
        id,
        name: '@deepseek-ai/dsh-mcp-client',
        config: dshMcpSpecToConfig(server.server || {}, id)
      }),
      profileName
    );
    return resultFor(mcpContext('sync'), 'ok', patch);
  };
  driver.remove = async serverId => {
    const profileName = profileNameForRequest(context);
    const id = String(serverId || '').trim();
    if (!id) throw new Error('MCP server id is required');
    if (!profileName) return resultFor(mcpContext('remove'), 'ok', true);
    const patch = requirePatchResult(deleteProfilePatchRow(context, profileName, id), profileName);
    return resultFor(mcpContext('remove'), 'ok', patch);
  };
    driver.import = async servers => {
    const entries = readDshMcpEntries(context);
    let count = 0;
    for (const [id, spec] of Object.entries(entries)) {
      if (servers[id]) {
        servers[id].apps = { ...(servers[id].apps || {}), dsh: true };
        continue;
      }
      const now = Date.now();
      servers[id] = {
        id,
        name: id,
        server: spec,
        apps: { dsh: true },
        createdAt: now,
        updatedAt: now
      };
      count++;
    }
    return resultFor(mcpContext('import'), 'ok', count);
    };
  }

  if (context.capability === 'prompts') {
    const promptContext = operation => dshCapabilityContext(context, 'prompts', operation);
    driver.read = () => resultFor(promptContext('read'), 'ok', readDshPrompt(context));
    driver.write = async content => {
    const profileName = profileNameForRequest(context);
    if (!profileName) throw new Error('No DSH profile is available');
    if (typeof content !== 'string') throw new Error('Prompt text must be a string');
    const patch = requirePatchResult(
      upsertProfilePatchRow(context, profileName, {
        id: 'system-prompt',
        name: '@deepseek-ai/dsh-system-prompt',
        config: { personaPrefix: content }
      }),
      profileName
    );
    return resultFor(promptContext('write'), 'ok', patch);
    };
    driver.remove = async () => {
    const profileName = profileNameForRequest(context);
    if (!profileName) return resultFor(promptContext('remove'), 'ok', true);
    const patch = requirePatchResult(
      deleteProfilePatchRow(context, profileName, 'system-prompt'),
      profileName
    );
    return resultFor(promptContext('remove'), 'ok', patch);
    };
  }

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
