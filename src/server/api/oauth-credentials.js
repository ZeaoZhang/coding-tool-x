const express = require('express');
const router = express.Router();
const {
  SUPPORTED_TOOLS,
  getAllToolSummaries,
  getToolSummary,
  importCredential,
  syncLocalCredential,
  setDefaultCredential,
  deleteCredential,
  applyStoredCredential,
  clearNativeOAuthState,
  fetchCredentialUsage
} = require('../services/oauth-credentials-service');

function assertTool(tool) {
  if (!SUPPORTED_TOOLS.includes(tool)) {
    const error = new Error(`Unsupported OAuth tool: ${tool}`);
    error.statusCode = 404;
    throw error;
  }
}

function broadcastToolProxyState(tool) {
  const { broadcastProxyState } = require('../websocket-server');

  if (tool === 'claude') {
    const { getProxyStatus } = require('../proxy-server');
    const { getAllChannels } = require('../services/channels');
    const channels = getAllChannels();
    const activeChannel = channels.find(ch => ch.enabled !== false) || null;
    broadcastProxyState('claude', getProxyStatus(), activeChannel, channels);
    return;
  }

  if (tool === 'codex') {
    const { getCodexProxyStatus } = require('../codex-proxy-server');
    const { getChannels } = require('../services/codex-channels');
    const channels = getChannels().channels || [];
    const activeChannel = channels.find(ch => ch.enabled !== false) || null;
    broadcastProxyState('codex', getCodexProxyStatus(), activeChannel, channels);
    return;
  }

  if (tool === 'gemini') {
    const { getGeminiProxyStatus } = require('../gemini-proxy-server');
    const { getChannels } = require('../services/gemini-channels');
    const channels = getChannels().channels || [];
    const activeChannel = channels.find(ch => ch.enabled !== false) || null;
    broadcastProxyState('gemini', getGeminiProxyStatus(), activeChannel, channels);
    return;
  }

  if (tool === 'opencode') {
    const { getOpenCodeProxyStatus } = require('../opencode-proxy-server');
    const { getChannels } = require('../services/opencode-channels');
    const channels = getChannels().channels || [];
    const activeChannel = channels.find(ch => ch.enabled !== false) || null;
    broadcastProxyState('opencode', getOpenCodeProxyStatus(), activeChannel, channels);
  }
}

router.get('/', (req, res) => {
  try {
    res.json({ tools: getAllToolSummaries() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:tool', (req, res) => {
  try {
    const { tool } = req.params;
    assertTool(tool);
    res.json({ tool, summary: getToolSummary(tool) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/:tool/import', (req, res) => {
  try {
    const { tool } = req.params;
    assertTool(tool);
    const credential = importCredential(tool, req.body || {});
    res.json({ tool, credential, summary: getToolSummary(tool) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/:tool/sync-local', (req, res) => {
  try {
    const { tool } = req.params;
    assertTool(tool);
    const result = syncLocalCredential(tool);
    res.json({ tool, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/:tool/:credentialId/default', (req, res) => {
  try {
    const { tool, credentialId } = req.params;
    assertTool(tool);
    const summary = setDefaultCredential(tool, credentialId);
    res.json({ tool, summary });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/:tool/:credentialId/apply', async (req, res) => {
  try {
    const { tool, credentialId } = req.params;
    assertTool(tool);
    const result = await applyStoredCredential(tool, credentialId);
    broadcastToolProxyState(tool);
    res.json({
      tool,
      ...result,
      message: `${tool} 已切换到 OAuth 凭证控制`
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.post('/:tool/clear-native', (req, res) => {
  try {
    const { tool } = req.params;
    assertTool(tool);
    const nativeState = clearNativeOAuthState(tool);
    res.json({ tool, nativeState });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.get('/:tool/:credentialId/usage', async (req, res) => {
  try {
    const { tool, credentialId } = req.params;
    assertTool(tool);
    const result = await fetchCredentialUsage(tool, credentialId);
    res.json({ tool, credentialId, usage: result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.delete('/:tool/:credentialId', (req, res) => {
  try {
    const { tool, credentialId } = req.params;
    assertTool(tool);
    const summary = deleteCredential(tool, credentialId);
    res.json({ tool, summary });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

module.exports = router;
