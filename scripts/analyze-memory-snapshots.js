#!/usr/bin/env node
'use strict';

// Standalone, bounded heap-graph inspection. This intentionally does not
// calculate dominators, exclusive ownership, or V8 retained size.
const fs = require('fs');
const path = require('path');
const DEFAULT_TARGETS = ['rowState', 'snapshots', 'pendingEntries', 'recentEventIds', 'trendCache', 'dailyStatsCache', 'hotCache', 'pendingSnapshot'];

function parseArgs(args) {
  const opt = { depth: 4, maxNodes: 10000, maxEdges: 100000, maxTargets: 64, targets: DEFAULT_TARGETS, output: null };
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') return null;
    if (!arg.startsWith('--')) { files.push(path.resolve(arg)); continue; }
    const key = { '--depth': 'depth', '--max-nodes': 'maxNodes', '--max-edges': 'maxEdges', '--max-targets': 'maxTargets', '--targets': 'targets', '--output': 'output' }[arg];
    if (!key || args[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${arg}`);
    const value = args[++i];
    opt[key] = key === 'targets' ? value.split(',').filter(Boolean) : key === 'output' ? path.resolve(value) : Number(value);
  }
  if (files.length !== 2) throw new Error('Provide before.heapsnapshot and after.heapsnapshot');
  if (!Number.isInteger(opt.depth) || opt.depth < 0 || opt.depth > 12 || !Number.isInteger(opt.maxNodes) || opt.maxNodes < 1 || opt.maxNodes > 1000000 || !Number.isInteger(opt.maxEdges) || opt.maxEdges < 1 || opt.maxEdges > 10000000) throw new Error('Invalid traversal limit');
  if (!opt.targets.length || opt.targets.length > 50) throw new Error('Provide 1–50 target names');
  if (!Number.isInteger(opt.maxTargets) || opt.maxTargets < 1 || opt.maxTargets > 1024) throw new Error('max-targets must be 1–1024');
  return { ...opt, files };
}

function graph(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const meta = data.snapshot.meta;
  const nf = meta.node_fields.length, ef = meta.edge_fields.length;
  const ni = Object.fromEntries(meta.node_fields.map((name, i) => [name, i]));
  const ei = Object.fromEntries(meta.edge_fields.map((name, i) => [name, i]));
  for (const key of ['type', 'name', 'id', 'self_size', 'edge_count']) if (ni[key] === undefined) throw new Error(`Missing node field ${key}`);
  for (const key of ['type', 'name_or_index', 'to_node']) if (ei[key] === undefined) throw new Error(`Missing edge field ${key}`);
  const count = data.nodes.length / nf;
  const starts = new Uint32Array(count + 1);
  for (let i = 0; i < count; i++) starts[i + 1] = starts[i] + data.nodes[i * nf + ni.edge_count] * ef;
  const node = index => {
    const off = index * nf;
    return { id: data.nodes[off + ni.id], type: meta.node_types[ni.type][data.nodes[off + ni.type]], name: data.strings[data.nodes[off + ni.name]], selfBytes: data.nodes[off + ni.self_size] };
  };
  const edge = offset => {
    const type = meta.edge_types[ei.type][data.edges[offset + ei.type]];
    return { type, name: ['element', 'hidden'].includes(type) ? String(data.edges[offset + ei.name_or_index]) : data.strings[data.edges[offset + ei.name_or_index]], to: data.edges[offset + ei.to_node] / nf };
  };
  function* edges(index) {
    for (let off = starts[index]; off < starts[index + 1]; off += ef) yield edge(off);
  }
  return { file, node, edge, edges, count, edgeCount: data.edges.length / ef };
}

const SKIP_EDGES = new Set(['__proto__', 'prototype', 'constructor', 'map', 'shared', 'feedback_cell', 'scope_info', 'previous', 'native_context', 'code']);
const SKIP_TYPES = new Set(['code', 'synthetic', 'object shape']);
function expandable(edge, target) {
  return edge.type !== 'weak' && !SKIP_EDGES.has(edge.name) && !SKIP_TYPES.has(target.type);
}

function reach(g, start, opt) {
  const seen = new Set([start]);
  const parent = new Map();
  const queue = [{ index: start, depth: 0 }];
  let scannedEdges = 0, limited = false;
  const direct = new Set();
  for (let q = 0; q < queue.length; q++) {
    const current = queue[q];
    if (current.depth >= opt.depth) continue;
    for (const edge of g.edges(current.index)) {
      if (scannedEdges >= opt.maxEdges) { limited = true; break; }
      scannedEdges++;
      const target = g.node(edge.to);
      if (!expandable(edge, target)) continue;
      if (current.depth === 0) direct.add(edge.to);
      if (seen.has(edge.to)) continue;
      if (seen.size >= opt.maxNodes) { limited = true; continue; }
      seen.add(edge.to);
      parent.set(edge.to, { from: current.index, edge: { type: edge.type, name: edge.name } });
      queue.push({ index: edge.to, depth: current.depth + 1 });
    }
    if (scannedEdges >= opt.maxEdges) { limited = true; break; }
  }
  const chain = index => {
    const steps = [];
    let next = index;
    while (parent.has(next)) {
      const previous = parent.get(next);
      steps.unshift({ from: g.node(previous.from), edge: previous.edge, to: g.node(next) });
      next = previous.from;
    }
    return steps;
  };
  const types = {};
  let selfBytes = 0;
  for (const index of seen) {
    const n = g.node(index);
    selfBytes += n.selfBytes;
    const key = `${n.type}:${n.name || '(unnamed)'}`;
    types[key] ||= { nodes: 0, selfBytes: 0 };
    types[key].nodes++;
    types[key].selfBytes += n.selfBytes;
  }
  const examples = [...seen].sort((a, b) => g.node(b).selfBytes - g.node(a).selfBytes).slice(0, 12).map(index => ({ node: g.node(index), chain: chain(index) }));
  return { indices: seen, report: { reachableNodesIncludingTarget: seen.size, reachableSelfBytes: selfBytes, directNodes: direct.size, directSelfBytes: [...direct].reduce((sum, i) => sum + g.node(i).selfBytes, 0), scannedEdges, traversalLimited: limited, types, examples } };
}

function inspect(file, opt) {
  const g = graph(file);
  const wanted = new Set(opt.targets), groups = {}, ownerContexts = new Set();
  for (const name of opt.targets) groups[name] = { observedMatches: 0, matchingLimited: false, matches: [], targets: new Map() };
  for (let index = 0; index < g.count; index++) {
    for (const edge of g.edges(index)) {
      if (!['context', 'property'].includes(edge.type) || !wanted.has(edge.name)) continue;
      const group = groups[edge.name];
      group.observedMatches++;
      if (!group.targets.has(edge.to) && group.targets.size >= opt.maxTargets) { group.matchingLimited = true; continue; }
      const match = { owner: g.node(index), edge: { type: edge.type, name: edge.name }, target: g.node(edge.to) };
      if (group.matches.length < opt.maxTargets * 2) group.matches.push(match);
      else group.matchingLimited = true;
      group.targets.set(edge.to, null);
      if (match.owner.name === 'system / Context') ownerContexts.add(index);
    }
  }
  const closureOwners = new Map([...ownerContexts].map(i => [g.node(i).id, []]));
  for (let index = 0; index < g.count; index++) {
    if (g.node(index).type !== 'closure') continue;
    for (const edge of g.edges(index)) {
      if (!ownerContexts.has(edge.to)) continue;
      const list = closureOwners.get(g.node(edge.to).id);
      if (list.length < 12) list.push({ closure: g.node(index), edge: { type: edge.type, name: edge.name }, context: g.node(edge.to) });
    }
  }
  const result = {};
  for (const [name, group] of Object.entries(groups)) {
    const union = new Set();
    const targets = [];
    for (const index of group.targets.keys()) {
      const reached = reach(g, index, opt);
      for (const item of reached.indices) union.add(item);
      targets.push({ target: g.node(index), ...reached.report });
    }
    const matches = group.matches.map(match => ({ ...match, contextClosureOwners: closureOwners.get(match.owner.id) || [] }));
    result[name] = {
      matchCount: group.observedMatches, matchingLimited: group.matchingLimited, distinctTargetCount: targets.length,
      uniqueReachableNodes: union.size, uniqueReachableSelfBytes: [...union].reduce((sum, i) => sum + g.node(i).selfBytes, 0),
      traversalLimited: group.matchingLimited || targets.some(t => t.traversalLimited), matches, targets
    };
  }
  return { file, nodeCount: g.count, edgeCount: g.edgeCount, holders: result };
}

function markdown(report) {
  const rows = report.comparison.map(item => `| ${item.name} | ${item.beforeTargets} → ${item.afterTargets} | ${item.reachableNodeDelta} | ${item.reachableSelfBytesDelta} | ${item.traversalLimited ? '触发上限' : '未触发'} |`);
  const chains = report.after.holders;
  const details = Object.entries(chains).flatMap(([name, group]) => group.matches.slice(0, 4).map(match => {
    const closures = match.contextClosureOwners.map(c => `${c.closure.name || '(anonymous)'} @${c.closure.id}`).join(', ') || '未找到限定的闭包入口';
    return `- ${name}: ${match.owner.type} ${match.owner.name} @${match.owner.id} —${match.edge.type}:${match.edge.name}→ ${match.target.type} ${match.target.name} @${match.target.id}; context 入口：${closures}`;
  }));
  return `# 隔离堆快照持有关系比较\n\n${report.caveat}\n\n深度 ${report.limits.depth}；每个目标最多 ${report.limits.maxNodes} 个节点、${report.limits.maxEdges} 条扫描边。节点 ID 可在 DevTools 中以 @ID 查验。JSON 保留直接持有边、闭包入口及有限遍历示例链。\n\n| 持有字段 | 不同目标数（前→后） | 可达节点变化 | 可达 self bytes 变化 | 遍历上限 |\n| --- | ---: | ---: | ---: | --- |\n${rows.join('\n')}\n\n## 后快照的直接持有边\n\n${details.length ? details.join('\n') : '未匹配到指定字段；不能据此断言无泄漏。'}\n\n前快照：${report.before.file}\n\n后快照：${report.after.file}\n`;
}

try {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt) {
    console.log('Usage: node scripts/analyze-memory-snapshots.js BEFORE AFTER --output DIRECTORY\n  --depth 4 --max-nodes 10000 --max-edges 100000 --max-targets 64\n  --targets rowState,snapshots,pendingEntries,recentEventIds,trendCache\nStandalone only; reachable self bytes are not dominator retained size.');
  } else {
    const before = inspect(opt.files[0], opt);
    const after = inspect(opt.files[1], opt);
    const comparison = opt.targets.map(name => ({
      name, beforeTargets: before.holders[name].distinctTargetCount, afterTargets: after.holders[name].distinctTargetCount,
      reachableNodeDelta: after.holders[name].uniqueReachableNodes - before.holders[name].uniqueReachableNodes,
      reachableSelfBytesDelta: after.holders[name].uniqueReachableSelfBytes - before.holders[name].uniqueReachableSelfBytes,
      traversalLimited: before.holders[name].traversalLimited || after.holders[name].traversalLimited
    }));
    const report = {
      version: 1, generatedAt: new Date().toISOString(), limits: { depth: opt.depth, maxNodes: opt.maxNodes, maxEdges: opt.maxEdges, maxTargets: opt.maxTargets },
      caveat: 'This is bounded outgoing graph reachability and summed self bytes, NOT dominator retained size or exclusive ownership. Shared nodes can appear under different holders. Depth truncation always applies, even when traversalLimited is false. Prototype, weak, code/shape and outer-context edges are excluded. Missing holders do not prove absence of leaks; V8 context names may differ by version.',
      before, after, comparison
    };
    if (opt.output) {
      fs.mkdirSync(opt.output, { recursive: true });
      fs.writeFileSync(path.join(opt.output, 'heap-holders.json'), JSON.stringify(report, null, 2));
      fs.writeFileSync(path.join(opt.output, 'heap-holders.md'), markdown(report));
    }
    console.log(JSON.stringify({ output: opt.output, comparison }, null, 2));
  }
} catch (error) { console.error(error.stack); process.exitCode = 1; }
