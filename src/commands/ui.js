const chalk = require('chalk');
const { startServer } = require('../server');

async function handleUI() {
  console.clear();
  console.log(chalk.cyan.bold('\n🌐 启动 CC-Tool Web UI...\n'));

  try {
    startServer(9999);

    // Keep the process running
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n\n👋 服务器已停止\n'));
      process.exit(0);
    });

    console.log(chalk.gray('按 Ctrl+C 停止服务器'));

  } catch (error) {
    console.error(chalk.red('启动服务器失败:'), error.message);
    process.exit(1);
  }
}

module.exports = { handleUI };
