// 渠道健康检查和智能切换模块

const healthConfig = {
  // 故障检测
  failureThreshold: 3,           // 连续失败3次触发冻结

  // 冻结时间配置
  initialFreezeTime: 60 * 1000,  // 初始冻结1分钟
  maxFreezeTime: 30 * 60 * 1000, // 最大冻结30分钟
  freezeMultiplier: 2,           // 冻结时间倍增

  // 健康检测
  healthCheckWindow: 5,          // 健康检测需要连续5次成功
};

// 渠道健康状态
const channelHealth = new Map(); // channelId → health info

/**
 * 初始化渠道健康信息
 */
function initChannelHealth(channelId) {
  if (!channelHealth.has(channelId)) {
    channelHealth.set(channelId, {
      status: 'healthy',           // healthy, frozen, checking
      consecutiveFailures: 0,      // 连续失败次数
      consecutiveSuccesses: 0,     // 连续成功次数
      totalFailures: 0,           // 总失败次数
      totalSuccesses: 0,          // 总成功次数
      freezeUntil: 0,             // 冻结到期时间
      nextFreezeTime: healthConfig.initialFreezeTime,
      lastCheckTime: null,        // 最后检查时间
    });
  }
  return channelHealth.get(channelId);
}

/**
 * 记录成功请求
 */
function recordSuccess(channelId) {
  const health = initChannelHealth(channelId);
  const now = Date.now();

  health.totalSuccesses++;
  health.consecutiveSuccesses++;
  health.consecutiveFailures = 0;
  health.lastCheckTime = now;

  // 如果在检测中状态，检查是否可以恢复
  if (health.status === 'checking') {
    if (health.consecutiveSuccesses >= healthConfig.healthCheckWindow) {
      // 恢复健康状态
      health.status = 'healthy';
      health.nextFreezeTime = healthConfig.initialFreezeTime; // 重置冻结时间
      console.log(`[ChannelHealth] Channel ${channelId} recovered and marked as healthy`);
    }
  }
}

/**
 * 记录失败请求
 */
function recordFailure(channelId, error) {
  const health = initChannelHealth(channelId);
  const now = Date.now();

  health.totalFailures++;
  health.consecutiveFailures++;
  health.consecutiveSuccesses = 0;
  health.lastCheckTime = now;

  // 如果当前是健康状态，检查是否需要冻结
  if (health.status === 'healthy') {
    if (health.consecutiveFailures >= healthConfig.failureThreshold) {
      // 触发冻结
      health.status = 'frozen';
      health.freezeUntil = now + health.nextFreezeTime;

      const freezeMinutes = Math.round(health.nextFreezeTime / 60000);
      console.warn(`[ChannelHealth] Channel ${channelId} frozen due to ${health.consecutiveFailures} consecutive failures. Frozen for ${freezeMinutes} minutes`);

      // 更新下次冻结时间（翻倍，不超过最大值）
      health.nextFreezeTime = Math.min(
        health.nextFreezeTime * healthConfig.freezeMultiplier,
        healthConfig.maxFreezeTime
      );
    }
  }
}

/**
 * 检查渠道是否可用
 */
function isChannelAvailable(channelId) {
  const health = channelHealth.get(channelId);
  if (!health) return true;

  const now = Date.now();

  switch (health.status) {
    case 'healthy':
      return true;

    case 'frozen':
      // 检查冻结时间是否到期
      if (now >= health.freezeUntil) {
        // 进入检测状态
        health.status = 'checking';
        health.consecutiveSuccesses = 0;
        console.log(`[ChannelHealth] Channel ${channelId} freeze expired, entering checking mode`);
        return true; // 允许一个请求用于健康检测
      }
      return false;

    case 'checking':
      // 在检测中的渠道可用，等待成功记录
      return true;

    default:
      return true;
  }
}

/**
 * 从渠道列表中过滤出可用的渠道
 */
function getAvailableChannels(channels) {
  return channels.filter(channel => isChannelAvailable(channel.id));
}

/**
 * 获取渠道健康状态（用于前端显示）
 */
function getChannelHealthStatus(channelId) {
  const health = channelHealth.get(channelId);
  if (!health) {
    return {
      status: 'healthy',
      statusText: '健康',
      statusColor: '#18a058',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      freezeUntil: null,
      freezeRemaining: 0,
    };
  }

  const now = Date.now();
  const freezeRemaining = Math.max(0, health.freezeUntil - now);

  const statusMap = {
    'healthy': { text: '健康', color: '#18a058' },
    'frozen': { text: '冻结', color: '#d03050' },
    'checking': { text: '检测中', color: '#f0a020' }
  };

  return {
    status: health.status,
    statusText: statusMap[health.status]?.text || '未知',
    statusColor: statusMap[health.status]?.color || '#909399',
    consecutiveFailures: health.consecutiveFailures,
    consecutiveSuccesses: health.consecutiveSuccesses,
    totalFailures: health.totalFailures,
    totalSuccesses: health.totalSuccesses,
    freezeUntil: health.freezeUntil,
    freezeRemaining: Math.ceil(freezeRemaining / 1000), // 剩余秒数
  };
}

/**
 * 获取所有渠道的健康状态
 */
function getAllChannelHealthStatus() {
  const result = {};
  for (const [channelId] of channelHealth) {
    result[channelId] = getChannelHealthStatus(channelId);
  }
  return result;
}

/**
 * 手动重置渠道健康状态（用于测试或管理员操作）
 */
function resetChannelHealth(channelId) {
  const health = initChannelHealth(channelId);
  health.status = 'healthy';
  health.consecutiveFailures = 0;
  health.consecutiveSuccesses = 0;
  health.freezeUntil = 0;
  health.nextFreezeTime = healthConfig.initialFreezeTime;
  console.log(`[ChannelHealth] Channel ${channelId} health status reset`);
}

module.exports = {
  recordSuccess,
  recordFailure,
  isChannelAvailable,
  getAvailableChannels,
  getChannelHealthStatus,
  getAllChannelHealthStatus,
  resetChannelHealth,
  healthConfig,
};