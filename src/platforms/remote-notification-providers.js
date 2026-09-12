'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');

const REMOTE_PROVIDER_TYPES = Object.freeze([
  'wechatBot',
  'qqBot',
  'feishuBot',
  'wecomBot',
  'dingtalkBot',
  'telegramBot'
]);

const PROVIDER_METADATA = Object.freeze({
  wechatBot: Object.freeze({
    label: '微信',
    legacyName: '微信 Bot',
    description: '使用个人微信 iLink token 发送通知',
    hint: '首次 token 可由 GA 微信扫码生成；也可以直接填写 token。',
    defaults: Object.freeze({ tokenFile: '~/.wxbot/token.json', botToken: '', targetUserId: '', contextToken: '' }),
    fields: Object.freeze([
      Object.freeze({ key: 'tokenFile', label: 'token.json 路径', type: 'input', placeholder: '~/.wxbot/token.json', wide: true }),
      Object.freeze({ key: 'botToken', label: 'Token', type: 'secret', placeholder: '可直接填写 token', wide: true }),
      Object.freeze({ key: 'targetUserId', label: '接收用户 ID', type: 'input', placeholder: '微信用户 ID' }),
      Object.freeze({ key: 'contextToken', label: 'Context Token（可选）', type: 'secret', placeholder: '可选' })
    ])
  }),
  qqBot: Object.freeze({
    label: 'QQ',
    legacyName: 'QQ Bot',
    description: '通过 OneBot / NapCat / go-cqhttp 兼容 HTTP 接口发送通知',
    hint: 'GA 当前构建已移除 QQ 前端，这里按 OneBot 兼容桥接入。',
    defaults: Object.freeze({ endpoint: 'http://127.0.0.1:3000', accessToken: '', targetType: 'private', targetId: '' }),
    fields: Object.freeze([
      Object.freeze({ key: 'endpoint', label: 'OneBot HTTP 地址', type: 'input', placeholder: 'http://127.0.0.1:3000', wide: true }),
      Object.freeze({ key: 'accessToken', label: 'Access Token（可选）', type: 'secret', placeholder: '可选' }),
      Object.freeze({ key: 'targetType', label: '接收类型', type: 'select', options: Object.freeze([
        Object.freeze({ label: '私聊', value: 'private' }),
        Object.freeze({ label: '群聊', value: 'group' })
      ]) }),
      Object.freeze({ key: 'targetId', label: '接收对象 ID', type: 'input', placeholder: 'QQ 号或群号' })
    ])
  }),
  feishuBot: Object.freeze({
    label: '飞书',
    legacyName: '飞书 Bot',
    description: '通过飞书自定义机器人 Webhook 发送通知',
    hint: '填写飞书自定义机器人 Webhook URL。',
    defaults: Object.freeze({ webhookUrl: '' }),
    fields: Object.freeze([
      Object.freeze({ key: 'webhookUrl', label: 'Webhook URL', type: 'input', placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/...', wide: true })
    ])
  }),
  wecomBot: Object.freeze({
    label: '企业微信',
    legacyName: '企业微信 Bot',
    description: '通过企业微信群机器人 Webhook 发送通知',
    hint: '当前通知发送使用企业微信群机器人 Webhook；GA 的 bot_id / secret 长连接模式不适合单向通知。',
    defaults: Object.freeze({ webhookUrl: '' }),
    fields: Object.freeze([
      Object.freeze({ key: 'webhookUrl', label: 'Webhook URL', type: 'input', placeholder: '企业微信群机器人 Webhook URL', wide: true })
    ])
  }),
  dingtalkBot: Object.freeze({
    label: '钉钉',
    legacyName: '钉钉 Bot',
    description: '支持钉钉自定义机器人 Webhook 和 GA 同款 App 模式',
    hint: 'App 模式需要 App Key / App Secret，并填写用户 ID 或群会话 ID。',
    defaults: Object.freeze({ mode: 'webhook', webhookUrl: '', clientId: '', clientSecret: '', targetType: 'group', targetId: '' }),
    fields: Object.freeze([
      Object.freeze({ key: 'mode', label: '接入模式', type: 'select', options: Object.freeze([
        Object.freeze({ label: 'Webhook', value: 'webhook' }),
        Object.freeze({ label: 'GA App 模式', value: 'app' })
      ]) }),
      Object.freeze({ key: 'clientId', label: 'App Key', type: 'input', placeholder: 'Client ID', visibleWhen: Object.freeze({ key: 'mode', equals: 'app' }) }),
      Object.freeze({ key: 'clientSecret', label: 'App Secret', type: 'secret', placeholder: 'Secret', visibleWhen: Object.freeze({ key: 'mode', equals: 'app' }) }),
      Object.freeze({ key: 'targetType', label: '接收类型', type: 'select', options: Object.freeze([
        Object.freeze({ label: '群会话', value: 'group' }),
        Object.freeze({ label: '用户', value: 'user' })
      ]), visibleWhen: Object.freeze({ key: 'mode', equals: 'app' }) }),
      Object.freeze({ key: 'targetId', label: '接收对象 ID', type: 'input', placeholder: '用户 ID 或群会话 ID', visibleWhen: Object.freeze({ key: 'mode', equals: 'app' }) }),
      Object.freeze({ key: 'webhookUrl', label: 'Webhook URL', type: 'input', placeholder: '钉钉自定义机器人 Webhook URL', wide: true, visibleWhen: Object.freeze({ key: 'mode', equals: 'webhook' }) })
    ])
  }),
  telegramBot: Object.freeze({
    label: 'Telegram',
    legacyName: 'Telegram Bot',
    description: '通过 Telegram Bot API sendMessage 发送通知',
    hint: '需要 Token 和 Chat ID。',
    defaults: Object.freeze({ botToken: '', chatId: '', proxy: '' }),
    fields: Object.freeze([
      Object.freeze({ key: 'botToken', label: 'Token', type: 'secret', placeholder: 'Telegram token' }),
      Object.freeze({ key: 'chatId', label: 'Chat ID', type: 'input', placeholder: 'Chat ID' }),
      Object.freeze({ key: 'proxy', label: 'HTTP 代理（可选）', type: 'input', placeholder: 'http://127.0.0.1:7890', wide: true })
    ])
  })
});

const TYPE_ALIASES = Object.freeze({
  wechat: 'wechatBot',
  weixin: 'wechatBot',
  qq: 'qqBot',
  feishu: 'feishuBot',
  lark: 'feishuBot',
  wecom: 'wecomBot',
  dingtalk: 'dingtalkBot',
  telegram: 'telegramBot'
});

function trimString(value) {
  return String(value || '').trim();
}

function normalizeProviderType(type) {
  const value = trimString(type);
  if (REMOTE_PROVIDER_TYPES.includes(value)) return value;
  if (TYPE_ALIASES[value.toLowerCase()]) return TYPE_ALIASES[value.toLowerCase()];
  return /^[a-z][a-z0-9_-]*$/i.test(value) ? value : '';
}

function createRemoteProviderId(type, index = 0) {
  return `${type || 'provider'}-${Date.now().toString(36)}-${index}`;
}

function normalizeConfig(type, config = {}) {
  const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  switch (type) {
    case 'wechatBot':
      return {
        tokenFile: trimString(source.tokenFile),
        botToken: trimString(source.botToken),
        targetUserId: trimString(source.targetUserId),
        contextToken: trimString(source.contextToken)
      };
    case 'qqBot':
      return {
        endpoint: trimString(source.endpoint),
        accessToken: trimString(source.accessToken),
        targetType: source.targetType === 'group' ? 'group' : 'private',
        targetId: trimString(source.targetId)
      };
    case 'feishuBot':
    case 'wecomBot':
      return { webhookUrl: trimString(source.webhookUrl) };
    case 'dingtalkBot':
      return {
        mode: source.mode === 'app' ? 'app' : 'webhook',
        webhookUrl: trimString(source.webhookUrl),
        clientId: trimString(source.clientId),
        clientSecret: trimString(source.clientSecret),
        targetType: source.targetType === 'user' ? 'user' : 'group',
        targetId: trimString(source.targetId)
      };
    case 'telegramBot':
      return {
        botToken: trimString(source.botToken),
        chatId: trimString(source.chatId),
        proxy: trimString(source.proxy)
      };
    default:
      return {};
  }
}

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateFeishuWebhookUrl(webhookUrl) {
  const value = trimString(webhookUrl);
  if (!value) return null;
  let urlObj;
  try {
    urlObj = new URL(value);
  } catch (error) {
    throw createValidationError('飞书 Webhook URL 格式不正确');
  }
  if (urlObj.protocol !== 'https:') throw createValidationError('飞书 Webhook 必须使用 HTTPS');
  if (urlObj.hostname !== 'open.feishu.cn') throw createValidationError('仅支持 open.feishu.cn 的飞书 Webhook');
  return urlObj;
}

function validateHttpsUrl(value, label, options = {}) {
  const raw = trimString(value);
  if (!raw) return null;
  let urlObj;
  try {
    urlObj = new URL(raw);
  } catch (error) {
    throw createValidationError(`${label} 格式不正确`);
  }
  if (options.requireHttps !== false && urlObj.protocol !== 'https:') {
    throw createValidationError(`${label} 必须使用 HTTPS`);
  }
  if (options.hostname && urlObj.hostname !== options.hostname) {
    throw createValidationError(`${label} 仅支持 ${options.hostname}`);
  }
  return urlObj;
}

function requireConfigValue(config, key, label) {
  if (!trimString(config?.[key])) throw createValidationError(`请填写${label}`);
}

function validateConfig(type, config = {}) {
  switch (type) {
    case 'wechatBot':
      if (!trimString(config.botToken) && !trimString(config.tokenFile)) {
        throw createValidationError('请填写微信 Bot Token 或 token.json 路径');
      }
      requireConfigValue(config, 'targetUserId', '微信接收用户 ID');
      break;
    case 'qqBot':
      requireConfigValue(config, 'endpoint', 'QQ Bot HTTP 地址');
      validateHttpsUrl(config.endpoint, 'QQ Bot HTTP 地址', { requireHttps: false });
      requireConfigValue(config, 'targetId', 'QQ 接收对象 ID');
      break;
    case 'feishuBot':
      validateFeishuWebhookUrl(config.webhookUrl);
      requireConfigValue(config, 'webhookUrl', '飞书 Webhook URL');
      break;
    case 'wecomBot':
      validateHttpsUrl(config.webhookUrl, '企业微信 Webhook URL');
      requireConfigValue(config, 'webhookUrl', '企业微信 Webhook URL');
      break;
    case 'dingtalkBot':
      if (config.mode === 'app') {
        requireConfigValue(config, 'clientId', '钉钉 App Key');
        requireConfigValue(config, 'clientSecret', '钉钉 App Secret');
        requireConfigValue(config, 'targetId', '钉钉接收对象 ID');
      } else {
        validateHttpsUrl(config.webhookUrl, '钉钉 Webhook URL');
        requireConfigValue(config, 'webhookUrl', '钉钉 Webhook URL');
      }
      break;
    case 'telegramBot':
      requireConfigValue(config, 'botToken', 'Telegram Bot Token');
      requireConfigValue(config, 'chatId', 'Telegram Chat ID');
      break;
    default:
      throw createValidationError('远程通知渠道类型不正确');
  }
}

function normalizeProvider(provider = {}, index = 0, descriptors = PROVIDER_METADATA) {
  const type = normalizeProviderType(provider.type);
  const metadata = descriptors[type];
  if (!metadata) return null;
  const suppliedName = trimString(provider.name);
  return {
    id: suppliedName && trimString(provider.id) ? trimString(provider.id) : trimString(provider.id) || createRemoteProviderId(type, index),
    type,
    name: suppliedName && suppliedName !== metadata.legacyName ? suppliedName : metadata.label,
    enabled: provider.enabled === true,
    config: normalizeConfig(type, provider.config)
  };
}

function normalizeRemoteNotificationsConfig(remoteNotifications = {}, descriptors = PROVIDER_METADATA) {
  const source = remoteNotifications && typeof remoteNotifications === 'object' && !Array.isArray(remoteNotifications)
    ? remoteNotifications
    : {};
  const providers = Array.isArray(source.providers)
    ? source.providers.map((provider, index) => normalizeProvider(provider, index, descriptors)).filter(Boolean)
    : [];
  return { providers };
}

function buildTestNotificationContext() {
  return {
    title: 'Coding Tool - 测试通知',
    message: '这是一条测试通知',
    source: 'test',
    eventType: 'test',
    timestamp: new Date().toLocaleString('zh-CN'),
    hostname: require('os').hostname()
  };
}

function formatProviderText(ctx) {
  return [
    ctx.title,
    `来源: ${ctx.source}`,
    `状态: ${ctx.message}`,
    `时间: ${ctx.timestamp}`,
    `设备: ${ctx.hostname}`
  ].join('\n');
}

function createClientId(prefix = 'coding-tool') {
  const randomPart = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : crypto.randomBytes(8).toString('hex');
  return `${prefix}-${randomPart}`;
}

function sendFeishuTest(webhookUrl) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = validateFeishuWebhookUrl(webhookUrl);
      const data = JSON.stringify({
        msg_type: 'interactive',
        card: {
          header: {
            title: { tag: 'plain_text', content: 'Coding Tool - 测试通知' },
            template: 'blue'
          },
          elements: [
            { tag: 'div', text: { tag: 'lark_md', content: '**状态**: 这是一条测试通知' } },
            { tag: 'div', text: { tag: 'lark_md', content: '**时间**: ' + new Date().toLocaleString('zh-CN') } }
          ]
        }
      });
      const requestModule = urlObj.protocol === 'https:' ? https : http;
      const request = requestModule.request({
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 10000
      }, () => resolve());
      request.on('error', reject);
      request.on('timeout', () => request.destroy(new Error('飞书测试通知超时')));
      request.write(data);
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

function requestJson(url, data, headers = {}, extraOptions = {}) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const body = JSON.stringify(data);
      const requestModule = urlObj.protocol === 'https:' ? https : http;
      const request = requestModule.request({
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers
        },
        ...extraOptions
      }, response => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 300) resolve();
        else reject(new Error(`远程通知返回 HTTP ${response.statusCode}`));
      });
      request.on('error', reject);
      request.on('timeout', () => request.destroy(new Error('远程通知测试超时')));
      request.write(body);
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

