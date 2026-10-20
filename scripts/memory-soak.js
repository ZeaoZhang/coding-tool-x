#!/usr/bin/env node
'use strict';

// Only the forked fixture process loads application modules. The controller
// never changes the caller's home, native configuration, or running daemon.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { fork } = require('child_process');
const MIB = 1024 * 1024;

function options(argv) {
  const result = {
    sourceRoot: path.resolve(__dirname, '..'), scenario: 'combined',
    warmupSeconds: 600, durationSeconds: 3600, sampleSeconds: 30,
    gcSeconds: 300, requestSeconds: 1, bodyKiB: 1024,
    historyRows: 10000, projectCount: 80, nativeSeconds: 5, nativeBatch: 50,
    output: path.resolve(os.tmpdir(), `cc-tool-memory-soak-${Date.now()}`),
    heapSnapshots: null
  };
  const names = {
    'source-root': 'sourceRoot', scenario: 'scenario', output: 'output',
    'warmup-seconds': 'warmupSeconds', 'duration-seconds': 'durationSeconds',
    'sample-seconds': 'sampleSeconds', 'gc-seconds': 'gcSeconds',
    'request-seconds': 'requestSeconds', 'body-kib': 'bodyKiB',
    'history-rows': 'historyRows', 'project-count': 'projectCount', 'native-seconds': 'nativeSeconds', 'native-batch': 'nativeBatch'
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') return null;
    if (arg === '--heap-snapshots') { result.heapSnapshots = true; continue; }
    if (arg === '--no-heap-snapshots') { result.heapSnapshots = false; continue; }
    if (arg === '--quick') {
      Object.assign(result, { warmupSeconds: 5, durationSeconds: 30, sampleSeconds: 2, gcSeconds: 5, historyRows: 1000 });
      continue;
    }
    const key = names[arg.replace(/^--/, '')];
    if (!arg.startsWith('--') || !key || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${arg}`);
    const value = argv[++i];
    result[key] = typeof result[key] === 'number' ? Number(value) : value;
  }
  if (!['idle', 'cli', 'combined'].includes(result.scenario)) throw new Error('scenario must be idle, cli, or combined');
  for (const [key, value] of Object.entries(result)) {
    if (typeof value !== 'number') continue;
    if (!Number.isFinite(value) || value < (key === 'warmupSeconds' ? 0 : 1)) throw new Error(`Invalid ${key}`);
  }
  if (result.historyRows > 100000 || result.bodyKiB > 16384 || result.projectCount > 1000 || result.nativeBatch > 1000) throw new Error('Fixture size exceeds safety limit');
  result.sourceRoot = path.resolve(result.sourceRoot);
  result.output = path.resolve(result.output);
  result.heapSnapshots ??= result.durationSeconds >= 3600;
  if (!fs.existsSync(path.join(result.sourceRoot, 'src/server/index.js'))) throw new Error('source-root must contain src/server/index.js');
  if (fs.existsSync(result.output) && fs.readdirSync(result.output).length) throw new Error('output must be a new or empty directory');
  return result;
}

function json(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function vacantPort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}

function mockUpstream() {
  return http.createServer((req, res) => {
    // Drain instead of buffering to keep controller memory independent of the fixture.
    req.on('error', () => {});
    req.resume();
    req.once('end', () => {
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'claude-sonnet-4-20250514' }] }));
      if (req.headers['x-soak-stream'] === '1') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: message_start\ndata: {"type":"message_start","message":{"id":"soak","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":100,"output_tokens":0}}}\n\n');
        const timer = setTimeout(() => {
          res.end('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n');
        }, 2000);
        res.once('close', () => clearTimeout(timer));
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'soak', type: 'message', role: 'assistant', model: 'claude-sonnet-4-20250514', content: [{ type: 'text', text: 'fixture' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 10 } }));
      }
    });
  });
}

function request(port, route, { body, stream = false, abort = false } = {}) {
  return new Promise(resolve => {
    const startedAt = performance.now();
    let firstByteMs = null;
    let done = false;
    const finish = value => { if (!done) { done = true; resolve({ ...value, durationMs: performance.now() - startedAt, firstByteMs }); } };
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: body ? 'POST' : 'GET', headers: body ? {
      'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
      'x-api-key': 'synthetic-key', 'x-soak-stream': stream ? '1' : '0'
    } : {}, timeout: 15000 }, res => {
      firstByteMs = performance.now() - startedAt;
      res.on('error', () => finish({ error: true }));
      res.resume();
      res.once('end', () => finish({ status: res.statusCode, completed: true }));
      res.once('close', () => finish({ status: res.statusCode, closed: true, error: !abort }));
    });
    req.once('error', () => finish({ aborted: abort, error: !abort }));
    req.once('timeout', () => req.destroy(new Error('timeout')));
    if (abort) {
      const timer = setTimeout(() => req.destroy(), 100);
      req.once('close', () => clearTimeout(timer));
    }
    req.end(body);
  });
}

const LATENCY_BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 15000, Infinity];
function addLatency(histograms, key, value) {
  if (!Number.isFinite(value)) return;
  const histogram = histograms[key] ||= { count: 0, totalMs: 0, maxMs: 0, buckets: LATENCY_BOUNDS.map(bound => ({ upperMs: Number.isFinite(bound) ? bound : null, count: 0 })) };
  histogram.count++;
  histogram.totalMs += value;
  histogram.maxMs = Math.max(histogram.maxMs, value);
  histogram.buckets[LATENCY_BOUNDS.findIndex(bound => value <= bound)].count++;
}

function analyse(samples, opt, workload, exit) {
  const measured = samples.filter(s => s.elapsedSeconds >= opt.warmupSeconds && !s.excludedSnapshot);
  const floor = measured.filter(s => s.postGc && s.elapsedSeconds >= opt.warmupSeconds + Math.max(0, opt.durationSeconds - 1800));
  const midpoint = floor.length ? (floor[0].elapsedSeconds + floor[floor.length - 1].elapsedSeconds) / 2 : 0;
  const first = floor.filter(s => s.elapsedSeconds <= midpoint);
  const last = floor.filter(s => s.elapsedSeconds > midpoint);
  const growth = field => first.length && last.length ? Math.min(...last.map(s => s[field])) - Math.min(...first.map(s => s[field])) : null;
  const heapGrowth = growth('heapUsed');
  const rssFloorGrowth = growth('rss');
  const peakRss = measured.length ? Math.max(...measured.map(s => s.rss)) : null;
  const fullDuration = opt.durationSeconds >= 3600 && measured.length > 1 && measured.at(-1).elapsedSeconds >= opt.warmupSeconds + opt.durationSeconds - opt.sampleSeconds - 2;
  const coverage = workload.moduleCoverage;
  const missingCoverage = opt.scenario === 'combined' && (!coverage || coverage.snapshotProjects < opt.projectCount || coverage.peakSnapshotEntries < Math.min(64, opt.projectCount) || coverage.trendCalls === 0 || (coverage.trendDiagnosticsAvailable && coverage.peakTrendEntries === 0));
  const errors = workload.errors + workload.badStatus + workload.status503 + (workload.skippedTicks || 0)
    + (missingCoverage ? 1 : 0) + (workload.statisticsVerification?.passed === false ? 1 : 0);
  const failedExit = exit.unexpected || exit.code !== 0 || exit.signal !== null;
  const sufficientFloor = floor.length >= 6 && floor.at(-1).elapsedSeconds - floor[0].elapsedSeconds >= 1500;
  return {
    verdict: errors || failedExit ? 'failed' : !fullDuration ? 'smoke-only' : !sufficientFloor ? 'failed' : heapGrowth !== null && heapGrowth <= 5 * MIB && rssFloorGrowth <= 10 * MIB && peakRss < 450 * MIB ? 'passed' : 'failed',
    fullDuration, sampleCount: samples.length, postGcFloorSamples: floor.length,
    sufficientFloor, moduleCoveragePassed: !missingCoverage, acceptanceKind: opt.durationSeconds >= 86400 && opt.scenario === 'combined' ? '24h-combined' : '60min-scenario',
    heapGrowthBytes: heapGrowth, rssFloorGrowthBytes: rssFloorGrowth, peakRss,
    thresholds: { heapGrowthBytes: 5 * MIB, rssFloorGrowthBytes: 10 * MIB, peakRss: 450 * MIB },
    heapSnapshots: opt.heapSnapshots, snapshotExclusionSeconds: opt.heapSnapshots ? 60 : 0,
    workload, exit, caveat: 'Synthetic isolated backend; isolated exits are not PM2 restarts. A quick run cannot establish long-run stability. Web traffic uses real APIs and WebSocket, not browser rendering.'
  };
}

function chart(samples, output) {
  samples = samples.filter(s => !s.excludedSnapshot);
  if (!samples.length) return;
  const width = 1000, height = 440, left = 65, top = 35, plotWidth = 905, plotHeight = 345;
  const maxTime = Math.max(1, samples.at(-1).elapsedSeconds);
  const maxMemory = Math.max(500, ...samples.map(s => s.rss / MIB));
  const lines = ['rss', 'heapUsed', 'external', 'arrayBuffers'].map((field, i) => {
    const colors = ['#c43a3a', '#2468af', '#5d9135', '#a064b4'];
    const points = samples.map(s => `${left + s.elapsedSeconds / maxTime * plotWidth},${top + plotHeight - s[field] / MIB / maxMemory * plotHeight}`).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${colors[i]}" stroke-width="1.5"/><text x="${left + i * 180}" y="425" fill="${colors[i]}">${field}</text>`;
  }).join('');
  fs.writeFileSync(path.join(output, 'memory.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" font-size="14"><text x="65" y="22">Isolated backend memory (MiB)</text><path d="M${left} ${top}V${top + plotHeight}H970" fill="none" stroke="#555"/><text x="8" y="45">${Math.ceil(maxMemory)}</text><text x="15" y="385">0</text><text x="65" y="405">0 s</text><text x="870" y="405">${Math.round(maxTime)} s</text>${lines}</g></svg>`);
}

function checkCoverageRegression() {
  const assert = require('assert/strict');
  const opt = { scenario: 'combined', projectCount: 80, warmupSeconds: 0, durationSeconds: 30, sampleSeconds: 2 };
  const exit = { unexpected: false, code: 0, signal: null };
  const base = { errors: 0, badStatus: 0, status503: 0 };
  const coverage = { snapshotProjects: 80, peakSnapshotEntries: 64, trendCalls: 40, trendDiagnosticsAvailable: true, peakTrendEntries: 32 };
  const verdict = moduleCoverage => analyse([], opt, { ...base, moduleCoverage }, exit);
  assert.equal(verdict(coverage).moduleCoveragePassed, true);
  for (const missing of [undefined, { ...coverage, snapshotProjects: 0 }, { ...coverage, peakSnapshotEntries: 0 }, { ...coverage, trendCalls: 0 }, { ...coverage, peakTrendEntries: 0 }]) {
    assert.equal(verdict(missing).moduleCoveragePassed, false);
    assert.equal(verdict(missing).verdict, 'failed');
  }
  assert.equal(verdict({ ...coverage, trendDiagnosticsAvailable: false, peakTrendEntries: 0 }).moduleCoveragePassed, true);
  assert.equal(analyse([], opt, { ...base, moduleCoverage: coverage, skippedTicks: 1 }, exit).verdict, 'failed');
  assert.equal(analyse([], opt, { ...base, moduleCoverage: coverage, statisticsVerification: { passed: false } }, exit).verdict, 'failed');
  assert.equal(analyse([], opt, { ...base, moduleCoverage: coverage, statisticsVerification: { passed: true } }, exit).verdict, 'smoke-only');
  console.log('Acceptance regression checks passed: valid load, missing modules, unavailable legacy diagnostics, skipped load, and failed statistics verification.');
}

async function controller(opt) {
  fs.mkdirSync(opt.output, { recursive: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tool-soak-home-'));
  const mock = mockUpstream();
  const mockPort = await listen(mock);
  const webPort = await vacantPort();
  let proxyPort = await vacantPort();
  while (proxyPort === webPort) proxyPort = await vacantPort();
  const childOptions = { ...opt, home, mockPort, webPort, proxyPort };
  json(path.join(opt.output, 'options.json'), { ...opt, node: process.version, createdAt: new Date().toISOString(), mockPort, webPort, proxyPort, fixtureVersion: 3 });
  const samples = [], timers = [], sockets = new Set(), pending = new Set();
  const workload = { cli: 0, api: 0, wsMessages: 0, status503: 0, errors: 0, badStatus: 0, intentionalAborts: 0, skippedTicks: 0, completedStreams: 0, latency: {} };
  const child = fork(__filename, ['--child'], { cwd: opt.sourceRoot, env: { ...process.env, CC_TOOL_SOAK_OPTIONS: JSON.stringify(childOptions) }, execArgv: ['--expose-gc'], silent: true });
  const logFd = fs.openSync(path.join(opt.output, 'backend.log'), 'w');
  let logBytes = 0, logTruncated = false;
  const appendLog = data => {
    if (logBytes + data.length <= 64 * MIB) { fs.writeSync(logFd, data); logBytes += data.length; }
    else if (!logTruncated) { fs.writeSync(logFd, '\n[SOAK] backend.log capped at 64 MiB\n'); logTruncated = true; }
  };
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  const exit = { pid: child.pid, code: null, signal: null, unexpected: false, isolatedProcessStarts: 1, pm2Restarts: null };
  let stopping = false, started = 0, finished = false;
  child.once('exit', (code, signal) => { Object.assign(exit, { code, signal, unexpected: !stopping }); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const cleanup = async () => {
    if (finished) return;
    finished = true;
    stopping = true;
    timers.forEach(clearInterval);
    for (const ws of sockets) ws.terminate();
    if (child.connected) child.send({ type: 'stop' });
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 60000);
    await exited;
    clearTimeout(killTimer);
    mock.closeAllConnections();
    await new Promise(resolve => mock.close(resolve));
    fs.closeSync(logFd);
    fs.rmSync(home, { recursive: true, force: true });
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Backend startup timed out (see backend.log)')), 120000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.on('message', message => {
        if (message.type === 'ready') { started = Date.now(); clearTimeout(timer); resolve(); }
        if (message.type === 'fatal') { clearTimeout(timer); reject(new Error(message.error)); }
        if (message.type === 'statisticsVerification') workload.statisticsVerification = message.result;
        if (message.type === 'sample') {
          if (message.coverage) workload.moduleCoverage = message.coverage;
          const sample = { ...message.memory, cpu: message.cpu, eventLoop: message.eventLoop, coverage: message.coverage, timestamp: new Date().toISOString(), pid: message.pid, postGc: message.postGc, excludedSnapshot: message.excludedSnapshot === true, elapsedSeconds: Math.max(0, (Date.now() - started) / 1000) };
          samples.push(sample);
          fs.appendFileSync(path.join(opt.output, 'samples.jsonl'), `${JSON.stringify(sample)}\n`);
        }
      });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Backend exited before readiness')); });
    });
    console.log(`Soak ${opt.scenario}: isolated PID ${child.pid}, ${opt.warmupSeconds}s warmup + ${opt.durationSeconds}s measurement; ${opt.output}`);
    timers.push(setInterval(() => json(path.join(opt.output, 'workload-progress.json'), { timestamp: new Date().toISOString(), controllerPid: process.pid, backendPid: child.pid, pending: pending.size, workload }), opt.sampleSeconds * 1000));
    const record = (promise, kind, abort = false, stream = false) => {
      pending.add(promise);
      promise.then(result => {
        workload[kind]++;
        if (abort) workload.intentionalAborts++;
        else if (result.error) workload.errors++;
        if (result.status === 503) workload.status503++;
        else if (result.status && (result.status < 200 || result.status >= 300)) workload.badStatus++;
        const latencyKind = abort ? 'canceled' : kind === 'api' ? 'api' : stream ? 'cliStream' : 'cliPlain';
        addLatency(workload.latency, latencyKind, result.durationMs);
        addLatency(workload.latency, `${latencyKind}FirstByte`, result.firstByteMs);
        if (stream && !abort && result.completed) workload.completedStreams++;
      }).finally(() => pending.delete(promise));
      return promise;
    };
    let tick = 0;
    const payload = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 32, stream: false, messages: [{ role: 'user', content: 'x'.repeat(opt.bodyKiB * 1024) }], system: 'Synthetic system prompt. '.repeat(10), tools: [{ name: 'fixture', description: 'synthetic', input_schema: { type: 'object', properties: {} } }] });
    if (opt.scenario !== 'idle') timers.push(setInterval(() => {
      if (pending.size >= 8) { workload.skippedTicks++; return; }
      tick++;
      const stream = tick % 2 === 0;
      const abort = tick % 20 === 0;
      record(request(proxyPort, '/v1/messages', { body: stream ? payload.replace('"stream":false', '"stream":true') : payload, stream, abort }), 'cli', abort, stream);
    }, opt.requestSeconds * 1000));
    if (opt.scenario === 'combined') {
      // Use a completed date so live statistics writes do not invalidate every
      // query before diagnostics can observe the trend cache.
      for (let i = 0; i < 40; i++) await record(request(webPort, `/api/statistics/trend?startDate=2020-01-01&endDate=2020-01-01&filterModel=fixture-${i}`), 'api');
      const WebSocket = require(path.join(opt.sourceRoot, 'node_modules/ws'));
      const ws = new WebSocket(`ws://127.0.0.1:${webPort}/ws`);
      sockets.add(ws);
      ws.on('message', () => workload.wsMessages++);
      ws.on('error', () => workload.errors++);
      timers.push(setInterval(() => {
        if (pending.size >= 8) return;
        const projectIndex = Math.floor(tick / 2) % opt.projectCount;
        const project = `soak-project-${projectIndex}`;
        record(request(webPort, `/api/platforms/claude/sessions/${project}`), 'api');
        child.send({ type: 'exerciseSnapshot', projectIndex });
        record(request(webPort, `/api/statistics/trend?startDate=2020-01-01&endDate=2020-01-01&filterModel=fixture-${tick % 100}`), 'api');
      }, 2000));
    }
    await new Promise(resolve => {
      const timer = setTimeout(resolve, (opt.warmupSeconds + opt.durationSeconds) * 1000);
      const stop = () => { clearTimeout(timer); resolve(); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      child.once('exit', stop);
    });
  } finally {
    await cleanup();
    const report = analyse(samples, opt, workload, exit);
    json(path.join(opt.output, 'report.json'), report);
    fs.writeFileSync(path.join(opt.output, 'memory.csv'), ['timestamp,elapsedSeconds,pid,postGc,excludedSnapshot,rss,heapUsed,heapTotal,external,arrayBuffers', ...samples.map(s => [s.timestamp, s.elapsedSeconds, s.pid, s.postGc, s.excludedSnapshot, s.rss, s.heapUsed, s.heapTotal, s.external, s.arrayBuffers].join(','))].join('\n') + '\n');
    chart(samples, opt.output);
    console.log(JSON.stringify(report, null, 2));
    if (exit.unexpected || workload.errors || workload.badStatus || report.verdict === 'failed') process.exitCode = 1;
  }
}

