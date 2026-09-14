const fs = require('fs');
const os = require('os');
const path = require('path');

const OMP_SESSIONS_PATH = require.resolve('../../../src/platforms/drivers/omp/sessions-implementation');
const OMP_CONFIG_PATH = require.resolve('../../../src/platforms/drivers/omp/config');
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

function appendJsonl(filePath, entries, { trailingNewline = true } = {}) {
  const content = entries
    .map(entry => typeof entry === 'string' ? entry : JSON.stringify(entry))
    .join('\n');
  fs.appendFileSync(filePath, content + (trailingNewline ? '\n' : ''), 'utf8');
}

function loadModule() {
  return require('../../../src/platforms/drivers/omp/sessions-implementation');
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
  delete require.cache[require.resolve('../../../src/platforms/session-history-adapters')];
  delete require.cache[require.resolve('../../../src/platforms/drivers/omp/session-history-adapter')];
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

  test('establishes a baseline and emits only appended usage events', () => {
    const sessionFile = path.join(sessionDir, 'session-cursor.jsonl');
    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'omp-session-cursor', cwd: '/repo/cursor' },
      {
        type: 'message',
        id: 'a1',
        message: { role: 'assistant', model: 'gpt-one', usage: { input: 1, output: 1 } }
      }
    ]);
    const { createOmpUsageEventCursor } = loadModule();
    const cursor = createOmpUsageEventCursor(sessionDir);

    expect(cursor.read()).toEqual([]);
    expect(cursor.read()).toEqual([]);

    appendJsonl(sessionFile, [{
      type: 'message',
      id: 'a2',
      message: { role: 'assistant', model: 'gpt-two', usage: { input: 2, output: 2 } }
    }]);

    expect(cursor.read()).toEqual([
      expect.objectContaining({
        id: 'omp-session-cursor:a2',
        provider: '',
        model: 'gpt-two',
        usage: expect.objectContaining({ input: 2, output: 2, total: 4 })
      })
    ]);
    expect(cursor.read()).toEqual([]);
  });

  test('emits all complete events from a file created after the baseline', () => {
    const { createOmpUsageEventCursor } = loadModule();
    const cursor = createOmpUsageEventCursor(sessionDir);
    expect(cursor.read()).toEqual([]);

    const sessionFile = path.join(sessionDir, 'session-new.jsonl');
    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'omp-session-new', timestamp: '2026-07-27T04:00:00.000Z' },
      { type: 'model_change', provider: 'native-provider', modelId: 'native-model' },
      {
        type: 'message',
        id: 'a1',
        message: { role: 'assistant', usage: { input: 3, output: 4 } }
      }
    ]);

    expect(cursor.read()).toEqual([
      expect.objectContaining({
        id: 'omp-session-new:a1',
        provider: 'native-provider',
        model: 'native-model'
      })
    ]);
  });

  test('holds an incomplete UTF-8 JSONL row until its newline arrives', () => {
    const sessionFile = path.join(sessionDir, 'session-partial.jsonl');
    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'omp-session-partial' }
    ]);
    const { createOmpUsageEventCursor } = loadModule();
    const cursor = createOmpUsageEventCursor(sessionDir);
    expect(cursor.read()).toEqual([]);

    const row = Buffer.from(JSON.stringify({
      type: 'message',
      id: 'a1',
      message: { role: 'assistant', content: '你好', usage: { input: 5, output: 6 } }
    }));
    const splitAt = row.indexOf(Buffer.from('你')) + 1;
    fs.appendFileSync(sessionFile, row.subarray(0, splitAt));
    expect(cursor.read()).toEqual([]);

    fs.appendFileSync(
      sessionFile,
      Buffer.concat([row.subarray(splitAt), Buffer.from('\n')])
    );
    expect(cursor.read()).toEqual([
      expect.objectContaining({
        id: 'omp-session-partial:a1',
        usage: expect.objectContaining({ input: 5, output: 6, total: 11 })
      })
    ]);
    expect(cursor.read()).toEqual([]);
  });

  test('carries model state into appended messages without provider metadata', () => {
    const sessionFile = path.join(sessionDir, 'session-model-state.jsonl');
    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'omp-session-model-state' },
      { type: 'model_change', provider: 'active-provider', modelId: 'active-model' }
    ]);
    const { createOmpUsageEventCursor } = loadModule();
    const cursor = createOmpUsageEventCursor(sessionDir);
    expect(cursor.read()).toEqual([]);

    appendJsonl(sessionFile, [{
      type: 'message',
      id: 'a1',
      message: { role: 'assistant', usage: { input: 1, output: 2 } }
    }]);

    expect(cursor.read()).toEqual([
      expect.objectContaining({
        provider: 'active-provider',
        model: 'active-model'
      })
    ]);
  });

  test('resets a file cursor after truncation and replacement', () => {
    const sessionFile = path.join(sessionDir, 'session-rotate.jsonl');
    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'omp-session-old' },
      {
        type: 'message',
        id: 'old',
        message: { role: 'assistant', usage: { totalTokens: 1 } }
      }
    ]);
    const { createOmpUsageEventCursor } = loadModule();
    const cursor = createOmpUsageEventCursor(sessionDir);
    expect(cursor.read()).toEqual([]);

    fs.truncateSync(sessionFile, 0);
    appendJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'omp-session-truncated' },
      {
        type: 'message',
        id: 'new',
        message: { role: 'assistant', usage: { totalTokens: 2 } }
      }
    ]);
    expect(cursor.read()).toEqual([
      expect.objectContaining({ id: 'omp-session-truncated:new' })
    ]);

    const replacementFile = path.join(sessionDir, 'replacement.jsonl');
    writeJsonl(replacementFile, [
      { type: 'session', version: 3, id: 'omp-session-replaced' },
      {
        type: 'message',
        id: 'replacement',
        message: { role: 'assistant', usage: { totalTokens: 3 } }
      }
    ]);
    fs.renameSync(replacementFile, sessionFile);
    expect(cursor.read()).toEqual([
      expect.objectContaining({ id: 'omp-session-replaced:replacement' })
    ]);
  });

  test('discovers files after a missing session directory and drops deleted state', () => {
    const missingRoot = path.join(testDir, 'not-created', 'sessions');
    const { createOmpUsageEventCursor } = loadModule();
    const cursor = createOmpUsageEventCursor(missingRoot);
    expect(cursor.read()).toEqual([]);

    fs.mkdirSync(missingRoot, { recursive: true });
    const sessionFile = path.join(missingRoot, 'session-late.jsonl');
    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'omp-session-late' },
      {
        type: 'message',
        id: 'late',
        message: { role: 'assistant', usage: { totalTokens: 4 } }
      }
    ]);
    expect(cursor.read()).toEqual([
      expect.objectContaining({ id: 'omp-session-late:late' })
    ]);

    fs.unlinkSync(sessionFile);
    expect(cursor.read()).toEqual([]);

    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'omp-session-again' },
      {
        type: 'message',
        id: 'again',
        message: { role: 'assistant', usage: { totalTokens: 5 } }
      }
    ]);
    expect(cursor.read()).toEqual([
      expect.objectContaining({ id: 'omp-session-again:again' })
    ]);
  });

  test('skips malformed complete rows and continues with valid rows', () => {
    const { createOmpUsageEventCursor } = loadModule();
    const cursor = createOmpUsageEventCursor(sessionDir);
    expect(cursor.read()).toEqual([]);

    const sessionFile = path.join(sessionDir, 'session-malformed.jsonl');
    writeJsonl(sessionFile, [
      '{malformed',
      { type: 'session', version: 3, id: 'omp-session-malformed' },
      {
        type: 'message',
        id: 'valid',
        message: { role: 'assistant', usage: { totalTokens: 6 } }
      }
    ]);

    expect(cursor.read()).toEqual([
      expect.objectContaining({ id: 'omp-session-malformed:valid' })
    ]);
  });

  test('reset clears the baseline and starts a fresh cursor', () => {
    const sessionFile = path.join(sessionDir, 'session-reset.jsonl');
    writeJsonl(sessionFile, [
      { type: 'session', version: 3, id: 'omp-session-reset' }
    ]);
    const { createOmpUsageEventCursor } = loadModule();
    const cursor = createOmpUsageEventCursor(sessionDir);
    expect(cursor.read()).toEqual([]);

    appendJsonl(sessionFile, [{
      type: 'message',
      id: 'before-reset',
      message: { role: 'assistant', usage: { totalTokens: 7 } }
    }]);
    expect(cursor.read()).toEqual([
      expect.objectContaining({ id: 'omp-session-reset:before-reset' })
    ]);

    cursor.reset();
    expect(cursor.read()).toEqual([]);
    appendJsonl(sessionFile, [{
      type: 'message',
      id: 'after-reset',
      message: { role: 'assistant', usage: { totalTokens: 8 } }
    }]);
    expect(cursor.read()).toEqual([
      expect.objectContaining({ id: 'omp-session-reset:after-reset' })
    ]);
  });
});
