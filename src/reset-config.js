const fs = require('fs');
const path = require('path');
const os = require('os');

// 恢复配置到默认状态
async function resetConfig() {
  console.log('\n开始恢复默认配置...\n');

  try {
    // 1. 尝试停止代理服务器（如果正在运行）
    try {
      const { stopProxyServer, getProxyStatus } = require('./server/proxy-server');
      const status = getProxyStatus();

      if (status.running) {
        console.log('检测到代理服务正在运行，正在停止...');
        await stopProxyServer();
        console.log('✅ 代理服务已停止');
      }
    } catch (err) {
      // 代理服务未运行或模块加载失败，继续处理本地文件
      console.log('代理服务未运行，继续恢复配置...');
    }

    // 2. 检查并恢复 settings.json
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const backupPath = path.join(os.homedir(), '.claude', 'settings.json.cc-tool-backup');

    if (fs.existsSync(backupPath)) {
      console.log('发现备份文件，正在恢复...');
      const backupContent = fs.readFileSync(backupPath, 'utf8');
      fs.writeFileSync(settingsPath, backupContent, 'utf8');
      fs.unlinkSync(backupPath);
      console.log('✅ 已从备份恢复 settings.json');
    } else if (fs.existsSync(settingsPath)) {
      // 检查是否是代理配置
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const baseUrl = settings?.env?.ANTHROPIC_BASE_URL || '';
      const apiKey = settings?.env?.ANTHROPIC_API_KEY || '';

      if (baseUrl.includes('127.0.0.1') || apiKey === 'PROXY_KEY') {
        console.log('检测到代理配置，尝试恢复到正常渠道...');

        // 读取激活的渠道
        const activeChannelPath = path.join(os.homedir(), '.claude', 'cc-tool', 'active-channel.json');
        if (fs.existsSync(activeChannelPath)) {
          const activeChannelData = JSON.parse(fs.readFileSync(activeChannelPath, 'utf8'));
          const channelsPath = path.join(os.homedir(), '.claude', 'cc-tool', 'channels.json');

          if (fs.existsSync(channelsPath)) {
            const channelsData = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));
            const activeChannel = channelsData.channels.find(ch => ch.id === activeChannelData.activeChannelId);

            if (activeChannel) {
              // 恢复到激活的渠道
              if (!settings.env) settings.env = {};
              settings.env.ANTHROPIC_BASE_URL = activeChannel.baseUrl;
              settings.env.ANTHROPIC_API_KEY = activeChannel.apiKey;
              settings.apiKeyHelper = `echo '${activeChannel.apiKey}'`;

              fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
              console.log(`✅ 已恢复到渠道: ${activeChannel.name}`);

              // 清理 active-channel.json
              fs.unlinkSync(activeChannelPath);
            } else {
              console.log('⚠️  无法找到激活的渠道，请手动配置 Claude Code');
            }
          }
        } else {
          console.log('⚠️  未找到激活渠道信息，但已清除代理配置');
          console.log('请手动配置 Claude Code 或通过 Web UI 切换渠道');
        }
      } else {
        console.log('✅ 配置文件正常，无需恢复');
      }
    } else {
      console.log('⚠️  未找到 settings.json 文件');
    }

    console.log('\n✅ 配置恢复完成！\n');
  } catch (err) {
    console.error('❌ 恢复配置时出错:', err.message);
    console.log('\n您可以尝试手动恢复：');
    console.log('1. 检查 ~/.claude/settings.json 文件');
    console.log('2. 如果有 settings.json.cc-tool-backup 备份文件，手动恢复');
    console.log('3. 或者通过 Web UI 重新配置渠道\n');
    process.exit(1);
  }
}

module.exports = { resetConfig };
