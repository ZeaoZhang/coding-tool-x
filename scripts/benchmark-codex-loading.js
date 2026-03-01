#!/usr/bin/env node

const { performance } = require('perf_hooks');
const codexSessions = require('../src/server/services/codex-sessions');

function measure(fn) {
  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    n: sorted.length,
    min: sorted[0] || 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] || 0,
    avg: sorted.length ? sum / sorted.length : 0
  };
}

function printSummary(label, stats) {
  console.log(`${label}`);
  console.log(`  n=${stats.n} min=${stats.min.toFixed(2)}ms p50=${stats.p50.toFixed(2)}ms p95=${stats.p95.toFixed(2)}ms avg=${stats.avg.toFixed(2)}ms max=${stats.max.toFixed(2)}ms`);
}

function runHotBenchmark(label, fn, iterations = 30) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const { durationMs } = measure(fn);
    samples.push(durationMs);
  }
  printSummary(label, summarize(samples));
}

function main() {
  const now = new Date().toISOString();
  console.log(`Codex Loading Benchmark @ ${now}`);

  const coldProjects = measure(() => codexSessions.getProjects());
  const projects = coldProjects.result || [];
  console.log(`Projects: ${projects.length}`);
  console.log(`Cold getProjects: ${coldProjects.durationMs.toFixed(2)}ms`);
  runHotBenchmark('Hot getProjects', () => codexSessions.getProjects());

  const sampleProject = projects[0] ? projects[0].name : null;
  if (!sampleProject) {
    console.log('No Codex projects found. Skip sessions benchmark.');
    return;
  }

  console.log(`Sample project: ${sampleProject}`);
  const coldSessions = measure(() => codexSessions.getSessionsByProject(sampleProject));
  const sessions = coldSessions.result || [];
  console.log(`Sessions in sample project: ${sessions.length}`);
  console.log(`Cold getSessionsByProject: ${coldSessions.durationMs.toFixed(2)}ms`);
  runHotBenchmark('Hot getSessionsByProject', () => codexSessions.getSessionsByProject(sampleProject));

  const sampleSessionId = sessions[0] ? sessions[0].sessionId : null;
  if (!sampleSessionId) {
    console.log('No session found in sample project. Skip message benchmark.');
    return;
  }

  console.log(`Sample session: ${sampleSessionId}`);
  const coldSessionDetail = measure(() => codexSessions.getSessionById(sampleSessionId));
  const messageCount = coldSessionDetail.result && Array.isArray(coldSessionDetail.result.messages)
    ? coldSessionDetail.result.messages.length
    : 0;
  console.log(`Session messages: ${messageCount}`);
  console.log(`Cold getSessionById: ${coldSessionDetail.durationMs.toFixed(2)}ms`);
  runHotBenchmark('Hot getSessionById', () => codexSessions.getSessionById(sampleSessionId));
}

main();
