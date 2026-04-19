const PRESET_WEBSITE_SOURCES = {
  claude: [
    { presetId: 'official', baseUrl: 'https://api.anthropic.com', websiteUrl: 'https://www.anthropic.com' },
    { presetId: 'deepseek', baseUrl: 'https://api.deepseek.com/anthropic', websiteUrl: 'https://platform.deepseek.com' },
    { presetId: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/anthropic', websiteUrl: 'https://open.bigmodel.cn' },
    { presetId: 'kimi', baseUrl: 'https://api.moonshot.cn/anthropic', websiteUrl: 'https://platform.moonshot.cn' },
    { presetId: 'minimax', baseUrl: 'https://api.minimaxi.com/anthropic', websiteUrl: 'https://platform.minimaxi.com' },
    { presetId: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/api/v2/apps/claude-code-proxy', websiteUrl: 'https://bailian.console.aliyun.com' },
    { presetId: 'doubao', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding', websiteUrl: 'https://www.volcengine.com/product/doubao' }
  ],
  codex: [
    { presetId: 'openai', baseUrl: 'https://api.openai.com/v1', websiteUrl: 'https://platform.openai.com' }
  ],
  gemini: [
    { presetId: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', websiteUrl: 'https://ai.google.dev' }
  ],
  opencode: [
    { presetId: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', websiteUrl: 'https://openrouter.ai' },
    { presetId: 'openai_api', baseUrl: 'https://api.openai.com/v1', websiteUrl: 'https://platform.openai.com' },
    { presetId: 'anthropic_api', baseUrl: 'https://api.anthropic.com/v1', websiteUrl: 'https://console.anthropic.com' },
    { presetId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', websiteUrl: 'https://platform.deepseek.com' },
    { presetId: 'groq', baseUrl: 'https://api.groq.com/openai/v1', websiteUrl: 'https://console.groq.com' },
    { presetId: 'together', baseUrl: 'https://api.together.xyz/v1', websiteUrl: 'https://www.together.ai' }
  ]
};

function normalizeNonEmptyString(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed || '';
}

function normalizePresetId(value) {
  return normalizeNonEmptyString(value).toLowerCase();
}

function normalizeBaseUrl(value) {
  const raw = normalizeNonEmptyString(value);
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}`;
  } catch (_) {
    return raw.replace(/\/+$/, '').toLowerCase();
  }
}

function buildPresetWebsiteLookup() {
  const lookup = {};

  for (const [platform, entries] of Object.entries(PRESET_WEBSITE_SOURCES)) {
    const byPresetId = {};
    const byBaseUrl = {};

    for (const entry of entries) {
      const websiteUrl = normalizeNonEmptyString(entry.websiteUrl);
      if (!websiteUrl) continue;

      const presetId = normalizePresetId(entry.presetId);
      if (presetId) {
        byPresetId[presetId] = websiteUrl;
      }

      const baseUrl = normalizeBaseUrl(entry.baseUrl);
      if (baseUrl) {
        byBaseUrl[baseUrl] = websiteUrl;
      }
    }

    lookup[platform] = { byPresetId, byBaseUrl };
  }

  return lookup;
}

const PRESET_WEBSITE_LOOKUP = buildPresetWebsiteLookup();

function resolveChannelWebsiteUrl(platform, channel = {}) {
  const existingWebsiteUrl = normalizeNonEmptyString(channel.websiteUrl);
  if (existingWebsiteUrl) {
    return existingWebsiteUrl;
  }

  const platformKey = normalizePresetId(platform);
  const lookup = PRESET_WEBSITE_LOOKUP[platformKey];
  if (!lookup) {
    return '';
  }

  const presetId = normalizePresetId(channel.presetId);
  if (presetId && lookup.byPresetId[presetId]) {
    return lookup.byPresetId[presetId];
  }

  const baseUrl = normalizeBaseUrl(channel.baseUrl);
  if (baseUrl && lookup.byBaseUrl[baseUrl]) {
    return lookup.byBaseUrl[baseUrl];
  }

  return '';
}

module.exports = {
  PRESET_WEBSITE_SOURCES,
  resolveChannelWebsiteUrl,
  _test: {
    PRESET_WEBSITE_LOOKUP,
    normalizeBaseUrl,
    normalizeNonEmptyString,
    normalizePresetId
  }
};
