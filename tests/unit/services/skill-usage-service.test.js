import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSkillUsageStore } = require('../../../src/server/services/skill-usage-store');
const { createSkillUsageService } = require('../../../src/server/services/skill-usage-service');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);

function createFakeIndex({ sessions, messagesBySession }) {
  return {
    async ensureSourceIndexed() {},
    async listUsageSessions() {
      return sessions;
    },
    async listToolCallMessages(_platform, sessionId) {
      if (messagesBySession instanceof Error) throw messagesBySession;
      return messagesBySession[sessionId] || [];
    }
  };
}

function skill(name, extra = {}) {
  return {
    name,
    directory: name,
    installed: true,
    enabled: true,
    cached: true,
    artifact: { state: 'ready' },
    projection: { path: null },
    targetDirectory: null,
    ...extra
  };
}

describe('skill-usage-service', () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-usage-'));
    store = createSkillUsageStore({ dbPath: path.join(dir, 'usage.sqlite') });
  });

  afterEach(() => {
    try { store.db.close(); } catch (_) {}
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function buildService(index, staleDays = 30) {
    return createSkillUsageService({
      store,
      index,
      readers: () => [],
      now: () => NOW,
      config: { skillUsage: { staleDays } }
    });
  }

  it('counts one use per turn and is idempotent', async () => {
    const sessions = [{ sessionId: 's1', size: 10, mtimeMs: 10, parserVersion: 3 }];
    const index = createFakeIndex({
      sessions,
      messagesBySession: {
        s1: [
          {
            turnNumber: 1,
            timestamp: NOW - DAY,
            toolCalls: [
              { id: 'c1', name: 'Skill', args: { skill: 'debug-router' } },
              { id: 'c2', name: 'Skill', args: { skill: 'debug-router' } }
            ]
          },
          {
            turnNumber: 2,
            timestamp: NOW - DAY,
            toolCalls: [{ id: 'c3', name: 'Skill', args: { skill: 'debug-router' } }]
          }
        ]
      }
    });
    const service = buildService(index);

    await service.runIngestPass();
    await service.runIngestPass();

    const rows = store.queryUsage({ names: ['debug-router'] });
    // Three calls produce three append-only events; the turn grouping is what
    // the read path counts.
    expect(rows).toHaveLength(3);
    const guarded = service.getUsageForSkills([skill('debug-router')], { platform: 'claude' });
    expect(guarded[0].usage.count).toBe(2);
    expect(guarded[0].usage.state).toBe('used');
  });

  it('marks stale only when coverage spans the window', async () => {
    const sessions = [{ sessionId: 's1', size: 10, mtimeMs: 10, parserVersion: 3 }];
    const index = createFakeIndex({
      sessions,
      messagesBySession: {
        s1: [
          {
            userMessageNumber: 1,
            timestamp: NOW - 40 * DAY,
            toolCalls: [{ id: 'a', name: 'Skill', args: { skill: 'old-skill' } }]
          },
          {
            userMessageNumber: 2,
            timestamp: NOW - 39 * DAY,
            toolCalls: [{ id: 'b', name: 'Skill', args: { skill: 'old-skill' } }]
          },
          {
            userMessageNumber: 3,
            timestamp: NOW - 1 * DAY,
            toolCalls: [{ id: 'c', name: 'Skill', args: { skill: 'fresh-skill' } }]
          }
        ]
      }
    });
    const service = buildService(index, 30);
    await service.runIngestPass();

    const rows = service.getUsageForSkills(
      [skill('old-skill'), skill('fresh-skill'), skill('never-used')],
      { platform: 'claude' }
    );
    expect(rows[0].usage.state).toBe('stale');
    expect(rows[1].usage.state).toBe('used');
    // No event and no known install date: coverage starts now, so no claim.
    expect(rows[2].usage.state).toBe('pending');
    expect(rows[2].usage.reason).toBe('coverage_short');
  });

  it('attributes an event by skill root when the platform differs', () => {
    const service = buildService(createFakeIndex({ sessions: [], messagesBySession: {} }));
    store.insertEvents([{
      eventKey: 'cross-1',
      platform: 'omp',
      sessionId: 'omp-session',
      turnKey: 'omp:omp-session:1',
      callId: 'call-1',
      normalizedName: 'shared-skill',
      baseName: 'shared-skill',
      rawTarget: 'skill://shared-skill',
      skillRoot: '/home/u/.claude/skills/shared-skill',
      occurredAt: NOW - DAY
    }]);
    store.upsertScanState('claude', {
      status: 'complete',
      skillEvents: 1,
      coverageStart: NOW - 60 * DAY,
      coverageEnd: NOW
    });

    const rows = service.getUsageForSkills([
      skill('shared-skill', { artifact: { state: 'ready', root: '/home/u/.claude/skills/shared-skill' } })
    ], { platform: 'claude' });
    expect(rows[0].usage.count).toBe(1);
    expect(rows[0].usage.state).toBe('used');
  });

  it('reports unverified when a platform has no calibration event', async () => {
    const sessions = [{ sessionId: 's1', size: 10, mtimeMs: 10, parserVersion: 3 }];
    const index = createFakeIndex({
      sessions,
      messagesBySession: {
        s1: [{
          userMessageNumber: 1,
          timestamp: NOW - 40 * DAY,
          toolCalls: [{ id: 'x', name: 'bash', args: { command: 'ls' } }]
        }]
      }
    });
    const service = buildService(index, 1);
    await service.runIngestPass();

    const result = service.getUsageForSkills([skill('anything')], { platform: 'claude' });
    expect(result[0].usage.state).toBe('unverified');
    expect(result[0].usage.reason).toBe('uncalibrated');
  });

  it('reports the policy and per-platform progress', async () => {
    const sessions = [{ sessionId: 's1', size: 10, mtimeMs: 10, parserVersion: 3 }];
    const index = createFakeIndex({
      sessions,
      messagesBySession: {
        s1: [{
          userMessageNumber: 1,
          timestamp: NOW - DAY,
          toolCalls: [{ id: 'p1', name: 'Skill', args: { skill: 'foo' } }]
        }]
      }
    });
    const service = buildService(index, 45);
    await service.runIngestPass();

    const policy = service.getUsagePolicy();
    expect(policy.staleDays).toBe(45);
    expect(Object.keys(policy.platforms).sort())
      .toEqual(['claude', 'codex', 'dsh', 'gemini', 'omp', 'opencode']);
    expect(policy.platforms.claude.state).toBe('complete');
    expect(policy.scan.progress.totalSessions).toBeGreaterThanOrEqual(1);
    expect(policy.scan.progress.doneSessions).toBeGreaterThanOrEqual(1);
  });

  it('returns usage unchanged when the ledger throws', async () => {
    const broken = createSkillUsageService({
      store: {
        queryUsage() { throw new Error('db gone'); },
        getScanState() { throw new Error('db gone'); }
      },
      index: createFakeIndex({ sessions: [], messagesBySession: {} }),
      readers: () => [],
      now: () => NOW,
      config: { skillUsage: { staleDays: 30 } }
    });
    const input = [skill('x')];
    expect(broken.getUsageForSkills(input, { platform: 'claude' })).toBe(input);
  });
});