function requestDingTalkAccessToken(config = {}) {
  if (!config.clientId || !config.clientSecret) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    try {
      const body = JSON.stringify({ appKey: config.clientId, appSecret: config.clientSecret });
      const request = https.request({
        hostname: 'api.dingtalk.com',
        path: '/v1.0/oauth2/accessToken',
        method: 'POST',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, response => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { responseBody += chunk; });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(responseBody);
            if (response.statusCode >= 200 && response.statusCode < 300 && parsed.accessToken) {
              resolve(parsed.accessToken);
              return;
            }
            reject(new Error(`钉钉 Access Token 获取失败: ${responseBody.slice(0, 300)}`));
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', reject);
      request.on('timeout', () => request.destroy(new Error('钉钉 Access Token 获取超时')));
      request.write(body);
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

function requestTelegramMessage(config = {}, ctx) {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const payload = { chat_id: config.chatId, text: formatProviderText(ctx) };
  const agent = config.proxy ? new HttpsProxyAgent(config.proxy) : null;
  return requestJson(url, payload, {}, agent ? { agent } : {});
}

async function sendDingTalkAppProviderTest(config = {}, ctx) {
  const token = await requestDingTalkAccessToken(config);
  if (!token) throw createValidationError('钉钉 App Access Token 获取失败');
  const isGroup = config.targetType !== 'user';
  const payload = {
    robotCode: config.clientId,
    msgKey: 'sampleMarkdown',
    msgParam: JSON.stringify({
      title: ctx.title,
      text: `### ${ctx.title}\n\n- 状态: ${ctx.message}\n- 时间: ${ctx.timestamp}\n- 设备: ${ctx.hostname}`
    })
  };
  if (isGroup) payload.openConversationId = config.targetId;
  else payload.userIds = [config.targetId];
  return requestJson(
    'https://api.dingtalk.com/v1.0/robot/' + (isGroup ? 'groupMessages/send' : 'oToMessages/batchSend'),
    payload,
    { 'x-acs-dingtalk-access-token': token }
  );
}

function createProviderSenders() {
  const getContext = () => buildTestNotificationContext();
  return {
    feishuBot: provider => sendFeishuTest(provider.config.webhookUrl),
    qqBot: provider => {
      const config = provider.config;
      const ctx = getContext();
      const pathSuffix = config.targetType === 'group' ? '/send_group_msg' : '/send_private_msg';
      return requestJson(String(config.endpoint).replace(/\/$/, '') + pathSuffix, {
        [config.targetType === 'group' ? 'group_id' : 'user_id']: config.targetId,
        message: formatProviderText(ctx)
      }, config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {});
    },
    wecomBot: provider => {
      const ctx = getContext();
      return requestJson(provider.config.webhookUrl, {
        msgtype: 'markdown',
        markdown: { content: `**${ctx.title}**\\n> 状态: ${ctx.message}\\n> 时间: ${ctx.timestamp}` }
      });
    },
    dingtalkBot: provider => {
      const ctx = getContext();
      return provider.config.mode === 'app'
        ? sendDingTalkAppProviderTest(provider.config, ctx)
        : requestJson(provider.config.webhookUrl, {
          msgtype: 'markdown',
          markdown: { title: ctx.title, text: `### ${ctx.title}\\n\\n- 状态: ${ctx.message}\\n- 时间: ${ctx.timestamp}` }
        });
    },
    telegramBot: provider => requestTelegramMessage(provider.config, getContext()),
    wechatBot: provider => {
      const config = { ...provider.config };
      const ctx = getContext();
      if (!config.botToken && config.tokenFile) {
        try {
          const parsed = JSON.parse(fs.readFileSync(config.tokenFile, 'utf8'));
          config.botToken = parsed.bot_token || parsed.token || '';
        } catch (error) {
          throw createValidationError('无法读取微信 token.json');
        }
      }
      requireConfigValue(config, 'botToken', '微信 Bot Token');
      return requestJson('https://ilinkai.weixin.qq.com/ilink/bot/sendmessage', {
        msg: {
          from_user_id: '',
          to_user_id: config.targetUserId,
          client_id: createClientId('coding-tool'),
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text: formatProviderText(ctx) } }],
          ...(config.contextToken ? { context_token: config.contextToken } : {})
        },
        base_info: { channel_version: '2.1.8' }
      }, {
        AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${config.botToken}`,
        'X-WECHAT-UIN': Buffer.from(String(Math.floor(Math.random() * 0xffffffff))).toString('base64')
      });
    }
  };
}

function isAllowedField(field) {
  return field && typeof field === 'object' && typeof field.key === 'string'
    && typeof field.label === 'string' && ['input', 'secret', 'select'].includes(field.type);
}

function publicField(field) {
  if (!isAllowedField(field)) return null;
  const result = { key: field.key, label: field.label, type: field.type };
  if (Array.isArray(field.options)) {
    result.options = field.options
      .filter(option => option && typeof option === 'object' && typeof option.label === 'string' && typeof option.value === 'string')
      .map(option => ({ label: option.label, value: option.value }));
  }
  if (typeof field.placeholder === 'string') result.placeholder = field.placeholder;
  if (typeof field.wide === 'boolean') result.wide = field.wide;
  if (field.visibleWhen && typeof field.visibleWhen === 'object'
    && typeof field.visibleWhen.key === 'string'
    && Object.prototype.hasOwnProperty.call(field.visibleWhen, 'equals')
    && ['string', 'number', 'boolean'].includes(typeof field.visibleWhen.equals)) {
    result.visibleWhen = { key: field.visibleWhen.key, equals: field.visibleWhen.equals };
  }
  return result;
}

function publicDescriptor(descriptor) {
  const fields = descriptor.fields.map(publicField).filter(Boolean);
  const fieldKeys = new Set(fields.map(field => field.key));
  const secretKeys = new Set(fields.filter(field => field.type === 'secret').map(field => field.key));
  const defaults = Object.fromEntries(
    Object.entries(descriptor.defaults)
      .filter(([key]) => fieldKeys.has(key))
      .map(([key, value]) => [
        key,
        secretKeys.has(key) ? '' : value
      ])
  );
  return {
    type: descriptor.type,
    label: descriptor.label,
    description: descriptor.description,
    hint: descriptor.hint,
    defaults,
    fields
  };
}

function createRemoteNotificationProviderRegistry({ senders = {} } = {}) {
  const descriptors = new Map();
  const builtInSenders = createProviderSenders();

  function register(type, descriptor = {}) {
    const normalizedType = normalizeProviderType(type || descriptor.type);
    if (!normalizedType || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
      throw new TypeError(`Invalid remote notification provider: ${type}`);
    }
    const metadata = PROVIDER_METADATA[normalizedType] || {};
    const fields = Array.isArray(descriptor.fields) ? descriptor.fields.filter(isAllowedField) : [];
    const normalizedDescriptor = {
      type: normalizedType,
      label: trimString(descriptor.label) || metadata.label || normalizedType,
      description: trimString(descriptor.description),
      hint: trimString(descriptor.hint),
      defaults: descriptor.defaults && typeof descriptor.defaults === 'object' && !Array.isArray(descriptor.defaults)
        ? { ...descriptor.defaults }
        : { ...(metadata.defaults || {}) },
      fields,
      normalize: typeof descriptor.normalize === 'function' ? descriptor.normalize : config => normalizeConfig(normalizedType, config),
      validate: typeof descriptor.validate === 'function' ? descriptor.validate : config => validateConfig(normalizedType, config),
      send: typeof descriptor.send === 'function'
        ? descriptor.send
        : senders[normalizedType] || builtInSenders[normalizedType]
    };
    if (typeof normalizedDescriptor.send !== 'function') {
      throw new TypeError(`Remote notification provider ${normalizedType} has no sender`);
    }
    descriptors.set(normalizedType, normalizedDescriptor);
    return normalizedDescriptor;
  }

  for (const type of REMOTE_PROVIDER_TYPES) {
    register(type, {
      ...PROVIDER_METADATA[type],
      normalize: config => normalizeConfig(type, config),
      validate: config => validateConfig(type, config),
      send: senders[type] || builtInSenders[type]
    });
  }

  function descriptorFor(type) {
    return descriptors.get(normalizeProviderType(type)) || null;
  }

  function normalizeProviderWithRegistry(provider = {}, index = 0) {
    const type = normalizeProviderType(provider.type);
    const descriptor = descriptorFor(type);
    if (!descriptor) return null;
    const suppliedName = trimString(provider.name);
    return {
      id: trimString(provider.id) || createRemoteProviderId(type, index),
      type,
      name: suppliedName && suppliedName !== PROVIDER_METADATA[type]?.legacyName ? suppliedName : descriptor.label,
      enabled: provider.enabled === true,
      config: descriptor.normalize(provider.config)
    };
  }

  function normalizeNotifications(remoteNotifications = {}) {
    const source = remoteNotifications && typeof remoteNotifications === 'object' && !Array.isArray(remoteNotifications)
      ? remoteNotifications
      : {};
    return {
      providers: Array.isArray(source.providers)
        ? source.providers.map((provider, index) => normalizeProviderWithRegistry(provider, index)).filter(Boolean)
        : []
    };
  }

  function validateProvider(provider = {}) {
    const normalized = normalizeProviderWithRegistry(provider);
    if (!normalized) throw createValidationError('远程通知渠道类型不正确');
    descriptorFor(normalized.type).validate(normalized.config);
    return normalized;
  }

  function validateNotifications(remoteNotifications = {}) {
    const normalized = normalizeNotifications(remoteNotifications);
    normalized.providers.forEach(provider => {
      if (provider.enabled === true) validateProvider(provider);
    });
    return normalized;
  }

  async function sendTest(providerInput = {}) {
    const provider = validateProvider({ ...providerInput, enabled: true });
    return descriptorFor(provider.type).send(provider);
  }

  return Object.freeze({
    register,
    get(type) {
      return descriptorFor(type);
    },
    list() {
      return [...descriptors.values()].map(publicDescriptor);
    },
    types() {
      return [...descriptors.keys()];
    },
    normalize: normalizeProviderWithRegistry,
    normalizeNotifications,
    validate: validateProvider,
    validateNotifications,
    sendTest
  });
}

let defaultRegistry;
function getRemoteNotificationProviderRegistry() {
  if (!defaultRegistry) defaultRegistry = createRemoteNotificationProviderRegistry();
  return defaultRegistry;
}

const defaultApi = getRemoteNotificationProviderRegistry();

module.exports = {
  REMOTE_PROVIDER_TYPES,
  createRemoteNotificationProviderRegistry,
  getRemoteNotificationProviderRegistry,
  getRemoteProviderTypes: () => defaultApi.list(),
  normalizeRemoteProviderType: normalizeProviderType,
  normalizeRemoteProvider: defaultApi.normalize,
  normalizeRemoteNotificationsConfig: defaultApi.normalizeNotifications,
  validateRemoteProviderConfig: defaultApi.validate,
  validateRemoteNotifications: defaultApi.validateNotifications,
  sendRemoteProviderTest: defaultApi.sendTest,
  validateFeishuWebhookUrl,
  validateHttpsUrl,
  createValidationError
};
