const express = require('express');
const path = require('path');
const { loadConfig } = require('../config/loader');

function startServer(port = 9999) {
  const app = express();
  const config = loadConfig();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CORS for development
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // API Routes
  app.use('/api/projects', require('./api/projects')(config));
  app.use('/api/sessions', require('./api/sessions')(config));
  app.use('/api/aliases', require('./api/aliases')());
  app.use('/api/channels', require('./api/channels'));

  // Serve static files in production
  const distPath = path.join(__dirname, '../../dist/web');
  if (require('fs').existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start server
  const server = app.listen(port, () => {
    console.log(`\n🚀 CC-Tool Web UI running at:`);
    console.log(`   http://localhost:${port}\n`);
  });

  return server;
}

module.exports = { startServer };
