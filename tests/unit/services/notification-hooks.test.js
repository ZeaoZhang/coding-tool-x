// tests/unit/services/notification-hooks.test.js
// Tests for pure logic functions exported via _test from notification-hooks.js

vi.mock('../../../src/server/services/ui-config', () => ({
  loadUIConfig: vi.fn(() => ({})),
  saveUIConfig: vi.fn()
}));

vi.mock('../../../src/server/services/codex-settings-manager', () => ({
  readConfig: vi.fn(() => ({})),
  configExists: vi.fn(() => false),
  writeConfig: vi.fn()
}));

vi.mock('../../../src/server/services/gemini-settings-manager', () => ({
  readSettings: vi.fn(() => ({})),
  settingsExists: vi.fn(() => false),
  writeSettings: vi.fn(),
  getSettingsPath: vi.fn(() => '/tmp/test-gemini-settings.json')
}));

vi.mock('../../../src/config/paths', () => ({
  PATHS: {
    notifyHook: '/tmp/test-notify-hook.js',
    configFile: '/tmp/test-config.json'
  },
  NATIVE_PATHS: {
    claude: { settings: '/tmp/test-claude-settings.json' },
    codex: { config: '/tmp/test-codex-config.toml' },
    opencode: { config: '/tmp/test-opencode-config' },
    omp: { extensions: '/tmp/test-omp-extensions' }
  }
}));

const websocketModPath = require.resolve('../../../src/server/websocket-server');
const mockBroadcastBrowserNotification = vi.fn();
require.cache[websocketModPath] = {
  id: websocketModPath,
  filename: websocketModPath,
  loaded: true,
  exports: {
    broadcastBrowserNotification: mockBroadcastBrowserNotification
  }
};

const { _test, MANAGED_HOOK_NAME } = require('../../../src/server/services/notification-hooks');

const {
  parseManagedType,
  applyClaudeDisablePreference,
  parseCodexNotificationStatus,
  parseGeminiNotificationStatus,
  parseOpenCodeNotificationStatus,
  parseOmpNotificationStatus,
  validateFeishuWebhookUrl,
  buildCodexNotifyCommand,
  buildClaudeCommand,
  buildGeminiCommand,
  generateNotifyScript,
  generateSystemNotificationCommand,
  buildOpenCodePluginContent,
  buildOmpExtensionContent,
  getOmpManagedExtensionPath,
  emitBrowserNotification,
  normalizeRemoteNotificationsConfig,
  validateRemoteProviderConfig,
  parseStopHookStatus,
  buildStopHookCommand,
  shouldRepairStopHook
} = _test;

// ---------------------------------------------------------------------------
// MANAGED_HOOK_NAME
// ---------------------------------------------------------------------------
describe('MANAGED_HOOK_NAME', () => {
  test('equals coding-tool-notify', () => {
    expect(MANAGED_HOOK_NAME).toBe('coding-tool-notify');
  });
});

