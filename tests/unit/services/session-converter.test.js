const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let testDir;
let sessionConverter;
let claudeSessions;
let codexSessionsById;
let geminiSessionsById;
let parsedCodexSession;
let projectPathMock;

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-converter-'));
  claudeSessions = [];
  codexSessionsById = new Map();
  geminiSessionsById = new Map();
  parsedCodexSession = null;
  projectPathMock = '/workspace/gemini-project';

  require.cache[require.resolve('../../../src/config/paths')] = {
    id: require.resolve('../../../src/config/paths'),
    filename: require.resolve('../../../src/config/paths'),
    loaded: true,
    exports: {
      NATIVE_PATHS: {
        claude: {
          projects: path.join(testDir, '.claude', 'projects')
        },
        codex: {
          sessions: path.join(testDir, '.codex', 'sessions')
        },
        gemini: {
          tmp: path.join(testDir, '.gemini', 'tmp')
        }
      },
      HOME_DIR: path.join(testDir, 'home')
    }
  };

  require.cache[require.resolve('../../../src/server/services/sessions')] = {
    id: require.resolve('../../../src/server/services/sessions'),
    filename: require.resolve('../../../src/server/services/sessions'),
    loaded: true,
    exports: {
      getSessionById: vi.fn((sessionId) => claudeSessions.find((item) => item.sessionId === sessionId) || null)
    }
  };

  require.cache[require.resolve('../../../src/server/services/codex-sessions')] = {
    id: require.resolve('../../../src/server/services/codex-sessions'),
    filename: require.resolve('../../../src/server/services/codex-sessions'),
    loaded: true,
    exports: {
      getSessionById: vi.fn((sessionId) => codexSessionsById.get(sessionId) || null)
    }
  };

  require.cache[require.resolve('../../../src/server/services/gemini-sessions')] = {
    id: require.resolve('../../../src/server/services/gemini-sessions'),
    filename: require.resolve('../../../src/server/services/gemini-sessions'),
    loaded: true,
    exports: {
      getSessionById: vi.fn((sessionId) => geminiSessionsById.get(sessionId) || null),
      getProjectPath: vi.fn(() => projectPathMock)
    }
  };

  require.cache[require.resolve('../../../src/server/services/codex-parser')] = {
    id: require.resolve('../../../src/server/services/codex-parser'),
    filename: require.resolve('../../../src/server/services/codex-parser'),
    loaded: true,
    exports: {
      readJSONL: vi.fn(),
      parseSession: vi.fn(() => parsedCodexSession)
    }
  };

  delete require.cache[require.resolve('../../../src/server/services/session-converter')];
  sessionConverter = require('../../../src/server/services/session-converter');
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  [
    '../../../src/server/services/session-converter',
    '../../../src/server/services/sessions',
    '../../../src/server/services/codex-sessions',
    '../../../src/server/services/gemini-sessions',
    '../../../src/server/services/codex-parser',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

describe('session-converter parsing and generation', () => {
  test('parses Claude JSONL sessions into the unified format', () => {
    const filePath = path.join(testDir, 'claude.jsonl');
    writeFile(filePath, [
      JSON.stringify({
        type: 'user',
        message: { content: 'hello' },
        cwd: '/workspace/demo',
        sessionId: 'claude-session-1',
        gitBranch: 'main',
        timestamp: '2026-03-17T10:00:00.000Z'
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: 'hi there' },
        timestamp: '2026-03-17T10:00:02.000Z'
      }),
      JSON.stringify({
        type: 'summary',
        summary: 'conversation summary',
        timestamp: '2026-03-17T10:00:03.000Z'
      }),
      '{"invalid-json"',
      JSON.stringify({ type: 'file-history-snapshot' })
    ].join('\n'));

    expect(sessionConverter.parseClaudeToUnified(filePath)).toEqual({
      sessionId: 'claude-session-1',
      cwd: '/workspace/demo',
      gitBranch: 'main',
      startTime: '2026-03-17T10:00:00.000Z',
      messages: [
        { role: 'user', content: 'hello', timestamp: '2026-03-17T10:00:00.000Z' },
        { role: 'assistant', content: 'hi there', timestamp: '2026-03-17T10:00:02.000Z' },
        { role: 'system', content: 'conversation summary', timestamp: '2026-03-17T10:00:03.000Z' }
      ],
      metadata: {
        source: 'claude',
        originalPath: filePath
      }
    });
  });

  test('converts a Codex session to Claude format and uses the requested target session id in the path', async () => {
    const sourcePath = path.join(testDir, 'source-codex.jsonl');
    writeFile(sourcePath, '{"ignored":true}\n');
    codexSessionsById.set('codex-source-1', { sessionId: 'codex-source-1', filePath: sourcePath });
    parsedCodexSession = {
      sessionId: 'codex-source-1',
      meta: {
        sessionId: 'codex-source-1',
        cwd: '/workspace/demo',
        git: { branch: 'feature/tests', repositoryUrl: 'https://example.com/repo.git' },
        timestamp: '2026-03-17T09:00:00.000Z'
      },
      messages: [
        { role: 'user', content: 'first question', timestamp: '2026-03-17T09:00:00.000Z' },
        { role: 'assistant', content: 'first answer', timestamp: '2026-03-17T09:00:01.000Z' },
        { role: 'system', content: 'skip me', timestamp: '2026-03-17T09:00:02.000Z' }
      ]
    };

    const result = await sessionConverter.convertSession('codex', 'claude', 'codex-source-1', {
      sessionId: 'converted-1'
    });

    const lines = fs.readFileSync(result.targetPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(result).toEqual(expect.objectContaining({
      success: true,
      sourceType: 'codex',
      targetType: 'claude',
      sourceSessionId: 'codex-source-1',
      targetSessionId: '1',
      messageCount: 2
    }));
    expect(result.targetPath).toContain(path.join('.claude', 'projects'));
    expect(result.targetPath).toContain('converted-1.jsonl');
    expect(lines).toEqual([
      {
        type: 'user',
        message: {
          role: 'user',
          content: 'first question'
        },
        cwd: '/workspace/demo',
        sessionId: 'codex-source-1',
        gitBranch: 'feature/tests',
        version: '1.0.24',
        timestamp: '2026-03-17T09:00:00.000Z'
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: 'first answer'
        },
        sessionId: 'codex-source-1',
        timestamp: '2026-03-17T09:00:01.000Z'
      }
    ]);
  });

  test('previews Gemini sessions using the resolved project path and truncates to five messages', async () => {
    const filePath = path.join(testDir, 'gemini-session.json');
    writeFile(filePath, JSON.stringify({
      sessionId: 'gemini-session-1',
      projectHash: 'project-hash-1',
      startTime: '2026-03-17T08:00:00.000Z',
      messages: [
        { type: 'user', content: '1', timestamp: '2026-03-17T08:00:00.000Z' },
        { type: 'assistant', content: '2', timestamp: '2026-03-17T08:00:01.000Z', model: 'gemini-2.5-pro' },
        { type: 'info', content: '3', timestamp: '2026-03-17T08:00:02.000Z' },
        { type: 'user', content: '4', timestamp: '2026-03-17T08:00:03.000Z' },
        { type: 'assistant', content: '5', timestamp: '2026-03-17T08:00:04.000Z', model: 'gemini-2.5-pro' },
        { type: 'assistant', content: '6', timestamp: '2026-03-17T08:00:05.000Z', model: 'gemini-2.5-pro' }
      ]
    }, null, 2));
    geminiSessionsById.set('gemini-session-1', { sessionId: 'gemini-session-1', filePath });

    const preview = await sessionConverter.previewConversion('gemini', 'gemini-session-1');

    expect(preview).toEqual({
      sessionId: 'gemini-session-1',
      cwd: '/workspace/gemini-project',
      gitBranch: null,
      startTime: '2026-03-17T08:00:00.000Z',
      messageCount: 6,
      messages: [
        { role: 'user', content: '1', timestamp: '2026-03-17T08:00:00.000Z' },
        { role: 'assistant', content: '2', timestamp: '2026-03-17T08:00:01.000Z' },
        { role: 'system', content: '3', timestamp: '2026-03-17T08:00:02.000Z' },
        { role: 'user', content: '4', timestamp: '2026-03-17T08:00:03.000Z' },
        { role: 'assistant', content: '5', timestamp: '2026-03-17T08:00:04.000Z' }
      ],
      metadata: {
        source: 'gemini',
        originalPath: filePath,
        projectHash: 'project-hash-1',
        model: undefined
      }
    });
  });

  test('throws when Codex parsing fails and validates missing sessions/invalid types', async () => {
    parsedCodexSession = null;

    expect(() => sessionConverter.parseCodexToUnified(path.join(testDir, 'missing.jsonl'))).toThrow('Failed to parse Codex session');
    await expect(sessionConverter.convertSession('invalid', 'claude', 'session-1')).rejects.toThrow('Invalid source type: invalid');
    await expect(sessionConverter.convertSession('codex', 'codex', 'session-1')).rejects.toThrow('Source and target types must be different');
    await expect(sessionConverter.previewConversion('codex', 'missing-session')).rejects.toThrow('Source session not found');
  });

  test('generates Gemini sessions with computed project hashes and default assistant model metadata', () => {
    const targetPath = path.join(testDir, 'generated-gemini.json');
    const unified = {
      sessionId: 'generated-session',
      cwd: '/workspace/generated',
      gitBranch: null,
      startTime: '2026-03-17T07:00:00.000Z',
      messages: [
        { role: 'user', content: 'hello', timestamp: '2026-03-17T07:00:00.000Z' },
        { role: 'assistant', content: 'world', timestamp: '2026-03-17T07:00:02.000Z' },
        { role: 'system', content: 'note', timestamp: '2026-03-17T07:00:03.000Z' }
      ],
      metadata: {}
    };

    sessionConverter.generateGeminiFromUnified(unified, targetPath);

    expect(JSON.parse(fs.readFileSync(targetPath, 'utf8'))).toEqual({
      sessionId: 'generated-session',
      projectHash: crypto.createHash('sha256').update('/workspace/generated').digest('hex'),
      startTime: '2026-03-17T07:00:00.000Z',
      lastUpdated: '2026-03-17T07:00:03.000Z',
      messages: [
        { type: 'user', content: 'hello', timestamp: '2026-03-17T07:00:00.000Z' },
        { type: 'assistant', content: 'world', timestamp: '2026-03-17T07:00:02.000Z', model: 'gemini-2.5-pro' },
        { type: 'info', content: 'note', timestamp: '2026-03-17T07:00:03.000Z' }
      ]
    });
  });
});
