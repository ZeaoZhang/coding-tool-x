'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { getProviderConfig } = require('../config/oauth-providers');

// Pending OAuth flows storage with state -> flow data mapping
const pendingFlows = new Map();

// Flow expiry time: 10 minutes
const FLOW_EXPIRY_MS = 10 * 60 * 1000;

// ============================================
// PKCE Generation
// ============================================

/**
 * Generate base64url encoded string from buffer
 * @param {Buffer} buffer
 * @returns {string}
 */
function base64url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate PKCE code verifier and challenge
 * @returns {{ codeVerifier: string, codeChallenge: string }}
 */
function generatePKCE() {
  // 32 bytes random -> base64url for code verifier
  const codeVerifier = base64url(crypto.randomBytes(32));

  // SHA-256 hash of verifier -> base64url for challenge
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = base64url(hash);

  return { codeVerifier, codeChallenge };
}

// ============================================
// State Management
// ============================================

/**
 * Generate random state for OAuth flow
 * @returns {string}
 */
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Clean up expired flows (older than 10 minutes)
 */
function cleanupExpiredFlows() {
  const now = Date.now();
  for (const [state, flow] of pendingFlows.entries()) {
    if (now - flow.createdAt > FLOW_EXPIRY_MS) {
      pendingFlows.delete(state);
    }
  }
}

// ============================================
// Auth URL Construction
// ============================================

/**
 * Build OAuth authorization URL
 * @param {string} provider - Provider name (claude, codex, gemini)
 * @param {string} state - State parameter
 * @param {string} codeChallenge - PKCE code challenge (for PKCE providers)
 * @returns {string} Full authorization URL
 */
