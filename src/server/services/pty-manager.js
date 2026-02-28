/**
 * PTY Manager - 伪终端进程管理服务
 * 管理所有 Web 终端的 PTY 进程生命周期
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// 尝试加载 node-pty，如果失败则提示
let pty = null;
let ptyError = null;
let HeadlessTerminal = null;
let headlessError = null;

try {
  // 优先使用 @lydell/node-pty (支持更新的 Node.js 版本)
  pty = require('@lydell/node-pty');
} catch (err) {
  try {
    // 回退到 node-pty
    pty = require('node-pty');
  } catch (err2) {
    ptyError = err2.message;
    console.error('Warning: node-pty failed to load:', err2.message);
  }
}

try {
  const headless = require('@xterm/headless');
  HeadlessTerminal = headless.Terminal || headless.default?.Terminal || headless.default || null;
} catch (err) {
  headlessError = err.message;
  console.warn('Warning: @xterm/headless failed to load:', err.message);
}

class PtyManager {
  constructor() {
    // 终端进程池: terminalId -> { pty, ws, metadata }
    this.terminals = new Map();
    this.nextId = 1;

    // 清理已退出的进程
    this.cleanupInterval = setInterval(() => this.cleanupDeadTerminals(), 30000);
    // 避免在未启用 Web 终端时阻止进程退出
    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  isDirectoryPath(candidate) {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
    } catch (err) {
      return false;
    }
  }

  resolveWorkingDirectory(cwd) {
    const fallback = os.homedir();
    if (typeof cwd !== 'string') {
      return fallback;
    }

    const trimmed = cwd.trim();
    if (!trimmed) {
      return fallback;
    }

    let normalized = trimmed;

    // 展开 ~
    if (normalized === '~') {
      normalized = os.homedir();
    } else if (normalized.startsWith('~/') || normalized.startsWith('~\\')) {
      normalized = path.join(os.homedir(), normalized.slice(2));
    }

    // 先尝试直接使用（支持相对路径）
    if (this.isDirectoryPath(normalized)) {
      return path.isAbsolute(normalized) ? normalized : path.resolve(process.cwd(), normalized);
    }

    // 相对路径：优先按进程 cwd 解析，其次按用户 home 解析（用于 .codex 这类隐藏目录）
    if (!path.isAbsolute(normalized)) {
      const candidates = [
        path.resolve(process.cwd(), normalized),
        path.resolve(process.cwd(), '..', normalized),
        path.resolve(process.cwd(), '..', '..', normalized),
        path.resolve(os.homedir(), normalized)
      ];

      for (const candidate of candidates) {
        if (this.isDirectoryPath(candidate)) {
          return candidate;
        }
      }
    }

    return normalized;
  }

  createScreen(cols, rows) {
    if (!HeadlessTerminal) {
      return null;
    }
    try {
      return new HeadlessTerminal({
        cols: Math.max(cols, 80),
        rows: Math.max(rows, 24),
        scrollback: 10000,
        convertEol: true
      });
    } catch (err) {
      console.warn('Failed to create headless terminal:', err.message);
      return null;
    }
  }

  buildScreenSnapshot(terminal) {
    if (!terminal?.screen || !terminal.screen.buffer?.active) {
      return { data: '' };
    }
    const screen = terminal.screen;
    const buffer = screen.buffer.active;
    const end = buffer.length;
    const cols = screen.cols || terminal.metadata?.cols || 80;
    const rows = screen.rows || terminal.metadata?.rows || 24;
    const cursorLineIndex = Math.max(0, (buffer.baseY || 0) + (buffer.cursorY || 0));
    const cursorCol = Math.max(0, buffer.cursorX || 0);
    const lastLineIndex = end > 0 ? end - 1 : -1;
    let output = '';
    let hasOutput = false;
    for (let i = 0; i <= lastLineIndex; i++) {
      const line = buffer.getLine(i);
      if (!line) {
        if (hasOutput) {
          output += '\r\n';
        } else {
          output = '';
          hasOutput = true;
        }
        continue;
      }
      let text = '';
      try {
        text = line.translateToString(true);
      } catch (err) {
        try {
          text = line.translateToString(false);
        } catch (err2) {
          text = '';
        }
      }
      const isWrapped = Boolean(line.isWrapped);
      if (!hasOutput) {
        output = text;
        hasOutput = true;
      } else if (isWrapped) {
        output += text;
      } else {
        output += '\r\n' + text;
      }
    }
    const data = hasOutput ? output : '';
    const topIndex = Math.max(0, lastLineIndex - rows + 1);
    let cursorRow = cursorLineIndex - topIndex + 1;
    if (!Number.isFinite(cursorRow)) {
      cursorRow = rows;
    }
    cursorRow = Math.min(Math.max(cursorRow, 1), rows);
    const cursorColSafe = Math.min(Math.max(cursorCol + 1, 1), cols);
    return {
      data,
      cursorRow,
      cursorCol: cursorColSafe,
      rows,
      cols
    };
  }

  /**
   * 获取默认 shell
   */
  getDefaultShell() {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }

    // 优先使用环境变量指定的 shell
    if (process.env.SHELL && fs.existsSync(process.env.SHELL)) {
      return process.env.SHELL;
    }

    // 回退到常见的 shell,按优先级检查
    const commonShells = ['/bin/bash', '/bin/sh', '/usr/bin/bash', '/usr/bin/sh'];
    for (const shell of commonShells) {
      if (fs.existsSync(shell)) {
        return shell;
      }
    }

    // 最后回退
    return '/bin/sh';
  }

  /**
   * 检查 PTY 是否可用
   */
  isPtyAvailable() {
    return pty !== null;
  }

  /**
   * 获取 PTY 不可用的原因
   */
  getPtyError() {
    if (ptyError) {
      return ptyError;
    }
    if (!pty) {
      return 'node-pty not loaded';
    }
    // 检查 Node.js 版本兼容性
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    if (majorVersion >= 23) {
      return `Node.js ${nodeVersion} may not be compatible with node-pty. Please use Node.js v20 or v22 LTS.`;
    }
    return null;
  }

  /**
   * 创建新终端
   * @param {Object} options - 终端配置
   * @returns {Object} 终端信息
   */
  create(options = {}) {
    // 检查 PTY 是否可用
    if (!pty) {
      const errMsg = this.getPtyError() || 'node-pty is not available';
      console.error('[PTY] Cannot create terminal:', errMsg);
      console.error('[PTY] Node version:', process.version);
      console.error('[PTY] Platform:', process.platform);
      throw new Error(`Cannot create terminal: ${errMsg}`);
    }

    let {
      cwd = os.homedir(),
      cols = 120,
      rows = 30,
      shell = this.getDefaultShell(),
      args = [],
      env = {},
      channel = 'claude',
      sessionId = null,
      projectName = null,
      startCommand = null
    } = options;

    // 验证 shell 和 cwd 存在
    if (!fs.existsSync(shell)) {
      const error = `Shell not found: ${shell}`;
      console.error('[PTY]', error);
      throw new Error(error);
    }

    const originalCwd = cwd;
    cwd = this.resolveWorkingDirectory(cwd);
    if (originalCwd !== cwd) {
      console.log(`[PTY] Resolved cwd: ${originalCwd} -> ${cwd}`);
    }

    if (!this.isDirectoryPath(cwd)) {
      const fallbackCandidates = [process.cwd(), os.homedir()];
      const fallbackCwd = fallbackCandidates.find((candidate) => this.isDirectoryPath(candidate));

      if (fallbackCwd) {
        console.warn(`[PTY] Working directory not found: ${cwd}, fallback to ${fallbackCwd}`);
        cwd = fallbackCwd;
      } else {
        const error = `Working directory not found: ${cwd}`;
        console.error('[PTY]', error);
        throw new Error(error);
      }
    }

    console.log(`[PTY] Creating terminal: shell=${shell}, cwd=${cwd}`);


    const terminalId = `term_${this.nextId++}_${Date.now()}`;

    // 合并环境变量
    const termEnv = {
      ...process.env,
      ...env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8'
    };

    // 创建 PTY 进程
    let ptyProcess;
    try {
      ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: Math.max(cols, 80),
        rows: Math.max(rows, 24),
        cwd: cwd,
        env: termEnv
      });
    } catch (err) {
      // 提供更有用的错误信息
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
      if (majorVersion >= 23) {
        throw new Error(`PTY creation failed. Node.js ${nodeVersion} is not compatible with node-pty. Please use Node.js v20 or v22 LTS.`);
      }
      throw err;
    }

    const terminal = {
      id: terminalId,
      pty: ptyProcess,
      ws: null,
      buffer: [], // 缓存未发送的输出（用于 WebSocket 断开期间）
      history: [], // 断线期间的输出缓冲（仅用于补发）
      historySize: 0, // 历史记录字节大小
      maxHistorySize: 100 * 1024, // 最大历史记录大小 100KB
      screen: this.createScreen(cols, rows),
      pendingOutput: [],
      snapshotInProgress: false,
      outputSeq: 0,
      snapshotSeq: 0,
      metadata: {
        cwd,
        shell,
        cols,
        rows,
        channel,
        sessionId,
        projectName,
        startCommand,
        createdAt: Date.now(),
        pid: ptyProcess.pid
      }
    };

    // 监听 PTY 输出
    ptyProcess.onData((data) => {
      terminal.outputSeq += 1;
      const outputEntry = { seq: terminal.outputSeq, data };
      if (terminal.screen) {
        terminal.screen.write(data);
      }

      if (terminal.ws && terminal.ws.readyState === 1) { // WebSocket.OPEN
        if (terminal.snapshotInProgress) {
          terminal.pendingOutput.push(outputEntry);
        } else {
          terminal.ws.send(JSON.stringify({
            type: 'terminal:output',
            terminalId,
            data
          }));
        }
        return;
      }

      if (!terminal.screen) {
        // 仅在断开期间缓存输出，避免重连时重复回放
        terminal.history.push(data);
        terminal.historySize += data.length;

        // 如果历史记录超出限制，裁剪前面的内容
        while (terminal.historySize > terminal.maxHistorySize && terminal.history.length > 1) {
          const removed = terminal.history.shift();
          terminal.historySize -= removed.length;
        }

        // 缓存输出，等待 WebSocket 连接
        terminal.buffer.push(data);
        // 限制缓存大小
        if (terminal.buffer.length > 1000) {
          terminal.buffer = terminal.buffer.slice(-500);
        }
      }
    });

    // 监听 PTY 退出
    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`Terminal ${terminalId} exited with code ${exitCode}, signal ${signal}`);

      if (terminal.ws && terminal.ws.readyState === 1) {
        terminal.ws.send(JSON.stringify({
          type: 'terminal:exited',
          terminalId,
          exitCode,
          signal
        }));
      }

      // 标记为已退出，稍后清理
      terminal.exited = true;
      terminal.exitCode = exitCode;
      terminal.exitedAt = Date.now();
    });

    this.terminals.set(terminalId, terminal);

    console.log(`Created terminal ${terminalId} (pid: ${ptyProcess.pid}) in ${cwd}`);

    // 如果有启动命令，延迟执行
    if (startCommand) {
      setTimeout(() => {
        if (!terminal.exited) {
          ptyProcess.write(startCommand + '\r');
        }
      }, 500);
    }

    return {
      id: terminalId,
      pid: ptyProcess.pid,
      metadata: terminal.metadata
    };
  }

  /**
   * 绑定 WebSocket 到终端
   * @param {string} terminalId - 终端 ID
   * @param {WebSocket} ws - WebSocket 连接
   * @returns {boolean} 是否成功
   */
  attachWebSocket(terminalId, ws, options = {}) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      console.warn(`Terminal ${terminalId} not found`);
      return false;
    }

    terminal.ws = ws;
    terminal.snapshotInProgress = false;
    terminal.pendingOutput = [];
    terminal.snapshotSeq = 0;

    const { includeHistory = true, trimLastLine = false } = options;

    const trimHistoryLastLine = (data) => {
      if (!data) return '';
      if (data.endsWith('\r\n')) {
        return data.slice(0, -2);
      }
      if (data.endsWith('\n')) {
        return data.slice(0, -1);
      }
      return data;
    };

    if (terminal.screen && includeHistory) {
      terminal.snapshotInProgress = true;
      terminal.pendingOutput = [];
      terminal.snapshotSeq = terminal.outputSeq;
      terminal.buffer = [];
      terminal.history = [];
      terminal.historySize = 0;

      const sendSnapshot = () => {
        try {
          const snapshot = this.buildScreenSnapshot(terminal);
          if (snapshot?.data && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'terminal:output',
              terminalId,
              data: snapshot.data
            }));
          }
          if (snapshot?.cursorRow && snapshot?.cursorCol && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'terminal:output',
              terminalId,
              data: `\x1b[${snapshot.cursorRow};${snapshot.cursorCol}H`
            }));
          }
          const pendingTail = terminal.pendingOutput
            .filter(item => item && item.seq > terminal.snapshotSeq)
            .map(item => item.data);
          if (pendingTail.length > 0 && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'terminal:output',
              terminalId,
              data: pendingTail.join('')
            }));
          }
        } catch (err) {
          console.warn(`Failed to send terminal snapshot ${terminalId}:`, err.message);
        } finally {
          terminal.pendingOutput = [];
          terminal.snapshotInProgress = false;
          terminal.snapshotSeq = 0;
        }
      };

      if (typeof terminal.screen.write === 'function') {
        terminal.screen.write('', sendSnapshot);
      } else {
        sendSnapshot();
      }
    } else {
      // 发送历史记录（用于重连时恢复之前的输出）
      let sentHistory = false;
      if (includeHistory) {
        if (terminal.history.length > 0) {
          let historyData = terminal.history.join('');
          if (trimLastLine) {
            historyData = trimHistoryLastLine(historyData);
          }
          if (historyData) {
            ws.send(JSON.stringify({
              type: 'terminal:output',
              terminalId,
              data: historyData
            }));
            console.log(`Sent ${terminal.history.length} history chunks (${terminal.historySize} bytes) to terminal ${terminalId}`);
            sentHistory = true;
          }
        } else if (terminal.buffer.length > 0) {
          let bufferData = terminal.buffer.join('');
          if (trimLastLine) {
            bufferData = trimHistoryLastLine(bufferData);
          }
          if (bufferData) {
            ws.send(JSON.stringify({
              type: 'terminal:output',
              terminalId,
              data: bufferData
            }));
            console.log(`Sent ${terminal.buffer.length} buffered chunks to terminal ${terminalId}`);
            sentHistory = true;
          }
        }
      }

      // 清空临时缓冲区（已经包含在历史记录中了）
      terminal.buffer = [];
      if (sentHistory) {
        terminal.history = [];
        terminal.historySize = 0;
      }
    }

    // 如果终端已退出，通知客户端
    if (terminal.exited) {
      ws.send(JSON.stringify({
        type: 'terminal:exited',
        terminalId,
        exitCode: terminal.exitCode
      }));
    }

    console.log(`WebSocket attached to terminal ${terminalId}`);
    return true;
  }

  /**
   * 解绑 WebSocket
   * @param {string} terminalId - 终端 ID
   */
  detachWebSocket(terminalId) {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      terminal.ws = null;
      terminal.snapshotInProgress = false;
      terminal.pendingOutput = [];
      terminal.snapshotSeq = 0;
    }
  }

  /**
   * 向终端写入数据
   * @param {string} terminalId - 终端 ID
   * @param {string} data - 输入数据
   * @returns {boolean} 是否成功
   */
  write(terminalId, data) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.exited) {
      return false;
    }

    terminal.pty.write(data);
    return true;
  }

  /**
   * 调整终端大小
   * @param {string} terminalId - 终端 ID
   * @param {number} cols - 列数
   * @param {number} rows - 行数
   * @returns {boolean} 是否成功
   */
  resize(terminalId, cols, rows) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.exited) {
      return false;
    }

    const newCols = Math.max(cols, 80);
    const newRows = Math.max(rows, 24);
    if (terminal.metadata.cols === newCols && terminal.metadata.rows === newRows) {
      return true;
    }

    terminal.pty.resize(newCols, newRows);
    terminal.metadata.cols = newCols;
    terminal.metadata.rows = newRows;
    if (terminal.screen && typeof terminal.screen.resize === 'function') {
      terminal.screen.resize(newCols, newRows);
    }

    return true;
  }

  /**
   * 销毁终端
   * @param {string} terminalId - 终端 ID
   * @returns {boolean} 是否成功
   */
  destroy(terminalId) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return false;
    }

    // 关闭 WebSocket
    if (terminal.ws) {
      terminal.ws.send(JSON.stringify({
        type: 'terminal:exited',
        terminalId,
        exitCode: -1,
        reason: 'destroyed'
      }));
    }

    // 杀死 PTY 进程
    if (!terminal.exited) {
      try {
        terminal.pty.kill();
      } catch (e) {
        console.warn(`Failed to kill terminal ${terminalId}:`, e.message);
      }
    }

    if (terminal.screen && typeof terminal.screen.dispose === 'function') {
      terminal.screen.dispose();
    }

    this.terminals.delete(terminalId);
    console.log(`Destroyed terminal ${terminalId}`);

    return true;
  }

  /**
   * 获取终端信息
   * @param {string} terminalId - 终端 ID
   * @returns {Object|null} 终端信息
   */
  get(terminalId) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return null;
    }

    return {
      id: terminal.id,
      pid: terminal.metadata.pid,
      metadata: terminal.metadata,
      connected: terminal.ws && terminal.ws.readyState === 1,
      exited: terminal.exited || false
    };
  }

  /**
   * 列出所有终端
   * @returns {Array} 终端列表
   */
  list() {
    const result = [];
    for (const [id, terminal] of this.terminals) {
      result.push({
        id,
        pid: terminal.metadata.pid,
        metadata: terminal.metadata,
        connected: terminal.ws && terminal.ws.readyState === 1,
        exited: terminal.exited || false
      });
    }
    return result;
  }

  /**
   * 清理已退出的终端
   */
  cleanupDeadTerminals() {
    const now = Date.now();
    for (const [id, terminal] of this.terminals) {
      // 清理已退出超过 5 分钟且无 WebSocket 连接的终端
      if (terminal.exited && !terminal.ws) {
        const exitedTime = terminal.exitedAt || now;
        if (now - exitedTime > 5 * 60 * 1000) {
          if (terminal.screen && typeof terminal.screen.dispose === 'function') {
            terminal.screen.dispose();
          }
          this.terminals.delete(id);
          console.log(`Cleaned up dead terminal ${id}`);
        }
      }
    }
  }

  /**
   * 销毁所有终端
   */
  destroyAll() {
    for (const [id] of this.terminals) {
      this.destroy(id);
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// 单例
const ptyManager = new PtyManager();

// 进程退出时清理
process.on('exit', () => {
  ptyManager.destroyAll();
});

process.on('SIGINT', () => {
  ptyManager.destroyAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  ptyManager.destroyAll();
  process.exit(0);
});

module.exports = {
  ptyManager,
  PtyManager
};
