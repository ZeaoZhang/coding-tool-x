const fs = require('fs');
const os = require('os');
const path = require('path');

const OMP_SESSIONS_PATH = require.resolve('../../../src/server/services/omp-sessions');
const OMP_CONFIG_PATH = require.resolve('../../../src/server/services/omp-config');
const PATHS_PATH = require.resolve('../../../src/config/paths');
const SESSION_INDEX_PATH = require.resolve('../../../src/server/services/session-history-index');

let testDir;
let sessionDir;
let getOmpPathsMock;
let isOmpInstalledMock;
let resolveOmpRuntimeMock;

function writeJsonl(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    entries.map(entry => typeof entry === 'string' ? entry : JSON.stringify(entry)).join('\n') + '\n',
    'utf8'
  );
}

function loadModule() {
  return require('../../../src/server/services/omp-sessions');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-sessions-'));
  sessionDir = path.join(testDir, '.omp', 'agent', 'sessions');

  delete require.cache[OMP_SESSIONS_PATH];
  delete require.cache[OMP_CONFIG_PATH];
  getOmpPathsMock = vi.fn(() => ({
    agentDir: path.join(testDir, '.omp', 'agent'),
    sessions: sessionDir
  }));
  isOmpInstalledMock = vi.fn(() => true);
  resolveOmpRuntimeMock = vi.fn(() => ({
    runtime: 'omp',
    command: 'omp',
    installed: true
  }));
  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      HOME_DIR: testDir,
      PATHS: {
        base: testDir,
        sessionHistoryIndex: path.join(testDir, 'session-history.sqlite'),
        ompProjectOrder: path.join(testDir, 'omp-project-order.json'),
        ompSessionOrder: path.join(testDir, 'omp-session-order.json')
      },
      NATIVE_PATHS: {
        claude: { projects: path.join(testDir, '.claude', 'projects') },
        codex: { config: path.join(testDir, '.codex', 'config.toml') },
        gemini: { env: path.join(testDir, '.gemini', '.env') }
      }
    }
  };
  require.cache[OMP_CONFIG_PATH] = {
    id: OMP_CONFIG_PATH,
    filename: OMP_CONFIG_PATH,
    loaded: true,
    exports: {
      getOmpCommand: () => 'omp',
      getOmpPaths: getOmpPathsMock,
      isOmpInstalled: isOmpInstalledMock,
      resolveOmpRuntime: resolveOmpRuntimeMock
    }
  };
});

