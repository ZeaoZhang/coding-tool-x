'use strict';

const AUTH_MODES = new Set(['api_key', 'oauth', 'none']);

function createAuthError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function validateEnabledTransition(channels, channel, policy = 'mixed') {
  if (channel.authMode !== 'oauth' || channel.enabled === false || policy !== 'single-enabled') return;
  const conflict = channels.find(item => item.id !== channel.id && item.authMode === 'oauth' && item.enabled !== false);
  if (!conflict) return;
  const error = createAuthError(`OAuth channel conflicts with ${conflict.name || conflict.id}`, 'oauth_channel_conflict', 409);
  error.conflictingChannelId = conflict.id;
  error.conflictingChannelName = conflict.name || conflict.id;
  throw error;
}

function assertAuthMode(mode) {
  if (!AUTH_MODES.has(mode)) throw createAuthError('Invalid auth mode', 'invalid_auth_payload', 400);
  return mode;
}

module.exports = { AUTH_MODES, assertAuthMode, validateEnabledTransition };
