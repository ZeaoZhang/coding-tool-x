/**
 * MCP 服务器管理 API 路由
 */

const express = require('express');
const router = express.Router();
const mcpService = require('../services/mcp-service');
const { redactSecrets } = require('../../shared/project-config');

const SENSITIVE_URL_KEY = /^(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key)$/i;

function hasSensitiveUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return Boolean(
      parsed.username
      || parsed.password
      || [...parsed.searchParams.keys()].some(key => SENSITIVE_URL_KEY.test(key))
    );
  } catch {
    return /\/\/[^/@\s:]+:[^@/\s]+@|[?&](?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key)=/i.test(value);
  }
}

function sanitizeMcpUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_URL_KEY.test(key)) parsed.searchParams.set(key, '[REDACTED]');
    }
    return parsed.toString();
  } catch {
    return value
      .replace(/\/\/[^/@\s:]+:[^@/\s]+@/g, '//[REDACTED]@')
      .replace(/([?&](?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key)=)[^&\s]+/gi, '$1[REDACTED]');
  }
}

const SENSITIVE_COMMAND_FLAG = /^(?:--?|\/)(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key|auth|credential|client[-_]?secret|bearer)$/i;

function sanitizeCommandLineValue(value) {
  if (Array.isArray(value)) {
    let redactNext = false;
    return value.map(item => {
      if (redactNext) {
        redactNext = false;
        return '[REDACTED]';
      }
      if (typeof item !== 'string') return '[REDACTED]';
      if (SENSITIVE_COMMAND_FLAG.test(item)) {
        redactNext = true;
        return item;
      }
      const inline = item.match(/^((?:--?|\/)(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key|auth|credential|client[-_]?secret|bearer)=).*/i);
      if (inline) return `${inline[1]}[REDACTED]`;
      return sanitizeErrorMessage(item);
    });
  }
  if (typeof value !== 'string') return value;
  return sanitizeErrorMessage(value)
    .replace(/((?:^|\s)(?:--?|\/)(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key|auth|credential|client[-_]?secret|bearer)(?:=|\s+))\S+/gi, '$1[REDACTED]');
}

function sanitizeMcpValue(value, key = '') {
  if (/^url$/i.test(key)) return sanitizeMcpUrl(value);
  if (/^(?:command|args)$/i.test(key)) return sanitizeCommandLineValue(value);
  if (/(?:token|secret|password|api[-_]?key|access[_-]?token|authorization|headers?|env(?:ironment)?|envvars|experimentalenvironment|auth|oauth|credential|private[_-]?key)/i.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') return sanitizeErrorMessage(value);
  if (Array.isArray(value)) return value.map(item => sanitizeMcpValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    sanitizeMcpValue(childValue, childKey)
  ]));
}
function sanitizeMcpServer(server) {
  if (!server || typeof server !== 'object') return server;
  const safe = sanitizeMcpValue(redactSecrets(server));
  const env = server.server?.env;
  const headers = server.server?.headers;
  const url = server.server?.url;
  return {
    ...safe,
    ...(env || headers || hasSensitiveUrl(url)
      ? { hasSecret: true }
      : {})
  };
}

function sanitizeErrorMessage(value) {
  return String(value || '')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, '$1?[REDACTED]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|secret|password|api[-_]?key|access[_-]?token|authorization|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:token|secret|password|api[-_]?key|access[_-]?token|authorization)\s*[:=]\s*)[^,\s}]+/gi, '$1[REDACTED]');
}
function sanitizeMcpServers(servers) {
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {};
  return Object.fromEntries(Object.entries(servers).map(([id, server]) => [id, sanitizeMcpServer(server)]));
}
const MCP_PLATFORMS = ['claude', 'codex', 'gemini', 'opencode', 'omp'];
const MCP_EXPORT_FORMATS = ['json', 'claude', 'codex', 'gemini', 'opencode', 'omp'];
const { getPlatformContext } = require('../platform-context');

function normalizePlatformKey(platform) {
  return String(platform || '').trim().toLowerCase();
}

function createCapabilityError(platform, code) {
  const key = normalizePlatformKey(platform);
  const error = new Error(code === 'not_found'
    ? `无效的平台: ${key}`
    : `平台 ${key} 未声明 mcp capability`);
  error.status = 404;
  error.code = code;
  error.platform = key;
  error.capability = 'mcp';
  return error;
}

function resolveMcpPlatform(platform) {
  const key = normalizePlatformKey(platform);
  const registry = getPlatformContext().registry;
  if (!registry.resolve(key)) return { error: createCapabilityError(key, 'not_found') };
  const driverId = registry.getCapability(key, 'mcp');
  if (!driverId || driverId === 'unsupported') {
    return { error: createCapabilityError(key, 'unsupported') };
  }
  return { key, driverId };
}

function resolveMcpExportPlatform(platform) {
  const resolved = resolveMcpPlatform(platform);
  if (resolved.error) return resolved;

  const runtime = getPlatformContext().runtime;
  const driver = runtime.getDriver(resolved.key, 'mcp');
  if (!driver || typeof driver.export !== 'function') {
    return { error: createCapabilityError(resolved.key, 'unsupported') };
  }

  return { key: resolved.key, driver };
}



