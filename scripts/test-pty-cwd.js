#!/usr/bin/env node

/**
 * 回归用例：PTY 工作目录解析
 * - 复现：传入相对路径 .codex（进程 cwd 下不存在，但用户 home 下存在）时，应该自动解析到 home/.codex
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { PtyManager } = require('../src/server/services/pty-manager');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // ignore
  }
}

function main() {
  const originalCwd = process.cwd();
  const originalHomedir = os.homedir;

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-pty-cwd-'));
  const tmpHome = path.join(tmpRoot, 'home');
  const tmpWork = path.join(tmpRoot, 'work');

  try {
    ensureDir(tmpHome);
    ensureDir(tmpWork);

    // 构造 home/.codex 目录，但 work/.codex 不存在
    const codexDir = path.join(tmpHome, '.codex');
    ensureDir(codexDir);

    // 进入 work 目录，确保 .codex 相对路径在这里不存在
    process.chdir(tmpWork);

    // stub: 让 resolveWorkingDirectory 看到一个可控的 home
    os.homedir = () => tmpHome;

    const mgr = new PtyManager();

    const resolvedCodex = mgr.resolveWorkingDirectory('.codex');
    assert.strictEqual(
      fs.realpathSync(resolvedCodex),
      fs.realpathSync(codexDir),
      '应把 .codex 解析到 home/.codex'
    );

    const resolvedDot = mgr.resolveWorkingDirectory('.');
    assert.strictEqual(
      fs.realpathSync(resolvedDot),
      fs.realpathSync(tmpWork),
      '应把 . 解析到当前工作目录的绝对路径'
    );

    const resolvedTilde = mgr.resolveWorkingDirectory('~/subdir');
    assert.strictEqual(resolvedTilde, path.join(tmpHome, 'subdir'), '应展开 ~/ 为 home 路径');

    console.log('OK: pty cwd resolution');
  } finally {
    try {
      os.homedir = originalHomedir;
    } catch (err) {
      // ignore
    }
    try {
      process.chdir(originalCwd);
    } catch (err) {
      // ignore
    }
    cleanupDir(tmpRoot);
  }
}

main();
