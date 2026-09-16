#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { spawn } = require('child_process');

const DEFAULT_RUNS = 5;
const MIB = 1024 * 1024;
const SHORT_LINE = JSON.stringify({
  type: 'event_msg',
  payload: { type: 'noise', info: { text: 'synthetic native-log history row' } }
}) + '\n';

function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers
  };
}

function listJsonlFiles(rootDir) {
  return fs.readdirSync(rootDir)
    .filter(name => name.endsWith('.jsonl'))
    .map(name => path.join(rootDir, name));
}

function writeLine(fd, value) {
  const buffer = Buffer.from(`${JSON.stringify(value)}\n`);
  fs.writeSync(fd, buffer, 0, buffer.length);
}

function fillWithShortRows(fd, targetBytes, initialBytes) {
  let written = initialBytes;
  while (written + SHORT_LINE.length <= targetBytes) {
    const count = SHORT_LINE.length;
    const buffer = Buffer.from(SHORT_LINE);
    fs.writeSync(fd, buffer, 0, count);
    written += count;
  }
  return written;
}

function makeFixture(rootDir, scenario) {
  const files = scenario === 'many-files' ? 8 : 1;
  const targetBytes = scenario === 'short-200mb' ? 200 * MIB
    : scenario === 'long-20mb' ? 22 * MIB
      : scenario === 'many-files' ? 4 * MIB
        : 10 * MIB;
  fs.mkdirSync(rootDir, { recursive: true });

  for (let fileIndex = 0; fileIndex < files; fileIndex += 1) {
    const filePath = path.join(rootDir, `rollout-${scenario}-${fileIndex}.jsonl`);
    const fd = fs.openSync(filePath, 'w');
    let written = 0;
    const sessionId = `synthetic-${scenario}-${fileIndex}`;
    const header = JSON.stringify({
      type: 'session_meta',
      payload: { id: sessionId, model_provider: 'synthetic-provider' }
    }) + '\n';
    const model = JSON.stringify({ type: 'turn_context', payload: { model: 'synthetic-model' } }) + '\n';
    fs.writeSync(fd, header);
    written += Buffer.byteLength(header);

    if (scenario === 'long-20mb') {
      fs.writeSync(fd, model);
      written += Buffer.byteLength(model);
      writeLine(fd, {
        type: 'event_msg',
        payload: { type: 'tool_output', output: 'x'.repeat(20 * MIB) }
      });
      written = fs.fstatSync(fd).size;
    } else if (scenario === 'sparse-10mb' || scenario === 'no-usage-10mb') {
      if (scenario === 'sparse-10mb') {
        fs.writeSync(fd, model);
        written += Buffer.byteLength(model);
      }
      written = fillWithShortRows(fd, targetBytes, written);
    } else {
      written = fillWithShortRows(fd, targetBytes - Buffer.byteLength(model) - 180, written);
    }

    if (scenario !== 'no-usage-10mb') {
      if (scenario !== 'sparse-10mb' && scenario !== 'long-20mb') fs.writeSync(fd, model);
      writeLine(fd, {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 } }
        }
      });
    }
    fs.closeSync(fd);
  }
}

function parseOldCodexFile(filePath) {
  const records = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  let usage = null;
  let model = '';
  let provider = '';
  let sessionId = path.basename(filePath, '.jsonl');
  for (const record of records) {
    if (record.type === 'session_meta') {
      sessionId = record.payload?.id || sessionId;
      provider = record.payload?.model_provider || provider;
    } else if (record.type === 'turn_context') {
      model = record.payload?.model || model;
    } else if (record.type === 'event_msg' && record.payload?.type === 'token_count') {
      usage = record.payload?.info?.total_token_usage || usage;
    }
  }
  return { sessionId, provider, model, usage };
}

function appendSyntheticUsage(rootDir) {
  for (const filePath of listJsonlFiles(rootDir)) {
    const fd = fs.openSync(filePath, 'a');
    writeLine(fd, {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 150, output_tokens: 0, total_tokens: 150 } }
      }
    });
    fs.closeSync(fd);
  }
}

function runOld(rootDir, sample) {
  for (const filePath of listJsonlFiles(rootDir)) {
    parseOldCodexFile(filePath);
    sample();
  }
  appendSyntheticUsage(rootDir);
  for (const filePath of listJsonlFiles(rootDir)) {
    parseOldCodexFile(filePath);
    sample();
  }
}

function runCandidate(rootDir, sample) {
  const codexDriver = require('../src/platforms/drivers/codex/native-logs');
  let diagnostics = [];
  let readBytes = 0;
  const trackedFs = {
    ...fs,
    readSync(...args) {
      const count = fs.readSync(...args);
      readBytes += count;
      sample();
      return count;
    }
  };
  const cursor = codexDriver.createDriver({ nativeRoot: rootDir, fsImpl: trackedFs })
    .createNativeLogCursor({
      fs: trackedFs,
      skipInitialParse: true,
      onDiagnostic: details => { diagnostics.push(details); }
    });
  cursor.initialize();
  const baseline = diagnostics.at(-1) || {};
  appendSyntheticUsage(rootDir);
  const events = cursor.readNewEvents();
  return { baseline, append: diagnostics.at(-1) || {}, events: events.length, readBytes };
}

