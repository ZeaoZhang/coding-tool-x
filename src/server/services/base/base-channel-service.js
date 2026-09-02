/**
 * BaseChannelService - 四平台渠道管理的公共基类
 *
 * 为各平台 Driver 实现提供共享 CRUD、启用/禁用、单渠道强制等基础能力。
 *
 * 子类通过覆写钩子方法实现平台差异化行为。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeGatewaySourceType, normalizeNumber } = require('./proxy-utils');
const { resolveChannelWebsiteUrl } = require('../../../config/channel-preset-websites');

function clearChannelBalanceCache(platform, channel) {
  try {
    require('../channel-balance').clearChannelBalanceCache(platform, channel);
  } catch (_) {
    // Balance cache invalidation is an optimization; channel updates must still succeed.
  }
}

function invalidateDashboardSource(platform) {
  try {
    const { invalidateDashboardSourceSnapshot } = require('../snapshot-cache');
    invalidateDashboardSourceSnapshot(platform);
  } catch (_) {
    // Dashboard snapshots are an optimization; channel mutations still succeed.
  }
}

class BaseChannelService {
  /**
   * @param {object} config
   * @param {string} config.platform - 'claude'|'codex'|'gemini'|'opencode'
   * @param {string} config.channelsFilePath - 渠道数据文件路径
   * @param {string} [config.defaultGatewaySource] - 默认网关来源类型
   * @param {Function} [config.isProxyRunning] - 返回代理是否运行中
   */
  constructor(config) {
    this.platform = config.platform;
    this.channelsFilePath = config.channelsFilePath;
    this.defaultGatewaySource = config.defaultGatewaySource || config.platform;
    this._isProxyRunning = config.isProxyRunning || (() => false);
    this._channelCache = { value: null, mtimeMs: 0, invalidated: true };
  }


  // ── 文件 I/O ──

  _ensureDir() {
    const dir = path.dirname(this.channelsFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _channelFileMtime() {
    try {
      return fs.statSync(this.channelsFilePath).mtimeMs;
    } catch (_) {
      return 0;
    }
  }

  _cloneChannelData(data) {
    return {
      channels: Array.isArray(data?.channels)
        ? data.channels.map(channel => ({ ...channel }))
        : []
    };
  }

  loadChannels() {
    this._ensureDir();
    const mtimeMs = this._channelFileMtime();
    if (!this._channelCache.invalidated
      && this._channelCache.mtimeMs === mtimeMs
      && this._channelCache.value) {
      return this._cloneChannelData(this._channelCache.value);
    }

    let value = { channels: [] };
    try {
      if (fs.existsSync(this.channelsFilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.channelsFilePath, 'utf8'));
        const channels = Array.isArray(raw?.channels) ? raw.channels : [];
        value = { channels: channels.map(channel => this._applyDefaults(channel)) };
      }
    } catch (err) {
      console.error(`[${this.platform}-channels] Error loading channels:`, err.message);
    }
    this._channelCache = { value, mtimeMs: this._channelFileMtime(), invalidated: false };
    return this._cloneChannelData(value);
  }

  saveChannels(data) {
    this._ensureDir();
    fs.writeFileSync(this.channelsFilePath, JSON.stringify(data, null, 2), 'utf8');
    const value = {
      channels: Array.isArray(data?.channels)
        ? data.channels.map(channel => this._applyDefaults(channel))
        : []
    };
    this._channelCache = { value, mtimeMs: this._channelFileMtime(), invalidated: false };
    invalidateDashboardSource(this.platform);
  }

  invalidate() {
    this._channelCache.invalidated = true;
  }

  // ── 查询 ──

  getChannels() {
    return this.loadChannels();
  }

  getEnabledChannels() {
    const data = this.loadChannels();
    return data.channels.filter(ch => ch.enabled !== false);
  }

  // ── CRUD ──

  createChannel(fields) {
    const data = this.loadChannels();

    // 子类可覆写的唯一性校验
    this._validateUniqueness(data.channels, fields);

    const channel = this._applyDefaults({
      id: this._generateId(),
      ...fields,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    data.channels.push(channel);

    // 单渠道强制：代理未运行时只允许一个渠道启用
    if (channel.enabled && !this._isProxyRunning()) {
      this._enforceSingleChannel(data.channels, data.channels.length - 1);
    }

    this.saveChannels(data);
    this._onAfterCreate(channel, data.channels);
    return channel;
  }
  updateChannel(channelId, updates) {
    const data = this.loadChannels();
    const index = data.channels.findIndex(ch => ch.id === channelId);
    if (index === -1) {
      throw new Error('Channel not found');
    }

    const oldChannel = data.channels[index];

    // 子类可覆写的唯一性校验（排除自身）
    this._validateUniqueness(data.channels, updates, channelId);

    const nextChannel = this._applyDefaults({
      ...oldChannel,
      ...updates,
      id: channelId,
      updatedAt: Date.now(),
    });
    data.channels[index] = nextChannel;

    // 单渠道强制
    const isProxyRunning = this._isProxyRunning();
    if (!isProxyRunning && nextChannel.enabled && !oldChannel.enabled) {
      this._enforceSingleChannel(data.channels, index);
    }

    this.saveChannels(data);
    if (oldChannel.enabled === false && nextChannel.enabled !== false) {
      clearChannelBalanceCache(this.platform, nextChannel);
    }
    this._onAfterUpdate(oldChannel, nextChannel, data.channels);
    return nextChannel;
  }

  deleteChannel(channelId) {
    const data = this.loadChannels();
    const index = data.channels.findIndex(ch => ch.id === channelId);
    if (index === -1) {
      throw new Error('Channel not found');
    }

    const removed = data.channels.splice(index, 1)[0];
    this.saveChannels(data);
    this._onAfterDelete(removed, data.channels);
    return { success: true };
  }

  // ── 启用/禁用 ──

  disableAllChannels() {
    const data = this.loadChannels();
    data.channels.forEach(ch => { ch.enabled = false; });
    this.saveChannels(data);
  }

  applyChannelToSettings(channelId) {
    const data = this.loadChannels();
    const channel = data.channels.find(ch => ch.id === channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    // 单渠道模式：只启用目标渠道
    const wasEnabled = channel.enabled !== false;
    data.channels.forEach(ch => {
      ch.enabled = ch.id === channelId;
    });
    this.saveChannels(data);
    if (!wasEnabled) {
      clearChannelBalanceCache(this.platform, channel);
    }
    this._applyToNativeSettings(channel);
    return channel;
  }

  // ── 排序 ──

  saveChannelOrder(order) {
    if (!Array.isArray(order)) return;
    const data = this.loadChannels();
    const channelMap = new Map(data.channels.map(ch => [ch.id, ch]));
    const ordered = [];
    for (const id of order) {
      const ch = channelMap.get(id);
      if (ch) {
        ordered.push(ch);
        channelMap.delete(id);
      }
    }
    // 未在 order 中的渠道追加到末尾
    for (const ch of channelMap.values()) {
      ordered.push(ch);
    }
    data.channels = ordered;
    this.saveChannels(data);
  }

  // ── API Key ──

  getEffectiveApiKey(channel) {
    return channel?.apiKey || null;
  }

  // ── 内部方法 ──

  _generateId() {
    return crypto.randomUUID();
  }

  _enforceSingleChannel(channels, enabledIndex) {
    channels.forEach((ch, i) => {
      if (i !== enabledIndex && ch.enabled) {
        ch.enabled = false;
      }
    });
    const name = channels[enabledIndex]?.name || channels[enabledIndex]?.id;
    console.log(`[${this.platform}] Single-channel mode: enabled "${name}", disabled all others`);
  }

  // ── 子类钩子（默认空实现）──

  /** 应用渠道默认值，子类覆写以添加平台特有字段 */
  _applyDefaults(channel) {
    const normalized = { ...channel };
    if (normalized.enabled === undefined) {
      normalized.enabled = true;
    } else {
      normalized.enabled = !!normalized.enabled;
    }
    normalized.weight = normalizeNumber(normalized.weight, 1, 100);
    // maxConcurrency: null 表示不限制并发；只有用户显式设置正整数时才生效
    const rawConcurrency = normalized.maxConcurrency;
    normalized.maxConcurrency = (rawConcurrency !== null && rawConcurrency !== undefined && Number(rawConcurrency) > 0)
      ? Number(rawConcurrency)
      : null;
    normalized.gatewaySourceType = normalizeGatewaySourceType(
      normalized.gatewaySourceType,
      this.defaultGatewaySource
    );
    normalized.websiteUrl = resolveChannelWebsiteUrl(this.platform, normalized);
    return normalized;
  }

  /** 唯一性校验，子类覆写（如 Codex 的 providerKey、Gemini 的 name） */
  _validateUniqueness(_channels, _fields, _excludeId) {
    // 默认无校验
  }

  /** 创建后钩子 */
  _onAfterCreate(_channel, _allChannels) {}

  /** 更新后钩子 */
  _onAfterUpdate(_oldChannel, _newChannel, _allChannels) {}

  /** 删除后钩子 */
  _onAfterDelete(_channel, _allChannels) {}

  /** 将渠道配置写入平台原生设置文件，子类必须覆写 */
  _applyToNativeSettings(_channel) {
    throw new Error(`${this.platform}: _applyToNativeSettings not implemented`);
  }
}

module.exports = BaseChannelService;
