/**
 * PTY Manager - 伪终端进程管理服务
 * 管理所有 Web 终端的 PTY 进程生命周期
 */

const os = require('os');
const path = require('path');

// 尝试加载 node-pty，如果失败则提示
let pty = null;
let ptyError = null;

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

class PtyManager {
  constructor() {
    // 终端进程池: terminalId -> { pty, ws, metadata }
    this.terminals = new Map();
    this.nextId = 1;

    // 清理已退出的进程
    this.cleanupInterval = setInterval(() => this.cleanupDeadTerminals(), 30000);
  }

  /**
   * 获取默认 shell
   */
  getDefaultShell() {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/zsh';
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
      throw new Error(`Cannot create terminal: ${errMsg}`);
    }

    const {
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
      history: [], // 持久历史记录（用于重连时恢复）
      historySize: 0, // 历史记录字节大小
      maxHistorySize: 100 * 1024, // 最大历史记录大小 100KB
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
      // 始终保存到历史记录（用于重连时恢复）
      terminal.history.push(data);
      terminal.historySize += data.length;

      // 如果历史记录超出限制，裁剪前面的内容
      while (terminal.historySize > terminal.maxHistorySize && terminal.history.length > 1) {
        const removed = terminal.history.shift();
        terminal.historySize -= removed.length;
      }

      if (terminal.ws && terminal.ws.readyState === 1) { // WebSocket.OPEN
        terminal.ws.send(JSON.stringify({
          type: 'terminal:output',
          terminalId,
          data
        }));
      } else {
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
  attachWebSocket(terminalId, ws) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      console.warn(`Terminal ${terminalId} not found`);
      return false;
    }

    terminal.ws = ws;

    // 发送历史记录（用于重连时恢复之前的输出）
    if (terminal.history.length > 0) {
      const historyData = terminal.history.join('');
      ws.send(JSON.stringify({
        type: 'terminal:output',
        terminalId,
        data: historyData
      }));
      console.log(`Sent ${terminal.history.length} history chunks (${terminal.historySize} bytes) to terminal ${terminalId}`);
    }

    // 清空临时缓冲区（已经包含在历史记录中了）
    terminal.buffer = [];

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

    terminal.pty.resize(newCols, newRows);
    terminal.metadata.cols = newCols;
    terminal.metadata.rows = newRows;

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
