const fs = require('fs');
const os = require('os');
const path = require('path');

const PI_SESSIONS_PATH = require.resolve('../../../src/server/services/pi-sessions');
const PI_CONFIG_PATH = require.resolve('../../../src/server/services/pi-config');
const PATHS_PATH = require.resolve('../../../src/config/paths');

let testDir;
let sessionDir;

function writeJsonl(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    entries.map(entry => typeof entry === 'string' ? entry : JSON.stringify(entry)).join('\n') + '\n',
    'utf8'
  );
}

function loadModule() {
  return require('../../../src/server/services/pi-sessions');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-sessions-'));
  sessionDir = path.join(testDir, '.omp', 'agent', 'sessions');

  delete require.cache[PI_SESSIONS_PATH];
  delete require.cache[PI_CONFIG_PATH];
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      HOME_DIR: testDir,
      PATHS: {
        piProjectOrder: path.join(testDir, 'pi-project-order.json'),
        piSessionOrder: path.join(testDir, 'pi-session-order.json')
      }
    }
  };
});

afterEach(() => {
  delete require.cache[PI_SESSIONS_PATH];
  delete require.cache[PI_CONFIG_PATH];
  delete require.cache[PATHS_PATH];
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('Pi session parser', () => {
  test('builds OMP launch commands by default', () => {
    const { buildLaunchCommand } = loadModule();

    expect(buildLaunchCommand('pi-session-1', '/repo/demo', { rpc: true }))
      .toBe('omp --mode rpc --session "pi-session-1"');
    expect(buildLaunchCommand('pi-session-1', '/repo/demo', { fork: true }))
      .toBe('omp --fork "pi-session-1"');
  });

  test('parses v3 JSONL header, roles, usage, and latest model change', () => {
    const sessionFile = path.join(sessionDir, 'session-1.jsonl');
    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'pi-session-1', timestamp: '2026-05-20T00:00:00.000Z', cwd: '/repo/demo' },
      { type: 'message', id: 'u1', timestamp: '2026-05-20T00:00:01.000Z', message: { role: 'user', content: 'Build this' } },
      {
        type: 'message',
        id: 'a1',
        timestamp: '2026-05-20T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done' }],
          model: 'old-model',
          usage: {
            input: 10,
            output: 20,
            cacheRead: 3,
            cacheWrite: 4,
            totalTokens: 37,
            cost: { total: 0.123 }
          }
        }
      },
      { type: 'message', id: 'tool-1', message: { role: 'toolResult', content: 'tool output' } },
      { type: 'model_change', provider: 'openai', modelId: 'gpt-pi' }
    ]);

    const { getProjects, getSessionsByProject, getSessionMessages, parseSessionFile } = loadModule();
    const parsed = parseSessionFile(sessionFile);
    const projects = getProjects();
    const sessions = getSessionsByProject(parsed.projectName);
    const messages = getSessionMessages('pi-session-1');

    expect(parsed).toEqual(expect.objectContaining({
      sessionId: 'pi-session-1',
      cwd: '/repo/demo',
      projectName: '----repo--demo--',
      preview: 'Build this',
      messageCount: 3,
      provider: 'openai',
      model: 'gpt-pi',
      usage: expect.objectContaining({
        input: 10,
        output: 20,
        cached: 3,
        total: 37
      })
    }));
    expect(projects).toEqual([
      expect.objectContaining({
        name: '----repo--demo--',
        displayName: 'demo',
        sessionCount: 1,
        latestSession: 'pi-session-1'
      })
    ]);
    expect(sessions).toEqual([
      expect.objectContaining({
        sessionId: 'pi-session-1',
        provider: 'openai',
        model: 'gpt-pi',
        tokens: expect.objectContaining({ total: 37 })
      })
    ]);
    expect(messages).toEqual([
      expect.objectContaining({ id: 'u1', type: 'user', content: 'Build this' }),
      expect.objectContaining({ id: 'a1', type: 'assistant', content: 'Done' }),
      expect.objectContaining({ id: 'tool-1', type: 'assistant', subtype: 'toolResult', content: 'tool output' })
    ]);
  });

  test('tolerates malformed JSONL rows', () => {
    const sessionFile = path.join(sessionDir, 'session-2.jsonl');
    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'pi-session-2', cwd: '/repo/broken' },
      '{bad json',
      { type: 'message', id: 'u1', message: { role: 'user', content: 'Still parse' } }
    ]);

    const { parseSessionFile } = loadModule();
    const parsed = parseSessionFile(sessionFile);

    expect(parsed).toEqual(expect.objectContaining({
      sessionId: 'pi-session-2',
      preview: 'Still parse',
      messageCount: 1
    }));
  });
});
