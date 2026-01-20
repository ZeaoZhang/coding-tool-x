/**
 * Enhanced Cache Manager
 * 
 * 提供全局缓存管理,支持TTL、自动清理、LRU策略
 */

class CacheManager {
    constructor(options = {}) {
        this.caches = new Map();
        this.ttls = new Map();
        this.accessTimes = new Map();
        this.maxSize = options.maxSize || 1000; // 最大缓存条目数
        this.defaultTTL = options.defaultTTL || 300000; // 默认5分钟
        this.cleanupInterval = options.cleanupInterval || 60000; // 1分钟清理一次

        // 启动自动清理
        this.startCleanup();
    }

    /**
     * 设置缓存
     * @param {string} key - 缓存键
     * @param {any} value - 缓存值
     * @param {number} ttl - 过期时间(毫秒),默认使用defaultTTL
     */
    set(key, value, ttl) {
        const expiryTime = Date.now() + (ttl || this.defaultTTL);

        // 如果缓存已满,清理最少使用的条目
        if (this.caches.size >= this.maxSize) {
            this.evictLRU();
        }

        this.caches.set(key, value);
        this.ttls.set(key, expiryTime);
        this.accessTimes.set(key, Date.now());
    }

    /**
     * 获取缓存
     * @param {string} key - 缓存键
     * @returns {any|null} 缓存值,不存在或过期返回null
     */
    get(key) {
        if (!this.caches.has(key)) {
            return null;
        }

        // 检查是否过期
        if (Date.now() > this.ttls.get(key)) {
            this.delete(key);
            return null;
        }

        // 更新访问时间(LRU)
        this.accessTimes.set(key, Date.now());
        return this.caches.get(key);
    }

    /**
     * 删除缓存
     * @param {string} key - 缓存键
     */
    delete(key) {
        this.caches.delete(key);
        this.ttls.delete(key);
        this.accessTimes.delete(key);
    }

    /**
     * 清空所有缓存
     */
    clear() {
        this.caches.clear();
        this.ttls.clear();
        this.accessTimes.clear();
    }

    /**
     * 检查缓存是否存在且有效
     * @param {string} key - 缓存键
     * @returns {boolean}
     */
    has(key) {
        return this.get(key) !== null;
    }

    /**
     * 获取或设置缓存(如果不存在则调用工厂函数)
     * @param {string} key - 缓存键
     * @param {Function} factory - 工厂函数,返回值或Promise
     * @param {number} ttl - 过期时间
     * @returns {any|Promise<any>}
     */
    async getOrSet(key, factory, ttl) {
        const cached = this.get(key);
        if (cached !== null) {
            return cached;
        }

        const value = await factory();
        this.set(key, value, ttl);
        return value;
    }

    /**
     * LRU驱逐策略:移除最久未使用的条目
     */
    evictLRU() {
        let oldestKey = null;
        let oldestTime = Infinity;

        for (const [key, accessTime] of this.accessTimes) {
            if (accessTime < oldestTime) {
                oldestTime = accessTime;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.delete(oldestKey);
        }
    }

    /**
     * 启动自动清理过期缓存
     */
    startCleanup() {
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            const expiredKeys = [];

            for (const [key, expiryTime] of this.ttls) {
                if (now > expiryTime) {
                    expiredKeys.push(key);
                }
            }

            expiredKeys.forEach(key => this.delete(key));

            if (expiredKeys.length > 0) {
                console.log(`[CacheManager] Cleaned up ${expiredKeys.length} expired entries`);
            }
        }, this.cleanupInterval);

        // 确保Node.js进程退出时清理定时器
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    /**
     * 停止自动清理
     */
    stopCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * 获取缓存统计信息
     * @returns {object}
     */
    getStats() {
        return {
            size: this.caches.size,
            maxSize: this.maxSize,
            keys: Array.from(this.caches.keys())
        };
    }
}

// 创建全局缓存实例
const globalCache = new CacheManager({
    maxSize: 1000,
    defaultTTL: 300000, // 5分钟
    cleanupInterval: 60000 // 1分钟
});

// 预定义的缓存键前缀
const CacheKeys = {
    PROJECTS: 'projects:',
    SESSIONS: 'sessions:',
    SKILLS: 'skills:',
    CONFIG_TEMPLATES: 'config-templates:',
    REPOS: 'repos:',
    HAS_MESSAGES: 'has-messages:'
};

module.exports = {
    CacheManager,
    globalCache,
    CacheKeys
};
