/**
 * 速度测试服务
 * 用于测试渠道 API 的响应延迟
 * 参考 cc-switch 的实现方式
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// 测试结果缓存
const testResultsCache = new Map();

// 超时配置（毫秒）
const DEFAULT_TIMEOUT = 8000;
const MIN_TIMEOUT = 2000;
const MAX_TIMEOUT = 30000;

/**
 * 规范化超时时间
 */
function sanitizeTimeout(timeout) {
  const ms = timeout || DEFAULT_TIMEOUT;
  return Math.min(Math.max(ms, MIN_TIMEOUT), MAX_TIMEOUT);
}

/**
 * 测试单个渠道的连接速度和 API 功能
 * @param {Object} channel - 渠道配置
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Object>} 测试结果
 */
async function testChannelSpeed(channel, timeout = DEFAULT_TIMEOUT) {
  const sanitizedTimeout = sanitizeTimeout(timeout);

  try {
    if (!channel.baseUrl) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        success: false,
        networkOk: false,
        apiOk: false,
        error: 'URL 不能为空',
        latency: null,
        statusCode: null,
        testedAt: Date.now()
      };
    }

    // 规范化 URL（去除末尾斜杠）
    let testUrl;
    try {
      const url = new URL(channel.baseUrl.trim());
      testUrl = url.toString().replace(/\/+$/, '');
    } catch (urlError) {
      return {
        channelId: channel.id,
        channelName: channel.name,
        success: false,
        networkOk: false,
        apiOk: false,
        error: `URL 无效: ${urlError.message}`,
        latency: null,
        statusCode: null,
        testedAt: Date.now()
      };
    }

    // 第一步：测试网络连接（简单 HEAD/GET 请求）
    const connectResult = await testNetworkConnectivity(testUrl, channel.apiKey, sanitizedTimeout);
    const networkOk = connectResult.statusCode !== null;

    let latency = connectResult.latency;
    let apiOk = false;
    let apiError = null;
    let detailError = null;

    // 第二步：如果网络可达，测试 API 功能（发送测试消息）
    if (networkOk) {
      const apiResult = await testAPIFunctionality(testUrl, channel.apiKey, sanitizedTimeout);
      apiOk = apiResult.success;
      apiError = apiResult.error;
      if (apiResult.latency && apiResult.latency > latency) {
        latency = apiResult.latency;
      }
    } else {
      detailError = connectResult.error;
    }

    // 综合判断成功（网络可达且 API 可用）
    const success = networkOk && apiOk;

    // 缓存结果
    const finalResult = {
      channelId: channel.id,
      channelName: channel.name,
      success,
      networkOk,
      apiOk,
      statusCode: connectResult.statusCode,
      error: success ? null : (apiError || detailError || '测试失败'),
      latency: success ? latency : null,
      testedAt: Date.now()
    };

    testResultsCache.set(channel.id, finalResult);

    return finalResult;
  } catch (error) {
    return {
      channelId: channel.id,
      channelName: channel.name,
      success: false,
      networkOk: false,
      apiOk: false,
      error: error.message || '连接失败',
      latency: null,
      statusCode: null,
      testedAt: Date.now()
    };
  }
}

/**
 * 测试网络连通性（简单 GET 请求）
 */
