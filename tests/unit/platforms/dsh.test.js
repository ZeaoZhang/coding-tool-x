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
const { createDriver: createStatisticsDriver } = require('../../../src/platforms/drivers/dsh/statistics');
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

  test('publishes DSH as a config/session platform with dedicated agent resources', () => {
    const registry = createPlatformRegistry({ userFile: { platforms: [] } });
    const manifest = registry.resolve('dsh');

    expect(manifest).toEqual(expect.objectContaining({
      key: 'dsh',
      defaultEnabled: false,
      cliSelectable: false,
      resourceTypes: expect.objectContaining({ skills: true, commands: false, agents: true, plugins: true })
    }));
    expect(manifest.resourceActions.skills.toggle).toBe(false);
    expect(manifest.resourceActions.skills.create).toBe(true);
    expect(manifest.projectResources.skills).toEqual({
      canonicalRoot: '.dsh/skills',
      readRoots: ['.dsh/skills', '.agents/skills']
    });
    expect(manifest.mcpTransports).toEqual(['stdio', 'streamable_http']);
    expect(registry.getPublicDefinition('dsh').mcpTransports).toEqual(['stdio', 'streamable_http']);
    expect(registry.getCapability('dsh', 'projects')).toBe('dsh-projects');
    expect(registry.getCapability('dsh', 'sessions')).toBe('dsh-sessions');
    expect(registry.getCapability('dsh', 'api')).toBe('dsh-api');
    expect(registry.getCapability('dsh', 'statistics')).toBe('dsh-statistics');
    expect(registry.getCapability('dsh', 'nativeLogs')).toBe('dsh-native-logs');

    tempHome = makeTempHome();
    const dshHome = path.join(tempHome, 'dsh-home');
    expect(registry.resolvePaths('dsh', { homeDir: tempHome, env: { DSH_HOME: dshHome } }).home).toBe(dshHome);
    expect(registry.resolvePathContext('dsh', {
      homeDir: tempHome,
      env: { DSH_HOME: dshHome }
    }).native.skills).toBe(path.join(dshHome, 'skills'));
  });

  test('daily statistics skip logs untouched since before the requested day', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const sessionFile = path.join(paths.sessions, 'project', 'session-stale', 'session.v3.jsonl.zstd');
    writeZstdLog(sessionFile, {
      type: 'session', version: 3, id: 'session-stale', cwd: tempHome
    }, [{
      type: 'assistant/message',
      seq: 1,
      time: Date.now(),
      data: {
        message: {
          id: 'assistant-stale',
          source: { provider: 'deepseek', model: 'deepseek-chat' },
          usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 }
        }
      }
    }]);
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(sessionFile, stale, stale);

    const stats = createStatisticsDriver({ paths });
    const today = stats.getTodayStatistics();

    expect(today.status).toBe('ok');
    expect(today.data.summary).toEqual({ requests: 0, tokens: 0, cost: 0 });
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
      expect.objectContaining({ name: 'demo-bundle', installed: true, bundle: true, management: 'ctx+dsh-plugin' })
    ]));
    expect(pluginsBefore.data.plugins).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '@deepseek-ai/dsh-base' })
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

  test('invalidates cached plugin lists after DSH plugin mutations', async () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const profileDir = path.join(paths.profiles, 'cache');
    writeJson(path.join(profileDir, 'package.json'), {
      name: 'dsh-profile-cache',
      dependencies: {},
      dsh: { profile: { bundles: [] } }
    });
    const fakeDsh = path.join(tempHome, 'fake-dsh-cache.js');
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
  const packageDir = path.join(dir, 'node_modules', spec);
  if (verb === 'add') {
    manifest.dependencies[spec] = '1.0.0';
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: spec, version: '1.0.0' }));
  } else if (verb === 'remove') {
    delete manifest.dependencies[spec];
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest));
`, 'utf8');
    fs.chmodSync(fakeDsh, 0o700);

    const api = createApiDriver({ paths, dshCommand: fakeDsh, platform: 'dsh', route: { capability: 'api', operation: 'installPlugin' } });
    const registry = { resolvePathContext: () => ({ customized: true, native: paths }) };
    const runtime = { getDriver: () => api };
    const service = new PluginsService('dsh', { registry, runtime });

    expect(service.listPlugins().plugins).toEqual([]);

    await api.installPlugin({ params: { profileName: 'cache' }, body: { spec: 'cached-plugin' } });
    expect(service.listPlugins().plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'cached-plugin', profile: 'cache', installed: true })
    ]));

    await api.uninstallPlugin({ params: { profileName: 'cache', pluginName: 'cached-plugin' }, body: {} });
    expect(service.listPlugins().plugins).toEqual([]);
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

  test('detects profile plugins declared only in devDependencies', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const profileDir = path.join(paths.profiles, 'dev-only');
    writeJson(path.join(profileDir, 'package.json'), {
      name: 'dsh-profile-dev-only',
      devDependencies: { 'dsh-dev-plugin': '2.0.0' },
      dsh: { profile: { bundles: [] } }
    });
    writeJson(path.join(profileDir, 'node_modules', 'dsh-dev-plugin', 'package.json'), {
      name: 'dsh-dev-plugin', version: '2.0.0'
    });

    const api = createApiDriver({ paths, platform: 'dsh' });
    const registry = { resolvePathContext: () => ({ customized: true, native: paths }) };
    const runtime = { getDriver: () => api };
    const plugins = new PluginsService('dsh', { registry, runtime }).listPlugins().plugins;

    expect(plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'dsh-dev-plugin',
        profile: 'dev-only',
        installed: true,
        requestedVersion: '2.0.0',
        pluginType: 'dsh-profile'
      })
    ]));
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
    const manifest = require('../../../src/platforms/manifests/dsh.json');
    const registry = {
      resolve: () => ({ projectResources: manifest.projectResources }),
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

    const service = new SkillService('dsh', {
      registry,
      runtime,
      artifactStore: {}
    });
    expect(service.installDir).toBe(path.join(paths.dir, 'skills'));
    const skills = await service.scanSkills({ scope: 'user', cwd: projectDir });
    expect(skills.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'user-skill', sourceProvider: 'dsh', readonly: true, managed: false })
    ]));
    expect(skills.skills).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'project-skill' })
    ]));

    service.createCustomSkill({
      name: 'native-created',
      directory: 'native-created',
      description: 'Created in DSH home',
      content: 'Native body'
    });
    expect(fs.existsSync(path.join(paths.dir, 'skills', 'native-created', 'SKILL.md'))).toBe(true);
    const userCreated = await service.scanSkills({ scope: 'user', cwd: projectDir });
    expect(userCreated.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'native-created', sourceProvider: 'dsh' })
    ]));

    service.createCustomSkill({
      name: 'project-created',
      directory: 'project-created',
      description: 'Created in project DSH root',
      content: 'Project body',
      scope: 'project',
      cwd: projectDir
    });
    expect(fs.existsSync(path.join(projectDir, '.dsh', 'skills', 'project-created', 'SKILL.md'))).toBe(true);
    const projectCreated = await service.scanSkills({ scope: 'project', cwd: projectDir });
    expect(projectCreated.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'project-created', sourceScope: 'project' })
    ]));

    const plugins = new PluginsService('dsh', { registry, runtime });
    expect(plugins.listPlugins().plugins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'demo-plugin',
        profile: 'default',
        readonly: false,
        installed: false,
        pluginType: 'dsh-profile'
      })
    ]));
    expect(plugins.getCapabilities()).toEqual(expect.objectContaining({
      supportsPlugins: true,
      repositories: false,
      install: true,
      uninstall: true
    }));
    expect(plugins.getRepos()).toEqual([]);
    expect((await plugins.installPlugin('demo-plugin')).success).toBe(false);
  });

  test('sync imports all configured DSH providers without rewriting native settings', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const settingsText = [
      'llm-pi-ai:',
      '  providers:',
      '    primary:',
      '      displayName: Primary',
      '      api: openai-completions',
      '      baseURL: https://primary.example/v1',
      '      apiKeyEnv: PRIMARY_API_KEY',
      '      models:',
      '        - id: primary-model',
      '    secondary:',
      '      displayName: Secondary',
      '      api: anthropic-messages',
      '      baseURL: https://secondary.example/v1',
      '      apiKeyEnv: SECONDARY_API_KEY',
      '      models:',
      '        - id: secondary-model',
      'agent-default-model:',
      '  provider: primary',
      '  model: primary-model',
      ''
    ].join('\n');
    fs.writeFileSync(paths.settings, settingsText, 'utf8');
    fs.writeFileSync(paths.credentials, [
      'version: 1',
      'refs:',
      '  PRIMARY_API_KEY: sk-primary',
      '  SECONDARY_API_KEY: sk-secondary',
      'records: {}',
      ''
    ].join('\n'), { encoding: 'utf8', mode: 0o600 });
    writeJson(path.join(tempHome, 'channels.json'), {
      channels: [{
        id: 'existing-primary',
        name: 'Primary',
        providerKey: 'primary',
        providerApi: 'openai-completions',
        baseUrl: 'https://primary.example/v1',
        model: 'primary-model',
        models: [{ id: 'primary-model' }],
        apiKeyEnv: 'PRIMARY_API_KEY',
        apiKey: 'sk-primary',
        authMode: 'api_key',
        gatewaySourceType: 'openai_compatible',
        enabled: true,
        weight: 1,
        createdAt: 1000,
        updatedAt: 1000
      }]
    });

    const driver = createChannelDriver({ paths });
    const synced = driver.sync({ route: { capability: 'channels', operation: 'sync' } });

    expect(synced.status).toBe('ok');
    expect(synced.data).toEqual(expect.objectContaining({ added: 1, updated: 0, skipped: 1 }));
    expect(synced.data.channels.map(channel => channel.providerKey).sort()).toEqual(['primary', 'secondary']);
    expect(synced.data.current).toEqual(expect.objectContaining({ id: 'existing-primary', providerKey: 'primary' }));
    expect(synced.data.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerKey: 'primary', enabled: true, apiKey: 'sk-primary' }),
      expect.objectContaining({ providerKey: 'secondary', enabled: true, apiKey: 'sk-secondary' })
    ]));
    expect(JSON.stringify(synced.data)).toContain('sk-primary');
    expect(JSON.stringify(synced.data)).toContain('sk-secondary');
    expect(fs.readFileSync(paths.settings, 'utf8')).toBe(settingsText);
  });

  test('discovers models for an unsaved DSH provider through the channel driver', async () => {
    tempHome = makeTempHome();
    const modelDetector = require('../../../src/server/services/model-detector');
    const originalFetch = modelDetector.fetchModelsFromProvider;
    const calls = [];
    modelDetector.fetchModelsFromProvider = async (...args) => {
      calls.push(args);
      return { models: ['claude-live-model'], supported: true, fallbackUsed: false };
    };
    try {
      const driver = createChannelDriver({ paths: dshPaths(tempHome) });
      const result = await driver.modelsFromConfig({
        body: {
          baseUrl: 'https://api.anthropic.example/v1',
          apiKey: 'sk-anthropic',
          providerApi: 'anthropic-messages'
        },
        route: { capability: 'channels', operation: 'modelsFromConfig' }
      });
      expect(result).toEqual(expect.objectContaining({
        status: 'ok',
        data: expect.objectContaining({ models: ['claude-live-model'] })
      }));
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toBe('claude');
      expect(calls[0][2]).toEqual({ forceRefresh: false });
    } finally {
      modelDetector.fetchModelsFromProvider = originalFetch;
    }
  });

  test('exposes offline catalog metadata for DSH channel models', () => {
    tempHome = makeTempHome();
    const driver = createChannelDriver({ paths: dshPaths(tempHome) });

    const result = driver.catalogMetadata({
      body: {
        providerKey: 'deepseek',
        model: 'deepseek/deepseek-v4-pro'
      },
      route: { capability: 'channels', operation: 'catalogMetadata' }
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'ok',
      platform: 'dsh',
      capability: 'channels',
      operation: 'catalogMetadata'
    }));
    expect(result.data.models).toEqual([
      expect.objectContaining({
        id: 'deepseek/deepseek-v4-pro',
        limit: expect.objectContaining({ context: expect.any(Number), output: expect.any(Number) })
      })
    ]);
    expect(result.data.source).toEqual(expect.objectContaining({ name: 'models.dev' }));
  });

  function writeProfileFixture(home, profileName, providers, selected) {
    const profileDir = path.join(home, 'profiles', profileName);
    fs.mkdirSync(profileDir, { recursive: true });
    writeJson(path.join(profileDir, 'package.json'), {
      name: profileName,
      dsh: { profile: { bundles: [] } }
    });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), `${JSON.stringify([
      {
        id: 'llm-pi-ai',
        name: '@deepseek-ai/dsh-llm-pi-ai',
        config: { providers }
      },
      {
        id: 'agent-default-model',
        config: selected
      }
    ], null, 2)}\n`);
    return { profileDir, patchPath: path.join(profileDir, 'cordis.patch.yml') };
  }

  function findPatchEntry(document, id) {
    for (const item of Array.isArray(document) ? document : []) {
      if (item?.id === id) return item;
      for (const operation of ['insert', 'replace', 'update']) {
        const entry = Array.isArray(item?.[operation])
          ? item[operation].find(candidate => candidate?.id === id)
          : null;
        if (entry) return entry;
      }
    }
    return null;
  }

  test('syncs providers from the active DSH profile when legacy settings.yaml is absent', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const { patchPath } = writeProfileFixture(tempHome, 'desktop', {
      foo: {
        displayName: 'Foo Provider',
        api: 'openai-completions',
        baseURL: 'https://foo.example/v1',
        apiKeyEnv: 'FOO_KEY',
        models: [
          { id: 'foo-model', contextWindow: 1000, maxTokens: 100 },
          { id: 'foo-secondary', contextWindow: 2000, maxTokens: 200 }
        ]
      },
      bar: {
        displayName: 'Bar Provider',
        api: 'anthropic-messages',
        baseURL: 'https://bar.example',
        apiKeyEnv: 'BAR_KEY',
        models: [{ id: 'bar-model' }]
      }
    }, { provider: 'foo', model: 'foo-model', reasoningEffort: 'high' });
    writeJson(paths.credentials, {
      version: 1,
      refs: { FOO_KEY: 'sk-foo', BAR_KEY: 'sk-bar' },
      records: {}
    });

    const driver = createChannelDriver({ paths });
    const result = driver.sync({ route: { capability: 'channels', operation: 'sync' } });

    expect(result.status).toBe('ok');
    expect(result.data.source).toEqual(expect.objectContaining({
      type: 'profile',
      profile: 'desktop',
      path: patchPath
    }));
    expect(result.data.added).toBe(2);
    expect(result.data.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerKey: 'foo',
        model: 'foo-model',
        models: [
          expect.objectContaining({ id: 'foo-model' }),
          expect.objectContaining({ id: 'foo-secondary' })
        ],
        apiKeyConfigured: true,
        enabled: true
      }),
      expect.objectContaining({
        providerKey: 'bar',
        model: 'bar-model',
        apiKeyConfigured: true,
        enabled: true
      })
    ]));
    expect(result.data.current).toEqual(expect.objectContaining({
      providerKey: 'foo',
      model: 'foo-model'
    }));
    expect(fs.existsSync(paths.settings)).toBe(false);
  });

  test('writes channel changes back into the active DSH profile patch', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const { readYamlFile } = require('../../../src/platforms/drivers/dsh/common');
    const { patchPath } = writeProfileFixture(tempHome, 'desktop', {
      foo: {
        displayName: 'Foo Provider',
        api: 'openai-completions',
        baseURL: 'https://foo.example/v1',
        apiKeyEnv: 'FOO_KEY',
        models: [{ id: 'foo-model' }]
      }
    }, { provider: 'foo', model: 'foo-model' });
    writeJson(paths.credentials, {
      version: 1,
      refs: { FOO_KEY: 'sk-foo' },
      records: {}
    });

    const driver = createChannelDriver({ paths });
    const created = driver.create({
      body: {
        name: 'New Provider',
        providerKey: 'new-provider',
        providerApi: 'openai-completions',
        baseUrl: 'https://new.example/v1',
        apiKey: 'sk-new',
        apiKeyEnv: 'NEW_PROVIDER_KEY',
        model: 'new-model',
        models: ['new-model']
      }
    });

    expect(created.status).toBe('ok');
    const document = readYamlFile(patchPath, []);
    const llm = findPatchEntry(document, 'llm-pi-ai');
    expect(llm.config.providers).toEqual(expect.objectContaining({
      foo: expect.objectContaining({ baseURL: 'https://foo.example/v1' }),
      'new-provider': expect.objectContaining({
        baseURL: 'https://new.example/v1',
        apiKeyEnv: 'NEW_PROVIDER_KEY'
      })
    }));
    expect(findPatchEntry(document, 'agent-default-model').config).toEqual(
      expect.objectContaining({ provider: 'new-provider', model: 'new-model' })
    );
    expect(fs.existsSync(paths.settings)).toBe(false);
    expect(readYamlFile(paths.credentials, {}).refs.NEW_PROVIDER_KEY).toBe('sk-new');
  });

  test('honors DSH_PROFILE for an empty dsh-tui profile and writes only that profile', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const { readYamlFile } = require('../../../src/platforms/drivers/dsh/common');
    const { patchPath: desktopPatch } = writeProfileFixture(tempHome, 'desktop', {
      foo: {
        displayName: 'Desktop Provider',
        api: 'openai-completions',
        baseURL: 'https://desktop.example/v1',
        apiKeyEnv: 'FOO_KEY',
        models: [{ id: 'desktop-model' }]
      }
    }, { provider: 'foo', model: 'desktop-model' });
    const tuiDir = path.join(tempHome, 'profiles', 'dsh-tui');
    fs.mkdirSync(tuiDir, { recursive: true });
    writeJson(path.join(tuiDir, 'package.json'), {
      name: 'dsh-tui',
      dsh: { profile: { bundles: [] } }
    });
    const tuiPatch = path.join(tuiDir, 'cordis.patch.yml');
    fs.writeFileSync(tuiPatch, '[]\n');
    writeJson(paths.credentials, { version: 1, refs: { FOO_KEY: 'sk-foo' }, records: {} });
    const desktopBefore = fs.readFileSync(desktopPatch, 'utf8');

    process.env.DSH_PROFILE = 'dsh-tui';
    try {
      const driver = createChannelDriver({ paths });
      const synced = driver.sync({ route: { capability: 'channels', operation: 'sync' } });

      expect(synced.status).toBe('ok');
      expect(synced.data.source).toEqual(expect.objectContaining({
        type: 'profile',
        profile: 'dsh-tui',
        path: tuiPatch
      }));
      expect(synced.data.added).toBe(0);
      expect(synced.data.warnings).toEqual([expect.stringContaining('llm-pi-ai.providers')]);

      const created = driver.create({
        body: {
          name: 'TUI Provider',
          providerKey: 'tui-provider',
          providerApi: 'openai-completions',
          baseUrl: 'https://tui.example/v1',
          apiKey: 'sk-tui',
          apiKeyEnv: 'TUI_KEY',
          model: 'tui-model',
          models: ['tui-model']
        }
      });
      expect(created.status).toBe('ok');
      const tuiDocument = readYamlFile(tuiPatch, []);
      expect(findPatchEntry(tuiDocument, 'llm-pi-ai').config.providers).toEqual(
        expect.objectContaining({ 'tui-provider': expect.any(Object) })
      );
      expect(fs.readFileSync(desktopPatch, 'utf8')).toBe(desktopBefore);
      expect(fs.existsSync(paths.settings)).toBe(false);
    } finally {
      delete process.env.DSH_PROFILE;
    }
  });

  test('selects DSH profiles by default desktop→web→tui priority', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    writeProfileFixture(tempHome, 'desktop', {
      desktop: {
        displayName: 'Desktop',
        api: 'openai-completions',
        baseURL: 'https://desktop.example/v1',
        apiKeyEnv: 'DESKTOP_KEY',
        models: [{ id: 'desktop-model' }]
      }
    }, { provider: 'desktop', model: 'desktop-model' });
    writeProfileFixture(tempHome, 'web', {
      web: {
        displayName: 'Web',
        api: 'openai-completions',
        baseURL: 'https://web.example/v1',
        apiKeyEnv: 'WEB_KEY',
        models: [{ id: 'web-model' }]
      }
    }, { provider: 'web', model: 'web-model' });
    writeJson(paths.credentials, {
      version: 1,
      refs: { DESKTOP_KEY: 'sk-desktop', WEB_KEY: 'sk-web' },
      records: {}
    });

    const auto = createChannelDriver({ paths }).sync({
      route: { capability: 'channels', operation: 'sync' }
    });
    expect(auto.data.source).toEqual(expect.objectContaining({ profile: 'desktop' }));

    const web = createChannelDriver({
      paths,
      context: { config: { dshChannelProfile: 'web' } }
    }).sync({ route: { capability: 'channels', operation: 'sync' } });
    expect(web.data.source).toEqual(expect.objectContaining({ profile: 'web' }));
  });

  test('selected TUI profile stays the write target instead of falling back to desktop', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    writeProfileFixture(tempHome, 'desktop', {
      desktop: {
        displayName: 'Desktop',
        api: 'openai-completions',
        baseURL: 'https://desktop.example/v1',
        apiKeyEnv: 'DESKTOP_KEY',
        models: [{ id: 'desktop-model' }]
      }
    }, { provider: 'desktop', model: 'desktop-model' });
    const tuiDir = path.join(tempHome, 'profiles', 'dsh-tui');
    fs.mkdirSync(tuiDir, { recursive: true });
    writeJson(path.join(tuiDir, 'package.json'), {
      name: 'dsh-tui',
      dsh: { profile: { bundles: [] } }
    });
    const tuiPatch = path.join(tuiDir, 'cordis.patch.yml');
    fs.writeFileSync(tuiPatch, '[]\n');
    writeJson(paths.credentials, {
      version: 1,
      refs: { DESKTOP_KEY: 'sk-desktop' },
      records: {}
    });

    const driver = createChannelDriver({
      paths,
      context: { config: { dshChannelProfile: 'tui' } }
    });
    const synced = driver.sync({ route: { capability: 'channels', operation: 'sync' } });
    expect(synced.data.source).toEqual(expect.objectContaining({
      profile: 'dsh-tui',
      missing: false
    }));
    expect(synced.data.added).toBe(0);

    const created = driver.create({
      body: {
        name: 'TUI Profile Provider',
        providerKey: 'tui-profile-provider',
        providerApi: 'openai-completions',
        baseUrl: 'https://tui-profile.example/v1',
        apiKey: 'sk-tui-profile',
        apiKeyEnv: 'TUI_PROFILE_KEY',
        model: 'tui-profile-model',
        models: ['tui-profile-model']
      }
    });
    expect(created.status).toBe('ok');
    const { readYamlFile } = require('../../../src/platforms/drivers/dsh/common');
    expect(findPatchEntry(readYamlFile(tuiPatch, []), 'llm-pi-ai').config.providers).toEqual(
      expect.objectContaining({ 'tui-profile-provider': expect.any(Object) })
    );
    expect(fs.readFileSync(path.join(tempHome, 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8'))
      .not.toContain('tui-profile-provider');
  });

  test('sync enriches known DSH models with metadata while preserving provider overrides', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const settingsText = [
      'llm-pi-ai:',
      '  providers:',
      '    deepseek:',
      '      displayName: DeepSeek',
      '      api: openai-completions',
      '      baseURL: https://api.deepseek.com/v1',
      '      models:',
      '        - id: deepseek/deepseek-v4-pro',
      '        - id: gpt-5.4',
      '          contextWindow: 64000',
      '          cost:',
      '            input: 0.5',
      '        - id: provider-specific-model',
      'agent-default-model:',
      '  provider: deepseek',
      '  model: deepseek/deepseek-v4-pro',
      ''
    ].join('\n');
    fs.writeFileSync(paths.settings, settingsText, 'utf8');

    const driver = createChannelDriver({ paths });
    const synced = driver.sync({ route: { capability: 'channels', operation: 'sync' } });
    const importedChannels = JSON.parse(fs.readFileSync(path.join(tempHome, 'channels.json'), 'utf8')).channels;
    const models = importedChannels[0].models;

    expect(synced.data.added).toBe(1);
    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'deepseek/deepseek-v4-pro',
        input: ['text'],
        reasoning: true,
        contextWindow: 1048576,
        maxTokens: 393216,
        cost: expect.objectContaining({ input: 0.66, output: 1.98, cacheRead: 0.022 })
      }),
      expect.objectContaining({
        id: 'gpt-5.4',
        contextWindow: 64000,
        maxTokens: 128000,
        cost: expect.objectContaining({ input: 0.5, output: 15, cacheRead: 0.25 })
      }),
      { id: 'provider-specific-model' }
    ]));
    expect(fs.readFileSync(paths.settings, 'utf8')).toBe(settingsText);
  });

  test('writes channel model metadata into DSH provider models', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const { readYamlFile } = require('../../../src/platforms/drivers/dsh/common');
    const channelDriver = createChannelDriver({ paths });
    const created = channelDriver.create({
      body: {
        name: 'Metadata provider',
        providerKey: 'metadata-provider',
        providerApi: 'openai-completions',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-metadata',
        model: 'deepseek/deepseek-v4-pro',
        models: [
          {
            id: 'deepseek/deepseek-v4-pro',
            contextWindow: 64000,
            maxTokens: 8192,
            reasoning: true,
            input: ['text', 'image'],
            thinking: { mode: 'effort', efforts: ['low', 'high'] }
          },
          {
            id: 'explicit-efforts',
            contextWindow: 32000,
            maxTokens: 4096,
            reasoningEfforts: { high: 'high' },
            compat: { supportsStore: false }
          }
        ],
        enabled: true
      },
      route: { capability: 'channels', operation: 'create' }
    });
    expect(created.status).toBe('ok');

    const settings = readYamlFile(paths.settings, {});
    const models = settings['llm-pi-ai'].providers['metadata-provider'].models;
    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'deepseek/deepseek-v4-pro',
        contextWindow: 64000,
        maxTokens: 8192,
        input: ['text', 'image'],
        reasoningEfforts: { low: 'low', high: 'high' }
      }),
      expect.objectContaining({
        id: 'explicit-efforts',
        contextWindow: 32000,
        maxTokens: 4096,
        reasoningEfforts: { high: 'high' },
        compat: { supportsStore: false }
      })
    ]));
    expect(models[0]).not.toHaveProperty('thinking');
    expect(models[0]).not.toHaveProperty('reasoning');
    expect(models[0]).not.toHaveProperty('cost');
  });

  test('dynamic proxy provider models carry channel model metadata', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const { readYamlFile } = require('../../../src/platforms/drivers/dsh/common');
    const implementation = require('../../../src/platforms/drivers/dsh/channels-implementation');
    const channelDriver = createChannelDriver({ paths });
    const created = channelDriver.create({
      body: {
        name: 'Proxy metadata provider',
        providerKey: 'proxy-metadata',
        providerApi: 'openai-completions',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-proxy-metadata',
        model: 'deepseek/deepseek-v4-pro',
        models: [{
          id: 'deepseek/deepseek-v4-pro',
          contextWindow: 128000,
          maxTokens: 16384,
          reasoning: true,
          input: ['text']
        }],
        enabled: true
      },
      route: { capability: 'channels', operation: 'create' }
    });
    expect(created.status).toBe('ok');

    implementation.setDshProxyConfig(3456, {});

    const settings = readYamlFile(paths.settings, {});
    const models = settings['llm-pi-ai'].providers['ctx-dsh-proxy'].models;
    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'deepseek/deepseek-v4-pro',
        contextWindow: 128000,
        maxTokens: 16384,
        input: ['text']
      })
    ]));
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
    expect(first.data.channel).toEqual(expect.objectContaining({ providerKey: 'primary', apiKey: 'sk-primary', apiKeyConfigured: true }));

    const edited = channelDriver.update({
      params: { channelId: first.data.channel.id },
      body: { model: 'deepseek-reasoner', apiKey: '[REDACTED]' },
      route: { capability: 'channels', operation: 'update' }
    });
    expect(edited.status).toBe('ok');
    expect(edited.data.channel.model).toBe('deepseek-reasoner');
    expect(edited.data.channel.apiKey).toBe('sk-primary');

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

  test('keeps every enabled channel in native settings for direct mode', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
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
    const second = createRequest({
      name: 'Backup',
      providerKey: 'backup',
      baseUrl: 'https://backup.example.com/v1',
      model: 'deepseek-reasoner',
      apiKey: 'sk-backup'
    });

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');

    const channels = JSON.parse(fs.readFileSync(path.join(tempHome, 'channels.json'), 'utf8')).channels;
    expect(channels).toEqual([
      expect.objectContaining({ providerKey: 'primary', enabled: true }),
      expect.objectContaining({ providerKey: 'backup', enabled: true })
    ]);

    const settingsText = fs.readFileSync(paths.settings, 'utf8');
    expect(settingsText).toContain('primary:');
    expect(settingsText).toContain('backup:');
    expect(settingsText).toContain('provider: backup');
    expect(settingsText).toContain('model: deepseek-reasoner');

    const credentialsText = fs.readFileSync(paths.credentials, 'utf8');
    expect(credentialsText).toContain('sk-primary');
    expect(credentialsText).toContain('sk-backup');

    const applied = channelDriver.applyToSettings({
      params: { channelId: first.data.channel.id },
      route: { capability: 'channels', operation: 'applyToSettings' }
    });
    expect(applied.status).toBe('ok');
    const appliedSettings = fs.readFileSync(paths.settings, 'utf8');
    expect(appliedSettings).toContain('primary:');
    expect(appliedSettings).toContain('backup:');
    expect(appliedSettings).toContain('provider: primary');
    expect(appliedSettings).toContain('model: deepseek-chat');

    channelDriver.update({
      params: { channelId: second.data.channel.id },
      body: { enabled: false, apiKey: '[REDACTED]' },
      route: { capability: 'channels', operation: 'update' }
    });
    const updatedSettings = fs.readFileSync(paths.settings, 'utf8');
    expect(updatedSettings).toContain('primary:');
    expect(updatedSettings).not.toContain('backup:');
    expect(updatedSettings).toContain('provider: primary');

    const updatedCredentials = fs.readFileSync(paths.credentials, 'utf8');
    expect(updatedCredentials).toContain('sk-primary');
    expect(updatedCredentials).not.toContain('sk-backup');
  });

  test('keeps the default model when editing a non-default channel', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
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
    createRequest({
      name: 'Backup',
      providerKey: 'backup',
      baseUrl: 'https://backup.example.com/v1',
      model: 'deepseek-reasoner',
      apiKey: 'sk-backup'
    });

    channelDriver.update({
      params: { channelId: first.data.channel.id },
      body: { weight: 3, apiKey: '[REDACTED]' },
      route: { capability: 'channels', operation: 'update' }
    });

    const settingsText = fs.readFileSync(paths.settings, 'utf8');
    expect(settingsText).toContain('provider: backup');
    expect(settingsText).toContain('model: deepseek-reasoner');
    expect(settingsText).toContain('primary:');
    expect(settingsText).toContain('backup:');
  });

  test('restores every enabled channel when stopping the managed proxy', async () => {
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
    createRequest({
      name: 'Primary',
      providerKey: 'primary',
      baseUrl: 'https://api.example.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-primary'
    });
    createRequest({
      name: 'Backup',
      providerKey: 'backup',
      baseUrl: 'https://backup.example.com/v1',
      model: 'deepseek-reasoner',
      apiKey: 'sk-backup'
    });

    const proxyDriver = createProxyDriver({
      paths,
      pathContext: { native: paths, customized: true, state }
    });
    const started = await proxyDriver.start({ port: 0 });
    expect(started.status).toBe('ok');
    expect(fs.readFileSync(paths.settings, 'utf8')).toContain('ctx-dsh-proxy');

    const stopped = await proxyDriver.stop();
    expect(stopped.status).toBe('ok');
    expect(fs.existsSync(state.activeChannel)).toBe(false);

    const settingsText = fs.readFileSync(paths.settings, 'utf8');
    expect(settingsText).not.toContain('ctx-dsh-proxy');
    expect(settingsText).toContain('primary:');
    expect(settingsText).toContain('backup:');
    expect(settingsText).toContain('provider: primary');

    const channels = JSON.parse(fs.readFileSync(state.channels, 'utf8')).channels;
    expect(channels).toEqual([
      expect.objectContaining({ providerKey: 'primary', enabled: true }),
      expect.objectContaining({ providerKey: 'backup', enabled: true })
    ]);
  });

  test('removes a deleted channel provider while the managed proxy is active', async () => {
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
    createRequest({
      name: 'Primary',
      providerKey: 'primary',
      baseUrl: 'https://api.example.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-primary'
    });
    const backup = createRequest({
      name: 'Backup',
      providerKey: 'backup',
      baseUrl: 'https://backup.example.com/v1',
      model: 'deepseek-reasoner',
      apiKey: 'sk-backup'
    });

    const proxyDriver = createProxyDriver({
      paths,
      pathContext: { native: paths, customized: true, state }
    });
    await proxyDriver.start({ port: 0 });
    expect(fs.readFileSync(paths.settings, 'utf8')).toContain('backup:');

    const removed = channelDriver.remove({
      params: { channelId: backup.data.channel.id },
      route: { capability: 'channels', operation: 'remove' }
    });
    expect(removed.status).toBe('ok');

    const settingsText = fs.readFileSync(paths.settings, 'utf8');
    expect(settingsText).toContain('ctx-dsh-proxy');
    expect(settingsText).toContain('primary:');
    expect(settingsText).not.toContain('backup:');

    const stopped = await proxyDriver.stop();
    expect(stopped.status).toBe('ok');
  });

  test('rejects starting the managed proxy with enabled non-completions providers', async () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const channelDriver = createChannelDriver({ paths });
    const created = channelDriver.create({
      body: {
        name: 'Anthropic provider',
        providerKey: 'anthropic-provider',
        providerApi: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.example/v1',
        model: 'claude-live-model',
        models: ['claude-live-model'],
        apiKey: 'sk-anthropic'
      },
      route: { capability: 'channels', operation: 'create' }
    });
    expect(created.status).toBe('ok');

    const proxyDriver = createProxyDriver({
      paths,
      pathContext: {
        native: paths,
        customized: true,
        state: {
          channels: path.join(tempHome, 'channels.json'),
          activeChannel: path.join(tempHome, 'active-channel.json'),
          proxyRuntime: path.join(tempHome, 'dsh-proxy.json')
        }
      }
    });
    const started = await proxyDriver.start({ port: 0 });

    expect(started.status).toBe('failed');
    expect(started.error).toContain('仅支持 OpenAI Chat Completions');
    expect(started.error).toContain('Anthropic provider');
  });

  test('rejects enabling non-completions channels while the managed proxy is active', () => {
    tempHome = makeTempHome();
    const paths = dshPaths(tempHome);
    const channelDriver = createChannelDriver({ paths });
    const created = channelDriver.create({
      body: {
        name: 'Anthropic provider',
        providerKey: 'anthropic-provider',
        providerApi: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.example/v1',
        model: 'claude-live-model',
        models: ['claude-live-model'],
        apiKey: 'sk-anthropic',
        enabled: false
      },
      route: { capability: 'channels', operation: 'create' }
    });
    expect(created.status).toBe('ok');
    writeJson(path.join(tempHome, 'active-channel.json'), { activeChannelId: 'active-channel' });

    const enabled = channelDriver.update({
      params: { channelId: created.data.channel.id },
      body: { enabled: true },
      route: { capability: 'channels', operation: 'update' }
    });

    expect(enabled.status).toBe('conflict');
    expect(enabled.error).toContain('仅支持 OpenAI Chat Completions');
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
