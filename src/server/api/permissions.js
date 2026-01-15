/**
 * Command Permissions API 路由
 *
 * 管理 Claude Code / Codex / Gemini CLI 命令执行权限
 *
 * 三个 CLI 工具的权限控制机制：
 *
 * 1. Claude Code:
 *    - 配置文件: ~/.claude/settings.json (用户级) 或 .claude/settings.json (项目级)
 *    - 权限格式: permissions.allow / permissions.deny 数组
 *    - 支持通配符: Bash(npm run *), Read(./src/**)
 *
 * 2. Codex CLI:
 *    - 启动参数: --ask-for-approval never/on-request/on-failure
 *    - 沙箱模式: --sandbox read-only/workspace-write/danger-full-access
 *    - YOLO 模式: --yolo 或 --dangerously-bypass-approvals-and-sandbox
 *
 * 3. Gemini CLI:
 *    - 启动参数: --approval-mode default/auto_edit/yolo
 *    - 允许工具: --allowed-tools "ShellTool(git status)"
 *    - 沙箱: --sandbox / -s
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const router = express.Router();

// Claude Code 设置文件路径
function getClaudeSettingsPath(projectPath, isLocal = false) {
  if (projectPath) {
    return path.join(projectPath, '.claude', isLocal ? 'settings.local.json' : 'settings.json');
  }
  return path.join(os.homedir(), '.claude', 'settings.json');
}

// 读取 Claude Code settings.json
function readClaudeSettings(projectPath, isLocal = false) {
  const settingsPath = getClaudeSettingsPath(projectPath, isLocal);
  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('[Permissions API] Error reading Claude settings:', err);
  }
  return {};
}

// 保存 Claude Code settings.json
function saveClaudeSettings(projectPath, settings, isLocal = false) {
  const settingsPath = getClaudeSettingsPath(projectPath, isLocal);
  const settingsDir = path.dirname(settingsPath);

  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

// 全局 all-allow 状态（内存中）
let globalAllAllowEnabled = process.env.CLAUDE_ALL_ALLOW === 'true';

/**
 * 获取项目的命令执行权限设置
 * GET /api/permissions
 * Query: projectPath - 项目路径, cliType - CLI 类型 (claude/codex/gemini)
 */