afterEach(() => {
  if (require.cache[SESSION_INDEX_PATH]) require(SESSION_INDEX_PATH).closeSessionHistoryIndex();
  delete require.cache[OMP_SESSIONS_PATH];
  delete require.cache[OMP_CONFIG_PATH];
  delete require.cache[SESSION_INDEX_PATH];
  delete require.cache[require.resolve('../../../src/server/services/session-history-adapters')];
  delete require.cache[require.resolve('../../../src/server/services/session-history-adapters/omp')];
  delete require.cache[PATHS_PATH];
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('OMP session parser', () => {
  test('uses the native session directory without probing OMP', () => {
    fs.mkdirSync(path.join(testDir, '.omp', 'agent'), { recursive: true });

    const { isOmpInstalled } = loadModule();

    expect(isOmpInstalled()).toBe(true);
    expect(getOmpPathsMock).toHaveBeenCalledWith(process.env, { resolveRuntime: false });
    expect(resolveOmpRuntimeMock).not.toHaveBeenCalled();
    expect(isOmpInstalledMock).not.toHaveBeenCalled();
  });

  test('builds OMP launch commands by default', () => {
    const { buildLaunchCommand } = loadModule();

    expect(buildLaunchCommand('omp-session-1', '/repo/demo', { rpc: true }))
      .toBe('omp --mode rpc --session "omp-session-1"');
    expect(buildLaunchCommand('omp-session-1', '/repo/demo', { fork: true }))
      .toBe('omp --fork "omp-session-1"');
  });

  test('parses v3 JSONL header, roles, usage, and latest model change', async () => {
    const sessionFile = path.join(sessionDir, 'session-1.jsonl');
    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'omp-session-1', timestamp: '2026-05-20T00:00:00.000Z', cwd: '/repo/demo' },
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
      { type: 'model_change', provider: 'openai', modelId: 'gpt-omp' }
    ]);

    const { getProjects, getSessionsByProject, getSessionMessages, parseSessionFile } = loadModule();
    const parsed = parseSessionFile(sessionFile);
    const projects = await getProjects();
    const sessions = await getSessionsByProject(parsed.projectName);
    const messages = await getSessionMessages('omp-session-1');

    expect(parsed).toEqual(expect.objectContaining({
      sessionId: 'omp-session-1',
      cwd: '/repo/demo',
      projectName: '----repo--demo--',
      preview: 'Build this',
      messageCount: 3,
      provider: 'openai',
      model: 'gpt-omp',
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
        latestSession: 'omp-session-1'
      })
    ]);
    expect(sessions).toEqual([
      expect.objectContaining({
        sessionId: 'omp-session-1',
        provider: 'openai',
        model: 'gpt-omp',
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
      { type: 'session', version: 3, id: 'omp-session-2', cwd: '/repo/broken' },
      '{bad json',
      { type: 'message', id: 'u1', message: { role: 'user', content: 'Still parse' } }
    ]);

    const { parseSessionFile } = loadModule();
    const parsed = parseSessionFile(sessionFile);

    expect(parsed).toEqual(expect.objectContaining({
      sessionId: 'omp-session-2',
      preview: 'Still parse',
      messageCount: 1
    }));
  });

  test('extracts stable assistant usage events with the provider and model active at that message', () => {
    const sessionFile = path.join(sessionDir, 'session-usage.jsonl');
    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'omp-session-usage', cwd: '/repo/usage' },
      { type: 'model_change', provider: 'ctx-first', modelId: 'gpt-first' },
      {
        type: 'message',
        id: 'a1',
        timestamp: '2026-07-27T03:00:00.000Z',
        message: {
          role: 'assistant',
          content: 'first',
          usage: { input: 10, output: 20, totalTokens: 30 }
        }
      },
      { type: 'model_change', provider: 'ctx-second', modelId: 'gpt-second' },
      {
        type: 'message',
        id: 'a2',
        timestamp: '2026-07-27T03:01:00.000Z',
        message: {
          role: 'assistant',
          content: 'second',
          provider: 'message-provider',
          model: 'message-model',
          usage: { inputTokens: 3, outputTokens: 4, reasoningTokens: 2, cost: { total: 0.5 } }
        }
      },
      {
        type: 'message',
        id: 'tool-1',
        message: { role: 'toolResult', content: 'not a model response' }
      }
    ]);

    const { getOmpUsageEvents } = loadModule();

    expect(getOmpUsageEvents()).toEqual([
      expect.objectContaining({
        key: `${sessionFile}:a1`,
        id: 'omp-session-usage:a1',
        provider: 'ctx-first',
        model: 'gpt-first',
        usage: expect.objectContaining({ input: 10, output: 20, total: 30 })
      }),
      expect.objectContaining({
        key: `${sessionFile}:a2`,
        id: 'omp-session-usage:a2',
        provider: 'message-provider',
        model: 'message-model',
        usage: expect.objectContaining({
          input: 3,
          output: 4,
          reasoning: 2,
          total: 9,
          cost: 0.5
        })
      })
    ]);
  });

  test('usage event cursor only reparses session files that changed', () => {
    const sessionFile = path.join(sessionDir, 'session-cursor.jsonl');
    const firstEntries = [
      { type: 'session', version: 3, id: 'omp-session-cursor', cwd: '/repo/cursor' },
      {
        type: 'message',
        id: 'a1',
        message: { role: 'assistant', model: 'gpt-one', usage: { input: 1, output: 1 } }
      }
    ];
    writeJsonl(sessionFile, firstEntries);
    const { createOmpUsageEventCursor } = loadModule();
    const cursor = createOmpUsageEventCursor(sessionDir);

    expect(cursor.read()).toHaveLength(1);
    expect(cursor.read()).toEqual([]);

    writeJsonl(sessionFile, [
      ...firstEntries,
      {
        type: 'message',
        id: 'a2',
        message: { role: 'assistant', model: 'gpt-two', usage: { input: 2, output: 2 } }
      }
    ]);

    expect(cursor.read()).toHaveLength(2);
    expect(cursor.read()).toEqual([]);
  });
});