function sendCapabilityError(res, error, fallbackStatus = 400) {
  const status = error?.status === 404 && error?.code ? 404 : fallbackStatus;
  return res.status(status).json({
    success: false,
    error: sanitizeErrorMessage(error.message),
    code: error.code || undefined,
    platform: error.platform || undefined,
    capability: error.capability || undefined
  });
}

/**
 * GET /api/mcp/servers
 * 获取所有 MCP 服务器
 */
router.get('/servers', (req, res) => {
  try {
    const servers = mcpService.getAllServers();
    res.json({
      success: true,
      servers: sanitizeMcpServers(servers)
    });
  } catch (error) {
    console.error('[MCP API] Get servers failed:', sanitizeErrorMessage(error.message || error));
    res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error.message)
    });
  }
});

/**
 * GET /api/mcp/servers/:id
 * 获取单个 MCP 服务器
 */
router.get('/servers/:id', (req, res) => {
  try {
    const server = mcpService.getServer(req.params.id);
    if (!server) {
      return res.status(404).json({
        success: false,
        error: `MCP 服务器 "${req.params.id}" 不存在`
      });
    }
    res.json({
      success: true,
      server: sanitizeMcpServer(server)
    });
  } catch (error) {
    console.error('[MCP API] Get server failed:', sanitizeErrorMessage(error.message || error));
    res.status(400).json({
      success: false,
      error: sanitizeErrorMessage(error.message)
    });
  }
});

/**
 * POST /api/mcp/servers
 * 添加或更新 MCP 服务器
 */
router.post('/servers', async (req, res) => {
  try {
    const server = req.body;

    if (!server.id) {
      return res.status(400).json({
        success: false,
        error: 'MCP 服务器 ID 不能为空'
      });
    }

    if (!server.server) {
      return res.status(400).json({
        success: false,
        error: '服务器配置不能为空'
      });
    }

    const result = await mcpService.saveServer(server);
    res.json({
      success: true,
      server: sanitizeMcpServer(result)
    });
  } catch (error) {
    console.error('[MCP API] Save server failed:', sanitizeErrorMessage(error.message || error));
    res.status(400).json({
      success: false,
      error: sanitizeErrorMessage(error.message)
    });
  }
});

/**
 * DELETE /api/mcp/servers/:id
 * 删除 MCP 服务器
 */
router.delete('/servers/:id', async (req, res) => {
  try {
    const deleted = await mcpService.deleteServer(req.params.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: `MCP 服务器 "${req.params.id}" 不存在`
      });
    }
    res.json({
      success: true
    });
  } catch (error) {
    console.error('[MCP API] Delete server failed:', sanitizeErrorMessage(error.message || error));
    res.status(400).json({
      success: false,
      error: sanitizeErrorMessage(error.message)
    });
  }
});

/**
 * POST /api/mcp/servers/:id/toggle
 * 切换 MCP 服务器在某平台的启用状态
 */
router.post('/servers/:id/toggle', async (req, res) => {
  try {
    const { app, enabled } = req.body;

    if (!app) {
      return res.status(400).json({
        success: false,
        error: '必须指定平台 (app)'
      });
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: '必须指定启用状态 (enabled)'
      });
    }

    const server = await mcpService.toggleServerApp(req.params.id, app, enabled);
    res.json({
      success: true,
      server: sanitizeMcpServer(server)
    });
  } catch (error) {
    console.error('[MCP API] Toggle server failed:', sanitizeErrorMessage(error.message || error));
    res.status(400).json({
      success: false,
      error: sanitizeErrorMessage(error.message)
    });
  }
});

/**
 * GET /api/mcp/presets
 * 获取 MCP 预设模板列表
 */
router.get('/presets', (req, res) => {
  try {
    const presets = mcpService.getPresets();
    res.json({
      success: true,
      presets
    });
  } catch (error) {
    console.error('[MCP API] Get presets failed:', sanitizeErrorMessage(error.message || error));
    res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error.message)
    });
  }
});

/**
 * POST /api/mcp/import/:platform
 * 从指定平台导入 MCP 配置
 */
router.post('/import/:platform', async (req, res) => {
  try {
    const resolved = resolveMcpPlatform(req.params.platform);
    if (resolved.error) return sendCapabilityError(res, resolved.error, 404);

    const count = await mcpService.importFromPlatform(resolved.key);
    res.json({
      success: true,
      imported: count,
      message: count > 0
        ? `成功从 ${resolved.key} 导入 ${count} 个 MCP 服务器`
        : `${resolved.key} 没有可导入的 MCP 服务器`
    });
  } catch (error) {
    console.error('[MCP API] Import failed:', sanitizeErrorMessage(error.message || error));
    return sendCapabilityError(res, error, 500);
  }
});

/**
 * GET /api/mcp/stats
 * 获取 MCP 统计信息
 */
router.get('/stats', (req, res) => {
  try {
    const stats = mcpService.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('[MCP API] Get stats failed:', sanitizeErrorMessage(error.message || error));
    res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error.message)
    });
  }
});