router.get('/', (req, res) => {
  try {
    const { projectPath, cliType = 'claude' } = req.query;

    if (!projectPath) {
      return res.status(400).json({
        success: false,
        message: '缺少 projectPath 参数'
      });
    }

    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({
        success: false,
        message: '项目路径不存在'
      });
    }

    // 读取 Claude Code 配置（所有 CLI 工具共用此配置管理）
    const settings = readClaudeSettings(projectPath);
    const permissions = settings.permissions || {};

    res.json({
      success: true,
      cliType,
      settings: {
        // Claude Code 格式
        allow: permissions.allow || [],
        deny: permissions.deny || [],
        // 兼容旧格式
        allowedCommands: permissions.allow || [],
        denyCommands: permissions.deny || []
      }
    });
  } catch (err) {
    console.error('[Permissions API] Get permissions error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 保存项目的命令执行权限设置
 * POST /api/permissions
 * Body: { projectPath, settings: { allow, deny }, isLocal }
 */
router.post('/', (req, res) => {
  try {
    const { projectPath, settings: newPermissions, isLocal = false } = req.body;

    if (!projectPath) {
      return res.status(400).json({
        success: false,
        message: '缺少 projectPath 参数'
      });
    }

    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({
        success: false,
        message: '项目路径不存在'
      });
    }

    // 读取现有设置
    const settings = readClaudeSettings(projectPath, isLocal);

    // 更新权限设置（使用 Claude Code 的标准格式）
    settings.permissions = {
      allow: newPermissions?.allow || newPermissions?.allowedCommands || [],
      deny: newPermissions?.deny || newPermissions?.denyCommands || []
    };

    // 保存设置
    saveClaudeSettings(projectPath, settings, isLocal);

    res.json({
      success: true,
      message: '权限设置已保存',
      savedTo: isLocal ? '.claude/settings.local.json' : '.claude/settings.json'
    });
  } catch (err) {
    console.error('[Permissions API] Save permissions error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取全局 all-allow 模式状态
 * GET /api/permissions/all-allow
 */
router.get('/all-allow', (req, res) => {
  try {
    res.json({
      success: true,
      enabled: globalAllAllowEnabled,
      note: '此设置通过启动命令参数控制，如 claude --dangerously-skip-permissions'
    });
  } catch (err) {
    console.error('[Permissions API] Get all-allow status error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 设置全局 all-allow 模式（运行时）
 * POST /api/permissions/all-allow
 * Body: { enabled }
 */
router.post('/all-allow', (req, res) => {
  try {
    const { enabled } = req.body;
    globalAllAllowEnabled = !!enabled;

    res.json({
      success: true,
      enabled: globalAllAllowEnabled,
      message: enabled ? 'All-Allow 模式已启用' : 'All-Allow 模式已禁用'
    });
  } catch (err) {
    console.error('[Permissions API] Set all-allow status error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取权限模版
 * GET /api/permissions/templates
 */
router.get('/templates', (req, res) => {
  try {
    const templates = {
      safe: {
        name: '安全模式',
        description: '仅允许只读命令，危险操作需要确认',
        allow: [
          'Bash(cat:*)',
          'Bash(ls:*)',
          'Bash(pwd)',
          'Bash(echo:*)',
          'Bash(head:*)',
          'Bash(tail:*)',
          'Bash(grep:*)',
          'Read(*)'
        ],
        deny: [
          'Bash(rm:*)',
          'Bash(sudo:*)',
          'Bash(git push:*)',
          'Bash(git reset --hard:*)',
          'Bash(chmod:*)',
          'Bash(chown:*)',
          'Edit(*)'
        ]
      },
      balanced: {
        name: '平衡模式',
        description: '允许常用开发命令，危险操作需要确认',
        allow: [
          'Bash(cat:*)',
          'Bash(ls:*)',
          'Bash(pwd)',
          'Bash(echo:*)',
          'Bash(head:*)',
          'Bash(tail:*)',
          'Bash(grep:*)',
          'Bash(find:*)',
          'Bash(git status)',
          'Bash(git diff:*)',
          'Bash(git log:*)',
          'Bash(npm run:*)',
          'Bash(pnpm:*)',
          'Bash(yarn:*)',
          'Read(*)',
          'Edit(*)'
        ],
        deny: [
          'Bash(rm -rf:*)',
          'Bash(sudo:*)',
          'Bash(git push --force:*)',
          'Bash(git reset --hard:*)'
        ]
      },
      permissive: {
        name: '宽松模式',
        description: '允许大多数命令，仅阻止极度危险的操作',
        allow: [
          'Bash(*)',
          'Read(*)',
          'Edit(*)'
        ],
        deny: [
          'Bash(rm -rf /*)',
          'Bash(sudo rm -rf:*)'
        ]
      }
    };

    res.json({
      success: true,
      templates
    });
  } catch (err) {
    console.error('[Permissions API] Get templates error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * 获取各 CLI 工具的启动参数配置说明
 * GET /api/permissions/cli-config
 */
router.get('/cli-config', (req, res) => {
  try {
    const cliConfigs = {
      claude: {
        name: 'Claude Code',
        configFile: '.claude/settings.json',
        userConfigFile: '~/.claude/settings.json',
        permissionFormat: {
          example: {
            permissions: {
              allow: ['Bash(npm run:*)', 'Read(./src/**)'],
              deny: ['Bash(rm:*)', 'Read(.env)']
            }
          }
        },
        allAllowFlag: '--dangerously-skip-permissions',
        docs: 'https://docs.anthropic.com/en/docs/claude-code'
      },
      codex: {
        name: 'Codex CLI',
        sandboxModes: ['read-only', 'workspace-write'],
        approvalModes: ['suggest', 'auto-edit'],
        allAllowFlag: '--dangerously-bypass-approvals-and-sandbox',
        example: 'codex --approval-mode auto-edit --sandbox workspace-write "task"',
        docs: 'https://github.com/openai/codex'
      },
      gemini: {
        name: 'Gemini CLI',
        allowedToolsFlag: '--allowedTools "ShellTool(git status)"',
        sandboxFlag: '--sandbox / -s',
        allAllowFlag: '--yolo',
        docs: 'https://github.com/google-gemini/gemini-cli'
      }
    };

    res.json({
      success: true,
      cliConfigs
    });
  } catch (err) {
    console.error('[Permissions API] Get CLI config error:', err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
