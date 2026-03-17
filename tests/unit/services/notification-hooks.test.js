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
    notifyHook: '/tmp/test-notify-hook.js'
  },
  NATIVE_PATHS: {
    claude: { settings: '/tmp/test-claude-settings.json' },
    codex: { config: '/tmp/test-codex-config.toml' },
    opencode: { config: '/tmp/test-opencode-config' }
  }
}));

const { _test, MANAGED_HOOK_NAME } = require('../../../src/server/services/notification-hooks');

const {
  parseManagedType,
  applyClaudeDisablePreference,
  parseCodexNotificationStatus,
  parseGeminiNotificationStatus,
  parseOpenCodeNotificationStatus,
  validateFeishuWebhookUrl,
  buildCodexNotifyCommand,
  buildClaudeCommand,
  buildGeminiCommand,
  generateNotifyScript,
  buildOpenCodePluginContent
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
});

// ---------------------------------------------------------------------------
// generateNotifyScript
// ---------------------------------------------------------------------------
describe('generateNotifyScript', () => {
  test('sets FEISHU_ENABLED=false when feishu.enabled is false', () => {
    const script = generateNotifyScript({ enabled: false, webhookUrl: '' });
    expect(script).toContain('FEISHU_ENABLED = false');
  });

  test('sets FEISHU_ENABLED=true and includes webhook URL when feishu enabled with URL', () => {
    const url = 'https://open.feishu.cn/open-apis/bot/v2/hook/test123';
    const script = generateNotifyScript({ enabled: true, webhookUrl: url });
    expect(script).toContain('FEISHU_ENABLED = true');
    expect(script).toContain(url);
  });

  test('sets FEISHU_ENABLED=false when called with no argument', () => {
    const script = generateNotifyScript();
    expect(script).toContain('FEISHU_ENABLED = false');
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
