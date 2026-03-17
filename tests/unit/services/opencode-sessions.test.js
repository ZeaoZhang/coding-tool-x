'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const PATHS_PATH = require.resolve('../../../src/config/paths');
const ALIAS_PATH = require.resolve('../../../src/server/services/alias');
const SESSIONS_PATH = require.resolve('../../../src/server/services/sessions');
const MODULE_PATH = require.resolve('../../../src/server/services/opencode-sessions');

let testDir;
let dataDir;
let projectOrderPath;
let sessionOrderPath;
let execSpy;
let executedSql;
let countsRow;
let projectRows;
let sessionRowsByProject;
let sessionRowsById;
let messageRowsBySession;
let partRowsBySession;
let aliasesState;
let forkRelationsState;
let deleteAliasMock;
let loadAliasesMock;
let getForkRelationsMock;
let saveForkRelationsMock;
let opencodeSessions;

function buildQueryResponder(sql) {
  if (sql.includes('(SELECT COUNT(*) FROM project) AS project_count')) {
    return [countsRow];
  }

  if (sql.includes('FROM project p')) {
    return projectRows;
  }

  if (sql.includes("SELECT id FROM project WHERE id = 'proj-1'")) {
    return projectRows.filter((row) => row.id === 'proj-1').map((row) => ({ id: row.id }));
  }

  if (sql.includes("SELECT id FROM session WHERE project_id = 'proj-1'")) {
    return (sessionRowsByProject['proj-1'] || []).map((row) => ({ id: row.id }));
  }

  if (sql.includes("WHERE s.project_id = 'proj-1'")) {
    return sessionRowsByProject['proj-1'] || [];
  }

  if (sql.includes("WHERE s.project_id = 'proj-2'")) {
    return sessionRowsByProject['proj-2'] || [];
  }

  if (sql.includes("WHERE s.id = 'ses-1'")) {
    return sessionRowsById['ses-1'] ? [sessionRowsById['ses-1']] : [];
  }

  if (sql.includes("WHERE s.id = 'ses-2'")) {
    return sessionRowsById['ses-2'] ? [sessionRowsById['ses-2']] : [];
  }

  if (sql.includes("WHERE session_id = 'ses-1'") && sql.includes('FROM message')) {
    return messageRowsBySession['ses-1'] || [];
  }

  if (sql.includes("WHERE session_id = 'ses-1'") && sql.includes('FROM part')) {
    return partRowsBySession['ses-1'] || [];
  }

  return [];
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-sessions-service-'));
  dataDir = path.join(testDir, '.opencode-data');
  projectOrderPath = path.join(testDir, '.cc-tool', 'opencode-project-order.json');
  sessionOrderPath = path.join(testDir, '.cc-tool', 'opencode-session-order.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'opencode.db'), '', 'utf8');

  executedSql = [];
  countsRow = { project_count: 2, session_count: 3 };
  projectRows = [
    {
      id: 'proj-1',
      worktree: '/workspace/app-a',
      name: 'ses_weird',
      time_created: 1000,
      time_updated: 5000,
      session_count: 2
    },
    {
      id: 'proj-2',
      worktree: '/workspace/app-b',
      name: 'Readable Project',
      time_created: 2000,
      time_updated: 6000,
      session_count: 1
    }
  ];
  sessionRowsByProject = {
    'proj-1': [
      {
        id: 'ses-1',
        project_id: 'proj-1',
        slug: 'needle-session',
        directory: '/workspace/app-a',
        title: 'Needle intro',
        time_updated: 4000,
        size: 128
      },
      {
        id: 'ses-2',
        project_id: 'proj-1',
        slug: 'follow-up',
        directory: '/workspace/app-a',
        title: 'Follow up',
        time_updated: 7000,
        size: 64
      }
    ],
    'proj-2': [
      {
        id: 'ses-3',
        project_id: 'proj-2',
        slug: 'summary',
        directory: '/workspace/app-b',
        title: 'Project summary',
        time_updated: 3000,
        size: 32
      }
    ]
  };
  sessionRowsById = {
    'ses-1': sessionRowsByProject['proj-1'][0],
    'ses-2': sessionRowsByProject['proj-1'][1]
  };
  messageRowsBySession = {
    'ses-1': [
      {
        id: 'msg-1',
        session_id: 'ses-1',
        time_created: 1000,
        time_updated: 1000,
        data: JSON.stringify({
          id: 'msg-1',
          role: 'user',
          content: 'needle question'
        })
      },
      {
        id: 'msg-2',
        session_id: 'ses-1',
        time_created: 1100,
        time_updated: 1100,
        data: JSON.stringify({
          id: 'msg-2',
          role: 'assistant',
          text: 'fallback answer',
          model: { modelID: 'gpt-4o-mini' }
        })
      },
      {
        id: 'msg-3',
        session_id: 'ses-1',
        time_created: 1200,
        time_updated: 1200,
        data: JSON.stringify({
          id: 'msg-3',
          role: 'system',
          content: 'ignore this'
        })
      }
    ]
  };
  partRowsBySession = {
    'ses-1': [
      {
        id: 'prt-1',
        message_id: 'msg-2',
        session_id: 'ses-1',
        time_created: 1110,
        time_updated: 1110,
        data: JSON.stringify({ text: 'assistant needle response' })
      }
    ]
  };
  aliasesState = {
    'ses-1': 'alias-one',
    'ses-2': 'focus-session'
  };
  forkRelationsState = {
    'ses-2': 'ses-root',
    child: 'ses-1',
    keep: 'ses-other'
  };
  deleteAliasMock = vi.fn((sessionId) => {
    delete aliasesState[sessionId];
  });
  loadAliasesMock = vi.fn(() => ({ ...aliasesState }));
  getForkRelationsMock = vi.fn(() => forkRelationsState);
  saveForkRelationsMock = vi.fn((next) => {
    forkRelationsState = next;
  });

  require.cache[PATHS_PATH] = {
    id: PATHS_PATH,
    filename: PATHS_PATH,
    loaded: true,
    exports: {
      NATIVE_PATHS: {
        opencode: {
          data: dataDir
        }
      },
      PATHS: {
        opencodeProjectOrder: projectOrderPath,
        opencodeSessionOrder: sessionOrderPath
      }
    }
  };
  require.cache[ALIAS_PATH] = {
    id: ALIAS_PATH,
    filename: ALIAS_PATH,
    loaded: true,
    exports: {
      loadAliases: loadAliasesMock,
      deleteAlias: deleteAliasMock
    }
  };
  require.cache[SESSIONS_PATH] = {
    id: SESSIONS_PATH,
    filename: SESSIONS_PATH,
    loaded: true,
    exports: {
      getForkRelations: getForkRelationsMock,
      saveForkRelations: saveForkRelationsMock
    }
  };

  execSpy = vi.spyOn(childProcess, 'execFileSync').mockImplementation((_cmd, args) => {
    const sql = args[args.length - 1];
    if (args[0] === '-json') {
      return JSON.stringify(buildQueryResponder(sql));
    }
    executedSql.push(sql);
    return '';
  });

  delete require.cache[MODULE_PATH];
  opencodeSessions = require('../../../src/server/services/opencode-sessions');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(testDir, { recursive: true, force: true });
  [MODULE_PATH, PATHS_PATH, ALIAS_PATH, SESSIONS_PATH].forEach((mod) => {
    delete require.cache[mod];
  });
});

