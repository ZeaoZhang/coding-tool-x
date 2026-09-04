'use strict';

const inquirer = require('inquirer');
const workspaceService = require('../../../src/server/services/workspace-service');

function createHarness(projectsDriver, { supportsProjects = true } = {}) {
  const registry = {
    resolve: vi.fn(key => key === 'demo-cli'
      ? {
        key,
        label: 'Demo CLI',
        command: 'demo'
      }
      : null),
    getCapability: vi.fn((_key, capability) => (
      capability === 'projects' && supportsProjects ? 'fake-projects' : null
    ))
  };
  const runtime = {
    getDriver: vi.fn(() => projectsDriver)
  };
  return { registry, runtime };
}

function stubPrompts(selectedProject, { confirm = false } = {}) {
  vi.spyOn(inquirer, 'prompt').mockImplementation(async questions => {
    const question = questions[0];
    if (question.name === 'name') return { name: 'demo-workspace' };
    if (question.name === 'description') return { description: '' };
    if (question.name === 'baseDirOption') return { baseDirOption: 'auto' };
    if (question.name === 'selectedProject') {
      const value = stubPrompts.nextSelection;
      stubPrompts.nextSelection = null;
      return { selectedProject: value };
    }
    if (question.name === 'linkName') return { linkName: 'demo' };
    if (question.name === 'confirm') return { confirm };
    throw new Error(`unexpected prompt: ${question.name}`);
  });
  stubPrompts.nextSelection = selectedProject;
}

describe('platform workspace project discovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('uses the selected platform project Driver for choices', async () => {
    const project = { name: 'demo', displayName: 'Demo Project', fullPath: '/tmp/demo', sessionCount: 3 };
    const projects = {
      listProjects: vi.fn().mockResolvedValue([project])
    };
    const harness = createHarness(projects);
    stubPrompts(project);
    vi.spyOn(workspaceService, 'isGitRepo').mockReturnValue(false);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createWorkspace } = require('../../../src/commands/workspace');

    await createWorkspace({
      config: { currentCliType: 'demo-cli' },
      registry: harness.registry,
      runtime: harness.runtime
    });

    expect(projects.listProjects).toHaveBeenCalledWith({
      config: { currentCliType: 'demo-cli' }
    });
    expect(inquirer.prompt).toHaveBeenCalled();
  });

  test('stops with an explicit unsupported message without Claude discovery', async () => {
    const projects = {};
    const harness = createHarness(projects, { supportsProjects: false });
    stubPrompts(null);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createWorkspace } = require('../../../src/commands/workspace');

    await createWorkspace({
      config: { currentCliType: 'demo-cli' },
      registry: harness.registry,
      runtime: harness.runtime
    });

    expect(harness.runtime.getDriver).not.toHaveBeenCalled();
    expect(console.log.mock.calls.flat().join('\n')).toContain('不支持');
  });
});
