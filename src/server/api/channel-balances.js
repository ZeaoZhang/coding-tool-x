const express = require('express');
const router = express.Router();
const { createSameOriginGuard } = require('../services/network-access');
const {
  getChannelBalances,
  refreshChannelBalance
} = require('../services/channel-balance');

router.use(createSameOriginGuard({
  message: '禁止跨站访问渠道余额接口'
}));

router.get('/', async (req, res) => {
  try {
    const result = await getChannelBalances(req.query.source);
    res.json(result);
  } catch (error) {
    const status = error?.message === 'Invalid channel balance source' ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'Invalid source' : 'Failed to load channel balances' });
  }
});

router.post('/:source/:id/refresh', async (req, res) => {
  try {
    const result = await refreshChannelBalance(req.params.source, req.params.id);
    res.json(result);
  } catch (error) {
    if (error?.statusCode === 404) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    const status = error?.message === 'Invalid channel balance source' ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'Invalid source' : 'Failed to refresh channel balance' });
  }
});

module.exports = router;
