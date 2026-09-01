const platformRuntime = require('../../platforms/runtime');
const { isChannelAvailable, getChannelHealthStatus, setOnChannelFrozen, setChannelListProvider } = require('./channel-health');

function readChannels(source = 'claude') {
  try {
    const driver = platformRuntime.getPlatformRuntime().getDriver(source, 'channels');
    if (!driver || (typeof driver.status === 'string' && driver.status !== 'ok')) {
      return [];
    }
    const list = typeof driver.list === 'function'
      ? driver.list.bind(driver)
      : typeof driver.getChannels === 'function'
        ? driver.getChannels.bind(driver)
        : null;
    if (!list) return [];
    const result = list();
    const payload = result?.status === 'ok' ? result.data : result;
    return Array.isArray(payload) ? payload : (Array.isArray(payload?.channels) ? payload.channels : []);
  } catch (_) {
    return [];
  }
}

function createState() {
  return {
    channels: [],
    inflight: new Map(),
    sessionBindings: new Map(),
    queue: []
  };
}

const schedulerStates = {
  claude: createState(),
  codex: createState(),
  gemini: createState(),
  opencode: createState(),
  omp: createState()
};

function getState(source = 'claude') {
  if (!schedulerStates[source]) {
    schedulerStates[source] = createState();
  }
  return schedulerStates[source];
}

const WAIT_TIMEOUT_MS = 15000;

/**
 * 解绑指定渠道的所有会话
 */
function unbindChannelSessions(source, channelId) {
  const state = getState(source);
  let unbindCount = 0;
  for (const [sessionId, boundChannelId] of state.sessionBindings) {
    if (boundChannelId === channelId) {
      state.sessionBindings.delete(sessionId);
      unbindCount++;
    }
  }
  if (unbindCount > 0) {
    console.log(`[ChannelScheduler] Unbound ${unbindCount} sessions from ${source} channel ${channelId}`);
  }
}

// 注册冻结回调，当渠道被冻结时解绑其会话
setOnChannelFrozen(unbindChannelSessions);
setChannelListProvider((source = 'claude') => readChannels(source));

function refreshChannels(source = 'claude') {
  const state = getState(source);
  const raw = readChannels(source);

  // 每次直接读取最新配置，不做缓存
  state.channels = raw
    .filter(ch => ch.enabled !== false)
    .map(ch => ({
      // 保留渠道完整字段，避免 proxy 等运行时配置在调度层丢失
      ...ch,
      weight: Math.max(1, Number(ch.weight) || 1),
      maxConcurrency: ch.maxConcurrency ?? null,
      modelConfig: ch.modelConfig || null,
      modelRedirects: ch.modelRedirects || []
    }));

  state.channels.forEach(ch => {
    if (!state.inflight.has(ch.id)) {
      state.inflight.set(ch.id, 0);
    }
  });
}

function matchesAllocationRequest(channel, options = {}) {
  const candidateIds = Array.isArray(options.candidateIds)
    ? new Set(options.candidateIds.filter(Boolean))
    : null;
  const excludedIds = new Set(
    Array.isArray(options.excludeChannelIds) ? options.excludeChannelIds.filter(Boolean) : []
  );
  if (candidateIds && !candidateIds.has(channel.id)) return false;
  if (excludedIds.has(channel.id)) return false;
  if (options.routingGroup && String(channel.routingGroup || channel.id) !== String(options.routingGroup)) {
    return false;
  }
  if (options.providerKey && String(channel.providerKey || channel.provider || '') !== String(options.providerKey)) {
    return false;
  }
  if (
    options.providerApi
    && String(channel.providerApi || channel.api || channel.wireApi || 'openai-completions') !== String(options.providerApi)
  ) {
    return false;
  }
  return true;
}

function getAvailableChannels(source = 'claude', options = {}) {
  refreshChannels(source);
  const state = getState(source);
  return state.channels.filter(ch => {
    if (!matchesAllocationRequest(ch, options)) return false;
    if (!isChannelAvailable(ch.id, source)) {
      return false;
    }
    if (ch.maxConcurrency === null) {
      return true;
    }
    return (state.inflight.get(ch.id) || 0) < ch.maxConcurrency;
  });
}

function pickWeightedChannel(channels) {
  if (!channels.length) return null;
  const totalWeight = channels.reduce((sum, ch) => sum + ch.weight, 0);
  let threshold = Math.random() * totalWeight;
  for (const channel of channels) {
    threshold -= channel.weight;
    if (threshold <= 0) {
      return channel;
    }
  }
  return channels[channels.length - 1];
}

