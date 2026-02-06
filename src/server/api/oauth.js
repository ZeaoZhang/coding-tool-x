'use strict';

const express = require('express');
const router = express.Router();
const { OAUTH_PROVIDERS, getProviderConfig, isDeviceFlowProvider } = require('../config/oauth-providers');
const {
  startFlow,
  getPendingFlow,
  completeFlow,
  failFlow,
  cancelFlow,
  exchangeCodeForToken,
  refreshToken,
  startDeviceFlow,
  pollDeviceFlow,
  cancelDeviceFlow
} = require('../services/oauth-service');
const {
  startCallbackServer,
  stopCallbackServer,
  isServerRunning
} = require('../services/oauth-callback-server');
const {
  getAllTokens,
  getToken,
  saveToken,
  updateToken,
  deleteToken
} = require('../services/oauth-token-storage');

// Track callback servers by state
const stateToPort = new Map();

// GET /api/oauth/providers - List available OAuth providers
router.get('/providers', (req, res) => {
  try {
    const providers = Object.entries(OAUTH_PROVIDERS).map(([id, config]) => ({
      id,
      name: config.name,
      scopes: config.scopes
    }));
    res.json({ providers });
  } catch (error) {
    console.error('Error fetching OAuth providers:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/oauth/start - Start OAuth flow
router.post('/start', async (req, res) => {
  try {
    const { provider, channelId, mode = 'browser' } = req.body;

    if (!provider) {
      return res.status(400).json({ error: 'Missing required field: provider' });
    }

    // Validate provider
    if (!OAUTH_PROVIDERS[provider]) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    const providerConfig = getProviderConfig(provider);
    const { state, authUrl } = startFlow(provider, channelId);
    const callbackPort = providerConfig.callbackPort;
    const callbackPath = providerConfig.callbackPath;

    // Track state -> port mapping
    stateToPort.set(state, callbackPort);

    // Start callback server
    await startCallbackServer(callbackPort, callbackPath, async (callbackData) => {
      const { code, state: cbState, error, errorDescription } = callbackData;

      if (error) {
        failFlow(cbState, `${error}: ${errorDescription || 'Unknown error'}`);
        return;
      }

      if (!code) {
        failFlow(cbState, 'No authorization code received');
        return;
      }

      // Get pending flow to retrieve code verifier
      const flow = getPendingFlow(cbState);
      if (!flow) {
        console.error('OAuth callback received for unknown state:', cbState);
        return;
      }

      try {
        // Exchange code for token
        const tokenResult = await exchangeCodeForToken(
          flow.provider,
          code,
          flow.codeVerifier
        );

        // Calculate expiry time
        const now = Date.now();
        const expiresAt = tokenResult.expiresIn
          ? now + (tokenResult.expiresIn * 1000)
          : null;

        // Save token
        const savedToken = saveToken({
          provider: flow.provider,
          channelId: flow.channelId,
          accessToken: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken,
          idToken: tokenResult.idToken,
          expiresAt,
          scope: tokenResult.scope
        });

        // Mark flow as completed
        completeFlow(cbState, savedToken.id);
        console.log(`OAuth flow completed for provider: ${flow.provider}, tokenId: ${savedToken.id}`);
      } catch (err) {
        console.error('Error exchanging code for token:', err);
        failFlow(cbState, err.message);
      }
    });

    // Open browser if mode is 'browser'
    if (mode === 'browser') {
      try {
        const open = require('open');
        await open(authUrl);
      } catch (err) {
        console.error('Failed to open browser:', err);
        // Don't fail the request, user can still open URL manually
      }
    }

    res.json({
      success: true,
      stateId: state,
      authUrl,
      callbackPort
    });
  } catch (error) {
    console.error('Error starting OAuth flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/oauth/status/:stateId - Get OAuth flow status
router.get('/status/:stateId', (req, res) => {
  try {
    const { stateId } = req.params;
    const flow = getPendingFlow(stateId);

    if (!flow) {
      return res.status(404).json({
        status: 'not_found',
        error: 'OAuth flow not found or expired'
      });
    }

    const response = {
      status: flow.status
    };

    if (flow.status === 'completed' && flow.tokenId) {
      response.tokenId = flow.tokenId;
    }

    if (flow.status === 'failed' && flow.error) {
      response.error = flow.error;
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching OAuth status:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/oauth/cancel/:stateId - Cancel OAuth flow
router.post('/cancel/:stateId', (req, res) => {
  try {
    const { stateId } = req.params;

    // Get port for this state
    const port = stateToPort.get(stateId);

    // Stop callback server if running
    if (port && isServerRunning(port)) {
      stopCallbackServer(port);
    }

    // Cancel the flow
    cancelFlow(stateId);

    // Clean up state -> port mapping
    stateToPort.delete(stateId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling OAuth flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/oauth/device/start - Start Device Flow OAuth
router.post('/device/start', async (req, res) => {
  try {
    const { provider, channelId } = req.body;

    if (!provider) {
      return res.status(400).json({ error: 'Missing required field: provider' });
    }

    if (!isDeviceFlowProvider(provider)) {
      return res.status(400).json({ error: `Provider ${provider} does not support Device Flow` });
    }

    const result = await startDeviceFlow(provider, channelId);

    res.json({
      success: true,
      stateId: result.state,
      userCode: result.userCode,
      verificationUri: result.verificationUri,
      expiresIn: result.expiresIn,
      interval: result.interval
    });
  } catch (error) {
    console.error('Error starting Device Flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/oauth/device/status/:stateId - Poll Device Flow status
router.get('/device/status/:stateId', async (req, res) => {
  try {
    const { stateId } = req.params;
    const result = await pollDeviceFlow(stateId);

    if (result.status === 'completed' && result.accessToken) {
      // Save token
      const flow = getPendingFlow(stateId);

      const savedToken = saveToken({
        provider: flow ? flow.provider : 'unknown',
        channelId: flow ? flow.channelId : null,
        accessToken: result.accessToken,
        refreshToken: null,
        expiresAt: null,
        scope: result.scope
      });

      // Mark flow as completed
      completeFlow(stateId, savedToken.id);

      res.json({
        status: 'completed',
        tokenId: savedToken.id
      });
    } else {
      res.json(result);
    }
  } catch (error) {
    console.error('Error polling Device Flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/oauth/device/cancel/:stateId - Cancel Device Flow
router.post('/device/cancel/:stateId', (req, res) => {
  try {
    const { stateId } = req.params;
    cancelDeviceFlow(stateId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling Device Flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/oauth/tokens - List all tokens (masked)
router.get('/tokens', (req, res) => {
  try {
    const tokens = getAllTokens();
    res.json({ tokens });
  } catch (error) {
    console.error('Error fetching OAuth tokens:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/oauth/tokens/:tokenId - Get single token (masked)
router.get('/tokens/:tokenId', (req, res) => {
  try {
    const token = getToken(req.params.tokenId);
    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }
    // Return masked token info
    const masked = {
      ...token,
      accessToken: token.accessToken ? token.accessToken.substring(0, 8) + '...' : null,
      refreshToken: token.refreshToken ? token.refreshToken.substring(0, 8) + '...' : null
    };
    res.json(masked);
  } catch (error) {
    console.error('Error fetching OAuth token:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/oauth/tokens/:tokenId - Delete a token
router.delete('/tokens/:tokenId', (req, res) => {
  try {
    const { tokenId } = req.params;
    const result = deleteToken(tokenId);
    res.json(result);
  } catch (error) {
    if (error.message === 'Token not found') {
      return res.status(404).json({ error: 'Token not found' });
    }
    console.error('Error deleting OAuth token:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/oauth/refresh/:tokenId - Refresh a token
router.post('/refresh/:tokenId', async (req, res) => {
  try {
    const { tokenId } = req.params;
    const token = getToken(tokenId);

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    if (!token.refreshToken) {
      return res.status(400).json({ error: 'Token does not have a refresh token' });
    }

    // Refresh the token
    const refreshResult = await refreshToken(token.provider, token.refreshToken);

    // Calculate new expiry time
    const now = Date.now();
    const expiresAt = refreshResult.expiresIn
      ? now + (refreshResult.expiresIn * 1000)
      : null;

    // Update token in storage
    const updatedToken = updateToken(tokenId, {
      accessToken: refreshResult.accessToken,
      refreshToken: refreshResult.refreshToken || token.refreshToken,
      expiresAt,
      scope: refreshResult.scope || token.scope
    });

    res.json({
      success: true,
      expiresAt: updatedToken.expiresAt
    });
  } catch (error) {
    if (error.message === 'Token not found') {
      return res.status(404).json({ error: 'Token not found' });
    }
    console.error('Error refreshing OAuth token:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
