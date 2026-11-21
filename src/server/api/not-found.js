'use strict';

/**
 * `/api/*` 兜底：未匹配的 API 路径必须返回 JSON 404，
 * 不能被 SPA 的 index.html 兜底吞掉（否则客户端会把 HTML 当数据解析）。
 */
module.exports = function apiNotFound(req, res) {
  res.status(404).json({
    error: 'Not Found',
    code: 'API_NOT_FOUND',
    method: req.method,
    path: req.originalUrl
  });
};