function tryAllocate(source = 'claude', options = {}) {
  const state = getState(source);
  const sessionId = options.sessionId;
  const enableSessionBinding = options.enableSessionBinding !== false; // 默认开启
  const available = getAvailableChannels(source, options);
  if (!available.length) {
    return null;
  }

  // 如果启用会话绑定且已有绑定，优先使用绑定渠道
  if (enableSessionBinding && sessionId && state.sessionBindings.has(sessionId)) {
    const boundId = state.sessionBindings.get(sessionId);
    const boundChannel = available.find(ch => ch.id === boundId);
    if (boundChannel) {
      state.inflight.set(boundChannel.id, (state.inflight.get(boundChannel.id) || 0) + 1);
      return boundChannel;
    }
  }

  // 选择新的渠道（加权随机）
  const chosen = pickWeightedChannel(available);
  if (!chosen) return null;

  // 只有在启用会话绑定时才记录绑定
  if (enableSessionBinding && sessionId) {
    state.sessionBindings.set(sessionId, chosen.id);
  }
  state.inflight.set(chosen.id, (state.inflight.get(chosen.id) || 0) + 1);
  return chosen;
}

function drainQueue(source = 'claude') {
  const state = getState(source);
  if (!state.queue.length) return;

  for (let i = 0; i < state.queue.length; i++) {
    const entry = state.queue[i];
    const channel = tryAllocate(source, entry.options);
    if (channel) {
      clearTimeout(entry.timer);
      state.queue.splice(i, 1);
      entry.cleanup?.();
      entry.resolve(channel);
      return drainQueue(source);
    }
  }
}

function allocateChannel(options = {}) {
  const source = options.source || 'claude';
  const state = getState(source);
  if (options.signal?.aborted) {
    return Promise.reject(Object.assign(new Error('Channel allocation aborted'), { name: 'AbortError' }));
  }
  const channel = tryAllocate(source, options);
  if (channel) {
    return Promise.resolve(channel);
  }

  if (!state.channels.length) {
    return Promise.reject(new Error('暂无可用渠道，请先添加并启用至少一个渠道'));
  }
  if (!state.channels.some(ch => matchesAllocationRequest(ch, options))) {
    return Promise.reject(new Error('没有匹配当前请求的可用渠道'));
  }

  // 检查是否所有渠道都被冻结
  const allFrozen = state.channels.every(ch => !isChannelAvailable(ch.id, source));

  return new Promise((resolve, reject) => {
    let entry;
    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
    };
    const removeEntry = () => {
      const index = state.queue.indexOf(entry);
      if (index !== -1) state.queue.splice(index, 1);
    };
    const onAbort = () => {
      clearTimeout(timer);
      removeEntry();
      cleanup();
      reject(Object.assign(new Error('Channel allocation aborted'), { name: 'AbortError' }));
    };
    const timer = setTimeout(() => {
      removeEntry();
      cleanup();
      // 根据实际情况返回更准确的错误信息
      if (allFrozen) {
        reject(new Error('所有渠道均已被冻结，请等待健康检查恢复或手动重置'));
      } else {
        reject(new Error('所有渠道均已达到并发上限，请稍后重试'));
      }
    }, WAIT_TIMEOUT_MS);

    entry = {
      source,
      options,
      resolve,
      reject,
      timer,
      cleanup
    };
    state.queue.push(entry);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
    }
  });
}

function releaseChannel(channelId, source = 'claude') {
  const state = getState(source);
  if (!channelId) return;
  if (!state.inflight.has(channelId)) {
    state.inflight.set(channelId, 0);
  }
  const current = state.inflight.get(channelId) || 0;
  state.inflight.set(channelId, current > 0 ? current - 1 : 0);
  drainQueue(source);
}

function getSchedulerState(source = 'claude') {
  refreshChannels(source);
  const state = getState(source);
  return {
    channels: state.channels.map(ch => {
      const healthStatus = getChannelHealthStatus(ch.id, source);
      return {
        id: ch.id,
        name: ch.name,
        weight: ch.weight,
        maxConcurrency: ch.maxConcurrency,
        inflight: state.inflight.get(ch.id) || 0,
        health: healthStatus
      };
    }),
    pending: state.queue.length
  };
}

module.exports = {
  allocateChannel,
  releaseChannel,
  getSchedulerState
};