// ---------------------------------------------------------------------------
// parseManagedType
// ---------------------------------------------------------------------------
describe('parseManagedType', () => {
  test('parses --cc-notify-type=dialog', () => {
    expect(parseManagedType('node script.js --cc-notify-type=dialog')).toBe('dialog');
  });

  test('parses --cc-notify-type=notification', () => {
    expect(parseManagedType('node script.js --cc-notify-type=notification')).toBe('notification');
  });

  test('parses --mode=dialog', () => {
    expect(parseManagedType('node script.js --mode=dialog')).toBe('dialog');
  });

  test('parses --mode=notification', () => {
    expect(parseManagedType('--mode=notification --source=claude')).toBe('notification');
  });

  test('parses browser notification mode', () => {
    expect(parseManagedType('node script.js --mode=browser --cc-notify-type=browser')).toBe('browser');
  });

  test('parses MODE = "dialog" pattern', () => {
    expect(parseManagedType('const MODE = "dialog"')).toBe('dialog');
  });

  test('parses MODE = "notification" pattern', () => {
    expect(parseManagedType("const MODE = 'notification'")).toBe('notification');
  });

  test('returns null when no match', () => {
    expect(parseManagedType('node script.js --source=claude')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseManagedType('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyClaudeDisablePreference
// ---------------------------------------------------------------------------
describe('applyClaudeDisablePreference', () => {
  test('claudeEnabled=true removes claudeNotificationDisabledByUser key', () => {
    const config = { claudeNotificationDisabledByUser: true, other: 'value' };
    const result = applyClaudeDisablePreference(config, true);
    expect(result).not.toHaveProperty('claudeNotificationDisabledByUser');
    expect(result.other).toBe('value');
  });

  test('claudeEnabled=false sets claudeNotificationDisabledByUser=true', () => {
    const config = { other: 'value' };
    const result = applyClaudeDisablePreference(config, false);
    expect(result.claudeNotificationDisabledByUser).toBe(true);
    expect(result.other).toBe('value');
  });

  test('handles null uiConfig gracefully', () => {
    const result = applyClaudeDisablePreference(null, false);
    expect(result.claudeNotificationDisabledByUser).toBe(true);
  });

  test('does not mutate original config object', () => {
    const config = { claudeNotificationDisabledByUser: true };
    applyClaudeDisablePreference(config, true);
    expect(config.claudeNotificationDisabledByUser).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Claude Stop Hook compatibility helpers
// ---------------------------------------------------------------------------
describe('Claude stop hook compatibility helpers', () => {
  test('parseStopHookStatus detects managed stop hook even when external hook appears first', () => {
    const settings = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'echo external-hook' }
            ]
          },
          {
            hooks: [
              { type: 'command', command: 'node /tmp/test-notify-hook.js --source=claude --mode=dialog --cc-notify-type=dialog' }
            ]
          }
        ]
      }
    };

    expect(parseStopHookStatus(settings)).toEqual({ enabled: true, type: 'dialog' });
  });

  test('buildStopHookCommand reuses the managed Claude hook command format', () => {
    const command = buildStopHookCommand('notification');
    expect(command).toContain('notify-hook.js');
    expect(command).toContain('--source=claude');
    expect(command).toContain('--cc-notify-type=notification');
  });

  test('shouldRepairStopHook returns true for old managed path without marker', () => {
    const settings = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'node "/old/path/notify-hook.js"' }
            ]
          }
        ]
      }
    };

    expect(shouldRepairStopHook(settings, '/tmp/test-notify-hook.js', () => false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseCodexNotificationStatus
// ---------------------------------------------------------------------------
describe('parseCodexNotificationStatus', () => {
  test('returns disabled defaults for empty object', () => {
    expect(parseCodexNotificationStatus({})).toEqual({
      enabled: false,
      external: false,
      type: 'notification',
      method: 'notify'
    });
  });

  test('returns disabled defaults when notify is empty array', () => {
    expect(parseCodexNotificationStatus({ notify: [] })).toEqual({
      enabled: false,
      external: false,
      type: 'notification',
      method: 'notify'
    });
  });

  test('detects managed notify command (contains notify-hook.js)', () => {
    const config = {
      notify: ['node', '/tmp/test-notify-hook.js', '--source=codex', '--mode=dialog', '--cc-notify-type=dialog']
    };
    const result = parseCodexNotificationStatus(config);
    expect(result.enabled).toBe(true);
    expect(result.external).toBe(false);
    expect(result.type).toBe('dialog');
    expect(result.method).toBe('notify');
  });

  test('detects managed notify with notification type', () => {
    const config = {
      notify: ['node', '/tmp/test-notify-hook.js', '--source=codex', '--mode=notification', '--cc-notify-type=notification']
    };
    const result = parseCodexNotificationStatus(config);
    expect(result.enabled).toBe(true);
    expect(result.type).toBe('notification');
  });

  test('detects external notify command', () => {
    const config = {
      notify: ['some-other-tool', '--arg']
    };
    const result = parseCodexNotificationStatus(config);
    expect(result.enabled).toBe(false);
    expect(result.external).toBe(true);
    expect(result.method).toBe('notify');
  });
});

// ---------------------------------------------------------------------------
// parseGeminiNotificationStatus
// ---------------------------------------------------------------------------
describe('parseGeminiNotificationStatus', () => {
  test('returns disabled defaults when no hooks', () => {
    expect(parseGeminiNotificationStatus({})).toEqual({
      enabled: false,
      external: false,
      type: 'notification',
      method: 'AfterAgent Hook'
    });
  });

  test('detects managed hook by name coding-tool-notify', () => {
    const settings = {
      hooks: {
        AfterAgent: [
          {
            hooks: [
              { name: 'coding-tool-notify', type: 'command', command: 'node /tmp/test-notify-hook.js --mode=notification' }
            ]
          }
        ]
      }
    };
    const result = parseGeminiNotificationStatus(settings);
    expect(result.enabled).toBe(true);
    expect(result.external).toBe(false);
    expect(result.type).toBe('notification');
  });

  test('detects managed hook by command path containing notify-hook.js', () => {
    const settings = {
      hooks: {
        AfterAgent: [
          {
            hooks: [
              { name: 'custom-name', type: 'command', command: 'node /some/path/notify-hook.js --mode=dialog --cc-notify-type=dialog' }
            ]
          }
        ]
      }
    };
    const result = parseGeminiNotificationStatus(settings);
    expect(result.enabled).toBe(true);
    expect(result.type).toBe('dialog');
  });

  test('detects external hook (not managed)', () => {
    const settings = {
      hooks: {
        AfterAgent: [
          {
            hooks: [
              { name: 'other-hook', type: 'command', command: 'some-other-command' }
            ]
          }
        ]
      }
    };
    const result = parseGeminiNotificationStatus(settings);
    expect(result.enabled).toBe(false);
    expect(result.external).toBe(true);
  });

  test('handles mix of managed and external hooks', () => {
    const settings = {
      hooks: {
        AfterAgent: [
          {
            hooks: [
              { name: 'coding-tool-notify', type: 'command', command: 'node /tmp/test-notify-hook.js --mode=dialog' },
              { name: 'other-hook', type: 'command', command: 'other-tool' }
            ]
          }
        ]
      }
    };
    const result = parseGeminiNotificationStatus(settings);
    expect(result.enabled).toBe(true);
    expect(result.external).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseOpenCodeNotificationStatus
// ---------------------------------------------------------------------------
describe('parseOpenCodeNotificationStatus', () => {
  test('returns disabled defaults for empty string', () => {
    expect(parseOpenCodeNotificationStatus('')).toEqual({
      enabled: false,
      external: false,
      type: 'notification',
      method: 'Plugin Events'
    });
  });

  test('returns enabled=true for non-empty content', () => {
    const result = parseOpenCodeNotificationStatus('some plugin content');
    expect(result.enabled).toBe(true);
    expect(result.external).toBe(false);
    expect(result.method).toBe('Plugin Events');
  });

  test('parses type from content with mode embedded', () => {
    const content = 'const MODE = "dialog"\n// some other content';
    const result = parseOpenCodeNotificationStatus(content);
    expect(result.enabled).toBe(true);
    expect(result.type).toBe('dialog');
  });
});

// ---------------------------------------------------------------------------
// parseOmpNotificationStatus
// ---------------------------------------------------------------------------
describe('parseOmpNotificationStatus', () => {
  test('returns disabled defaults for empty string', () => {
    expect(parseOmpNotificationStatus('')).toEqual({
      enabled: false,
      external: false,
      type: 'notification',
      method: 'Extension Events'
    });
  });

  test('returns enabled=true for non-empty content', () => {
    const result = parseOmpNotificationStatus('some extension content');
    expect(result.enabled).toBe(true);
    expect(result.external).toBe(false);
    expect(result.method).toBe('Extension Events');
  });

  test('parses type from content with mode embedded', () => {
    const content = 'const MODE = "dialog"\n// some other content';
    const result = parseOmpNotificationStatus(content);
    expect(result.enabled).toBe(true);
    expect(result.type).toBe('dialog');
  });
});

// ---------------------------------------------------------------------------
// validateFeishuWebhookUrl
// ---------------------------------------------------------------------------
describe('validateFeishuWebhookUrl', () => {
  test('returns null for null input', () => {
    expect(validateFeishuWebhookUrl(null)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(validateFeishuWebhookUrl('')).toBeNull();
  });

  test('throws statusCode 400 for invalid URL', () => {
    expect(() => validateFeishuWebhookUrl('not-a-url')).toThrow();
    try {
      validateFeishuWebhookUrl('not-a-url');
    } catch (err) {
      expect(err.statusCode).toBe(400);
    }
  });

  test('throws for non-HTTPS URL', () => {
    expect(() => validateFeishuWebhookUrl('http://open.feishu.cn/open-apis/bot/v2/hook/xxx')).toThrow();
    try {
      validateFeishuWebhookUrl('http://open.feishu.cn/open-apis/bot/v2/hook/xxx');
    } catch (err) {
      expect(err.statusCode).toBe(400);
    }
  });

  test('throws for wrong hostname', () => {
    expect(() => validateFeishuWebhookUrl('https://example.com/hook')).toThrow();
    try {
      validateFeishuWebhookUrl('https://example.com/hook');
    } catch (err) {
      expect(err.statusCode).toBe(400);
    }
  });

  test('returns URL object for valid feishu webhook', () => {
    const url = 'https://open.feishu.cn/open-apis/bot/v2/hook/abcdef123456';
    const result = validateFeishuWebhookUrl(url);
    expect(result).toBeInstanceOf(URL);
    expect(result.hostname).toBe('open.feishu.cn');
  });
});

describe('remote notification providers', () => {
  test('normalizes all GA-style remote provider types', () => {
    const result = normalizeRemoteNotificationsConfig({
      providers: [
        { type: 'wechatBot', config: { tokenFile: '~/.wxbot/token.json', targetUserId: 'wx-user' } },
        { type: 'qqBot', config: { endpoint: 'http://127.0.0.1:3000', targetType: 'group', targetId: '123' } },
        { type: 'feishuBot', config: { webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/a' } },
        { type: 'wecomBot', config: { webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=a' } },
        { type: 'dingtalkBot', config: { webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=a' } },
        { type: 'telegramBot', config: { botToken: 'token', chatId: '1' } }
      ]
    });

    expect(result.providers.map(provider => provider.type)).toEqual([
      'wechatBot',
      'qqBot',
      'feishuBot',
      'wecomBot',
      'dingtalkBot',
      'telegramBot'
    ]);
  });

  test('validates qq provider target id', () => {
    expect(() => validateRemoteProviderConfig({
      type: 'qqBot',
      config: { endpoint: 'http://127.0.0.1:3000', targetId: '' }
    })).toThrow('请填写QQ 接收对象 ID');
  });

  test('validates telegram provider required fields', () => {
    expect(() => validateRemoteProviderConfig({
      type: 'telegramBot',
      config: { botToken: 'token', chatId: '' }
    })).toThrow('请填写Telegram Chat ID');
  });
});

// ---------------------------------------------------------------------------
// buildCodexNotifyCommand
// ---------------------------------------------------------------------------
describe('buildCodexNotifyCommand', () => {
  test('returns array with notification type', () => {
    const result = buildCodexNotifyCommand('notification');
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toBe('node');
    expect(result[1]).toMatch(/notify-hook\.js$/);
    expect(result).toContain('--source=codex');
    expect(result).toContain('--mode=notification');
    expect(result).toContain('--cc-notify-type=notification');
  });

  test('returns array with dialog type', () => {
    const result = buildCodexNotifyCommand('dialog');
    expect(result).toContain('--mode=dialog');
    expect(result).toContain('--cc-notify-type=dialog');
  });

  test('returns array with browser type', () => {
    const result = buildCodexNotifyCommand('browser');
    expect(result).toContain('--mode=browser');
    expect(result).toContain('--cc-notify-type=browser');
  });

  test('defaults to notification for invalid type', () => {
    const result = buildCodexNotifyCommand('invalid');
    expect(result).toContain('--mode=notification');
    expect(result).toContain('--cc-notify-type=notification');
  });
});

// ---------------------------------------------------------------------------
// buildClaudeCommand
// ---------------------------------------------------------------------------
describe('buildClaudeCommand', () => {
  test('builds command string for notification type', () => {
    const result = buildClaudeCommand('notification');
    expect(typeof result).toBe('string');
    expect(result).toContain('--source=claude');
    expect(result).toContain('--mode=notification');
    expect(result).toContain('--cc-notify-type=notification');
  });

  test('builds command string for dialog type', () => {
    const result = buildClaudeCommand('dialog');
    expect(result).toContain('--mode=dialog');
    expect(result).toContain('--cc-notify-type=dialog');
  });

  test('builds command string for browser type', () => {
    const result = buildClaudeCommand('browser');
    expect(result).toContain('--mode=browser');
    expect(result).toContain('--cc-notify-type=browser');
  });
});

// ---------------------------------------------------------------------------
// buildGeminiCommand
// ---------------------------------------------------------------------------
describe('buildGeminiCommand', () => {
  test('builds command string for notification type', () => {
    const result = buildGeminiCommand('notification');
    expect(typeof result).toBe('string');
    expect(result).toContain('--source=gemini');
    expect(result).toContain('--mode=notification');
    expect(result).toContain('--cc-notify-type=notification');
  });

  test('builds command string for dialog type', () => {
    const result = buildGeminiCommand('dialog');
    expect(result).toContain('--mode=dialog');
    expect(result).toContain('--cc-notify-type=dialog');
  });

  test('builds command string for browser type', () => {
    const result = buildGeminiCommand('browser');
    expect(result).toContain('--mode=browser');
    expect(result).toContain('--cc-notify-type=browser');
  });
});

// ---------------------------------------------------------------------------
// generateNotifyScript
// ---------------------------------------------------------------------------
describe('generateNotifyScript', () => {
  test('uses Windows popup command for generated notification command', () => {
    const command = generateSystemNotificationCommand('notification', '这是一条测试通知', 'win32');
    expect(command).toContain('PresentationFramework');
    expect(command).toContain('AllowsTransparency');
    expect(command).toContain('DropShadowEffect');
    expect(command).toContain('ShowActivated');
    expect(command).toContain('System.Windows.Forms');
    expect(command).toContain('WorkingArea');
    expect(command).toContain('FormBorderStyle]::None');
    expect(command).not.toContain('FixedToolWindow');
    expect(command).not.toContain('ToastNotificationManager');
  });

  test('keeps Windows popup fallback in generated dialog command', () => {
    const command = generateSystemNotificationCommand('dialog', '这是一条测试通知', 'win32');
    expect(command).toContain('MessageBox');
    expect(command).toContain('-STA');
    expect(command).toContain('PresentationFramework');
    expect(command).toContain('AllowsTransparency');
    expect(command).toContain('System.Windows.Forms');
    expect(command).toContain('WorkingArea');
    expect(command).toContain('||');
  });

  test('embeds Windows popup helper in generated script', () => {
    const script = generateNotifyScript();
    expect(script).toContain('function buildWindowsPopupCommand');
    expect(script).toContain("execFileSync('powershell'");
    expect(script).toContain('PresentationFramework');
    expect(script).toContain('AllowsTransparency');
    expect(script).toContain('DropShadowEffect');
    expect(script).toContain('System.Windows.Forms');
    expect(script).toContain('WorkingArea');
  });

  test('embeds browser notification relay in generated script', () => {
    const script = generateNotifyScript();
    expect(script).toContain('postBrowserNotification');
    expect(script).toContain('/api/hooks/browser-event');
    expect(script).toContain('CONFIG_FILE');
  });

  test('embeds OMP message and display source in generated script', () => {
    const script = generateNotifyScript();
    expect(script).toContain("source === 'omp'");
    expect(script).toContain('OMP 回合已完成 | 等待交互');
    expect(script).toContain('function resolveDisplaySource');
    expect(script).toContain("return 'OMP'");
  });

  test('embeds enabled remote providers in generated script', () => {
    const script = generateNotifyScript({
      providers: [
        {
          type: 'telegramBot',
          enabled: true,
          config: { botToken: 'telegram-token', chatId: '123', proxy: 'http://127.0.0.1:2082' }
        },
        {
          type: 'qqBot',
          enabled: false,
          config: { endpoint: 'http://127.0.0.1:3000', targetId: '456' }
        }
      ]
    });
    expect(script).toContain('REMOTE_PROVIDERS');
    expect(script).toContain('telegram-token');
    expect(script).not.toContain('127.0.0.1:3000');
    expect(script).toContain('sendRemoteProvider');
    expect(script).toContain('createHttpsProxyAgent');
    expect(script).toContain("require('https-proxy-agent')");
    expect(script).toContain('http://127.0.0.1:2082');
  });

  test('embeds DingTalk app sender in generated script', () => {
    const script = generateNotifyScript({
      providers: [
        {
          type: 'dingtalkBot',
          enabled: true,
          config: {
            mode: 'app',
            clientId: 'ding-client',
            clientSecret: 'ding-secret',
            targetType: 'group',
            targetId: 'group-id'
          }
        }
      ]
    });

    expect(script).toContain('fetchDingTalkAccessToken');
    expect(script).toContain('/v1.0/oauth2/accessToken');
    expect(script).toContain('/v1.0/robot/');
    expect(script).toContain('ding-client');
  });
});

// ---------------------------------------------------------------------------
// buildOpenCodePluginContent
// ---------------------------------------------------------------------------
describe('buildOpenCodePluginContent', () => {
  test('embeds notification mode in plugin content', () => {
    const content = buildOpenCodePluginContent('notification');
    expect(typeof content).toBe('string');
    expect(content).toContain('notification');
    expect(content).toContain('CodingToolNotifyPlugin');
  });

  test('embeds dialog mode in plugin content', () => {
    const content = buildOpenCodePluginContent('dialog');
    expect(content).toContain('dialog');
    expect(content).toContain('CodingToolNotifyPlugin');
  });
});

// ---------------------------------------------------------------------------
// buildOmpExtensionContent
// ---------------------------------------------------------------------------
describe('buildOmpExtensionContent', () => {
  test('uses the managed OMP extension path', () => {
    const extensionPath = getOmpManagedExtensionPath().replace(/\\/g, '/');
    expect(extensionPath).toContain('/extensions/');
    expect(extensionPath).toMatch(/\/coding-tool-notify\.ts$/);
  });

  test('embeds notification mode and OMP event handlers in extension content', () => {
    const content = buildOmpExtensionContent('notification');
    expect(typeof content).toBe('string');
    expect(content).toContain('CodingToolNotifyExtension');
    expect(content).toContain('notify-hook.js');
    expect(content).toContain('--source=omp');
    expect(content).toContain('const MODE = "notification"');
    expect(content).toContain('agent_settled');
    expect(content).toContain('turn_end');
    expect(content).toContain('shouldFire');
  });

  test('embeds browser mode in extension content', () => {
    const content = buildOmpExtensionContent('browser');
    expect(content).toContain('const MODE = "browser"');
    expect(content).toContain('CodingToolNotifyExtension');
  });
});

describe('emitBrowserNotification', () => {
  beforeEach(() => {
    mockBroadcastBrowserNotification.mockClear();
  });

  test('broadcasts websocket payload with derived title and route', () => {
    const payload = emitBrowserNotification({
      source: 'codex',
      message: 'Codex CLI 回合已完成 | 等待交互'
    });

    expect(payload.title).toBe('Codex CLI');
    expect(payload.url).toBe('/codex');
    expect(mockBroadcastBrowserNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'browser-notification',
      source: 'codex',
      message: 'Codex CLI 回合已完成 | 等待交互'
    }));
  });

  test('broadcasts OMP websocket payload with derived title and route', () => {
    const payload = emitBrowserNotification({
      source: 'omp',
      message: 'OMP 回合已完成 | 等待交互'
    });

    expect(payload.title).toBe('OMP');
    expect(payload.url).toBe('/omp');
    expect(mockBroadcastBrowserNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'browser-notification',
      source: 'omp',
      message: 'OMP 回合已完成 | 等待交互'
    }));
  });

  test('rejects empty browser notification message', () => {
    expect(() => emitBrowserNotification({ source: 'claude', message: '' })).toThrow('缺少浏览器通知内容');
  });
});