async function fixtureChild() {
  const opt = JSON.parse(process.env.CC_TOOL_SOAK_OPTIONS);
  // os.homedir is overridden only inside the fork, before any app import.
  os.homedir = () => opt.home;
  // Native index/snapshot workers are separate processes. Propagate the same
  // home isolation before their first application import, without rewriting HOME.
  const preload = path.join(opt.home, 'isolate-home.cjs');
  fs.writeFileSync(preload, `require('os').homedir = () => ${JSON.stringify(opt.home)};\n`);
  process.execArgv.push('--require', preload);
  for (const key of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'OPENCODE_DB_PATH', 'OMP_CONFIG_DIR', 'OMP_AGENT_DIR', 'PI_CODING_AGENT_DIR', 'OMP_CODING_AGENT_DIR', 'OMP_PROFILE', 'DSH_HOME', 'APPDATA', 'LOCALAPPDATA']) delete process.env[key];
  process.env.OMP_CONFIG_DIR = path.join(opt.home, '.omp');
  process.env.PI_CODING_AGENT_DIR = path.join(opt.home, '.omp/agent');
  process.env.OMP_COMMAND = path.join(opt.home, 'no-installed-omp');
  process.env.CC_TOOL_MEMORY_TRACE = '1';
  process.env.CC_TOOL_LOG_REQUESTS = 'false';
  process.env.CC_TOOL_LOG_API_REQUESTS = 'false';
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key];
  for (const dir of ['.claude/projects', '.codex/sessions', '.gemini/tmp/soak/chats', '.omp/agent/sessions', '.local/share/opencode']) fs.mkdirSync(path.join(opt.home, dir), { recursive: true });
  const app = relative => require(path.join(opt.sourceRoot, relative));
  const { PATHS, NATIVE_PATHS } = app('src/config/paths');
  if (!PATHS.base.startsWith(opt.home + path.sep)) throw new Error('Application storage is not isolated');
  for (const platformPaths of Object.values(NATIVE_PATHS)) {
    for (const nativePath of Object.values(platformPaths)) {
      if (typeof nativePath === 'string' && path.isAbsolute(nativePath) && !nativePath.startsWith(opt.home + path.sep)) throw new Error(`Native path is not isolated: ${nativePath}`);
    }
  }
  json(PATHS.configFile, { projectsDir: path.join(opt.home, '.claude/projects'), ports: { webUI: opt.webPort, proxy: opt.proxyPort }, nativeCliLogs: { enabled: true, intervalSeconds: 1 }, maxLogs: 100 });
  json(PATHS.channels.claude, { channels: [{ id: 'fixture', name: 'Synthetic local upstream', baseUrl: `http://127.0.0.1:${opt.mockPort}`, apiKey: 'synthetic-key', enabled: true, authType: 'api_key', weight: 1 }] });
  const timestamp = '2026-10-01T00:00:00.000Z';
  for (let i = 0; i < opt.projectCount; i++) {
    const project = path.join(opt.home, '.claude/projects', `soak-project-${i}`);
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, `session-${i}.jsonl`), `${JSON.stringify({ type: 'user', uuid: `u-${i}`, sessionId: `session-${i}`, timestamp, cwd: opt.home, message: { role: 'user', content: 'synthetic historical message' } })}\n`);
  }
  const { DatabaseSync } = require('node:sqlite');
  const nativeDb = new DatabaseSync(path.join(opt.home, '.local/share/opencode/opencode.db'));
  nativeDb.exec('CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY, session_id TEXT, message_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);');
  const insert = nativeDb.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)');
  let nativeIndex = 0;
  const nativeRow = () => {
    const index = nativeIndex++;
    insert.run(`p-${index}`, 'fixture', null, index + 1, index + 1, JSON.stringify({ type: 'step-finish', model: 'fixture-model', tokens: { input: 100, output: 10 } }));
  };
  nativeDb.exec('BEGIN');
  for (let i = 0; i < opt.historyRows; i++) nativeRow();
  nativeDb.exec('COMMIT');
  const geminiFile = path.join(opt.home, '.gemini/tmp/soak/chats/session-fixture.json');
  let geminiMessages = Array.from({ length: Math.min(opt.historyRows, 10000) }, (_, i) => ({ id: `g-${i}`, type: 'gemini', timestamp, tokens: { input: 100, output: 10 }, model: 'gemini-2.5-pro' }));
  const writeGemini = () => json(geminiFile, { sessionId: 'fixture', startTime: timestamp, lastUpdated: timestamp, messages: geminiMessages });
  writeGemini();
  // This harness measures backend state; rebuilding the frontend would mutate
  // the selected baseline checkout and make the workloads incomparable.
  const buildPath = require.resolve(path.join(opt.sourceRoot, 'src/server/services/web-build'));
  require.cache[buildPath] = { id: buildPath, filename: buildPath, loaded: true, exports: { inspectWebBuildState: () => ({ needsBuild: false }) } };
  // Deny accidental Internet traffic from startup discovery or fixture routes.
  const originalConnect = require('net').Socket.prototype.connect;
  require('net').Socket.prototype.connect = function (...args) {
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const input = normalized[0];
    const host = typeof input === 'object' ? input.host || input.hostname : typeof normalized[1] === 'string' ? normalized[1] : 'localhost';
    if (host && !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(`Soak blocked external connection: ${host}`);
    return originalConnect.apply(this, args);
  };
  let trendCalls = 0;
  const statistics = app('src/server/services/statistics-service');
  const originalTrend = statistics.getTrendStatistics;
  statistics.getTrendStatistics = (...args) => { trendCalls++; return originalTrend(...args); };
  const server = await app('src/server').startServer(opt.webPort, '127.0.0.1', { interactive: false });
  await app('src/platforms/drivers/claude/proxy-implementation').startProxyServer();
  const snapshotCache = app('src/server/services/snapshot-cache');
  const snapshotProjects = new Set();
  let peakSnapshotEntries = 0, peakTrendEntries = 0;
  const coverage = () => {
    const snapshots = snapshotCache.getSnapshotCacheDiagnostics?.();
    const queue = statistics.getStatisticsQueueDiagnostics?.();
    peakSnapshotEntries = Math.max(peakSnapshotEntries, snapshots?.entries ?? snapshotCache._test?.snapshots?.size ?? 0);
    peakTrendEntries = Math.max(peakTrendEntries, queue?.trendCacheEntries || 0);
    return { snapshotProjects: snapshotProjects.size, peakSnapshotEntries, peakTrendEntries, trendCalls, trendDiagnosticsAvailable: typeof statistics.getStatisticsQueueDiagnostics === 'function', snapshotPath: 'isolated IPC -> session-snapshots -> indexed payload (production session API uses session-history-index)' };
  };
  const exerciseSnapshot = async projectIndex => {
    const projectName = `soak-project-${projectIndex}`;
    const result = await app('src/server/services/session-snapshots').getSessionListSnapshot('claude', projectName, {
      force: true,
      refresh: () => app('src/server/services/session-snapshot-worker').buildPayload({ source: 'claude', projectName, config: { projectsDir: path.join(opt.home, '.claude/projects') }, options: { force: true } })
    });
    if (result.meta?.error || result.meta?.fallback) throw new Error(`Snapshot fixture refresh failed: ${projectName}: ${result.meta?.error || 'fallback'}`);
    snapshotProjects.add(projectName);
    coverage();
  };
  if (opt.scenario === 'combined') {
    // No production session API currently calls this legacy snapshot service.
    // Exercise it explicitly in the isolated process instead of claiming API coverage.
    for (let i = 0; i < opt.projectCount; i++) await exerciseSnapshot(i);
    console.log(`[SOAK] module-coverage ${JSON.stringify(coverage())}`);
  }
  let stopping = false;
  let snapshotExcludedUntil = 0;
  const loopDelay = require('perf_hooks').monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
  const timers = [];
  const sample = postGc => {
    if (postGc) global.gc();
    process.send?.({ type: 'sample', pid: process.pid, postGc, excludedSnapshot: Date.now() < snapshotExcludedUntil, memory: process.memoryUsage(), cpu: process.cpuUsage(), eventLoop: { meanMs: loopDelay.mean / 1e6, maxMs: loopDelay.max / 1e6, p99Ms: loopDelay.percentile(99) / 1e6 }, coverage: coverage() });
    loopDelay.reset();
  };
  process.send?.({ type: 'ready', pid: process.pid });
  sample(true);
  timers.push(setInterval(() => sample(false), opt.sampleSeconds * 1000));
  timers.push(setInterval(() => sample(true), opt.gcSeconds * 1000));
  const snapshot = name => {
    // A snapshot temporarily duplicates part of the heap. Exclude it and the
    // next minute from the acceptance series, while retaining raw samples.
    snapshotExcludedUntil = Date.now() + 60000;
    const file = require('v8').writeHeapSnapshot(path.join(opt.output, `${name}-${process.pid}.heapsnapshot`));
    snapshotExcludedUntil = Date.now() + 60000;
    console.log(`[SOAK] heap-snapshot ${JSON.stringify({ file, exclusionSeconds: 60 })}`);
  };
  if (opt.heapSnapshots) timers.push(setTimeout(() => { global.gc(); snapshot('warmup-end'); }, opt.warmupSeconds * 1000));
  if (opt.scenario !== 'idle') timers.push(setInterval(() => {
    if (nativeIndex >= 1000000) throw new Error('Fixture reached one million rows; stopping to bound temporary storage');
    nativeDb.exec('BEGIN');
    for (let i = 0; i < opt.nativeBatch; i++) {
      nativeRow();
      geminiMessages.push({ id: `new-${nativeIndex}`, type: 'gemini', timestamp: new Date().toISOString(), tokens: { input: 100, output: 10 }, model: 'gemini-2.5-pro' });
    }
    nativeDb.exec('COMMIT');
    if (geminiMessages.length > 10000) geminiMessages = geminiMessages.slice(-10000);
    writeGemini();
  }, opt.nativeSeconds * 1000));
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    loopDelay.disable();
    timers.forEach(clearInterval);
    sample(true);
    if (opt.heapSnapshots) snapshot('measurement-end');
    // Stop generating first, then let the whole-JSON poll interval drain the
    // final batch. This extra drain is outside the measured load window.
    if (opt.scenario !== 'idle') await new Promise(resolve => setTimeout(resolve, 16000));
    const observer = app('src/server/services/native-log-observer');
    for (let i = 0; i < 20; i++) observer.pollNativeCliLogs();
    if (observer.drainNativeCliLogs) await observer.drainNativeCliLogs();
    app('src/server/services/memory-reclaimer').stopMemoryReclaimer();
    await app('src/platforms/drivers/claude/proxy-implementation').stopProxyServer({ forceAfterMs: 3000 });
    await app('src/server/websocket-server').flushPendingLogs();
    if (observer.drainNativeCliLogs) await observer.drainNativeCliLogs();
    const statisticsResult = await app('src/server/services/statistics-service').shutdownStatistics();
    if (statisticsResult?.durable === false) throw new Error('Statistics shutdown was not durable');
    observer.shutdownNativeCliLogObserver();
    const verification = await verifyNativeStatistics(PATHS, nativeIndex - opt.historyRows, opt.historyRows, opt.output);
    json(path.join(opt.output, 'statistics-verification.json'), verification);
    process.send?.({ type: 'statisticsVerification', result: verification });
    server.closeAllConnections();
    server.close();
    nativeDb.close();
    app('src/server/services/sqlite-connection').closeAllDatabases();
    process.exit(0);
  };
  let snapshotBusy = false;
  process.on('message', message => {
    if (message.type === 'stop') stop().catch(error => { console.error(error); process.exit(1); });
    if (message.type === 'exerciseSnapshot' && !stopping && !snapshotBusy) {
      snapshotBusy = true;
      exerciseSnapshot(message.projectIndex).catch(error => { console.error(error); process.exit(1); }).finally(() => { snapshotBusy = false; });
    }
  });
  process.once('disconnect', () => stop());
  process.once('SIGTERM', () => stop());
}

