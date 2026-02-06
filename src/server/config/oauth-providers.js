'use strict';

const OAUTH_PROVIDERS = {
  claude: {
    name: 'Claude Pro',
    authUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    redirectUri: 'http://localhost:54545/callback',
    scopes: ['org:create_api_key', 'user:profile', 'user:inference'],
    authType: 'pkce',
    callbackPort: 54545,
    callbackPath: '/callback'
  },

  codex: {
    name: 'OpenAI Codex',
    authUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    redirectUri: 'http://localhost:1455/auth/callback',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    authType: 'pkce',
    extraParams: {
      codex_cli_simplified_flow: 'true',
      originator: 'ctx'
    },
    tokenContentType: 'application/x-www-form-urlencoded',
    callbackPort: 1455,
    callbackPath: '/auth/callback'
  },

  gemini: {
    name: 'Google Gemini',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    redirectUri: 'http://localhost:51121/callback',
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/cclog',
      'https://www.googleapis.com/auth/experimentsandconfigs'
    ],
    authType: 'standard',
    extraParams: {
      access_type: 'offline',
      prompt: 'consent'
    },
    callbackPort: 51121,
    callbackPath: '/callback'
  },

  // ============================================
  // OpenCode OAuth Providers
  // ============================================

  github_copilot: {
    name: 'GitHub Copilot',
    // Device Flow - 不使用标准 authUrl，而是 deviceCodeUrl
    authType: 'device_flow',
    deviceCodeUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientId: 'Iv1.b507a08c87ecfe98',  // GitHub Copilot CLI public client ID
    scopes: ['read:user'],
    pollInterval: 5000,  // 5 秒轮询间隔
    expiresIn: 900,      // 15 分钟过期
    tokenContentType: 'application/json'
  },

  openai_chatgpt: {
    name: 'OpenAI ChatGPT Plus/Pro',
    // 复用 codex OAuth 端点，但用于 OpenCode
    authUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    redirectUri: 'http://localhost:51124/auth/callback',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    authType: 'pkce',
    extraParams: {
      codex_cli_simplified_flow: 'true',
      originator: 'ctx-opencode'
    },
    tokenContentType: 'application/x-www-form-urlencoded',
    callbackPort: 51124,
    callbackPath: '/auth/callback'
  },

  anthropic_claude: {
    name: 'Anthropic Claude Pro/Max',
    // 复用 claude OAuth 端点，但用于 OpenCode
    authUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    redirectUri: 'http://localhost:51125/callback',
    scopes: ['org:create_api_key', 'user:profile', 'user:inference'],
    authType: 'pkce',
    callbackPort: 51125,
    callbackPath: '/callback'
  },

  gitlab_duo: {
    name: 'GitLab Duo',
    // Device Flow for GitLab
    authType: 'device_flow',
    deviceCodeUrl: 'https://gitlab.com/oauth/device/code',
    tokenUrl: 'https://gitlab.com/oauth/token',
    clientId: 'glpat-opencode-placeholder',  // 需要用户自行配置
    scopes: ['api', 'read_user', 'ai_features'],
    pollInterval: 5000,
    expiresIn: 600,
    tokenContentType: 'application/json'
  }
};

function getProviderConfig(provider) {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unknown OAuth provider: ${provider}`);
  }
  return { ...config };
}

/**
 * 检查提供商是否使用 Device Flow
 * @param {string} provider
 * @returns {boolean}
 */
function isDeviceFlowProvider(provider) {
  const config = OAUTH_PROVIDERS[provider];
  return config?.authType === 'device_flow';
}

module.exports = {
  OAUTH_PROVIDERS,
  getProviderConfig,
  isDeviceFlowProvider
};
