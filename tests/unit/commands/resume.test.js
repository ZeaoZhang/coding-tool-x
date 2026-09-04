'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function createRegistry(platform = 'claude') {
  return {
    resolve: vi.fn(key => key === platform
      ? { key, label: platform === 'claude' ? 'Claude Code' : 'Demo CLI', command: platform, capabilities: { sessions: 'fake' } }
      : null),
    getCapability: vi.fn((_key, capability) => capability === 'sessions' ? 'fake' : null)
  };
}

describe('platform session launch', () => {
  let originalSetTimeout;
  let removeListenersSpy;
  let pauseSpy;
  let exitSpy;

  beforeEach(() => {
    originalSetTimeout = global.setTimeout;
    global.setTimeout = (callback) => {
      callback();
      return 0;
    };
    removeListenersSpy = vi.spyOn(process.stdin, 'removeAllListeners').mockImplementation(() => process.stdin);
    pauseSpy = vi.spyOn(process.stdin, 'pause').mockImplementation(() => process.stdin);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    global.setTimeout = originalSetTimeout;
    vi.restoreAllMocks();
  });

  test('routes Claude launch through the session Driver', async () => {
    const launch = vi.fn().mockReturnValue({
      status: 'ok',
      data: { status: 0, cwd: '/tmp/project' }
    });
    const runtime = { getDriver: vi.fn(() => ({ launch })) };
    const registry = createRegistry('claude');
    const { resumeSession } = require('../../../src/commands/resume');
    const config = { currentCliType: 'claude', currentProject: 'demo' };
    const processRunner = vi.fn();

    await resumeSession(config, 'session-123', true, {
      registry,
      runtime,
      processRunner
    });

    expect(launch).toHaveBeenCalledWith('session-123', expect.objectContaining({
      fork: true,
      config,
      processRunner
    }));
    expect(processRunner).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(removeListenersSpy).toHaveBeenCalled();
    expect(pauseSpy).toHaveBeenCalled();
  });

  test('builds an argument-vector Claude launch with session cwd', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tool-resume-'));
    const projectDir = path.join(root, 'demo');
    const sessionCwd = path.join(root, 'workspace');
    fs.mkdirSync(projectDir);
    fs.mkdirSync(sessionCwd);
    fs.writeFileSync(path.join(projectDir, 'session-123.jsonl'), '{"cwd":"' + sessionCwd + '"}\n');
    const processRunner = vi.fn(() => ({ status: 0, signal: null }));
    const implementation = require('../../../src/platforms/drivers/claude/sessions-implementation');

    try {
      const result = implementation.launch('session-123', {
        fork: true,
        config: { projectsDir: root, currentProject: 'demo' },
        processRunner
      });

      expect(processRunner).toHaveBeenCalledWith(
        'claude',
        ['-r', 'session-123', '--fork-session'],
        { cwd: sessionCwd, stdio: 'inherit', windowsHide: true }
      );
      expect(result).toMatchObject({ status: 0, cwd: sessionCwd });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.each(['demo-cli', 'codex', 'gemini', 'opencode', 'omp'])('%s without launch stays unsupported', async platform => {
    const registry = createRegistry(platform);
    const runtime = { getDriver: vi.fn(() => ({})) };
    const { resumeSession } = require('../../../src/commands/resume');

    const result = await resumeSession(
      { currentCliType: platform, currentProject: 'demo' },
      'session-123',
      false,
      { registry, runtime }
    );

    expect(result).toMatchObject({
      status: 'unsupported',
      platform,
      capability: 'sessions',
      operation: 'launch'
    });
    expect(runtime.getDriver).toHaveBeenCalledWith(platform, 'sessions');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
