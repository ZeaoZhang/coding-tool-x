'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let tempDir;
let registry;

function loadRegistry() {
  const pathsPath = require.resolve('../../../src/config/paths');
  require.cache[pathsPath] = {
    id: pathsPath,
    filename: pathsPath,
    loaded: true,
    exports: { PATHS: { config: path.join(tempDir, 'config'), base: tempDir } }
  };
  const modPath = require.resolve('../../../src/platforms/drivers/claude/project-registry');
  delete require.cache[modPath];
  return require('../../../src/platforms/drivers/claude/project-registry');
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-registry-'));
  registry = loadRegistry();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('claude project registry', () => {
  test('registers and resolves a created project', () => {
    const projectPath = path.join(tempDir, 'project');
    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true });

    const entry = registry.registerProject('my-project', { projectPath });

    expect(entry).toMatchObject({ projectName: 'my-project', projectPath });
    expect(registry.getRegisteredProject('my-project')).toMatchObject({
      projectPath,
      claudeDir: path.join(projectPath, '.claude')
    });
  });

  test('removes the initialized .claude directory and the registry entry', () => {
    const projectPath = path.join(tempDir, 'project');
    const claudeDir = path.join(projectPath, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'project.json'), '{}');
    registry.registerProject('my-project', { projectPath, claudeDir });

    const removed = registry.removeRegisteredProject('my-project');

    expect(removed).toMatchObject({ projectPath });
    expect(fs.existsSync(claudeDir)).toBe(false);
    expect(registry.getRegisteredProject('my-project')).toBeNull();
  });

  test('does not remove an arbitrary directory stored as claudeDir', () => {
    const projectPath = path.join(tempDir, 'project');
    const unsafeDir = path.join(tempDir, 'not-claude');
    fs.mkdirSync(unsafeDir, { recursive: true });
    const registryPath = registry.getRegistryPath();
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify({
      'unsafe-project': { projectName: 'unsafe-project', projectPath, claudeDir: unsafeDir }
    }));

    registry.removeRegisteredProject('unsafe-project');

    expect(fs.existsSync(unsafeDir)).toBe(true);
    expect(registry.getRegisteredProject('unsafe-project')).toBeNull();
  });

  test('unregister returns false for unknown projects', () => {
    expect(registry.unregisterProject('missing')).toBe(false);
  });
});
