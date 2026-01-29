/**
 * Terminal REST API - Web 终端接口
 */

const express = require('express');
const router = express.Router();
const os = require('os');
const path = require('path');
const fs = require('fs');

const { ptyManager } = require('../services/pty-manager');
const { getWebTerminalShellConfig } = require('../services/terminal-config');
const {
  loadTerminalCommands,
  saveTerminalCommands,
  getCommandForChannel,
  getDefaultCommands
} = require('../services/terminal-commands');

/**
 * GET /api/terminal/list - 获取所有活跃终端
 */
router.get('/list', (req, res) => {
  try {
    const terminals = ptyManager.list();
    res.json({ success: true, terminals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/terminal/health - 检查终端健康状态
 */
router.get('/health', (req, res) => {
  try {
    const isPtyAvailable = ptyManager.isPtyAvailable();
    const ptyError = ptyManager.getPtyError();

    res.json({
      success: isPtyAvailable,
      pty: {
        available: isPtyAvailable,
        error: ptyError,
        nodeVersion: process.version,
        platform: process.platform
      },
      shell: {
        default: ptyManager.getDefaultShell(),
        env: process.env.SHELL
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/terminal/commands/config - 获取命令配置
 * 注意：此路由必须在 /:id 之前定义，否则会被动态路由捕获
 */
router.get('/commands/config', (req, res) => {
  try {
    const commands = loadTerminalCommands();
    res.json({ success: true, commands });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/terminal/commands/config - 保存命令配置
 */
router.put('/commands/config', (req, res) => {
  try {
    const { commands } = req.body;
    if (!commands) {
      return res.status(400).json({ success: false, error: 'Missing commands' });
    }

    const success = saveTerminalCommands(commands);
    if (!success) {
      return res.status(500).json({ success: false, error: 'Failed to save' });
    }

    res.json({ success: true, commands: loadTerminalCommands() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/terminal/commands/reset - 重置为默认配置
 */
router.post('/commands/reset', (req, res) => {
  try {
    const defaults = getDefaultCommands();
    saveTerminalCommands(defaults);
    res.json({ success: true, commands: defaults });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/terminal/:id - 获取终端详情
 * 注意：动态路由必须放在静态路由之后
 */
router.get('/:id', (req, res) => {
  try {
    const terminal = ptyManager.get(req.params.id);
    if (!terminal) {
      return res.status(404).json({ success: false, error: 'Terminal not found' });
    }
    res.json({ success: true, terminal });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/terminal/create - 创建新终端
 */
router.post('/create', (req, res) => {
  try {
    const {
      channel = 'claude',
      sessionId = null,
      projectName = null,
      cwd = null
    } = req.body;

    // 确定工作目录
    let workDir = cwd || os.homedir();

    // 如果提供了项目名，尝试解析真实路径
    if (projectName && !cwd) {
      // 尝试从项目名解析路径
      const projectsDir = path.join(os.homedir(), '.claude', 'projects');
      const projectPath = path.join(projectsDir, projectName);

      if (fs.existsSync(projectPath)) {
        // 尝试读取会话文件获取 cwd
        if (sessionId) {
          const sessionFile = path.join(projectPath, sessionId + '.jsonl');
          if (fs.existsSync(sessionFile)) {
            try {
              const content = fs.readFileSync(sessionFile, 'utf8');
              const firstLine = content.split('\n')[0];
              if (firstLine) {
                const json = JSON.parse(firstLine);
                if (json.cwd && fs.existsSync(json.cwd)) {
                  workDir = json.cwd;
                }
              }
            } catch (e) {
              console.warn('Failed to parse session cwd:', e.message);
            }
          }
        }
      }

      // 尝试从项目名直接解析路径 (URL 编码格式)
      if (workDir === os.homedir()) {
        const decodedPath = decodeURIComponent(projectName).replace(/-/g, '/');
        if (fs.existsSync(decodedPath)) {
          workDir = decodedPath;
        }
      }
    }

    // 获取启动命令
    const startCommand = getCommandForChannel(channel, sessionId, workDir);

    const shellConfig = getWebTerminalShellConfig();

    // 创建终端
    const terminal = ptyManager.create({
      cwd: workDir,
      channel,
      sessionId,
      projectName,
      startCommand,
      ...shellConfig
    });

    res.json({
      success: true,
      terminal: {
        id: terminal.id,
        pid: terminal.pid,
        metadata: terminal.metadata
      }
    });
  } catch (err) {
    console.error('Failed to create terminal:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/terminal/:id - 销毁终端
 */
router.delete('/:id', (req, res) => {
  try {
    const success = ptyManager.destroy(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Terminal not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/terminal/:id/resize - 调整终端大小
 */
router.post('/:id/resize', (req, res) => {
  try {
    const { cols, rows } = req.body;
    const success = ptyManager.resize(req.params.id, cols, rows);
    if (!success) {
      return res.status(404).json({ success: false, error: 'Terminal not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