describe('opencode-sessions project and session ordering', () => {
  test('loads projects and sessions with persisted ordering and display-name fallbacks', () => {
    opencodeSessions.saveProjectOrder(['proj-2', 'proj-1']);
    opencodeSessions.saveSessionOrder('proj-1', ['ses-1', 'ses-2']);

    expect(opencodeSessions.getProjects()).toEqual([
      {
        name: 'proj-2',
        displayName: 'Readable Project',
        fullPath: '/workspace/app-b',
        path: '/workspace/app-b',
        sessionCount: 1,
        lastUsed: 6000,
        source: 'opencode'
      },
      {
        name: 'proj-1',
        displayName: 'app-a',
        fullPath: '/workspace/app-a',
        path: '/workspace/app-a',
        sessionCount: 2,
        lastUsed: 5000,
        source: 'opencode'
      }
    ]);

    expect(opencodeSessions.getSessionsByProjectId('proj-1')).toEqual([
      {
        sessionId: 'ses-1',
        projectName: 'proj-1',
        mtime: '1970-01-01T01:06:40.000Z',
        size: 128,
        filePath: '',
        gitBranch: null,
        firstMessage: 'Needle intro',
        forkedFrom: null,
        directory: '/workspace/app-a',
        slug: 'needle-session',
        source: 'opencode'
      },
      {
        sessionId: 'ses-2',
        projectName: 'proj-1',
        mtime: '1970-01-01T01:56:40.000Z',
        size: 64,
        filePath: '',
        gitBranch: null,
        firstMessage: 'Follow up',
        forkedFrom: null,
        directory: '/workspace/app-a',
        slug: 'follow-up',
        source: 'opencode'
      }
    ]);
  });
});

