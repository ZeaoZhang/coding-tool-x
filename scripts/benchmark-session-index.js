#!/usr/bin/env node
/**
 * Benchmark script for session-history-index read paths.
 *
 * Creates a temp directory with synthetic Claude session files,
 * runs a full inventory, then times each query type.
 *
 * Usage: node scripts/benchmark-session-index.js [--sessions=N] [--messages=N]
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const sessionCount = parseInt(args.find(a => a.startsWith('--sessions='))?.split('=')[1] || '50', 10);
const messagesPerSession = parseInt(args.find(a => a.startsWith('--messages='))?.split('=')[1] || '20', 10);

// ── Create temp directory with synthetic sessions ────────────────────────────
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-session-index-'));
const projectsDir = path.join(testDir, 'projects');
const projects = ['bench-proj-a', 'bench-proj-b', 'bench-proj-c'];
const dbPath = path.join(testDir, 'session-history.sqlite');

// Generate synthetic sessions with messages
const sessionsPerProject = Math.ceil(sessionCount / projects.length);
let totalSessions = 0;
let totalMessages = 0;

for (const proj of projects) {
  const projDir = path.join(projectsDir, proj);
  fs.mkdirSync(projDir, { recursive: true });
  for (let s = 0; s < sessionsPerProject && totalSessions < sessionCount; s++) {
    const sessionId = `bench-${proj}-${String(s).padStart(4, '0')}`;
    const filePath = path.join(projDir, `${sessionId}.jsonl`);
    const lines = [];
    // Session header
    lines.push(JSON.stringify({
      type: 'user',
      sessionId,
      message: { content: `Benchmark session ${s} in ${proj}`, role: 'user' },
      cwd: `/workspace/${proj}`,
      gitBranch: 'main',
      timestamp: new Date(Date.now() - s * 3600000).toISOString()
    }));
    // Messages
    for (let m = 0; m < messagesPerSession; m++) {
      const isUser = m % 2 === 0;
      const role = isUser ? 'user' : 'assistant';
      const content = isUser
        ? `Question ${m}: how do I benchmark session indexing for project ${proj} session ${s}?`
        : `Answer ${m}: use node:sqlite with DatabaseSync and prepared statements for the ${proj} scenario.`;
      lines.push(JSON.stringify({
        type: role,
        message: { content, role },
        timestamp: new Date(Date.now() - s * 3600000 + m * 60000).toISOString()
      }));
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
    totalSessions++;
    totalMessages += messagesPerSession + 1;
  }
}

// ── Override config for this benchmark ────────────────────────────────────────
const srcDir = path.resolve(__dirname, '..', 'src');
const pathsModule = path.join(srcDir, 'config', 'paths.js');
const geminiConfigModule = path.join(srcDir, 'server', 'services', 'gemini-config.js');
const ompConfigModule = path.join(srcDir, 'server', 'services', 'omp-config.js');
const indexPath = path.join(srcDir, 'server', 'services', 'session-history-index.js');

require.cache[pathsModule] = {
  id: pathsModule, filename: pathsModule, loaded: true,
  exports: {
    NATIVE_PATHS: {
      claude: { projects: projectsDir },
      codex: { config: path.join(testDir, 'codex.toml') },
      gemini: { env: path.join(testDir, '.env') },
      opencode: { data: path.join(testDir, 'opencode') }
    },
    PATHS: {
      base: testDir,
      sessionHistoryIndex: dbPath,
      projectOrder: path.join(testDir, 'project-order.json'),
      forkRelations: path.join(testDir, 'fork-relations.json'),
      sessionOrder: path.join(testDir, 'session-order.json'),
      opencodeProjectOrder: path.join(testDir, 'oc-project-order.json'),
      opencodeSessionOrder: path.join(testDir, 'oc-session-order.json'),
      ompProjectOrder: path.join(testDir, 'omp-project-order.json'),
      ompSessionOrder: path.join(testDir, 'omp-session-order.json')
    },
    HOME_DIR: testDir,
    ensureStorageDirMigrated: () => {}
  }
};

require.cache[geminiConfigModule] = {
  id: geminiConfigModule, filename: geminiConfigModule, loaded: true,
  exports: { getGeminiDir: () => path.join(testDir, '.gemini') }
};
require.cache[ompConfigModule] = {
  id: ompConfigModule, filename: ompConfigModule, loaded: true,
  exports: { getOmpPaths: () => ({ sessions: path.join(testDir, '.omp', 'agent', 'sessions'), agentDir: path.join(testDir, '.omp', 'agent') }) }
};

// ── Benchmark harness ─────────────────────────────────────────────────────────
async function time(label, fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  const elapsedNs = process.hrtime.bigint() - start;
  const elapsedMs = Number(elapsedNs) / 1e6;
  process.stdout.write(`  ${label.padEnd(40)} ${elapsedMs.toFixed(2).padStart(8)} ms  (${typeof result === 'number' ? result : Array.isArray(result) ? result.length : '—'} result${Array.isArray(result) && result.length !== 1 ? 's' : ''})\n`);
  return result;
}

(async () => {
// Clear stale caches from any prior requires
delete require.cache[pathsModule];
delete require.cache[path.join(srcDir, 'server', 'services', 'session-history-adapters', 'index.js')];
delete require.cache[path.join(srcDir, 'server', 'services', 'session-history-adapters', 'claude.js')];
delete require.cache[indexPath];

const { createSessionHistoryIndex } = require(indexPath);
const index = createSessionHistoryIndex({ dbPath });
const source = 'claude';

console.log('── Inventory ──');
await time('ensureSourceIndexed (force)', () => index.ensureSourceIndexed(source, { force: true }));

console.log('\n── Project Queries ──');
const projectList = await time('listProjects', () => index.listProjects(source));
await time('listProjects (cached)', () => index.listProjects(source));

console.log('\n── Session Queries ──');
for (const proj of projectList.slice(0, 2)) {
  await time(`listSessions for "${proj.name}"`, () => index.listSessions(source, proj.name));
}

console.log('\n── Recent & Search ──');
await time('getRecentSessions (limit=10)', () => index.getRecentSessions(source, 10));
await time('searchSessions "benchmark"', () => index.searchSessions(source, 'benchmark'));
await time('searchSessions "scenario"', () => index.searchSessions(source, 'scenario'));

console.log('\n── Message Pages ──');
const sampleSession = await time('listSessions (any)', () => index.listSessions(source, projectList[0].name));
if (sampleSession.length > 0) {
  const sid = sampleSession[0].sessionId;
  await time(`getSessionStatus for "${sid}"`, () => index.getSessionStatus(source, sid));
  await time(`getSessionOutline for "${sid}"`, () => index.getSessionOutline(source, sid));
  await time(`getMessagePage for "${sid}" (page 1)`, () => index.getMessagePage(source, sid, { page: 1, limit: 10 }));
}

index.closeSessionHistoryIndex();
fs.rmSync(testDir, { recursive: true, force: true });
console.log('\nDone.\n');
})();