/**
 * POST /api/mcp/servers/:id/test
 * 测试 MCP 服务器连接
 */
router.post('/servers/:id/test', async (req, res) => {
  try {
    const result = await mcpService.testServer(req.params.id);

    // 更新服务器状态
    const status = result.success ? 'online' : 'error';
    await mcpService.updateServerStatus(req.params.id, status);

    res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('[MCP API] Test server failed:', sanitizeErrorMessage(error.message || error));
    const safeError = sanitizeErrorMessage(error.message || error);
    res.status(error.code === 'MCP_DISABLED' ? 403 : 500).json({
      success: false,
      error: safeError,
      message: safeError,
      hint: sanitizeMcpValue(error?.data?.hint)
    });
  }
});

/**
 * POST /api/mcp/servers/order
 * 更新服务器排序
 */
router.post('/servers/order', (req, res) => {
  try {
    const { serverIds } = req.body;

    if (!Array.isArray(serverIds)) {
      return res.status(400).json({
        success: false,
        error: 'serverIds 必须是数组'
      });
    }

    const servers = mcpService.updateServerOrder(serverIds);
    res.json({
      success: true,
      servers: sanitizeMcpServers(servers)
    });
  } catch (error) {
    console.error('[MCP API] Update order failed:', sanitizeErrorMessage(error.message || error));
    const safeError = sanitizeErrorMessage(error.message || error);
    res.status(/invalid MCP server ID/i.test(safeError) ? 400 : 500).json({
      success: false,
      error: safeError
    });
  }
});

/**
 * GET /api/mcp/export
 * 导出 MCP 配置
 */
router.get('/export', (req, res) => {
  try {
    const format = normalizePlatformKey(req.query.format || 'json');

    if (format !== 'json') {
      const resolved = resolveMcpExportPlatform(format);
      if (resolved.error) {
        if (resolved.error.code === 'not_found') {
          return res.status(400).json({
            success: false,
            error: `无效的导出格式: ${format}`
          });
        }
        return sendCapabilityError(res, resolved.error, 404);
      }
    }

    const result = mcpService.exportServers(format);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[MCP API] Export failed:', sanitizeErrorMessage(error.message || error));
    return sendCapabilityError(res, error, 500);
  }
});

/**
 * GET /api/mcp/export/download
 * 下载导出的配置文件
 */
router.get('/export/download', (req, res) => {
  try {
    const format = normalizePlatformKey(req.query.format || 'json');

    if (format !== 'json') {
      const resolved = resolveMcpExportPlatform(format);
      if (resolved.error) {
        if (resolved.error.code === 'not_found') {
          return res.status(400).json({
            success: false,
            error: `无效的导出格式: ${format}`
          });
        }
        return sendCapabilityError(res, resolved.error, 404);
      }
    }

    const result = mcpService.exportServers(format);

    res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (error) {
    console.error('[MCP API] Export download failed:', sanitizeErrorMessage(error.message || error));
    return sendCapabilityError(res, error, 500);
  }
});

/**
 * GET /api/mcp/servers/:id/tools
 * 获取 MCP 服务器的工具列表
 */
router.get('/servers/:id/tools', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await mcpService.getServerTools(id);
    if (result.status === 'error') {
      return res.status(502).json({
        success: false,
        error: sanitizeErrorMessage(result.error || '获取工具列表失败'),
        message: sanitizeErrorMessage(result.error || '获取工具列表失败'),
        hint: sanitizeMcpValue(result.hint || null),
        duration: result.duration,
        tools: []
      });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.code === 'MCP_DISABLED' ? 403 : 404).json({
      success: false,
      error: sanitizeErrorMessage(err.message),
      message: sanitizeErrorMessage(err.message),
      hint: sanitizeMcpValue(err?.data?.hint || null)
    });
  }
});

/**
 * POST /api/mcp/servers/:id/tools/test
 * 测试 MCP 服务器的工具
 */
router.post('/servers/:id/tools/test', async (req, res) => {
  try {
    const { id } = req.params;
    const { toolName, arguments: args } = req.body;

    if (!toolName) {
      return res.status(400).json({ success: false, error: '缺少 toolName 参数', message: '缺少 toolName 参数' });
    }

    const result = await mcpService.callServerTool(id, toolName, args || {});
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.code === 'MCP_DISABLED' ? 403 : 500).json({
      success: false,
      error: sanitizeErrorMessage(err.message),
      message: sanitizeErrorMessage(err.message),
      hint: sanitizeMcpValue(err?.data?.hint || null)
    });
  }
});

/**
 * GET /api/mcp/servers/:id/info
 * 获取 MCP 服务器的详细信息
 */
router.get('/servers/:id/info', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await mcpService.getServerTools(id);

    const serverData = mcpService.getServer(id);

    res.json({
      success: true,
      capabilities: {
        tools: true,
        resources: false,
        prompts: false
      },
      tools: result.tools,
      serverInfo: serverData ? {
        name: serverData.name || id,
        type: serverData.server?.type || 'stdio'
      } : {}
    });
  } catch (err) {
    res.status(500).json({ success: false, error: sanitizeErrorMessage(err.message) });
  }
});

module.exports = router;
