'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPlatformRegistry } = require('../../../src/platforms/registry');
const { createPlatformRuntime } = require('../../../src/platforms/runtime');
const { getDriverRegistry } = require('../../../src/platforms/driver-registry');

describe('demo-cli configuration-only contract', () => {
  test('discovers generic capabilities without server platform branches', () => {
    const registry = createPlatformRegistry({
      builtIns: [],
      userFile: {
        platforms: [{
          key: 'demo-cli',
          label: 'Demo CLI',
          command: 'demo',
          iconToken: 'terminal',
          paths: { home: '/tmp/demo-cli', sessions: '/tmp/demo-cli/sessions', baseUrl: 'https://demo.invalid/v1' },
          resourceMappings: { skills: '{home}/skills' },
          sessionMapping: { sessionId: 'id', projectName: 'project', messages: 'messages' },
          capabilities: {
            sessions: 'generic-jsonl',
            resourceSync: 'generic-filesystem',
            channels: 'generic-openai-compatible',
            proxy: 'unsupported'
          }
        }]
      }
    });
    const runtime = createPlatformRuntime({ registry, driverRegistry: getDriverRegistry() });

    expect(registry.resolve('demo-cli')).toEqual(expect.objectContaining({ key: 'demo-cli' }));
    expect(typeof runtime.getDriver('demo-cli', 'sessions').inventory).toBe('function');
    expect(typeof runtime.getDriver('demo-cli', 'resourceSync').sync).toBe('function');
    expect(typeof runtime.getDriver('demo-cli', 'channels').request).toBe('function');
    expect(runtime.getDriver('demo-cli', 'proxy')).toEqual({
      status: 'unsupported', platform: 'demo-cli', capability: 'proxy'
    });
  });

  test('aggregates project, session, and resource discovery from manifest drivers', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-cli-contract-'));
    const sessionsDir = path.join(root, 'sessions');
    const skillsDir = path.join(root, 'skills');
    fs.mkdirSync(sessionsDir);
    fs.mkdirSync(skillsDir);
    fs.writeFileSync(path.join(sessionsDir, 'session-1.jsonl'), JSON.stringify({
      id: 'session-1',
      project: 'demo-project',
      messages: [{ role: 'user', content: 'Hello' }]
    }));
    fs.writeFileSync(path.join(skillsDir, 'skill.md'), '# Demo skill');

    try {
      const registry = createPlatformRegistry({
        builtIns: [],
        userFile: {
          platforms: [{
            key: 'demo-cli',
            label: 'Demo CLI',
            command: 'demo',
            paths: { home: root, sessions: sessionsDir },
            resourceMappings: { skills: skillsDir },
            sessionMapping: { sessionId: 'id', projectName: 'project', messages: 'messages' },
            capabilities: {
              sessions: 'generic-jsonl',
              resourceSync: 'generic-filesystem'
            }
          }]
        }
      });
      const runtime = createPlatformRuntime({
        registry,
        driverRegistry: getDriverRegistry(),
        dependencies: { fsImpl: fs.promises }
      });

      const sessions = runtime.getDriver('demo-cli', 'sessions');
      const inventory = await sessions.inventory();
      const parsed = await sessions.parse(inventory[0]);
      const resources = await runtime.getDriver('demo-cli', 'resourceSync').list('skills');

      expect(parsed).toEqual(expect.objectContaining({
        sessionId: 'session-1',
        projectName: 'demo-project',
        messages: [{ role: 'user', content: 'Hello' }]
      }));
      expect(resources).toEqual([expect.objectContaining({
        name: 'skill.md',
        type: 'file'
      })]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
