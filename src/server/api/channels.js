const express = require('express');
const router = express.Router();
const {
  getAllChannels,
  getCurrentChannel,
  createChannel,
  updateChannel,
  deleteChannel,
  activateChannel
} = require('../services/channels');
const { broadcastLog, broadcastProxyState } = require('../websocket-server');

// GET /api/channels - Get all channels
router.get('/', (req, res) => {
  try {
    const channels = getAllChannels();
    res.json({ channels });
  } catch (error) {
    console.error('Error fetching channels:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/channels/current - Get current active channel
router.get('/current', (req, res) => {
  try {
    const channel = getCurrentChannel();
    res.json({ channel });
  } catch (error) {
    console.error('Error fetching current channel:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/channels - Create new channel
router.post('/', (req, res) => {
  try {
    const { name, baseUrl, apiKey, websiteUrl } = req.body;

    if (!name || !baseUrl || !apiKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const channel = createChannel(name, baseUrl, apiKey, websiteUrl);
    res.json({ channel });
  } catch (error) {
    console.error('Error creating channel:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/channels/:id - Update channel
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const channel = updateChannel(id, updates);
    res.json({ channel });
  } catch (error) {
    console.error('Error updating channel:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/channels/:id - Delete channel
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = deleteChannel(id);
    res.json(result);
  } catch (error) {
    console.error('Error deleting channel:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/activate', async (req, res) => {
  try {
    const { id } = req.params;
    const channel = activateChannel(id);

    const { getProxyStatus, stopProxyServer, startProxyServer } = require('../proxy-server');
    let proxyStatus = getProxyStatus();

    if (proxyStatus && proxyStatus.running) {
      console.log(`Proxy is running, restarting to switch to channel: ${channel.name}`);
      await stopProxyServer({ clearStartTime: false });
      const { setProxyConfig } = require('../services/settings-manager');
      const proxyResult = await startProxyServer({ preserveStartTime: true });

      if (proxyResult.success) {
        setProxyConfig(proxyResult.port);
        console.log(`Proxy restarted successfully on port ${proxyResult.port}`);
      }

      proxyStatus = getProxyStatus();
    }

    broadcastLog({
      type: 'action',
      action: 'switch_channel',
      message: `切换渠道至 ${channel.name}`,
      channelName: channel.name,
      timestamp: Date.now(),
      source: 'claude'
    });

    const channels = getAllChannels();
    const activeChannel = channels.find(ch => ch.isActive);
    broadcastProxyState('claude', proxyStatus, activeChannel, channels);

    res.json({ channel });
  } catch (error) {
    console.error('Error activating channel:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
