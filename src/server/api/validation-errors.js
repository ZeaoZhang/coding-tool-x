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
  const status = ['not_found', 'unsupported'].includes(error?.code)
    ? 404
    : error?.code === 'invalid'
      ? 400
      : error?.code === 'failed'
        ? 500
        : (isValidationError(error) ? 400 : fallbackStatus);
  const payload = {
    success: false,
    message: error?.message || String(error),
    ...extra
  };
  if (error?.code) payload.code = error.code;
  if (error?.platform) payload.platform = error.platform;
  if (error?.capability) payload.capability = error.capability;
  if (error?.operation) payload.operation = error.operation;
  return res.status(status).json(payload);
}

module.exports = {
  isValidationError,
  sendApiError
};
