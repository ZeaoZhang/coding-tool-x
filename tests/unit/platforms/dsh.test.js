'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const { once } = require('events');

const { createPlatformRegistry } = require('../../../src/platforms/registry');
const { createPlatformRuntime } = require('../../../src/platforms/runtime');
const { getDriverRegistry } = require('../../../src/platforms/driver-registry');
const { createDriver: createConfigDriver } = require('../../../src/platforms/drivers/dsh/native-config');
const { createDriver: createSessionDriver, projectNameFor } = require('../../../src/platforms/drivers/dsh/sessions');
const { createDriver: createApiDriver } = require('../../../src/platforms/drivers/dsh/api-operations');
const { createDriver: createChannelDriver } = require('../../../src/platforms/drivers/dsh/channels');
const { createDriver: createProxyDriver } = require('../../../src/platforms/drivers/dsh/proxy');
const { createDriver: createNativeLogDriver } = require('../../../src/platforms/drivers/dsh/native-logs');
const { listSkills } = require('../../../src/platforms/drivers/dsh/resources');
const { createPlatformRouter } = require('../../../src/server/api/platforms');
const { SkillService } = require('../../../src/server/services/skill-service');
const { PluginsService } = require('../../../src/server/services/plugins-service');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-dsh-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeZstdLog(filePath, header, events) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const frames = [header, ...events].map(record => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(record)}\n`)));
  fs.writeFileSync(filePath, Buffer.concat(frames));
}

function dshPaths(home) {
  return {
    dir: home,
    settings: path.join(home, 'settings.yaml'),
    credentials: path.join(home, '.credentials.yaml'),
    sessions: path.join(home, 'sessions'),
    profiles: path.join(home, 'profiles'),
    patch: path.join(home, 'cordis.patch.yml')
  };
}

describe('DSH platform integration', () => {
  let tempHome;

  afterEach(() => {
    if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  });

  test('publishes DSH as a config/session platform without generic resource plugins', () => {
    const registry = createPlatformRegistry({ userFile: { platforms: [] } });
    const manifest = registry.resolve('dsh');

    expect(manifest).toEqual(expect.objectContaining({
      key: 'dsh',
      defaultEnabled: false,
      cliSelectable: false,
      resourceTypes: expect.objectContaining({ skills: true, commands: false, agents: false, plugins: true })
    }));
    expect(registry.getCapability('dsh', 'projects')).toBe('dsh-projects');
    expect(registry.getCapability('dsh', 'sessions')).toBe('dsh-sessions');
    expect(registry.getCapability('dsh', 'api')).toBe('dsh-api');
    expect(registry.getCapability('dsh', 'statistics')).toBe('dsh-statistics');
    expect(registry.getCapability('dsh', 'nativeLogs')).toBe('dsh-native-logs');

    tempHome = makeTempHome();
    const dshHome = path.join(tempHome, 'dsh-home');
    expect(registry.resolvePaths('dsh', { homeDir: tempHome, env: { DSH_HOME: dshHome } }).home).toBe(dshHome);
  });

  test('streams DSH usage events from appended compressed session records', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const sessionId = 'session-usage';
    const sessionFile = path.join(paths.sessions, 'project', sessionId, 'session.v3.jsonl.zstd');
    const header = { type: 'session', version: 3, id: sessionId, cwd: tempHome };
    const firstEvent = {
      type: 'assistant/message',
      seq: 1,
      time: Date.now(),
      data: {
        message: {
          id: 'assistant-1',
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
          usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }
        }
      }
    };
    writeZstdLog(sessionFile, header, [firstEvent]);

    const cursor = createNativeLogDriver({ paths }).createNativeLogCursor();
    cursor.initialize();
    expect(cursor.readNewEvents()).toEqual([]);

    const secondEvent = {
      ...firstEvent,
      seq: 2,
      time: Date.now(),
      data: {
        ...firstEvent.data,
        message: {
          ...firstEvent.data.message,
          id: 'assistant-2',
          usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }
        }
      }
    };
    fs.appendFileSync(sessionFile, zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(secondEvent)}\n`)));

    expect(cursor.readNewEvents()).toEqual([expect.objectContaining({
      id: expect.stringContaining('assistant-2'),
      source: 'dsh',
      model: 'deepseek-chat',
      provider: 'deepseek',
      tokens: expect.objectContaining({ input: 20, output: 8, total: 28 })
    })]);
  });

  test('reads current DSH zstd session generations and maps message projections read-only', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const cwd = path.join(tempHome, 'workspace');
    const sessionId = 'session-zstd';
    const sessionDir = path.join(paths.sessions, '--tmp-ctx-dsh--', sessionId);
    const header = {
      type: 'session', version: 3, id: sessionId, createdAt: 1730000000000,
      cwd, isSeeded: false, delegationDepth: 0
    };
    const events = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: 2, surfaceOp: 'append', data: {
        id: 'user-1', role: 'user', content: [{ type: 'text', text: '检查插件配置' }], source: { kind: 'user' }
      } },
      { type: 'assistant/message', seq: 2, time: 3, surfaceOp: 'append', data: {
        turn: 1, step: 1,
        message: { id: 'assistant-1', role: 'assistant', content: [{ type: 'text', text: '这是只读查看' }], source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' } },
        stream: []
      } }
    ];
    writeZstdLog(path.join(sessionDir, 'session.v3.jsonl.zstd'), header, events);

    const driver = createSessionDriver({ paths });
    const projectName = projectNameFor(cwd);
    expect(driver.listProjects()).toEqual([expect.objectContaining({
      name: projectName,
      fullPath: cwd,
      sessionCount: 1,
      readOnly: true
    })]);
    expect(driver.listSessions({ params: { projectName } })).toEqual([expect.objectContaining({
      sessionId,
      firstMessage: '检查插件配置',
      readOnly: true,
      running: null
    })]);
    expect(driver.messages({ params: { sessionId }, query: { order: 'asc' } })).toEqual(expect.objectContaining({
      messages: [
        expect.objectContaining({ type: 'user', content: [{ type: 'text', text: '检查插件配置' }] }),
        expect.objectContaining({ type: 'assistant', content: '这是只读查看', model: 'deepseek-flash' })
      ],
      metadata: expect.objectContaining({ readOnly: true })
    }));
  });

  test('redacts credentials, performs revision-checked settings updates, and inspects profile bundles', async () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    fs.mkdirSync(paths.profiles, { recursive: true });
    fs.writeFileSync(paths.settings, [
      'llm-deepseek:',
      '  apiKey: should-not-leak',
      '  model: deepseek-flash',
      'ui:',
      '  theme: dark',
      ''
    ].join('\n'), 'utf8');
    fs.writeFileSync(paths.credentials, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: stored\nrecords: {}\n', { encoding: 'utf8', mode: 0o600 });
    const profileDir = path.join(paths.profiles, 'review');
    const pluginDir = path.join(profileDir, 'node_modules', 'demo-bundle');
    writeJson(path.join(profileDir, 'package.json'), {
      name: 'dsh-profile-review',
      dependencies: { 'demo-bundle': '1.2.3' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'demo-bundle'], patchReload: 'live' } }
    });
    writeJson(path.join(pluginDir, 'package.json'), {
      name: 'demo-bundle', version: '1.2.3', dsh: { bundle: { patch: './cordis.patch.yml' } }
    });
    fs.writeFileSync(path.join(pluginDir, 'cordis.patch.yml'), '- insert:\n    - id: demo-tool\n      name: demo-tool\n', 'utf8');
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '- replace:\n    - id: demo-tool\n      name: demo-tool\n      config:\n        enabled: true\n', 'utf8');
    fs.appendFileSync(path.join(profileDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: mcp-github',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: github',
      '        transport: stdio',
      '        command: npx',
      '        args: ["-y", "server-github"]',
      '        env:',
      '          GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN',
      '    - id: system-prompt',
      "      name: '@deepseek-ai/dsh-system-prompt'",
      '      config:',
      '        personaPrefix: "Review changes carefully."',
      '        personaSuffix: "Keep the report concise."',
      '    - id: skill-filesystem',
      "      name: '@deepseek-ai/dsh-skill-filesystem'",
      '      config:',
      '        includeDefaultRoots: true',
      '        customSkillDirs: []',
      ''
    ].join('\n'), 'utf8');
    fs.writeFileSync(paths.patch, '- insert:\n    - id: home-preference\n      name: home-preference\n', 'utf8');
    const projectDir = path.join(tempHome, 'workspace');
    fs.mkdirSync(path.join(projectDir, '.dsh', 'skills', 'review-check'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.dsh', 'skills', 'review-check', 'SKILL.md'), [
      '---',
      'name: review-check',
      'description: Review a change set',
      'whenToUse: Use before reporting a review',
      'user-invocable: false',
      'metadata:',
      '  owner: ctx',
      '---',
      '',
      '# Review checklist',
      '',
      'Check the diff before summarizing it.',
      ''
    ].join('\n'), 'utf8');

    const driver = createConfigDriver({ paths });
    const before = driver.getConfig();
    expect(before.settings.namespaces['llm-deepseek'].apiKey).toBe('[REDACTED]');
    expect(JSON.stringify(before)).not.toContain('should-not-leak');
    expect(before.credentials).toEqual(expect.objectContaining({ exists: true, secure: true, refs: ['DEEPSEEK_API_KEY'] }));

    const updated = driver.updateConfig({
      expectedRevision: before.settings.revision,
      namespace: 'ui',
      patch: { density: 'compact' }
    });
    expect(updated.settings.namespaces.ui).toEqual({ theme: 'dark', density: 'compact' });
    expect(() => driver.updateConfig({
      expectedRevision: before.settings.revision,
      namespace: 'ui',
      patch: { stale: true }
    })).toThrow(expect.objectContaining({ statusCode: 409 }));

    const api = createApiDriver({ paths, platform: 'dsh', route: { capability: 'api', operation: 'listProfilePlugins' } });
    const pluginsBefore = await api.listProfilePlugins({ params: { profileName: 'review' } });
    expect(pluginsBefore.data.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'demo-bundle', installed: true, bundle: true, management: 'ctx+dsh-plugin' }),
      expect.objectContaining({ name: '@deepseek-ai/dsh-base', inBundleList: true, management: 'ctx+dsh-plugin' })
    ]));
    const capabilities = await api.listProfileCapabilities({ params: { profileName: 'review' } });
    expect(capabilities.data.management).toBe('ctx');
    expect(capabilities.data.contributions.flatMap(entry => entry.rows).map(row => row.id)).toEqual(expect.arrayContaining(['demo-tool', 'home-preference']));
    const mcp = await api.listProfileMcp({ params: { profileName: 'review' } });
    expect(mcp.data.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'mcp-github',
        enabled: true,
        config: expect.objectContaining({
          serverName: 'github',
          env: { GITHUB_TOKEN: '[REDACTED]' }
        })
      })
    ]));
    expect(JSON.stringify(mcp.data)).not.toContain('process.env.GITHUB_TOKEN');
    const prompts = await api.listProfilePrompts({ params: { profileName: 'review' } });
    expect(prompts.data.prompts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'system-prompt',
        config: expect.objectContaining({ personaPrefix: 'Review changes carefully.' })
      })
    ]));
    const skills = listSkills({ paths }, { profile: 'review', cwd: projectDir, includeContent: true });
    expect(skills.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'review-check',
        source: 'project-dsh',
        invocation: { modelInvocable: true, userInvocable: false },
        content: expect.stringContaining('Check the diff')
      })
    ]));
    const resources = createConfigDriver({ paths }).getConfigResources({ query: { profile: 'review', cwd: projectDir } });
    expect(resources).toEqual(expect.objectContaining({
      skills: expect.objectContaining({ read: true }),
      plugins: { inspect: true, management: 'ctx+dsh-plugin' },
      mcp: { inspect: true, management: 'ctx-patch' },
      prompts: { inspect: true, management: 'ctx-patch' }
    }));
    expect(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8')).toContain('demo-bundle');
  });

  test('manages DSH skills and profile patch resources through ctx', async () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const profileDir = path.join(paths.profiles, 'managed');
    writeJson(path.join(profileDir, 'package.json'), {
      name: 'dsh-profile-managed',
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }
    });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '[]\n', 'utf8');
    const api = createApiDriver({ paths, platform: 'dsh', route: { capability: 'api', operation: 'upsertMcp' } });

    const mcp = await api.upsertMcp({
      params: { profileName: 'managed' },
      body: {
        id: 'mcp-demo',
        config: {
          serverName: 'demo',
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: { DEMO_TOKEN: '!!js process.env.DEMO_TOKEN' }
        }
      }
    });
    expect(mcp.data.mcp.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mcp-demo', config: { serverName: 'demo', transport: 'stdio', command: 'node', args: ['server.js'], env: { DEMO_TOKEN: '[REDACTED]' } } })
    ]));
    expect(fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8')).toContain('!!js process.env.DEMO_TOKEN');

    const prompt = await api.upsertPrompt({
      params: { profileName: 'managed' },
      body: { id: 'ctx-persona', config: { personaPrefix: 'Be precise.' } }
    });
    expect(prompt.data.prompts.prompts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ctx-persona', config: { personaPrefix: 'Be precise.' } })
    ]));

    const skill = await api.createSkill({
      body: { name: 'ctx-managed', description: 'Managed skill', content: 'Use this skill.', scope: 'user' }
    });
    expect(skill.data.skill.name).toBe('ctx-managed');
    expect(fs.existsSync(path.join(paths.dir, 'skills', 'ctx-managed', 'SKILL.md'))).toBe(true);
    const removedSkill = await api.deleteSkill({ params: { skillName: 'ctx-managed' }, body: { scope: 'user' } });
    expect(removedSkill.data.removed).toBe(true);

    const removedPrompt = await api.deletePrompt({ params: { profileName: 'managed', promptId: 'ctx-persona' }, body: {} });
    expect(removedPrompt.data.prompts.prompts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ctx-persona' })
    ]));
    const removedMcp = await api.deleteMcp({ params: { profileName: 'managed', serverId: 'mcp-demo' }, body: {} });
    expect(removedMcp.data.mcp.servers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mcp-demo' })
    ]));
  });

  test('delegates DSH plugin install and uninstall to the configured dsh command', async () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const profileDir = path.join(paths.profiles, 'plugins');
    writeJson(path.join(profileDir, 'package.json'), {
      name: 'dsh-profile-plugins',
      dependencies: {},
      dsh: { profile: { bundles: [] } }
    });
    const fakeDsh = path.join(tempHome, 'fake-dsh.js');
    fs.writeFileSync(fakeDsh, `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const profile = args[args.indexOf('--profile') + 1];
const verb = args[args.indexOf('--profile') + 2];
const specs = args.slice(args.indexOf('--profile') + 3);
const dir = path.join(process.env.DSH_HOME, 'profiles', profile);
const manifestPath = path.join(dir, 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.dependencies = manifest.dependencies || {};
for (const spec of specs) {
  if (verb === 'add') {
    manifest.dependencies[spec] = '1.0.0';
    const packageDir = path.join(dir, 'node_modules', spec);
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: spec, version: '1.0.0' }));
  } else if (verb === 'remove') {
    delete manifest.dependencies[spec];
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest));
`, 'utf8');
    fs.chmodSync(fakeDsh, 0o700);

    const api = createApiDriver({ paths, dshCommand: fakeDsh, platform: 'dsh', route: { capability: 'api', operation: 'installPlugin' } });
    const installed = await api.installPlugin({ params: { profileName: 'plugins' }, body: { spec: 'demo-plugin' } });
    expect(installed.data.plugins.plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'demo-plugin', installed: true })
    ]));
    const removed = await api.uninstallPlugin({ params: { profileName: 'plugins', pluginName: 'demo-plugin' }, body: {} });
    expect(removed.data.plugins.plugins).toEqual([]);
  });

  test('runtime resolves all DSH declared capabilities to dedicated drivers', () => {
    const registry = createPlatformRegistry({ userFile: { platforms: [] } });
    const runtime = createPlatformRuntime({ registry, driverRegistry: getDriverRegistry() });
    expect(runtime.getDriver('dsh', 'projects')).toEqual(expect.objectContaining({ platform: 'dsh', capability: 'projects' }));
    expect(runtime.getDriver('dsh', 'sessions')).toEqual(expect.objectContaining({ platform: 'dsh', capability: 'sessions' }));
    expect(runtime.getDriver('dsh', 'nativeConfig')).toEqual(expect.objectContaining({ platform: 'dsh', capability: 'nativeConfig' }));
    expect(runtime.getDriver('dsh', 'api')).toEqual(expect.objectContaining({ platform: 'dsh', capability: 'api' }));
    expect(runtime.getDriver('dsh', 'channels')).toEqual(expect.objectContaining({ platform: 'dsh', capability: 'channels' }));
    expect(runtime.getDriver('dsh', 'proxy')).toEqual(expect.objectContaining({ platform: 'dsh', capability: 'proxy' }));
    expect(runtime.getDriver('dsh', 'statistics')).toEqual(expect.objectContaining({ platform: 'dsh', capability: 'statistics' }));
    expect(runtime.getDriver('dsh', 'nativeLogs')).toEqual(expect.objectContaining({ platform: 'dsh', capability: 'nativeLogs' }));
  });

  test('uses the manifest-declared native snapshot for config export and import', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    fs.mkdirSync(tempHome, { recursive: true });
    fs.writeFileSync(paths.settings, 'providers:\n  primary:\n    model: deepseek\n', 'utf8');
    fs.writeFileSync(paths.patch, 'profiles: {}\n', 'utf8');

    const manifest = require('../../../src/platforms/manifests/dsh.json');
    const registry = createPlatformRegistry({
      builtIns: [{ ...manifest, paths: { home: tempHome } }],
      userFile: { platforms: [] }
    });
    const runtime = createPlatformRuntime({ registry, driverRegistry: getDriverRegistry() });
    const driver = runtime.getDriver('dsh', 'nativeConfig');
    const snapshot = driver.exportSnapshot();

    expect(snapshot.settings.content).toContain('deepseek');
    expect(snapshot.patch.content).toContain('profiles');

    fs.writeFileSync(paths.settings, 'providers: {}\n', 'utf8');
    expect(driver.importSnapshot(snapshot)).toEqual(expect.objectContaining({ imported: 2, failed: 0 }));
    expect(fs.readFileSync(paths.settings, 'utf8')).toContain('deepseek');
  });

  test('routes the shared Skills and Plugins services through the DSH Driver', async () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const projectDir = path.join(tempHome, 'workspace');
    fs.mkdirSync(path.join(projectDir, '.dsh', 'skills', 'project-skill'), { recursive: true });
    fs.mkdirSync(path.join(paths.dir, 'skills', 'user-skill'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.dsh', 'skills', 'project-skill', 'SKILL.md'), '---\nname: project-skill\ndescription: Project\n---\n\nProject body\n');
    fs.writeFileSync(path.join(paths.dir, 'skills', 'user-skill', 'SKILL.md'), '---\nname: user-skill\ndescription: User\n---\n\nUser body\n');
    fs.mkdirSync(path.join(paths.profiles, 'default'), { recursive: true });
    writeJson(path.join(paths.profiles, 'default', 'package.json'), {
      name: 'dsh-profile-default',
      dependencies: { 'demo-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['demo-plugin'] } }
    });

    const api = createApiDriver({ paths, platform: 'dsh' });
    const runtime = { getDriver: () => api };
    const registry = {
      resolve: () => ({ projectResources: {} }),
      resolvePathContext: () => ({
        customized: true,
        native: paths,
        state: {
          localSkills: path.join(tempHome, 'state', 'skills'),
          skillRepos: path.join(tempHome, 'state', 'skill-repos.json'),
          skillCaches: path.join(tempHome, 'state', 'skill-cache.json')
        }
      })
    };

    const skills = await new SkillService('dsh', {
      registry,
      runtime,
      artifactStore: {}
    }).scanSkills({ scope: 'user', cwd: projectDir });
    expect(skills.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'user-skill', sourceProvider: 'dsh', readonly: true, managed: false })
    ]));
    expect(skills.skills).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'project-skill' })
    ]));

    const plugins = new PluginsService('dsh', { registry, runtime });
    expect(plugins.listPlugins().plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'demo-plugin', profile: 'default', readonly: true, pluginType: 'dsh-profile' })
    ]));
    expect(plugins.getCapabilities()).toEqual(expect.objectContaining({
      supportsPlugins: true,
      repositories: true,
      install: false,
      uninstall: false
    }));
    expect(plugins.getRepos()).toEqual([]);
    expect((await plugins.installPlugin('demo-plugin')).success).toBe(false);
  });

  test('manages DSH channels and switches native config through the managed proxy', async () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const state = {
      channels: path.join(tempHome, 'channels.json'),
      activeChannel: path.join(tempHome, 'active-channel.json'),
      proxyRuntime: path.join(tempHome, 'dsh-proxy.json')
    };
    const channelDriver = createChannelDriver({ paths });
    const createRequest = body => channelDriver.create({
      body,
      route: { capability: 'channels', operation: 'create' }
    });
    const first = createRequest({
      name: 'Primary',
      providerKey: 'primary',
      baseUrl: 'https://api.example.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-primary'
    });
    expect(first.status).toBe('ok');
    expect(first.data.channel).toEqual(expect.objectContaining({ providerKey: 'primary', apiKey: '[REDACTED]', apiKeyConfigured: true }));

    const edited = channelDriver.update({
      params: { channelId: first.data.channel.id },
      body: { model: 'deepseek-reasoner', apiKey: '[REDACTED]' },
      route: { capability: 'channels', operation: 'update' }
    });
    expect(edited.status).toBe('ok');
    expect(edited.data.channel.model).toBe('deepseek-reasoner');
    expect(edited.data.channel.apiKey).toBe('[REDACTED]');

    const proxyDriver = createProxyDriver({
      paths,
      pathContext: { native: paths, customized: true, state }
    });
    const started = await proxyDriver.start({ port: 0 });
    expect(started.status).toBe('ok');
    expect(started.data).toEqual(expect.objectContaining({ success: true, provider: 'ctx-dsh-proxy' }));
    expect(fs.readFileSync(paths.settings, 'utf8')).toContain('ctx-dsh-proxy');

    const second = createRequest({
      name: 'Backup',
      providerKey: 'backup',
      baseUrl: 'https://backup.example.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-backup'
    });
    expect(second.status).toBe('ok');
    const disabled = channelDriver.update({
      params: { channelId: second.data.channel.id },
      body: { enabled: false, apiKey: '[REDACTED]' },
      route: { capability: 'channels', operation: 'update' }
    });
    expect(disabled.status).toBe('ok');
    expect(disabled.data.channel.enabled).toBe(false);

    const stopped = await proxyDriver.stop();
    expect(stopped.status).toBe('ok');
    expect(fs.readFileSync(paths.settings, 'utf8')).toContain('provider: primary');
    expect(channelDriver.remove({
      params: { channelId: second.data.channel.id },
      route: { capability: 'channels', operation: 'remove' }
    }).status).toBe('ok');
  });

  test('mounts DSH descriptor routes through the shared platform API factory', async () => {
    tempHome = makeTempHome();
    fs.mkdirSync(path.join(tempHome, 'skills', 'route-check'), { recursive: true });
    fs.writeFileSync(path.join(tempHome, 'skills', 'route-check', 'SKILL.md'), '---\nname: route-check\ndescription: Route check\n---\n\nRead only.\n', 'utf8');
    const manifest = require('../../../src/platforms/manifests/dsh.json');
    const registry = createPlatformRegistry({
      builtIns: [{ ...manifest, paths: { home: tempHome } }],
      userFile: { platforms: [] }
    });
    const runtime = createPlatformRuntime({ registry, driverRegistry: getDriverRegistry() });
    const app = express();
    app.use('/api/platforms', createPlatformRouter({ registry, runtime }));
    const server = app.listen(0);
    await once(server, 'listening');
    try {
      const { port } = server.address();
      const capabilities = await fetch(`http://127.0.0.1:${port}/api/platforms/dsh/config/capabilities`);
      expect(capabilities.status).toBe(200);
      expect(await capabilities.json()).toEqual(expect.objectContaining({
        platform: 'dsh',
        settings: expect.objectContaining({ update: true }),
        plugins: expect.objectContaining({ install: true, remove: true, inspect: true }),
        skills: expect.objectContaining({ create: true, remove: true }),
        mcp: expect.objectContaining({ create: true, remove: true }),
        prompts: expect.objectContaining({ create: true, remove: true })
      }));

      const projects = await fetch(`http://127.0.0.1:${port}/api/platforms/dsh/projects`);
      expect(projects.status).toBe(200);
      expect(await projects.json()).toEqual(expect.objectContaining({
        projects: [],
        currentProject: null,
        meta: {}
      }));

      const skills = await fetch(`http://127.0.0.1:${port}/api/platforms/dsh/skills?includeContent=1`);
      expect(skills.status).toBe(200);
      expect((await skills.json()).skills).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'route-check', content: expect.stringContaining('Read only') })
      ]));

      const statsSession = path.join(tempHome, 'sessions', 'project', 'session-stats', 'session.v3.jsonl.zstd');
      writeZstdLog(statsSession, {
        type: 'session', version: 3, id: 'session-stats', cwd: tempHome
      }, [{
        type: 'assistant/message',
        seq: 1,
        time: Date.now(),
        data: {
          message: {
            id: 'assistant-stats',
            source: { provider: 'deepseek', model: 'deepseek-chat' },
            usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 }
          }
        }
      }]);

      const todayDate = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const today = await fetch(`http://127.0.0.1:${port}/api/platforms/dsh/statistics/today`);
      expect(today.status).toBe(200);
      expect(await today.json()).toEqual(expect.objectContaining({
        date: expect.any(String),
        summary: expect.objectContaining({ requests: 1, tokens: 7 })
      }));

      const daily = await fetch(`http://127.0.0.1:${port}/api/platforms/dsh/statistics/daily/${todayDate}`);
      expect(daily.status).toBe(200);
      expect(await daily.json()).toEqual(expect.objectContaining({
        date: todayDate,
        summary: expect.objectContaining({ requests: 1, tokens: 7 })
      }));
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
