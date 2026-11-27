'use strict';

/**
 * Skill usage service: ingest, scheduler, and read-time state.
 *
 * The ledger is append-only; this module never deletes an event. Ingest folds
 * the `toolCalls` payload that the session adapters persist in `extra_json`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const index = require('./session-history-index');
const { createSkillUsageStore } = require('./skill-usage-store');
const {
  normalizeSkillName,
  baseNameOf,
  extractSkillTargets
} = require('./skill-usage-extractors');
const { loadConfig } = require('../../config/loader');
const { PATHS } = require('../../config/paths');

const ADAPTER_PLATFORMS = ['claude', 'codex', 'omp', 'gemini'];
const READER_PLATFORMS = ['dsh', 'opencode'];
const DAY_MS = 24 * 60 * 60 * 1000;
const EXTRACTOR_VERSION = 1;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseTime(value) {
  return Number.isFinite(value) ? value : null;
}

function safeBirthtimeMs(rows = []) {
  for (const row of rows) {
    if (typeof row !== 'string' || !row) continue;
    try {
      const stat = fs.statSync(row);
      if (Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0) return stat.birthtimeMs;
    } catch (_) {
      // path may not exist
    }
  }
  return null;
}

function defaultScanState(platform) {
  return {
    platform,
    coverageStart: null,
    coverageEnd: null,
    status: 'idle',
    parseFailures: 0,
    nonSkillCalls: 0,
    unresolvedSkillReads: 0,
    skillEvents: 0,
    calibrationPositiveAt: null
  };
}

function getReaderToolCalls(platform, options = {}) {
  if (platform === 'dsh') {
    const { listUsageToolCalls } = require('../../platforms/drivers/dsh/sessions');
    return typeof listUsageToolCalls === 'function' ? listUsageToolCalls(options) : [];
  }
  if (platform === 'opencode') {
    const { listUsageToolCalls } = require('../../platforms/drivers/opencode/sessions-implementation');
    return typeof listUsageToolCalls === 'function' ? listUsageToolCalls(options) : [];
  }
  return [];
}

function createSkillUsageService(options = {}) {
  const now = options.now || (() => Date.now());
  const store = options.store || createSkillUsageStore(options.storeOptions);
  const indexApi = options.index || index;
  const readers = options.readers || getReaderToolCalls;

  function getPolicy() {
    const config = options.config || loadConfig();
    const days = Number.parseInt(config?.skillUsage?.staleDays, 10);
    return {
      staleDays: Number.isInteger(days) && days >= 1 && days <= 365 ? days : 30
    };
  }

  function buildUsageEvents(platform, session, messages, counters) {
    const events = [];
    for (const message of messages) {
      const timestamp = parseTime(message.timestamp) || now();
      counters.minTimestamp = Math.min(counters.minTimestamp, timestamp);
      counters.maxTimestamp = Math.max(counters.maxTimestamp, timestamp);
      const turnNumber = message.turnNumber != null
        ? message.turnNumber
        : message.userMessageNumber;
      const turnAnchor = turnNumber != null
        ? `${platform}:${session.sessionId}:${turnNumber}`
        : null;
      const callList = Array.isArray(message.toolCalls) ? message.toolCalls : [];
      for (const call of callList) {
        const targets = extractSkillTargets(platform, call);
        if (targets.length === 0) {
          counters.nonSkillCalls += 1;
          const targetPath = call?.args?.file_path || call?.args?.path;
          if (typeof targetPath === 'string' && /(^|\/)SKILL\.md$/i.test(targetPath)) {
            counters.unresolvedSkillReads += 1;
          }
          continue;
        }
        for (const target of targets) {
          const turnKey = turnAnchor
            || (call.turnId != null
              ? `${platform}:${session.sessionId}:t${call.turnId}`
              : `${platform}:${session.sessionId}:c${target.callId || '0'}`);
          const eventKey = sha256([
            platform,
            session.sessionId,
            target.callId || '',
            target.normalizedName,
            target.targetKind
          ].join('|'));
          events.push({
            eventKey,
            platform,
            sessionId: session.sessionId,
            turnKey,
            callId: target.callId || null,
            extractorVersion: EXTRACTOR_VERSION,
            rawName: target.rawName,
            normalizedName: target.normalizedName,
            baseName: baseNameOf(target.normalizedName),
            rawTarget: target.rawTarget,
            skillRoot: target.skillRoot || null,
            sessionCwd: session.cwd || null,
            occurredAt: timestamp
          });
          store.insertObservation(platform, target.normalizedName, timestamp);
          counters.skillEvents += 1;
          counters.minTimestamp = Math.min(counters.minTimestamp, timestamp);
          counters.maxTimestamp = Math.max(counters.maxTimestamp, timestamp);
        }
      }
    }
    return events;
  }

  function foldSession(platform, session, messages) {
    const counters = {
      skillEvents: 0,
      nonSkillCalls: 0,
      unresolvedSkillReads: 0,
      minTimestamp: Infinity,
      maxTimestamp: -Infinity
    };
    const events = buildUsageEvents(platform, session, messages, counters);
    if (events.length > 0) store.insertEvents(events);
    return counters;
  }

  async function runIngestPass({ maxSessions = 200, maxMs = 15000 } = {}) {
    const startedAt = now();
    let processedSessions = 0;
    const summary = { platforms: {}, processedSessions: 0 };

    const runPlatform = async (platform, sessions) => {
      let state = store.getScanState(platform) || defaultScanState(platform);
      let folded = 0;
      let remaining = 0;
      for (const session of sessions) {
        if (processedSessions >= maxSessions || now() - startedAt > maxMs) {
          remaining += 1;
          continue;
        }
        const cursor = store.getCursor(platform, session.sessionId);
        const unchanged = cursor
          && cursor.size === session.size
          && cursor.mtimeMs === session.mtimeMs
          && cursor.parserVersion === session.parserVersion
          && cursor.status === 'done';
        if (unchanged) continue;

        let messages = [];
        let counters;
        try {
          messages = platform === 'dsh' || platform === 'opencode'
            ? []
            : await indexApi.listToolCallMessages(platform, session.sessionId);
          counters = foldSession(platform, session, messages);
        } catch (_error) {
          state = { ...state, parseFailures: state.parseFailures + 1 };
          continue;
        }

        store.upsertCursor(platform, session.sessionId, {
          size: session.size,
          mtimeMs: session.mtimeMs,
          parserVersion: session.parserVersion,
          status: 'done'
        });
        processedSessions += 1;
        folded += 1;
        state = {
          ...state,
          skillEvents: state.skillEvents + counters.skillEvents,
          nonSkillCalls: state.nonSkillCalls + counters.nonSkillCalls,
          unresolvedSkillReads: state.unresolvedSkillReads + counters.unresolvedSkillReads,
          calibrationPositiveAt: state.calibrationPositiveAt
            || (counters.skillEvents > 0 ? now() : null),
          coverageStart: Number.isFinite(counters.minTimestamp)
            ? Math.min(
              state.coverageStart != null ? state.coverageStart : counters.minTimestamp,
              counters.minTimestamp
            )
            : state.coverageStart,
          coverageEnd: Number.isFinite(counters.maxTimestamp)
            ? Math.max(
              state.coverageEnd != null ? state.coverageEnd : counters.maxTimestamp,
              counters.maxTimestamp
            )
            : state.coverageEnd
        };
      }
      store.upsertScanState(platform, {
        ...state,
        status: remaining === 0 ? 'complete' : 'running'
      });
      summary.platforms[platform] = { folded, remaining };
    };

    for (const platform of ADAPTER_PLATFORMS) {
      try {
        await indexApi.ensureSourceIndexed(platform);
      } catch (_) {
        // A missing platform has no transcripts; the scan state stays idle.
        continue;
      }
      const sessions = await indexApi.listUsageSessions(platform);
      await runPlatform(platform, sessions);
    }

    for (const platform of READER_PLATFORMS) {
      let sessions = [];
      try {
        sessions = readers(platform, {
          limit: maxSessions,
          excludeSessionIds: store.getDoneSessionIds(platform)
        });
      } catch (_) {
        sessions = [];
      }
      const normalized = sessions.map(session => ({
        sessionId: session.sessionId,
        filePath: session.filePath || '',
        size: Number(session.size) || 0,
        mtimeMs: Number(session.mtimeMs) || 0,
        parserVersion: EXTRACTOR_VERSION,
        messages: Array.isArray(session.toolCalls) ? session.toolCalls : [],
        cwd: session.cwd || null
      }));
      let state = store.getScanState(platform) || defaultScanState(platform);
      for (const session of normalized) {
        if (processedSessions >= maxSessions || now() - startedAt > maxMs) break;
        const cursor = store.getCursor(platform, session.sessionId);
        if (cursor && cursor.size === session.size && cursor.mtimeMs === session.mtimeMs
          && cursor.parserVersion === session.parserVersion && cursor.status === 'done') {
          continue;
        }
        const counters = {
          skillEvents: 0,
          nonSkillCalls: 0,
          unresolvedSkillReads: 0,
          minTimestamp: Infinity,
          maxTimestamp: -Infinity
        };
        const events = buildUsageEvents(
          platform,
          session,
          [{ userMessageNumber: null, timestamp: session.mtimeMs, toolCalls: session.messages }],
          counters
        );
        if (events.length > 0) store.insertEvents(events);
        store.upsertCursor(platform, session.sessionId, {
          size: session.size,
          mtimeMs: session.mtimeMs,
          parserVersion: session.parserVersion,
          status: 'done'
        });
        processedSessions += 1;
        state = {
          ...state,
          skillEvents: state.skillEvents + counters.skillEvents,
          nonSkillCalls: state.nonSkillCalls + counters.nonSkillCalls,
          unresolvedSkillReads: state.unresolvedSkillReads + counters.unresolvedSkillReads,
          calibrationPositiveAt: state.calibrationPositiveAt
            || (counters.skillEvents > 0 ? now() : null),
          coverageStart: Number.isFinite(counters.minTimestamp)
            ? Math.min(
              state.coverageStart != null ? state.coverageStart : counters.minTimestamp,
              counters.minTimestamp
            )
            : state.coverageStart,
          coverageEnd: Number.isFinite(counters.maxTimestamp)
            ? Math.max(
              state.coverageEnd != null ? state.coverageEnd : counters.maxTimestamp,
              counters.maxTimestamp
            )
            : state.coverageEnd
        };
      }
      store.upsertScanState(platform, {
        ...state,
        status: normalized.length >= maxSessions ? 'running' : 'complete'
      });
    }

    summary.processedSessions = processedSessions;
    return summary;
  }

  function aggregateRows(rows) {
    const byKey = new Map();
    for (const row of rows) {
      const key = `${row.platform}\u0000${row.normalized_name}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          platform: row.platform,
          name: row.normalized_name,
          turns: new Set(),
          firstUsedAt: null,
          lastUsedAt: null,
          roots: new Set()
        };
        byKey.set(key, entry);
      }
      const turn = row.turn_key != null ? String(row.turn_key) : `call:${row.call_id || ''}`;
      if (turn) entry.turns.add(turn);
      const occurredAt = Number(row.occurred_at);
      if (Number.isFinite(occurredAt)) {
        entry.firstUsedAt = entry.firstUsedAt == null ? occurredAt : Math.min(entry.firstUsedAt, occurredAt);
        entry.lastUsedAt = entry.lastUsedAt == null ? occurredAt : Math.max(entry.lastUsedAt, occurredAt);
      }
      if (row.skill_root) entry.roots.add(String(row.skill_root));
    }
    return [...byKey.values()].map(entry => ({
      ...entry,
      count: entry.turns.size,
      roots: [...entry.roots].sort((a, b) => b.length - a.length)
    }));
  }

  function rowRoots(skill) {
    return [
      skill?.projection?.path,
      skill?.targetDirectory,
      skill?.artifact?.root,
      skill?.sourcePath
    ].filter(value => typeof value === 'string' && value);
  }

  function pickAggregate(rows, skill, platform) {
    const name = normalizeSkillName(skill?.name || skill?.directory || '');
    if (!name) return null;
    const candidates = rows.filter(row => row.name === name);
    if (candidates.length === 0) return null;
    const exact = candidates.find(row => row.platform === platform);
    if (exact) return exact;
    const roots = rowRoots(skill);
    const byRoot = candidates.find(row => row.roots.some(root => (
      roots.some(localPath => (
        localPath.startsWith(`${root}/`) || root.startsWith(`${localPath}/`)
      ))
    )));
    if (byRoot) return byRoot;
    return candidates.length === 1 ? candidates[0] : null;
  }

  function buildUsage(skill, aggregate, scan, policy, currentTime, firstSeenAt) {
    const staleDays = policy.staleDays;
    const count = aggregate ? aggregate.count : 0;
    const lastUsedAt = aggregate ? aggregate.lastUsedAt : null;
    const firstUsedAt = aggregate ? aggregate.firstUsedAt : null;
    const coverageStart = scan?.coverageStart ?? null;
    const coverageEnd = scan?.coverageEnd ?? null;
    const ready = skill?.installed !== false
      && skill?.enabled !== false
      && (!skill?.artifact || skill.artifact.state === 'ready');
    const base = {
      count,
      firstUsedAt,
      lastUsedAt,
      coverageStart,
      coverageEnd,
      state: 'pending',
      reason: null
    };

    if (!scan) return { ...base, reason: 'backfill_running' };
    if (scan.parseFailures > 0 && scan.skillEvents === 0 && count === 0) {
      return { ...base, state: 'unsupported', reason: 'parse_failures' };
    }
    if (!scan.calibrationPositiveAt && count === 0) {
      return { ...base, state: 'unverified', reason: 'uncalibrated' };
    }
    if (count > 0 && lastUsedAt != null && currentTime - lastUsedAt < staleDays * DAY_MS) {
      return { ...base, state: 'used' };
    }
    if (!ready) {
      return {
        ...base,
        reason: skill?.installed === false ? 'artifact_missing' : 'artifact_disabled'
      };
    }

    const eligibilityStart = Math.min(
      firstSeenAt || currentTime,
      safeBirthtimeMs(rowRoots(skill)) || currentTime
    );
    const observedStart = coverageStart != null ? Math.max(coverageStart, eligibilityStart) : null;
    const spanDays = coverageStart != null && coverageEnd != null
      ? (coverageEnd - coverageStart) / DAY_MS
      : 0;
    const ageDays = observedStart != null ? (currentTime - observedStart) / DAY_MS : 0;

    if (scan.status !== 'complete') return { ...base, reason: 'backfill_running' };
    if (spanDays < staleDays || ageDays < staleDays) {
      return { ...base, reason: 'coverage_short' };
    }
    return { ...base, state: 'stale' };
  }

  function getUsageForSkills(skills = [], { platform, policy } = {}) {
    if (!Array.isArray(skills) || skills.length === 0) return skills;
    const resolvedPolicy = policy || getPolicy();
    const names = [...new Set(skills
      .map(skill => normalizeSkillName(skill?.name || skill?.directory || ''))
      .filter(Boolean))];
    let rows = [];
    try {
      rows = store.queryUsage({ names });
    } catch (_) {
      return skills;
    }
    const aggregates = aggregateRows(rows);
    const scan = store.getScanState(platform);
    const observations = store.getObservations(platform, names);
    const currentTime = now();
    return skills.map(skill => ({
      ...skill,
      usage: buildUsage(
        { ...skill, platform },
        pickAggregate(aggregates, skill, platform),
        scan,
        resolvedPolicy,
        currentTime,
        observations.get(normalizeSkillName(skill?.name || skill?.directory || '')) || null
      )
    }));
  }

  function getUsagePolicy() {
    const policy = getPolicy();
    const platforms = {};
    for (const platform of [...ADAPTER_PLATFORMS, ...READER_PLATFORMS]) {
      const scan = store.getScanState(platform) || defaultScanState(platform);
      const stats = store.getCursorStats(platform);
      platforms[platform] = {
        state: scan.status,
        calibrationPositiveAt: scan.calibrationPositiveAt,
        coverageStart: scan.coverageStart,
        coverageEnd: scan.coverageEnd,
        progress: stats
      };
    }
    const complete = Object.values(platforms).every(entry => entry.state === 'complete');
    return {
      staleDays: policy.staleDays,
      scan: {
        state: complete ? 'complete' : 'running',
        progress: {
          doneSessions: Object.values(platforms).reduce((sum, entry) => sum + entry.progress.doneSessions, 0),
          totalSessions: Object.values(platforms).reduce((sum, entry) => sum + entry.progress.totalSessions, 0)
        }
      },
      platforms
    };
  }

  return {
    runIngestPass,
    getUsageForSkills,
    getUsagePolicy,
    getPolicy,
    store
  };
}

// ---------------------------------------------------------------------------
// Scheduler (one per process)
// ---------------------------------------------------------------------------

let _scheduler = null;

function acquireLock(lockPath) {
  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(fd, String(process.pid), 'utf8');
    return () => {
      try { fs.closeSync(fd); } catch (_) {}
      try { fs.unlinkSync(lockPath); } catch (_) {}
    };
  } catch (error) {
    if (error?.code !== 'EEXIST') return null;
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > 30 * 60 * 1000) {
        fs.unlinkSync(lockPath);
        return acquireLock(lockPath);
      }
    } catch (_) {}
    return null;
  }
}

function startUsageScheduler(options = {}) {
  if (_scheduler) return _scheduler;
  const initialDelayMs = Number.isFinite(options.initialDelayMs) ? options.initialDelayMs : 60 * 1000;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 60 * 1000;
  const idleIntervalMs = Number.isFinite(options.idleIntervalMs)
    ? options.idleIntervalMs
    : 10 * 60 * 1000;
  const service = options.service || createSkillUsageService(options.serviceOptions);
  const lockPath = `${PATHS.skillUsageIndex}.usage.lock`;
  let timer = null;
  let initial = null;
  let stopped = false;
  let lastCompleteAt = 0;

  function isIdle() {
    try {
      if (service.getUsagePolicy().scan.state !== 'complete') return false;
      if (!lastCompleteAt) lastCompleteAt = Date.now();
      return Date.now() - lastCompleteAt < idleIntervalMs;
    } catch (_) {
      return false;
    }
  }

  const run = async () => {
    if (stopped || isIdle()) return;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const release = acquireLock(lockPath);
    if (!release) return;
    try {
      await service.runIngestPass(options.passOptions || {});
      if (service.getUsagePolicy().scan.state === 'complete') {
        lastCompleteAt = Date.now();
      }
    } catch (error) {
      console.error('[SkillUsage] ingest pass failed:', error?.message || error);
    } finally {
      release();
    }
  };

  initial = setTimeout(run, initialDelayMs);
  if (typeof initial.unref === 'function') initial.unref();
  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  _scheduler = {
    service,
    stop() {
      stopped = true;
      clearTimeout(initial);
      clearInterval(timer);
      _scheduler = null;
    }
  };
  return _scheduler;
}

let _sharedService = null;

function getSharedUsageService() {
  if (!_sharedService) _sharedService = createSkillUsageService();
  return _sharedService;
}

module.exports = {
  createSkillUsageService,
  getSharedUsageService,
  startUsageScheduler,
  getPolicy: () => getSharedUsageService().getPolicy()
};
