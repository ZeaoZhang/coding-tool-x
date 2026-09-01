const VALIDATION_ERROR_PATTERNS = [
  /^Invalid\b/i,
  /不能为空/,
  /不合法/,
  /只能包含/,
  /不能包含/,
  /必须/,
  /不能/,
  /Missing\b/i,
  /requires?/i,
  /required/i,
  /escapes/i,
  /not support/i,
  /不支持/,
  /symlink/i,
  /string/i,
  /MCP server ID/i,
];

function isValidationError(error) {
  const message = String(error?.message || error || '');
  return VALIDATION_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

function sendApiError(res, error, fallbackStatus = 500, extra = {}) {
  const status = isValidationError(error) ? 400 : fallbackStatus;
  return res.status(status).json({
    success: false,
    message: error?.message || String(error),
    ...extra
  });
}

module.exports = {
  isValidationError,
  sendApiError
};
