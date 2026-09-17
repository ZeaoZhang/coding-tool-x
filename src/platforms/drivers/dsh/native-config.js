'use strict';

const fs = require('fs');
const { resolvePaths, readYamlFile, writeAtomic, dumpYaml, mergeSettings, fileRevision, credentialMetadata, redactSecrets, listProfiles, listProfilePlugins, listProfileMcp, listProfilePrompts } = require('./common');
const { resolveSkillRoots } = require('./resources');

function createDriver(context = {}) {
  const paths = resolvePaths(context);
  return {
    platform: 'dsh',
    capability: 'nativeConfig',
    getConfig() {
      return {
        settings: {
          path: paths.settings,
          exists: fs.existsSync(paths.settings),
          revision: fileRevision(paths.settings),
          namespaces: redactSecrets(readYamlFile(paths.settings, {}))
        },
        credentials: credentialMetadata(paths.credentials),
        sessions: {
          root: paths.sessions,
          exists: fs.existsSync(paths.sessions)
        },
        home: paths.dir
      };
    },
    updateConfig(request = {}) {
      const body = request.body || request;
      const currentRevision = fileRevision(paths.settings);
      if (body.expectedRevision !== undefined && body.expectedRevision !== currentRevision) {
        const error = new Error('DSH settings changed on disk; reload before updating');
        error.statusCode = 409;
        throw error;
      }
      const current = readYamlFile(paths.settings, {});
      const next = mergeSettings(current, body.namespace, body.patch, body.replace === true);
      writeAtomic(paths.settings, dumpYaml(next), 0o600);
      return this.getConfig();
    },
    getConfigCapabilities() {
      return {
        platform: 'dsh',
        settings: { read: true, update: true, patch: true },
        credentials: { readMetadata: true, values: false, update: false },
        sessions: { read: true, write: false },
        skills: { inspect: true, read: true, create: true, update: true, remove: true },
        plugins: { inspect: true, install: true, remove: true, update: true, enable: false, disable: false },
        mcp: { inspect: true, create: true, update: true, remove: true, connect: false },
        prompts: { inspect: true, create: true, update: true, remove: true }
      };
    },
    getConfigResources(request = {}) {
      const profileName = request.query?.profile || null;
      const skillRoots = resolveSkillRoots(context, {
        profile: profileName,
        cwd: request.query?.cwd
      });
      const profiles = listProfiles(context).map(profile => {
        const plugins = listProfilePlugins(context, profile.name);
        const mcp = listProfileMcp(context, profile.name);
        const prompts = listProfilePrompts(context, profile.name);
        return {
          name: profile.name,
          pluginCount: plugins?.plugins?.length || 0,
          mcpCount: mcp?.servers?.length || 0,
          promptCount: prompts?.prompts?.length || 0
        };
      });
      return {
        platform: 'dsh',
        paths: { ...paths },
        profiles,
        skills: {
          read: true,
          create: true,
          update: true,
          remove: true,
          roots: skillRoots.roots.map(root => ({ path: root.path, source: root.source }))
        },
        plugins: { inspect: true, management: 'ctx+dsh-plugin' },
        mcp: { inspect: true, management: 'ctx-patch' },
        prompts: { inspect: true, management: 'ctx-patch' }
      };
    },
    getConfigAuthProviders() {
      const metadata = credentialMetadata(paths.credentials);
      return { platform: 'dsh', credentials: metadata, providers: metadata.refs };
    }
  };
}

module.exports = { createDriver };
