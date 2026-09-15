'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPlatformRegistry } = require('../../../src/platforms/registry');
const { AgentsService } = require('../../../src/platforms/agents-service');
const { CommandsService } = require('../../../src/platforms/commands-service');

describe('configurable native resource paths', () => {
  let root;
  let registry;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tool-configurable-paths-'));
    registry = createPlatformRegistry({
      pathOverlay: {
        platforms: {
          claude: {
            paths: {
              home: path.join(root, 'claude'),
              settings: path.join(root, 'claude', 'settings.json'),
              agents: path.join(root, 'claude', 'custom-agents'),
              commands: path.join(root, 'claude', 'custom-commands'),
              channels: path.join(root, 'state', 'claude-channels.json'),
              activeChannel: path.join(root, 'state', 'claude-active.json')
            }
          }
        }
      }
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('routes Agents and Commands services to the configured native roots', () => {
    const agents = new AgentsService('claude', { registry });
    const commands = new CommandsService('claude', { registry });

    expect(agents.userAgentsDir).toBe(path.join(root, 'claude', 'custom-agents'));
    expect(commands.userCommandsDir).toBe(path.join(root, 'claude', 'custom-commands'));
    expect(registry.resolvePathContext('claude').state).toEqual(expect.objectContaining({
      channels: path.join(root, 'state', 'claude-channels.json'),
      activeChannel: path.join(root, 'state', 'claude-active.json')
    }));

    agents.dispose();
    commands.dispose();
  });

  test('writes and reads a resource without touching the default native root', () => {
    const commands = new CommandsService('claude', { registry });
    const command = commands.createCommand({
      name: 'configured-command',
      scope: 'user',
      description: 'configured',
      body: 'echo configured'
    });

    expect(command.fullPath).toBe(path.join(root, 'claude', 'custom-commands', 'configured-command.md'));
    expect(fs.existsSync(command.fullPath)).toBe(true);
    commands.dispose();
  });
});