function runWorker(mode, rootDir, useGc) {
  const startedAt = performance.now();
  let peak = memorySnapshot();
  const samples = [];
  const sample = () => {
    const current = memorySnapshot();
    samples.push({ at: performance.now() - startedAt, ...current });
    peak = {
      rss: Math.max(peak.rss, current.rss),
      heapUsed: Math.max(peak.heapUsed, current.heapUsed),
      heapTotal: Math.max(peak.heapTotal, current.heapTotal),
      external: Math.max(peak.external, current.external),
      arrayBuffers: Math.max(peak.arrayBuffers, current.arrayBuffers)
    };
  };
  if (useGc && typeof global.gc === 'function') global.gc();
  sample();
  const before = memorySnapshot();
  const result = mode === 'old' ? (runOld(rootDir, sample), {}) : runCandidate(rootDir, sample);
  const after = memorySnapshot();
  if (useGc && typeof global.gc === 'function') global.gc();
  const postGc = memorySnapshot();
  sample();
  process.stdout.write(`RESULT ${JSON.stringify({
    mode,
    durationMs: performance.now() - startedAt,
    before,
    after,
    postGc,
    peak,
    samples: samples.length,
    ...result
  })}\n`);
}

function readProcessRss(pid) {
  try {
    const output = require('child_process').execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
    const kb = Number.parseInt(output.trim(), 10);
    return Number.isFinite(kb) ? kb * 1024 : 0;
  } catch (_) {
    return 0;
  }
}

function runIsolated(mode, fixtureDir, runDir, useGc) {
  fs.cpSync(fixtureDir, runDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const nodeArgs = useGc ? ['--expose-gc', __filename, '--worker', mode, runDir] : [__filename, '--worker', mode, runDir];
    const child = spawn(process.execPath, nodeArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    let externalPeak = 0;
    const sampler = setInterval(() => {
      externalPeak = Math.max(externalPeak, readProcessRss(child.pid));
    }, 10);
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.on('error', error => {
      clearInterval(sampler);
      reject(error);
    });
    child.on('close', code => {
      clearInterval(sampler);
      const line = output.split(/\r?\n/).find(item => item.startsWith('RESULT '));
      if (code !== 0 || !line) {
        reject(new Error(`benchmark worker failed (${mode}, exit ${code}): ${output.slice(-1000)}`));
        return;
      }
      try {
        const result = JSON.parse(line.slice('RESULT '.length));
        result.externalPeak = Math.max(externalPeak, result.peak?.rss || 0);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function summarize(results, key) {
  const values = results.map(result => result[key] || 0);
  return { n: values.length, median: median(values), max: Math.max(...values, 0) };
}

function parseArgs(argv) {
  const args = { runs: DEFAULT_RUNS, scenarios: null, useGc: false, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runs') args.runs = Math.max(1, Number(argv[++index]));
    else if (argv[index] === '--scenarios') args.scenarios = argv[++index].split(',').filter(Boolean);
    else if (argv[index] === '--expose-gc') args.useGc = true;
    else if (argv[index] === '--output') args.output = argv[++index];
  }
  return args;
}

async function runParent(argv) {
  const args = parseArgs(argv);
  const scenarios = args.scenarios || [
    'short-10mb', 'short-200mb', 'long-20mb', 'no-usage-10mb', 'sparse-10mb', 'many-files'
  ];
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-log-memory-bench-'));
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    runs: args.runs,
    scenarios: {}
  };
  try {
    for (const scenario of scenarios) {
      const fixtureDir = path.join(rootDir, 'fixture', scenario);
      makeFixture(fixtureDir, scenario);
      const scenarioResults = { old: [], candidate: [] };
      for (let run = 0; run < args.runs; run += 1) {
        for (const mode of ['old', 'candidate']) {
          const runDir = path.join(rootDir, `run-${scenario}-${mode}-${run}`);
          scenarioResults[mode].push(await runIsolated(mode, fixtureDir, runDir, args.useGc));
          fs.rmSync(runDir, { recursive: true, force: true });
        }
      }
      report.scenarios[scenario] = {
        old: {
          durationMs: summarize(scenarioResults.old, 'durationMs'),
          peakRss: summarize(scenarioResults.old, 'externalPeak'),
          peakHeapUsed: summarize(scenarioResults.old.map(result => ({ peakHeapUsed: result.peak.heapUsed })), 'peakHeapUsed'),
          peakExternal: summarize(scenarioResults.old.map(result => ({ peakExternal: result.peak.external })), 'peakExternal')
        },
        candidate: {
          durationMs: summarize(scenarioResults.candidate, 'durationMs'),
          peakRss: summarize(scenarioResults.candidate, 'externalPeak'),
          peakHeapUsed: summarize(scenarioResults.candidate.map(result => ({ peakHeapUsed: result.peak.heapUsed })), 'peakHeapUsed'),
          peakExternal: summarize(scenarioResults.candidate.map(result => ({ peakExternal: result.peak.external })), 'peakExternal'),
          baselineDiagnostics: scenarioResults.candidate.map(result => result.baseline),
          appendDiagnostics: scenarioResults.candidate.map(result => result.append)
        }
      };
    }
    const output = JSON.stringify(report, null, 2);
    if (args.output) fs.writeFileSync(args.output, output + '\n', 'utf8');
    console.log(output);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--worker') {
  runWorker(process.argv[3], process.argv[4], process.argv.includes('--expose-gc'));
} else {
  runParent(process.argv.slice(2)).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