function buildAuthUrl(provider, state, codeChallenge) {
  const config = getProviderConfig(provider);
  const url = new URL(config.authUrl);

  // Common parameters
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', config.scopes.join(' '));

  // PKCE parameters for PKCE-enabled providers
  if (config.authType === 'pkce' && codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  // Extra parameters from provider config
  if (config.extraParams) {
    for (const [key, value] of Object.entries(config.extraParams)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

// ============================================
// HTTP Request Helper
// ============================================

/**
 * Make HTTP/HTTPS request
 * @param {string} urlString - Full URL
 * @param {Object} options - Request options
 * @param {string} body - Request body
 * @returns {Promise<{ statusCode: number, data: Object }>}
 */
function makeRequest(urlString, options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const client = url.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'POST',
      headers: options.headers || {}
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: parsed });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// ============================================
// Token Exchange
// ============================================

/**
 * Exchange authorization code for tokens
 * @param {string} provider - Provider name
 * @param {string} code - Authorization code
 * @param {string} codeVerifier - PKCE code verifier (for PKCE providers)
 * @returns {Promise<{ accessToken: string, refreshToken?: string, idToken?: string, expiresIn?: number, scope?: string }>}
 */
async function exchangeCodeForToken(provider, code, codeVerifier) {
  const config = getProviderConfig(provider);

  // Build token request body
  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('client_id', config.clientId);
  params.set('redirect_uri', config.redirectUri);

  // Add client_secret for standard OAuth (gemini)
  if (config.clientSecret) {
    params.set('client_secret', config.clientSecret);
  }

  // Add code_verifier for PKCE providers
  if (config.authType === 'pkce' && codeVerifier) {
    params.set('code_verifier', codeVerifier);
  }

  // Determine content type - Codex requires form-urlencoded
  const contentType = config.tokenContentType || 'application/x-www-form-urlencoded';

  const headers = {
    'Content-Type': contentType,
    'Accept': 'application/json'
  };

  const { statusCode, data } = await makeRequest(config.tokenUrl, { headers }, params.toString());

  if (statusCode !== 200) {
    const errorMsg = data.error_description || data.error || 'Token exchange failed';
    throw new Error(`Token exchange failed (${statusCode}): ${errorMsg}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresIn: data.expires_in,
    scope: data.scope
  };
}

// ============================================
// Token Refresh
// ============================================

/**
 * Refresh access token using refresh token
 * @param {string} provider - Provider name
 * @param {string} refreshTokenValue - Refresh token
 * @returns {Promise<{ accessToken: string, refreshToken?: string, expiresIn?: number, scope?: string }>}
 */
async function refreshToken(provider, refreshTokenValue) {
  const config = getProviderConfig(provider);

  // Build refresh request body
  const params = new URLSearchParams();
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', refreshTokenValue);
  params.set('client_id', config.clientId);

  // Add client_secret for standard OAuth (gemini)
  if (config.clientSecret) {
    params.set('client_secret', config.clientSecret);
  }

  // Determine content type
  const contentType = config.tokenContentType || 'application/x-www-form-urlencoded';

  const headers = {
    'Content-Type': contentType,
    'Accept': 'application/json'
  };

  const { statusCode, data } = await makeRequest(config.tokenUrl, { headers }, params.toString());

  if (statusCode !== 200) {
    const errorMsg = data.error_description || data.error || 'Token refresh failed';
    throw new Error(`Token refresh failed (${statusCode}): ${errorMsg}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope
  };
}

// ============================================
// Flow Management
// ============================================

/**
 * Start a new OAuth flow
 * @param {string} provider - Provider name
 * @param {string} [channelId] - Optional channel ID to associate with flow
 * @returns {{ state: string, authUrl: string }}
 */
function startFlow(provider, channelId) {
  // Clean up old flows first
  cleanupExpiredFlows();

  const state = generateState();
  const config = getProviderConfig(provider);

  let codeVerifier = null;
  let codeChallenge = null;

  // Generate PKCE for PKCE-enabled providers
  if (config.authType === 'pkce') {
    const pkce = generatePKCE();
    codeVerifier = pkce.codeVerifier;
    codeChallenge = pkce.codeChallenge;
  }

  const authUrl = buildAuthUrl(provider, state, codeChallenge);

  // Store flow data
  pendingFlows.set(state, {
    provider,
    codeVerifier,
    channelId: channelId || null,
    createdAt: Date.now(),
    status: 'pending',
    tokenId: null,
    error: null
  });

  return { state, authUrl };
}

/**
 * Get pending flow by state
 * @param {string} state
 * @returns {Object|null}
 */
function getPendingFlow(state) {
  return pendingFlows.get(state) || null;
}

/**
 * Update flow with partial data
 * @param {string} state
 * @param {Object} updates
 * @returns {boolean}
 */
function updateFlow(state, updates) {
  const flow = pendingFlows.get(state);
  if (!flow) return false;

  Object.assign(flow, updates);
  return true;
}

/**
 * Mark flow as completed
 * @param {string} state
 * @param {string} tokenId - Token ID from storage
 * @returns {boolean}
 */
function completeFlow(state, tokenId) {
  return updateFlow(state, { status: 'completed', tokenId });
}

/**
 * Mark flow as failed
 * @param {string} state
 * @param {string} error - Error message
 * @returns {boolean}
 */
function failFlow(state, error) {
  return updateFlow(state, { status: 'failed', error });
}

/**
 * Cancel and remove a flow
 * @param {string} state
 * @returns {boolean}
 */
function cancelFlow(state) {
  return pendingFlows.delete(state);
}

// ============================================
// Device Flow (RFC 8628)
// ============================================

/**
 * Start a Device Authorization Flow
 * @param {string} provider - Provider name (e.g., 'codex')
 * @param {string} [channelId] - Optional channel ID to associate with flow
 * @returns {Promise<{ state: string, userCode: string, verificationUri: string, expiresIn: number, interval: number }>}
 */
async function startDeviceFlow(provider, channelId) {
  // Clean up old flows first
  cleanupExpiredFlows();

  const config = getProviderConfig(provider);

  // Verify provider supports device flow
  if (config.authType !== 'device_flow') {
    throw new Error(`Provider ${provider} does not support device flow (authType: ${config.authType})`);
  }

  if (!config.deviceCodeUrl) {
    throw new Error(`Provider ${provider} missing deviceCodeUrl configuration`);
  }

  // Build device authorization request body
  const params = new URLSearchParams();
  params.set('client_id', config.clientId);
  params.set('scope', config.scopes.join(' '));

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  };

  const { statusCode, data } = await makeRequest(config.deviceCodeUrl, { headers }, params.toString());

  if (statusCode !== 200) {
    const errorMsg = data.error_description || data.error || 'Device authorization request failed';
    throw new Error(`Device flow start failed (${statusCode}): ${errorMsg}`);
  }

  // Extract device authorization response fields
  const deviceCode = data.device_code;
  const userCode = data.user_code;
  const verificationUri = data.verification_uri;
  const expiresIn = data.expires_in || 900; // Default 15 minutes
  const interval = data.interval || 5; // Default 5 seconds

  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error('Invalid device authorization response: missing required fields');
  }

  // Generate state ID for tracking
  const state = generateState();

  // Store flow data with device-specific fields
  pendingFlows.set(state, {
    provider,
    channelId: channelId || null,
    createdAt: Date.now(),
    status: 'pending',
    tokenId: null,
    error: null,
    // Device flow specific fields
    deviceCode,
    userCode,
    verificationUri,
    interval,
    expiresAt: Date.now() + (expiresIn * 1000)
  });

  return {
    state,
    userCode,
    verificationUri,
    expiresIn,
    interval
  };
}

/**
 * Poll device flow for token
 * @param {string} state - Flow state ID
 * @returns {Promise<{ status: string, accessToken?: string, tokenType?: string, scope?: string, interval?: number, error?: string }>}
 */
async function pollDeviceFlow(state) {
  const flow = pendingFlows.get(state);

  if (!flow) {
    return { status: 'failed', error: 'Flow not found' };
  }

  if (!flow.deviceCode) {
    return { status: 'failed', error: 'Not a device flow' };
  }

  // Check if flow has expired
  if (Date.now() > flow.expiresAt) {
    failFlow(state, 'Device code expired');
    return { status: 'expired' };
  }

  const config = getProviderConfig(flow.provider);

  // Build token request body for device flow
  const params = new URLSearchParams();
  params.set('client_id', config.clientId);
  params.set('device_code', flow.deviceCode);
  params.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  };

  const { statusCode, data } = await makeRequest(config.tokenUrl, { headers }, params.toString());

  // Handle error responses (typically 400 status during polling)
  if (data.error) {
    switch (data.error) {
      case 'authorization_pending':
        // User hasn't completed authorization yet
        return { status: 'pending' };

      case 'slow_down':
        // Server requests slower polling - increase interval
        const newInterval = (flow.interval || 5) + 5;
        updateFlow(state, { interval: newInterval });
        return { status: 'pending', interval: newInterval };

      case 'expired_token':
        failFlow(state, 'Device code expired');
        return { status: 'expired' };

      case 'access_denied':
        failFlow(state, 'User denied authorization');
        return { status: 'denied' };

      default:
        // Other errors
        const errorMsg = data.error_description || data.error;
        failFlow(state, errorMsg);
        return { status: 'failed', error: errorMsg };
    }
  }

  // Success - we have tokens
  if (data.access_token) {
    return {
      status: 'completed',
      accessToken: data.access_token,
      tokenType: data.token_type,
      scope: data.scope,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  }

  // Unexpected response
  return { status: 'failed', error: 'Unexpected response from token endpoint' };
}

/**
 * Cancel a device flow
 * @param {string} state - Flow state ID
 * @returns {{ success: boolean }}
 */
function cancelDeviceFlow(state) {
  pendingFlows.delete(state);
  return { success: true };
}

module.exports = {
  // PKCE
  generatePKCE,

  // State
  generateState,
  cleanupExpiredFlows,

  // Auth URL
  buildAuthUrl,

  // Token operations
  exchangeCodeForToken,
  refreshToken,

  // Flow management
  startFlow,
  getPendingFlow,
  updateFlow,
  completeFlow,
  failFlow,
  cancelFlow,

  // Device Flow (RFC 8628)
  startDeviceFlow,
  pollDeviceFlow,
  cancelDeviceFlow
};
