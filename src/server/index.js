const express = require('express');
const path = require('path');
const chalk = require('chalk');
const { loadConfig } = require('../config/loader');
const { startWebSocketServer: attachWebSocketServer } = require('./websocket-server');

function startServer(port) {
  const config = loadConfig();
  // 使用配置的端口，如果没有传入参数
  if (!port) {
    port = config.ports?.webUI || 10099;
  }
  const app = express();

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
  app.use('/api/proxy', require('./api/proxy'));

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
    console.log(`   http://localhost:${port}`);

    // 附加 WebSocket 服务器到同一个端口
    attachWebSocketServer(server);
    console.log(`   ws://localhost:${port}/ws\n`);
  });

  // 监听端口占用错误
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(chalk.red(`\n❌ 端口 ${port} 已被占用`));
      console.error(chalk.yellow('\n💡 解决方案:'));
      console.error(chalk.gray('   1. 运行 cc 命令，选择"配置端口"修改端口'));
      console.error(chalk.gray(`   2. 或关闭占用端口 ${port} 的程序\n`));
      process.exit(1);
    }
  });

  return server;
}

module.exports = { startServer };