describe('opencode-sessions messages, recent sessions, and search', () => {
  test('builds message content from parts, enriches recent sessions, and searches session data', () => {
    expect(opencodeSessions.getSessionById('ses-1')).toEqual({
      sessionId: 'ses-1',
      projectName: 'proj-1',
      mtime: '1970-01-01T01:06:40.000Z',
      size: 128,
      filePath: '',
      gitBranch: null,
      firstMessage: 'Needle intro',
      forkedFrom: null,
      directory: '/workspace/app-a',
      slug: 'needle-session',
      source: 'opencode'
    });

    expect(opencodeSessions.getSessionMessages('ses-1')).toEqual([
      {
        type: 'user',
        content: 'needle question',
        timestamp: '1970-01-01T00:16:40.000Z',
        model: null
      },
      {
        type: 'assistant',
        content: 'assistant needle response',
        timestamp: '1970-01-01T00:18:20.000Z',
        model: 'gpt-4o-mini'
      }
    ]);

    expect(opencodeSessions.getRecentSessions(2)).toEqual([
      expect.objectContaining({
        sessionId: 'ses-2',
        alias: 'focus-session',
        forkedFrom: 'ses-root',
        projectDisplayName: 'app-a',
        projectFullPath: '/workspace/app-a'
      }),
      expect.objectContaining({
        sessionId: 'ses-1',
        alias: 'alias-one',
        projectDisplayName: 'app-a'
      })
    ]);

    expect(opencodeSessions.searchSessions('needle', 5)).toEqual([
      expect.objectContaining({
        sessionId: 'ses-1',
        projectName: 'proj-1',
        projectDisplayName: 'app-a',
        projectFullPath: '/workspace/app-a',
        alias: 'alias-one',
        matchCount: 4,
        source: 'opencode'
      })
    ]);
    expect(opencodeSessions.searchSessions('needle', 5)[0].matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', context: expect.stringContaining('Needle') }),
      expect.objectContaining({ role: 'user', context: expect.stringContaining('needle') })
    ]));
  });
});

describe('opencode-sessions deletion, forking, and count caching', () => {
  test('deletes sessions, cleans aliases/fork relations, and invalidates cached counts', () => {
    opencodeSessions.saveSessionOrder('proj-1', ['ses-1', 'ses-2']);
    expect(opencodeSessions.getProjectAndSessionCounts()).toEqual({
      projectCount: 2,
      sessionCount: 3
    });

    countsRow = { project_count: 2, session_count: 2 };
    const result = opencodeSessions.deleteSession('ses-1');

    expect(result).toEqual({
      success: true,
      projectName: 'proj-1',
      sessionId: 'ses-1'
    });
    expect(deleteAliasMock).toHaveBeenCalledWith('ses-1');
    expect(readJson(sessionOrderPath)).toEqual({
      'proj-1': ['ses-2']
    });
    expect(saveForkRelationsMock).toHaveBeenCalledWith({
      'ses-2': 'ses-root',
      keep: 'ses-other'
    });
    expect(executedSql.some((sql) => sql.includes("DELETE FROM session WHERE id = 'ses-1'"))).toBe(true);
    expect(opencodeSessions.getProjectAndSessionCounts()).toEqual({
      projectCount: 2,
      sessionCount: 2
    });
  });

  test('forks sessions by cloning messages/parts and prepending the new session to order', () => {
    opencodeSessions.saveSessionOrder('proj-1', ['ses-2']);
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-1111-1111-111111111111')
      .mockReturnValueOnce('22222222-2222-2222-2222-222222222222')
      .mockReturnValueOnce('33333333-3333-3333-3333-333333333333')
      .mockReturnValueOnce('44444444-4444-4444-4444-444444444444');

    const result = opencodeSessions.forkSession('ses-1');

    expect(result).toEqual({
      success: true,
      newSessionId: 'ses_11111111111111111111111111111111',
      forkedFrom: 'ses-1',
      projectName: 'proj-1',
      newFilePath: null
    });
    expect(readJson(sessionOrderPath)).toEqual({
      'proj-1': ['ses_11111111111111111111111111111111', 'ses-2']
    });
    expect(saveForkRelationsMock).toHaveBeenCalledWith({
      'ses-2': 'ses-root',
      child: 'ses-1',
      keep: 'ses-other',
      'ses_11111111111111111111111111111111': 'ses-1'
    });
    expect(executedSql.join('\n')).toContain("INSERT INTO session");
    expect(executedSql.join('\n')).toContain("INSERT INTO message");
    expect(executedSql.join('\n')).toContain("INSERT INTO part");
    expect(executedSql.join('\n')).toContain("ses_11111111111111111111111111111111");
    expect(executedSql.join('\n')).toContain("msg_22222222222222222222222222222222");
    expect(executedSql.join('\n')).toContain("msg_33333333333333333333333333333333");
  });
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
