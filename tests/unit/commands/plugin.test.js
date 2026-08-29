'use strict';

const Module = require('module');
const PLUGIN_COMMAND_MODULE = require.resolve('../../../src/commands/plugin');
const PLUGIN_INSTALLER_MODULE = require.resolve('../../../src/plugins/plugin-installer');

function loadPluginCommand() {
  delete require.cache[PLUGIN_COMMAND_MODULE];
  delete require.cache[PLUGIN_INSTALLER_MODULE];
  const originalLoad = Module._load;
  const calls = [];
  Module._load = function trackedLoad(request, parent, isMain) {
    calls.push(request);
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const command = require('../../../src/commands/plugin');
    return { command, calls };
  } finally {
    Module._load = originalLoad;
    delete require.cache[PLUGIN_COMMAND_MODULE];
  }
}

test('loading plugin command does not load inquirer', () => {
  const { calls } = loadPluginCommand();

  expect(calls).not.toContain('inquirer');
  expect(calls).not.toContain('../plugins/plugin-installer');
});

test('plugin list remains non-interactive', async () => {
  const { command, calls } = loadPluginCommand();
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  try {
    await command.handlePluginCommand(['list']);
  } finally {
    logSpy.mockRestore();
  }

  expect(calls).not.toContain('inquirer');
  expect(calls).not.toContain('../plugins/plugin-installer');
});