function testNetworkConnectivity(url, apiKey, timeout) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      timeout,
      headers: {
        'Authorization': `Bearer ${apiKey || ''}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Coding-Tool-SpeedTest/1.0'
      }
    };

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const latency = Date.now() - startTime;
        resolve({
          statusCode: res.statusCode,
          latency,
          error: null
        });
      });
    });

    req.on('error', (error) => {
      let errorMsg;
      if (error.code === 'ECONNREFUSED') {
        errorMsg = '连接被拒绝';
      } else if (error.code === 'ETIMEDOUT') {
        errorMsg = '连接超时';
      } else if (error.code === 'ENOTFOUND') {
        errorMsg = 'DNS 解析失败';
      } else if (error.code === 'ECONNRESET') {
        errorMsg = '连接被重置';
      } else {
        errorMsg = error.message || '连接失败';
      }

      resolve({
        statusCode: null,
        latency: null,
        error: errorMsg
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        statusCode: null,
        latency: null,
        error: '请求超时'
      });
    });

    req.end();
  });
}

/**
 * 测试 API 功能（发送真实的聊天请求）
 * 支持 OpenAI 和 Anthropic 格式
 */
function testAPIFunctionality(baseUrl, apiKey, timeout) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const parsedUrl = new URL(baseUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    // 确定 API 路径和请求格式
    let apiPath;
    let requestBody;
    let headers;

    // 检测是 Anthropic 还是 OpenAI 格式
    const isAnthropic = baseUrl.includes('anthropic') || baseUrl.includes('claude');

    if (isAnthropic) {
      // Anthropic 格式
      apiPath = parsedUrl.pathname.includes('/v1')
        ? parsedUrl.pathname.replace(/\/$/, '') + '/messages'
        : '/v1/messages';
      requestBody = JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      });
      headers = {
        'x-api-key': apiKey || '',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'User-Agent': 'Coding-Tool-SpeedTest/1.0'
      };
    } else {
      // OpenAI 格式（默认）
      apiPath = parsedUrl.pathname.includes('/v1')
        ? parsedUrl.pathname.replace(/\/$/, '') + '/chat/completions'
        : '/v1/chat/completions';
      requestBody = JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      });
      headers = {
        'Authorization': `Bearer ${apiKey || ''}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Coding-Tool-SpeedTest/1.0'
      };
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: apiPath,
      method: 'POST',
      timeout,
      headers
    };

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const latency = Date.now() - startTime;

        // 检查响应状态
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 成功响应
          resolve({
            success: true,
            latency,
            error: null
          });
        } else if (res.statusCode === 401) {
          resolve({
            success: false,
            latency,
            error: 'API Key 无效或已过期'
          });
        } else if (res.statusCode === 403) {
          resolve({
            success: false,
            latency,
            error: 'API Key 权限不足'
          });
        } else if (res.statusCode === 429) {
          // 429 表示请求过多，但说明 API Key 有效
          resolve({
            success: true,
            latency,
            error: null
          });
        } else if (res.statusCode === 402) {
          resolve({
            success: false,
            latency,
            error: '账户余额不足'
          });
        } else if (res.statusCode === 400) {
          // 尝试解析错误信息
          try {
            const errData = JSON.parse(data);
            const errMsg = errData.error?.message || errData.message || '请求参数错误';
            // 如果是模型不存在的错误，说明 API 本身是通的
            if (errMsg.includes('model') || errMsg.includes('Model')) {
              resolve({
                success: true,
                latency,
                error: null
              });
            } else {
              resolve({
                success: false,
                latency,
                error: errMsg
              });
            }
          } catch {
            resolve({
              success: false,
              latency,
              error: '请求参数错误'
            });
          }
        } else {
          // 其他错误
          let errMsg = `HTTP ${res.statusCode}`;
          try {
            const errData = JSON.parse(data);
            errMsg = errData.error?.message || errData.message || errMsg;
          } catch {}
          resolve({
            success: false,
            latency,
            error: errMsg
          });
        }
      });
    });

    req.on('error', (error) => {
      resolve({
        success: false,
        latency: null,
        error: error.message || '请求失败'
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        latency: null,
        error: 'API 请求超时'
      });
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * 批量测试多个渠道
 * @param {Array} channels - 渠道列表
 * @param {number} timeout - 超时时间
 * @returns {Promise<Array>} 测试结果列表
 */
async function testMultipleChannels(channels, timeout = DEFAULT_TIMEOUT) {
  const results = await Promise.all(
    channels.map(channel => testChannelSpeed(channel, timeout))
  );

  // 按延迟排序（成功的在前，按延迟升序）
  results.sort((a, b) => {
    if (a.success && !b.success) return -1;
    if (!a.success && b.success) return 1;
    if (a.success && b.success) return (a.latency || Infinity) - (b.latency || Infinity);
    return 0;
  });

  return results;
}

/**
 * 获取缓存的测试结果
 * @param {string} channelId - 渠道 ID
 * @returns {Object|null} 缓存的测试结果
 */
function getCachedResult(channelId) {
  const cached = testResultsCache.get(channelId);
  // 5 分钟内的缓存有效
  if (cached && Date.now() - cached.testedAt < 5 * 60 * 1000) {
    return cached;
  }
  return null;
}

/**
 * 清除测试结果缓存
 */
function clearCache() {
  testResultsCache.clear();
}

/**
 * 获取延迟等级
 * @param {number} latency - 延迟毫秒数
 * @returns {string} 等级：excellent/good/fair/poor
 */
function getLatencyLevel(latency) {
  if (!latency) return 'unknown';
  if (latency < 300) return 'excellent';   // < 300ms 优秀
  if (latency < 500) return 'good';        // < 500ms 良好
  if (latency < 800) return 'fair';        // < 800ms 一般
  return 'poor';                           // >= 800ms 较差
}

module.exports = {
  testChannelSpeed,
  testMultipleChannels,
  getCachedResult,
  clearCache,
  getLatencyLevel
};
