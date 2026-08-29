'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { once } = require('events');
const { createPlatformRegistry } = require('../../../src/platforms/registry');
const { createPlatformRuntime } = require('../../../src/platforms/runtime');
const { getDriverRegistry } = require('../../../src/platforms/driver-registry');
const { createPlatformRouter } = require('../../../src/server/api/platforms');
const { createSessionHistoryIndex } = require('../../../src/server/services/session-history-index');

async function requestJson(app, route) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('config-only generic platform contract', () => {
  it('discovers routes, indexes sessions, and syncs resources without platform source changes', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-contract-home-'));
    const dbPath = path.join(tempHome, 'index.sqlite');
    const sessionsDir = path.join(tempHome, 'sessions');
    const skillsDir = path.join(tempHome, 'skills');
    const sourceDir = path.join(tempHome, 'source-review');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'session-1.jsonl'), JSON.stringify({
      id: 'session-1',
      project: 'demo-project',
      messages: [{ id: 'm1', role: 'user', content: 'hello demo' }]
    }) + '\n', 'utf8');
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '# Demo skill', 'utf8');

    const demoManifest = {
      key: 'demo-cli',
      label: 'Demo CLI',
      command: 'demo',
      iconToken: 'terminal',
      paths: { home: tempHome, sessions: '{home}/sessions' },
      resourceMappings: { skills: '{home}/skills' },
      sessionMapping: { sessionId: 'id', projectName: 'project', messages: 'messages' },
      capabilities: {
        sessions: 'generic-jsonl',
        resourceSync: 'generic-filesystem',
        proxy: 'unsupported',
        statistics: 'unsupported'
      }
    };
    const registry = createPlatformRegistry({ builtIns: [], userFile: { platforms: [demoManifest] } });
    const runtime = createPlatformRuntime({ registry, driverRegistry: getDriverRegistry() });

    expect(registry.list().map(platform => platform.key)).toEqual(['demo-cli']);
    expect(registry.resolvePaths('demo-cli').sessions).toBe(sessionsDir);

    const app = express();
    app.use('/api/platforms', createPlatformRouter({ registry, runtime }));
    const catalog = await requestJson(app, '/api/platforms');
    expect(catalog.body.platforms[0]).toEqual(expect.objectContaining({ key: 'demo-cli', label: 'Demo CLI' }));
    expect(catalog.body.platforms[0]).not.toHaveProperty('paths');

    const index = createSessionHistoryIndex({
      dbPath,
      runtime,
      workerRunner: vi.fn(async () => {}),
      ftsEnabledOverride: false
    });
    try {
      await index.ensureSourceIndexed('demo-cli', { consistency: 'complete' });
      const sessions = await index.listSessions('demo-cli', 'demo-project');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toEqual(expect.objectContaining({ sessionId: 'session-1', projectName: 'demo-project' }));

      const resourceDriver = runtime.getDriver('demo-cli', 'resourceSync');
      expect(await resourceDriver.sync('skills', 'review', sourceDir)).toEqual(expect.objectContaining({ status: 'ok' }));
      expect(fs.existsSync(path.join(skillsDir, 'review', 'SKILL.md'))).toBe(true);
      expect(runtime.getDriver('demo-cli', 'proxy')).toEqual({
        status: 'unsupported',
        platform: 'demo-cli',
        capability: 'proxy'
      });
    } finally {
      index.closeSessionHistoryIndex();
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