async function verifyNativeStatistics(paths, expected, historicalRows, output) {
  const { DatabaseSync } = require('node:sqlite');
  const ledger = new DatabaseSync(path.join(output, 'native-statistics-ledger.sqlite'));
  ledger.exec('PRAGMA cache_size = -2048; CREATE TABLE records(tool TEXT, id INTEGER, input INTEGER, output INTEGER, PRIMARY KEY(tool,id)); BEGIN');
  const insert = ledger.prepare('INSERT OR IGNORE INTO records VALUES (?,?,?,?)');
  const counts = { opencode: 0, gemini: 0 };
  let duplicates = 0, invalid = 0;
  try {
    if (fs.existsSync(paths.statistics.requestLogs)) {
      for (const month of fs.readdirSync(paths.statistics.requestLogs, { withFileTypes: true })) {
        if (!month.isDirectory()) continue;
        const dir = path.join(paths.statistics.requestLogs, month.name);
        for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.jsonl'))) {
          const lines = require('readline').createInterface({ input: fs.createReadStream(path.join(dir, name)), crlfDelay: Infinity });
          for await (const line of lines) {
            if (!line.trim()) continue;
            let record;
            try { record = JSON.parse(line); } catch (_) { invalid++; continue; }
            if (!(record.toolType in counts)) continue;
            counts[record.toolType]++;
            const match = (record.toolType === 'opencode' ? /^opencode:fixture:p-(\d+)$/ : /^session-fixture\.json:new-(\d+)$/).exec(record.id || '');
            const id = match ? Number(match[1]) - (record.toolType === 'gemini' ? 1 : 0) : -1;
            if (id < historicalRows || id >= historicalRows + expected || record.tokens?.input !== 100 || record.tokens?.output !== 10) { invalid++; continue; }
            if (insert.run(record.toolType, id, record.tokens.input, record.tokens.output).changes === 0) duplicates++;
          }
        }
      }
    }
    ledger.exec('COMMIT');
    const distinct = ledger.prepare('SELECT tool,COUNT(*) AS count FROM records GROUP BY tool').all();
    const summary = fs.existsSync(paths.statistics.summary) ? JSON.parse(fs.readFileSync(paths.statistics.summary, 'utf8')) : {};
    const aggregate = Object.fromEntries(Object.keys(counts).map(tool => [tool, summary.byToolType?.[tool]?.requests || 0]));
    const passed = invalid === 0 && duplicates === 0 && Object.keys(counts).every(tool => counts[tool] === expected && aggregate[tool] === expected);
    return { passed, expectedPerNativePlatform: expected, counts, distinct, aggregate, duplicates, invalid, ledger: path.join(output, 'native-statistics-ledger.sqlite') };
  } finally { ledger.close(); }
}

if (process.argv.includes('--self-check')) {
  checkCoverageRegression();
} else if (process.argv.includes('--child')) {
  fixtureChild().catch(error => { process.send?.({ type: 'fatal', error: error.stack }); console.error(error); process.exit(1); });
} else {
  try {
    const opt = options(process.argv.slice(2));
    if (!opt) console.log('Usage: node scripts/memory-soak.js [--scenario idle|cli|combined] [--quick]\n  --source-root PATH --output PATH --warmup-seconds 600 --duration-seconds 3600\n  --sample-seconds 30 --gc-seconds 300 --request-seconds 1 --body-kib 1024\n  --history-rows 10000 --project-count 80 --native-seconds 5 --native-batch 50\n  --heap-snapshots | --no-heap-snapshots (default: enabled for 60min+)\n24 h: --scenario combined --duration-seconds 86400\nRun each source checkout separately with identical options; no reset or PM2 operations.');
    else controller(opt).catch(error => { console.error(error.stack); process.exitCode = 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
