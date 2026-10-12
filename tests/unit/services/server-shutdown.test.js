const http = require('http');
const { attachServerShutdownHandling, drainProxyServers } = require('../../../src/server/services/server-shutdown');

it('drains multiple proxy responses together before process shutdown completes', async () => {
  const responses = [];
  const servers = [0, 1].map(() => attachServerShutdownHandling(http.createServer((_req, res) => {
    res.write('first');
    responses.push(res);
  })));
  const clients = [];
  try {
    const completions = [];
    for (const server of servers) {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      completions.push(new Promise((resolve, reject) => {
        const client = http.get(`http://127.0.0.1:${server.address().port}`, res => {
          res.resume();
          res.once('end', resolve);
          res.once('error', reject);
        });
        clients.push(client);
        client.once('error', reject);
      }));
    }
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    let drained = false;
    const shutdown = drainProxyServers({ forceAfterMs: 2000 }).then(() => { drained = true; });
    responses[0].end('done');
    await completions[0];
    expect(drained).toBe(false);
    responses[1].end('done');
    await Promise.all([...completions, shutdown]);
    expect(drained).toBe(true);
    expect(servers.every(server => !server.listening)).toBe(true);
  } finally {
    clients.forEach(client => client.destroy());
    servers.forEach(server => { server.closeAllConnections(); server.close(); });
  }
});
