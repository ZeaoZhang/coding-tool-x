const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { execSync, execFileSync } = require('child_process');
const { PATHS, NATIVE_PATHS } = require('../../config/paths');
const { loadUIConfig, saveUIConfig } = require('./ui-config');
const codexSettingsManager = require('./codex-settings-manager');
const geminiSettingsManager = require('./gemini-settings-manager');

const MANAGED_HOOK_NAME = 'coding-tool-notify';
const MANAGED_OPENCODE_PLUGIN_FILE = 'coding-tool-notify.js';
const MANAGED_OMP_EXTENSION_FILE = 'coding-tool-notify.ts';
const REMOTE_PROVIDER_TYPES = [
  'wechatBot',
  'qqBot',
  'feishuBot',
  'wecomBot',
  'dingtalkBot',
  'telegramBot'
];

const REMOTE_PROVIDER_LABELS = {
  wechatBot: '微信 Bot',
  qqBot: 'QQ Bot',
  feishuBot: '飞书 Bot',
  wecomBot: '企业微信 Bot',
  dingtalkBot: '钉钉 Bot',
  telegramBot: 'Telegram Bot'
};

function normalizeType(type) {
  return type === 'dialog' || type === 'browser' ? type : 'notification';
}

function createClientId(prefix = 'coding-tool') {
  const randomPart = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : crypto.randomBytes(8).toString('hex');
  return `${prefix}-${randomPart}`;
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim() ? JSON.parse(content) : {};
  } catch (error) {
    return {};
  }
}

function writeJsonFile(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readClaudeSettings() {
  return readJsonFile(NATIVE_PATHS.claude.settings);
}

function writeClaudeSettings(settings) {
  writeJsonFile(NATIVE_PATHS.claude.settings, settings);
}

function trimString(value) {
  return String(value || '').trim();
}

function normalizeRemoteProviderType(type) {
  const value = trimString(type);
  return REMOTE_PROVIDER_TYPES.includes(value) ? value : '';
}

function createRemoteProviderId(type, index = 0) {
  return `${type || 'provider'}-${Date.now().toString(36)}-${index}`;
}

function normalizeProviderConfig(type, config = {}) {
  const source = config && typeof config === 'object' ? config : {};
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
      return {
        webhookUrl: trimString(source.webhookUrl)
      };
    case 'wecomBot':
      return {
        webhookUrl: trimString(source.webhookUrl)
      };
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

function normalizeRemoteProvider(provider = {}, index = 0) {
  const type = normalizeRemoteProviderType(provider.type);
  if (!type) {
    return null;
  }

  return {
    id: trimString(provider.id) || createRemoteProviderId(type, index),
    type,
    name: trimString(provider.name) || REMOTE_PROVIDER_LABELS[type],
    enabled: provider.enabled === true,
    config: normalizeProviderConfig(type, provider.config)
  };
}

function normalizeRemoteNotificationsConfig(remoteNotifications = {}) {
  const source = remoteNotifications && typeof remoteNotifications === 'object' ? remoteNotifications : {};
  const providers = Array.isArray(source.providers)
    ? source.providers.map((provider, index) => normalizeRemoteProvider(provider, index)).filter(Boolean)
    : [];

  return {
    providers
  };
}

function getRemoteNotificationsConfig(uiConfig = loadUIConfig()) {
  return normalizeRemoteNotificationsConfig(uiConfig.remoteNotifications);
}

function applyClaudeDisablePreference(uiConfig = {}, claudeEnabled) {
  const nextConfig = (uiConfig && typeof uiConfig === 'object') ? { ...uiConfig } : {};
  if (claudeEnabled) {
    delete nextConfig.claudeNotificationDisabledByUser;
  } else {
    nextConfig.claudeNotificationDisabledByUser = true;
  }
  return nextConfig;
}

function saveNotificationUiConfig(remoteNotifications = {}, claudeEnabled) {
  let uiConfig = loadUIConfig();
  if (typeof claudeEnabled === 'boolean') {
    uiConfig = applyClaudeDisablePreference(uiConfig, claudeEnabled);
  }
  uiConfig.remoteNotifications = normalizeRemoteNotificationsConfig(remoteNotifications);
  delete uiConfig.feishuNotification;
  saveUIConfig(uiConfig);
}

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateFeishuWebhookUrl(webhookUrl) {
  const value = String(webhookUrl || '').trim();
  if (!value) {
    return null;
  }

  let urlObj;
  try {
    urlObj = new URL(value);
  } catch (error) {
    throw createValidationError('飞书 Webhook URL 格式不正确');
  }

  if (urlObj.protocol !== 'https:') {
    throw createValidationError('飞书 Webhook 必须使用 HTTPS');
  }

  if (urlObj.hostname !== 'open.feishu.cn') {
    throw createValidationError('仅支持 open.feishu.cn 的飞书 Webhook');
  }

  return urlObj;
}

function validateHttpsUrl(value, label, options = {}) {
  const raw = trimString(value);
  if (!raw) {
    return null;
  }

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
  if (!trimString(config?.[key])) {
    throw createValidationError(`请填写${label}`);
  }
}

function validateRemoteProviderConfig(provider = {}) {
  const type = normalizeRemoteProviderType(provider.type);
  const config = provider.config || {};
  if (!type) {
    throw createValidationError('远程通知渠道类型不正确');
  }

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
      break;
  }
}

function validateRemoteNotifications(remoteNotifications = {}) {
  const remote = normalizeRemoteNotificationsConfig(remoteNotifications);
  remote.providers.forEach((provider) => {
    if (provider.enabled === true) {
      validateRemoteProviderConfig(provider);
    }
  });
  return remote;
}

function removeNotifyScript() {
  if (fs.existsSync(PATHS.notifyHook)) {
    fs.unlinkSync(PATHS.notifyHook);
  }
}

function parseManagedType(input) {
  const value = String(input || '');
  const matches = [
    value.match(/--cc-notify-type=(dialog|notification|browser)/i),
    value.match(/--mode=(dialog|notification|browser)/i),
    value.match(/MODE\s*=\s*["'](dialog|notification|browser)["']/i)
  ];

  for (const match of matches) {
    if (match?.[1]) {
      return normalizeType(match[1].toLowerCase());
    }
  }

  return null;
}

function getManagedCommandType(input) {
  return parseManagedType(input);
}

function isManagedNotifyPath(input) {
  const normalizedInput = String(input || '').replace(/\\/g, '/');
  const normalizedPath = String(PATHS.notifyHook || '').replace(/\\/g, '/');
  return normalizedInput.includes('notify-hook.js') || (normalizedPath && normalizedInput.includes(normalizedPath));
}

function buildManagedArgs(source, type, extra = []) {
  const mode = normalizeType(type);
  return [
    `--source=${source}`,
    `--mode=${mode}`,
    `--cc-notify-type=${mode}`,
    ...extra
  ];
}

function quoteShellArg(value) {
  const stringValue = String(value || '');
  if (/^[A-Za-z0-9_./:=+-]+$/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/"/g, '\\"')}"`;
}

function buildClaudeCommand(type) {
  const mode = normalizeType(type);
  const args = ['node', PATHS.notifyHook, `--source=claude`, `--mode=${mode}`, `--cc-notify-type=${mode}`];
  return `${quoteShellArg(args[0])} ${quoteShellArg(args[1])} ${args.slice(2).map(quoteShellArg).join(' ')}`;
}

function buildCodexNotifyCommand(type) {
  const mode = normalizeType(type);
  return ['node', PATHS.notifyHook, `--source=codex`, `--mode=${mode}`, `--cc-notify-type=${mode}`];
}

function buildGeminiCommand(type) {
  const mode = normalizeType(type);
  const args = ['node', PATHS.notifyHook, `--source=gemini`, `--mode=${mode}`, `--cc-notify-type=${mode}`];
  return `${quoteShellArg(args[0])} ${quoteShellArg(args[1])} ${args.slice(2).map(quoteShellArg).join(' ')}`;
}

function getOpenCodeManagedPluginPath() {
  return path.join(NATIVE_PATHS.opencode.config, 'plugins', MANAGED_OPENCODE_PLUGIN_FILE);
}

function getOmpManagedExtensionPath() {
  const ompPaths = NATIVE_PATHS.omp || {};
  const extensionsDir = ompPaths.extensions ||
    path.join(ompPaths.dir || path.dirname(ompPaths.settings || PATHS.notifyHook), 'extensions');
  return path.join(extensionsDir, MANAGED_OMP_EXTENSION_FILE);
}

function buildOpenCodePluginContent(type) {
  const mode = normalizeType(type);
  return `// Managed by Coding Tool. Do not edit manually.
// mode:${mode}
import { spawn } from 'node:child_process'

const SCRIPT_PATH = ${JSON.stringify(PATHS.notifyHook)}
const MODE = ${JSON.stringify(mode)}

function fire(eventType) {
  try {
    const child = spawn('node', [
      SCRIPT_PATH,
      '--source=opencode',
      \`--mode=\${MODE}\`,
      \`--cc-notify-type=\${MODE}\`,
      \`--event-type=\${eventType}\`
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  } catch (error) {
    // Ignore notification failures.
  }
}

export const CodingToolNotifyPlugin = async () => ({
  event: async ({ event }) => {
    const eventType = event?.type
    if (eventType === 'session.idle' || eventType === 'session.error') {
      fire(eventType)
    }
  }
})
`;
}

function buildOmpExtensionContent(type) {
  const mode = normalizeType(type);
  return `// Managed by Coding Tool. Do not edit manually.
// mode:${mode}
import { spawn } from 'node:child_process'

const SCRIPT_PATH = ${JSON.stringify(PATHS.notifyHook)}
const MODE = ${JSON.stringify(mode)}
let lastFireAt = 0

function shouldFire() {
  const now = Date.now()
  if (now - lastFireAt < 1000) {
    return false
  }
  lastFireAt = now
  return true
}

function fire(eventType) {
  if (!shouldFire()) {
    return
  }

  try {
    const child = spawn('node', [
      SCRIPT_PATH,
      '--source=omp',
      \`--mode=\${MODE}\`,
      \`--cc-notify-type=\${MODE}\`,
      \`--event-type=\${eventType}\`
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  } catch (error) {
    // Ignore notification failures.
  }
}

export default async function CodingToolNotifyExtension(omp) {
  const register = (eventName) => {
    if (typeof omp?.on !== 'function') {
      return
    }
    omp.on(eventName, async () => {
      fire(eventName)
    })
  }

  register('agent_settled')
  register('turn_end')
}
`;
}

function escapeForAppleScript(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeForPowerShellSingleQuote(value) {
  return String(value || '').replace(/'/g, "''");
}

function escapeForXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildWindowsPopupCommand(title, message) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$titleText = '${escapeForPowerShellSingleQuote(title)}'`,
    `$messageText = '${escapeForPowerShellSingleQuote(message)}'`,
    "$segments = $messageText -split '\\s*\\|\\s*', 2",
    "$headlineText = if ($segments.Length -ge 1) { $segments[0] } else { $messageText }",
    "$detailText = if ($segments.Length -ge 2) { $segments[1] } else { '' }",
    'try {',
    'Add-Type -AssemblyName PresentationFramework',
    'Add-Type -AssemblyName PresentationCore',
    'Add-Type -AssemblyName WindowsBase',
    '$brushConverter = New-Object System.Windows.Media.BrushConverter',
    '$window = New-Object System.Windows.Window',
    '$window.Width = 372',
    '$window.Height = 118',
    '$window.WindowStyle = [System.Windows.WindowStyle]::None',
    '$window.ResizeMode = [System.Windows.ResizeMode]::NoResize',
    '$window.AllowsTransparency = $true',
    '$window.Background = [System.Windows.Media.Brushes]::Transparent',
    '$window.ShowInTaskbar = $false',
    '$window.Topmost = $true',
    '$window.ShowActivated = $false',
    '$window.Opacity = 0',
    '$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual',
    '$root = New-Object System.Windows.Controls.Border',
    '$root.CornerRadius = New-Object System.Windows.CornerRadius -ArgumentList 20',
    '$root.Padding = New-Object System.Windows.Thickness -ArgumentList 16',
    "$root.Background = $brushConverter.ConvertFromString('#F3F4F7')",
    "$root.BorderBrush = $brushConverter.ConvertFromString('#D9DBE3')",
    '$root.BorderThickness = New-Object System.Windows.Thickness -ArgumentList 1',
    '$shadow = New-Object System.Windows.Media.Effects.DropShadowEffect',
    "$shadow.Color = [System.Windows.Media.ColorConverter]::ConvertFromString('#22000000')",
    '$shadow.BlurRadius = 26',
    '$shadow.ShadowDepth = 0',
    '$shadow.Opacity = 0.85',
    '$root.Effect = $shadow',
    '$grid = New-Object System.Windows.Controls.Grid',
    '$iconColumn = New-Object System.Windows.Controls.ColumnDefinition',
    '$iconColumn.Width = New-Object System.Windows.GridLength -ArgumentList 44',
    '$contentColumn = New-Object System.Windows.Controls.ColumnDefinition',
    '$grid.ColumnDefinitions.Add($iconColumn) | Out-Null',
    '$grid.ColumnDefinitions.Add($contentColumn) | Out-Null',
    '$iconHolder = New-Object System.Windows.Controls.Border',
    '$iconHolder.Width = 34',
    '$iconHolder.Height = 34',
    '$iconHolder.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left',
    '$iconHolder.VerticalAlignment = [System.Windows.VerticalAlignment]::Top',
    '$iconHolder.CornerRadius = New-Object System.Windows.CornerRadius -ArgumentList 17',
    "$iconHolder.Background = $brushConverter.ConvertFromString('#DDEBFF')",
    '$iconGlyph = New-Object System.Windows.Controls.TextBlock',
    '$iconGlyph.Text = [char]0x2713',
    '$iconGlyph.FontSize = 18',
    '$iconGlyph.FontWeight = [System.Windows.FontWeights]::Bold',
    "$iconGlyph.Foreground = $brushConverter.ConvertFromString('#0A84FF')",
    '$iconGlyph.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center',
    '$iconGlyph.VerticalAlignment = [System.Windows.VerticalAlignment]::Center',
    '$iconHolder.Child = $iconGlyph',
    '$contentStack = New-Object System.Windows.Controls.StackPanel',
    '$contentStack.Orientation = [System.Windows.Controls.Orientation]::Vertical',
    '$contentStack.Margin = New-Object System.Windows.Thickness -ArgumentList 4,0,0,0',
    '$metaGrid = New-Object System.Windows.Controls.Grid',
    '$metaGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition)) | Out-Null',
    '$timeColumn = New-Object System.Windows.Controls.ColumnDefinition',
    '$timeColumn.Width = [System.Windows.GridLength]::Auto',
    '$metaGrid.ColumnDefinitions.Add($timeColumn) | Out-Null',
    '$appLabel = New-Object System.Windows.Controls.TextBlock',
    '$appLabel.Text = $titleText',
    '$appLabel.FontSize = 11.5',
    '$appLabel.FontWeight = [System.Windows.FontWeights]::SemiBold',
    "$appLabel.Foreground = $brushConverter.ConvertFromString('#6B6C73')",
    '$appLabel.TextTrimming = [System.Windows.TextTrimming]::CharacterEllipsis',
    '$stampLabel = New-Object System.Windows.Controls.TextBlock',
    "$stampLabel.Text = '刚刚'",
    '$stampLabel.FontSize = 11',
    "$stampLabel.Foreground = $brushConverter.ConvertFromString('#8D8E95')",
    '$stampLabel.Margin = New-Object System.Windows.Thickness -ArgumentList 12,0,0,0',
    '[System.Windows.Controls.Grid]::SetColumn($stampLabel, 1)',
    '$metaGrid.Children.Add($appLabel) | Out-Null',
    '$metaGrid.Children.Add($stampLabel) | Out-Null',
    '$headlineLabel = New-Object System.Windows.Controls.TextBlock',
    '$headlineLabel.Text = $headlineText',
    '$headlineLabel.FontSize = 14',
    '$headlineLabel.FontWeight = [System.Windows.FontWeights]::SemiBold',
    "$headlineLabel.Foreground = $brushConverter.ConvertFromString('#1F2024')",
    '$headlineLabel.TextWrapping = [System.Windows.TextWrapping]::Wrap',
    '$headlineLabel.Margin = New-Object System.Windows.Thickness -ArgumentList 0,6,0,0',
    '$detailLabel = New-Object System.Windows.Controls.TextBlock',
    '$detailLabel.Text = $detailText',
    '$detailLabel.FontSize = 12',
    "$detailLabel.Foreground = $brushConverter.ConvertFromString('#5F6168')",
    '$detailLabel.TextWrapping = [System.Windows.TextWrapping]::Wrap',
    '$detailLabel.Margin = New-Object System.Windows.Thickness -ArgumentList 0,4,0,0',
    '$detailLabel.Visibility = if ([string]::IsNullOrWhiteSpace($detailText)) { [System.Windows.Visibility]::Collapsed } else { [System.Windows.Visibility]::Visible }',
    '$contentStack.Children.Add($metaGrid) | Out-Null',
    '$contentStack.Children.Add($headlineLabel) | Out-Null',
    '$contentStack.Children.Add($detailLabel) | Out-Null',
    '[System.Windows.Controls.Grid]::SetColumn($contentStack, 1)',
    '$grid.Children.Add($iconHolder) | Out-Null',
    '$grid.Children.Add($contentStack) | Out-Null',
    '$root.Child = $grid',
    '$window.Content = $root',
    '$workArea = [System.Windows.SystemParameters]::WorkArea',
    '$window.Left = $workArea.Right - $window.Width - 18',
    '$window.Top = $workArea.Top + 18',
    '$frame = New-Object System.Windows.Threading.DispatcherFrame',
    '$window.Add_Closed({ $frame.Continue = $false })',
    '$closeTimer = New-Object System.Windows.Threading.DispatcherTimer',
    '$closeTimer.Interval = [TimeSpan]::FromMilliseconds(4600)',
    '$closeTimer.Add_Tick({',
    '  $closeTimer.Stop()',
    '  $fadeOut = New-Object System.Windows.Media.Animation.DoubleAnimation',
    '  $fadeOut.From = $window.Opacity',
    '  $fadeOut.To = 0',
    '  $fadeOut.Duration = [TimeSpan]::FromMilliseconds(220)',
    '  $fadeOut.Add_Completed({ $window.Close() })',
    '  $window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fadeOut)',
    '})',
    '$window.Show()',
    '$fadeIn = New-Object System.Windows.Media.Animation.DoubleAnimation',
    '$fadeIn.From = 0',
    '$fadeIn.To = 1',
    '$fadeIn.Duration = [TimeSpan]::FromMilliseconds(180)',
    '$window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fadeIn)',
    '$closeTimer.Start()',
    '[System.Windows.Threading.Dispatcher]::PushFrame($frame)',
    '} catch {',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$form = New-Object System.Windows.Forms.Form',
    '$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
    '$form.BackColor = [System.Drawing.Color]::FromArgb(247, 247, 250)',
    '$form.Width = 360',
    '$form.Height = 118',
    '$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual',
    '$form.ShowInTaskbar = $false',
    '$form.TopMost = $true',
    '$form.MaximizeBox = $false',
    '$form.MinimizeBox = $false',
    '$workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea',
    '$form.Location = New-Object System.Drawing.Point(($workingArea.Right - $form.Width - 18), ($workingArea.Top + 18))',
    '$iconPanel = New-Object System.Windows.Forms.Panel',
    '$iconPanel.Width = 34',
    '$iconPanel.Height = 34',
    '$iconPanel.BackColor = [System.Drawing.Color]::FromArgb(221, 235, 255)',
    '$iconPanel.Location = New-Object System.Drawing.Point(16, 18)',
    '$iconLabel = New-Object System.Windows.Forms.Label',
    '$iconLabel.Text = [char]0x2713',
    "$iconLabel.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)",
    '$iconLabel.ForeColor = [System.Drawing.Color]::FromArgb(10, 132, 255)',
    '$iconLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter',
    '$iconLabel.Dock = [System.Windows.Forms.DockStyle]::Fill',
    '$iconPanel.Controls.Add($iconLabel)',
    '$titleLabel = New-Object System.Windows.Forms.Label',
    '$titleLabel.Text = $titleText',
    "$titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)",
    '$titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(109, 110, 115)',
    '$titleLabel.AutoSize = $true',
    '$titleLabel.Location = New-Object System.Drawing.Point(60, 16)',
    '$headlineLabel = New-Object System.Windows.Forms.Label',
    '$headlineLabel.Text = $headlineText',
    "$headlineLabel.Font = New-Object System.Drawing.Font('Segoe UI', 10.5, [System.Drawing.FontStyle]::Bold)",
    '$headlineLabel.ForeColor = [System.Drawing.Color]::FromArgb(31, 32, 36)',
    '$headlineLabel.MaximumSize = New-Object System.Drawing.Size(272, 0)',
    '$headlineLabel.AutoSize = $true',
    '$headlineLabel.Location = New-Object System.Drawing.Point(60, 36)',
    '$detailLabel = New-Object System.Windows.Forms.Label',
    '$detailLabel.Text = $detailText',
    "$detailLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)",
    '$detailLabel.ForeColor = [System.Drawing.Color]::FromArgb(95, 97, 104)',
    '$detailLabel.MaximumSize = New-Object System.Drawing.Size(272, 0)',
    '$detailLabel.AutoSize = $true',
    '$detailLabel.Location = New-Object System.Drawing.Point(60, 60)',
    '$detailLabel.Visible = -not [string]::IsNullOrWhiteSpace($detailText)',
    '$form.Controls.Add($iconPanel)',
    '$form.Controls.Add($titleLabel)',
    '$form.Controls.Add($headlineLabel)',
    '$form.Controls.Add($detailLabel)',
    '$timer = New-Object System.Windows.Forms.Timer',
    '$timer.Interval = 4800',
    '$timer.Add_Tick({ $timer.Stop(); $form.Close() })',
    '$timer.Start()',
    '[void]$form.ShowDialog()',
    '}'
  ].join('; ');
  return script;
}

function runWindowsPowerShellCommand(command) {
  // Invoke PowerShell directly so the styled popup script doesn't hit cmd.exe's 8191-char limit.
  execFileSync('powershell', ['-NoProfile', '-STA', '-Command', command], {
    stdio: 'ignore',
    windowsHide: true
  });
}

function generateNotifyScript(remoteNotifications = {}) {
  const remote = normalizeRemoteNotificationsConfig(remoteNotifications);
  const enabledProviders = remote.providers.filter((provider) => provider.enabled === true);

  return `#!/usr/bin/env node
// Coding Tool 通知脚本 - 自动生成，请勿手动修改
const fs = require('fs')
const os = require('os')
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const { execSync, execFileSync } = require('child_process')

function createHttpsProxyAgent(proxyUrl) {
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent')
    return new HttpsProxyAgent(proxyUrl)
  } catch (error) {
    return null
  }
}

const REMOTE_PROVIDERS = ${JSON.stringify(enabledProviders)}
const CONFIG_FILE = ${JSON.stringify(PATHS.configFile)}

function createClientId(prefix = 'coding-tool') {
  const randomPart = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : crypto.randomBytes(8).toString('hex')
  return prefix + '-' + randomPart
}

function readArg(name) {
  const prefix = \`\${name}=\`
  const matched = process.argv.slice(2).find((arg) => String(arg || '').startsWith(prefix))
  return matched ? matched.slice(prefix.length) : ''
}

function readOptionalPayload() {
  const payloadCandidates = []

  if (!process.stdin.isTTY) {
    try {
      const raw = fs.readFileSync(0, 'utf8').trim()
      if (raw) payloadCandidates.push(raw)
    } catch (error) {
      // ignore stdin read errors
    }
  }

  for (const arg of process.argv.slice(2)) {
    const trimmed = String(arg || '').trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      payloadCandidates.push(trimmed)
    }
  }

  for (const raw of payloadCandidates) {
    try {
      return JSON.parse(raw)
    } catch (error) {
      // ignore malformed payloads
    }
  }

  return null
}

function resolveMessage(source, eventType, payload) {
  const effectiveEventType = eventType || payload?.type || payload?.hook_event?.event_type || ''

  if (source === 'codex') {
    if (effectiveEventType === 'agent-turn-complete') {
      return 'Codex CLI 回合已完成 | 等待交互'
    }
    return 'Codex CLI 已返回结果 | 等待交互'
  }

  if (source === 'gemini') {
    return 'Gemini CLI 回合已完成 | 等待交互'
  }

  if (source === 'opencode') {
    if (effectiveEventType === 'session.error') {
      return 'OpenCode 会话异常，请检查日志'
    }
    return 'OpenCode 响应已完成 | 等待交互'
  }

  if (source === 'omp') {
    return 'OMP 回合已完成 | 等待交互'
  }

  return 'Claude Code 任务已完成 | 等待交互'
}

function readWebUiPort() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    const port = parseInt(config?.ports?.webUI, 10)
    return Number.isFinite(port) ? port : 19999
  } catch (error) {
    return 19999
  }
}

function postBrowserNotification(source, eventType, message) {
  const payload = JSON.stringify({
    source,
    eventType,
    message
  })
  const port = readWebUiPort()
  const attempts = [
    { module: https, options: { rejectUnauthorized: false } },
    { module: http, options: {} }
  ]

  return new Promise((resolve) => {
    const runAttempt = (index) => {
      const current = attempts[index]
      if (!current) {
        resolve()
        return
      }

      const request = current.module.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/hooks/browser-event',
        method: 'POST',
        timeout: 1500,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        ...current.options
      }, (response) => {
        response.resume()
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve()
          return
        }
        runAttempt(index + 1)
      })

      request.on('error', () => runAttempt(index + 1))
      request.on('timeout', () => {
        request.destroy()
        runAttempt(index + 1)
      })
      request.write(payload)
      request.end()
    }

    runAttempt(0)
  })
}

function notify(mode, message) {
  const title = 'Coding Tool'
  const platform = os.platform()

  if (mode === 'browser') {
    return
  }

  try {
    if (platform === 'darwin') {
      if (mode === 'dialog') {
        const appleScript = 'display dialog "' + escapeForAppleScript(message) +
          '" with title "' + escapeForAppleScript(title) +
          '" buttons {"好的"} default button 1 with icon note'
        execSync('osascript -e ' + JSON.stringify(appleScript), { stdio: 'ignore', windowsHide: true })
      } else {
        const fallbackScript = 'display notification "' + escapeForAppleScript(message) +
          '" with title "' + escapeForAppleScript(title) + '" sound name "Glass"'
        const command = 'if command -v terminal-notifier >/dev/null 2>&1; then ' +
          'terminal-notifier -title ' + JSON.stringify(title) +
          ' -message ' + JSON.stringify(message) +
          ' -sound Glass -activate com.apple.Terminal; ' +
          'else osascript -e ' + JSON.stringify(fallbackScript) + '; fi'
        execSync(command, { stdio: 'ignore', windowsHide: true })
      }
      return
    }

    if (platform === 'win32') {
      const popupCommand = buildWindowsPopupCommand(title, message)
      if (mode === 'dialog') {
        const ps = "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('" +
          escapeForPowerShellSingleQuote(message) + "', '" +
          escapeForPowerShellSingleQuote(title) + "', 'OK', 'Information')"
        try {
          runWindowsPowerShellCommand(ps)
        } catch (dialogError) {
          runWindowsPowerShellCommand(popupCommand)
        }
      } else {
        runWindowsPowerShellCommand(popupCommand)
      }
      return
    }

    const escapedTitle = String(title || '').replace(/"/g, '\\"')
    const escapedMessage = String(message || '').replace(/"/g, '\\"')
    if (mode === 'dialog') {
      execSync(
        'zenity --info --title="' + escapedTitle + '" --text="' + escapedMessage +
        '" 2>/dev/null || notify-send "' + escapedTitle + '" "' + escapedMessage + '"',
        { stdio: 'ignore', windowsHide: true }
      )
    } else {
      execSync('notify-send "' + escapedTitle + '" "' + escapedMessage + '"', { stdio: 'ignore', windowsHide: true })
    }
  } catch (error) {
    // ignore system notification failures
  }
}

function postJson(url, data, headers = {}, extraOptions = {}) {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(url)
      const body = JSON.stringify(data)
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers
        },
        ...extraOptions,
        timeout: 10000
      }

      const requestModule = urlObj.protocol === 'https:' ? https : http
      const request = requestModule.request(options, (response) => {
        response.resume()
        resolve()
      })
      request.on('error', () => resolve())
      request.on('timeout', () => {
        request.destroy()
        resolve()
      })
      request.write(body)
      request.end()
    } catch (error) {
      resolve()
    }
  })
}

function sendTelegramMessage(config = {}, ctx, send = postJson) {
  const url = 'https://api.telegram.org/bot' + config.botToken + '/sendMessage'
  const payload = {
    chat_id: config.chatId,
    text: formatPlainMessage(ctx)
  }
  const agent = config.proxy ? createHttpsProxyAgent(config.proxy) : null
  return send(url, payload, {}, agent ? { agent } : {})
}

function resolveDisplaySource(source) {
  if (source === 'omp') return 'OMP'
  return source
}

function buildNotificationContext(message, source, eventType) {
  const timestamp = new Date().toLocaleString('zh-CN')
  return {
    title: 'Coding Tool - 通知',
    message,
    source: resolveDisplaySource(source),
    eventType,
    timestamp,
    hostname: os.hostname()
  }
}

function formatPlainMessage(ctx) {
  return [
    ctx.title,
    '来源: ' + ctx.source,
    '状态: ' + ctx.message,
    '时间: ' + ctx.timestamp,
    '设备: ' + ctx.hostname
  ].join('\\n')
}

function readWechatToken(config = {}) {
  if (config.botToken) return config.botToken
  if (!config.tokenFile) return ''
  try {
    const raw = fs.readFileSync(String(config.tokenFile), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed.bot_token || parsed.token || ''
  } catch (error) {
    return ''
  }
}

function fetchDingTalkAccessToken(config = {}) {
  if (!config.clientId || !config.clientSecret) return Promise.resolve('')
  return new Promise((resolve) => {
    try {
      const data = JSON.stringify({ appKey: config.clientId, appSecret: config.clientSecret })
      const req = https.request({
        hostname: 'api.dingtalk.com',
        path: '/v1.0/oauth2/accessToken',
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      }, (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body)
            resolve(parsed.accessToken || '')
          } catch (error) {
            resolve('')
          }
        })
      })
      req.on('error', () => resolve(''))
      req.on('timeout', () => {
        req.destroy()
        resolve('')
      })
      req.write(data)
      req.end()
    } catch (error) {
      resolve('')
    }
  })
}

async function sendDingTalkAppMessage(config = {}, ctx) {
  const token = await fetchDingTalkAccessToken(config)
  if (!token || !config.targetId) return
  const isGroup = config.targetType !== 'user'
  const payload = {
    robotCode: config.clientId,
    msgKey: 'sampleMarkdown',
    msgParam: JSON.stringify({
      title: ctx.title,
      text: '### ' + ctx.title + '\\n\\n- 来源: ' + ctx.source + '\\n- 状态: ' + ctx.message + '\\n- 时间: ' + ctx.timestamp + '\\n- 设备: ' + ctx.hostname
    })
  }
  if (isGroup) {
    payload.openConversationId = config.targetId
  } else {
    payload.userIds = [config.targetId]
  }
  return postJson(
    'https://api.dingtalk.com/v1.0/robot/' + (isGroup ? 'groupMessages/send' : 'oToMessages/batchSend'),
    payload,
    { 'x-acs-dingtalk-access-token': token }
  )
}

function sendRemoteProvider(provider, ctx) {
  const config = provider?.config || {}
  switch (provider?.type) {
    case 'wechatBot': {
      const token = readWechatToken(config)
      if (!token || !config.targetUserId) return Promise.resolve()
      return postJson('https://ilinkai.weixin.qq.com/ilink/bot/sendmessage', {
        msg: {
          from_user_id: '',
          to_user_id: config.targetUserId,
          client_id: createClientId('coding-tool'),
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text: formatPlainMessage(ctx) } }],
          ...(config.contextToken ? { context_token: config.contextToken } : {})
        },
        base_info: { channel_version: '2.1.8' }
      }, {
        AuthorizationType: 'ilink_bot_token',
        Authorization: 'Bearer ' + token,
        'X-WECHAT-UIN': Buffer.from(String(Math.floor(Math.random() * 0xffffffff))).toString('base64')
      })
    }
    case 'qqBot': {
      if (!config.endpoint || !config.targetId) return Promise.resolve()
      const path = config.targetType === 'group' ? '/send_group_msg' : '/send_private_msg'
      const base = String(config.endpoint).replace(/\\/$/, '')
      return postJson(base + path, {
        [config.targetType === 'group' ? 'group_id' : 'user_id']: config.targetId,
        message: formatPlainMessage(ctx)
      }, config.accessToken ? { Authorization: 'Bearer ' + config.accessToken } : {})
    }
    case 'feishuBot': {
      if (!config.webhookUrl) return Promise.resolve()
      return postJson(config.webhookUrl, {
        msg_type: 'interactive',
        card: {
          header: {
            title: { tag: 'plain_text', content: ctx.title },
            template: 'green'
          },
          elements: [
            { tag: 'div', text: { tag: 'lark_md', content: '**来源**: ' + ctx.source } },
            { tag: 'div', text: { tag: 'lark_md', content: '**状态**: ' + ctx.message } },
            { tag: 'div', text: { tag: 'lark_md', content: '**时间**: ' + ctx.timestamp } },
            { tag: 'div', text: { tag: 'lark_md', content: '**设备**: ' + ctx.hostname } }
          ]
        }
      })
    }
    case 'wecomBot': {
      if (!config.webhookUrl) return Promise.resolve()
      return postJson(config.webhookUrl, {
        msgtype: 'markdown',
        markdown: {
          content: '**' + ctx.title + '**\\n> 来源: ' + ctx.source + '\\n> 状态: ' + ctx.message + '\\n> 时间: ' + ctx.timestamp + '\\n> 设备: ' + ctx.hostname
        }
      })
    }
    case 'dingtalkBot': {
      if (config.mode === 'app') return sendDingTalkAppMessage(config, ctx)
      if (!config.webhookUrl) return Promise.resolve()
      return postJson(config.webhookUrl, {
        msgtype: 'markdown',
        markdown: {
          title: ctx.title,
          text: '### ' + ctx.title + '\\n\\n- 来源: ' + ctx.source + '\\n- 状态: ' + ctx.message + '\\n- 时间: ' + ctx.timestamp + '\\n- 设备: ' + ctx.hostname
        }
      })
    }
    case 'telegramBot': {
      if (!config.botToken || !config.chatId) return Promise.resolve()
      return sendTelegramMessage(config, ctx)
    }
    default:
      return Promise.resolve()
  }
}

async function sendRemoteNotifications(message, source, eventType) {
  const ctx = buildNotificationContext(message, source, eventType)
  for (const provider of REMOTE_PROVIDERS) {
    await sendRemoteProvider(provider, ctx)
  }
}

(async () => {
  const source = readArg('--source') || 'claude'
  const mode = readArg('--mode') || readArg('--cc-notify-type') || 'notification'
  const eventType = readArg('--event-type') || ''
  const payload = readOptionalPayload()
  const message = resolveMessage(source, eventType, payload)

  if (mode === 'browser') {
    await postBrowserNotification(source, eventType, message)
  } else {
    notify(mode, message)
  }
  await sendRemoteNotifications(message, source, eventType)
})().catch(() => {
  process.exit(0)
})

function escapeForAppleScript(value) {
  return String(value || '').replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"')
}

function escapeForPowerShellSingleQuote(value) {
  return String(value || '').replace(/'/g, "''")
}

function escapeForXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildWindowsPopupCommand(title, message) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    \`$titleText = '\${escapeForPowerShellSingleQuote(title)}'\`,
    \`$messageText = '\${escapeForPowerShellSingleQuote(message)}'\`,
    "$segments = $messageText -split '\\\\s*\\\\|\\\\s*', 2",
    "$headlineText = if ($segments.Length -ge 1) { $segments[0] } else { $messageText }",
    "$detailText = if ($segments.Length -ge 2) { $segments[1] } else { '' }",
    'try {',
    'Add-Type -AssemblyName PresentationFramework',
    'Add-Type -AssemblyName PresentationCore',
    'Add-Type -AssemblyName WindowsBase',
    '$brushConverter = New-Object System.Windows.Media.BrushConverter',
    '$window = New-Object System.Windows.Window',
    '$window.Width = 372',
    '$window.Height = 118',
    '$window.WindowStyle = [System.Windows.WindowStyle]::None',
    '$window.ResizeMode = [System.Windows.ResizeMode]::NoResize',
    '$window.AllowsTransparency = $true',
    '$window.Background = [System.Windows.Media.Brushes]::Transparent',
    '$window.ShowInTaskbar = $false',
    '$window.Topmost = $true',
    '$window.ShowActivated = $false',
    '$window.Opacity = 0',
    '$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual',
    '$root = New-Object System.Windows.Controls.Border',
    '$root.CornerRadius = New-Object System.Windows.CornerRadius -ArgumentList 20',
    '$root.Padding = New-Object System.Windows.Thickness -ArgumentList 16',
    "$root.Background = $brushConverter.ConvertFromString('#F3F4F7')",
    "$root.BorderBrush = $brushConverter.ConvertFromString('#D9DBE3')",
    '$root.BorderThickness = New-Object System.Windows.Thickness -ArgumentList 1',
    '$shadow = New-Object System.Windows.Media.Effects.DropShadowEffect',
    "$shadow.Color = [System.Windows.Media.ColorConverter]::ConvertFromString('#22000000')",
    '$shadow.BlurRadius = 26',
    '$shadow.ShadowDepth = 0',
    '$shadow.Opacity = 0.85',
    '$root.Effect = $shadow',
    '$grid = New-Object System.Windows.Controls.Grid',
    '$iconColumn = New-Object System.Windows.Controls.ColumnDefinition',
    '$iconColumn.Width = New-Object System.Windows.GridLength -ArgumentList 44',
    '$contentColumn = New-Object System.Windows.Controls.ColumnDefinition',
    '$grid.ColumnDefinitions.Add($iconColumn) | Out-Null',
    '$grid.ColumnDefinitions.Add($contentColumn) | Out-Null',
    '$iconHolder = New-Object System.Windows.Controls.Border',
    '$iconHolder.Width = 34',
    '$iconHolder.Height = 34',
    '$iconHolder.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left',
    '$iconHolder.VerticalAlignment = [System.Windows.VerticalAlignment]::Top',
    '$iconHolder.CornerRadius = New-Object System.Windows.CornerRadius -ArgumentList 17',
    "$iconHolder.Background = $brushConverter.ConvertFromString('#DDEBFF')",
    '$iconGlyph = New-Object System.Windows.Controls.TextBlock',
    '$iconGlyph.Text = [char]0x2713',
    '$iconGlyph.FontSize = 18',
    '$iconGlyph.FontWeight = [System.Windows.FontWeights]::Bold',
    "$iconGlyph.Foreground = $brushConverter.ConvertFromString('#0A84FF')",
    '$iconGlyph.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center',
    '$iconGlyph.VerticalAlignment = [System.Windows.VerticalAlignment]::Center',
    '$iconHolder.Child = $iconGlyph',
    '$contentStack = New-Object System.Windows.Controls.StackPanel',
    '$contentStack.Orientation = [System.Windows.Controls.Orientation]::Vertical',
    '$contentStack.Margin = New-Object System.Windows.Thickness -ArgumentList 4,0,0,0',
    '$metaGrid = New-Object System.Windows.Controls.Grid',
    '$metaGrid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition)) | Out-Null',
    '$timeColumn = New-Object System.Windows.Controls.ColumnDefinition',
    '$timeColumn.Width = [System.Windows.GridLength]::Auto',
    '$metaGrid.ColumnDefinitions.Add($timeColumn) | Out-Null',
    '$appLabel = New-Object System.Windows.Controls.TextBlock',
    '$appLabel.Text = $titleText',
    '$appLabel.FontSize = 11.5',
    '$appLabel.FontWeight = [System.Windows.FontWeights]::SemiBold',
    "$appLabel.Foreground = $brushConverter.ConvertFromString('#6B6C73')",
    '$appLabel.TextTrimming = [System.Windows.TextTrimming]::CharacterEllipsis',
    '$stampLabel = New-Object System.Windows.Controls.TextBlock',
    "$stampLabel.Text = '刚刚'",
    '$stampLabel.FontSize = 11',
    "$stampLabel.Foreground = $brushConverter.ConvertFromString('#8D8E95')",
    '$stampLabel.Margin = New-Object System.Windows.Thickness -ArgumentList 12,0,0,0',
    '[System.Windows.Controls.Grid]::SetColumn($stampLabel, 1)',
    '$metaGrid.Children.Add($appLabel) | Out-Null',
    '$metaGrid.Children.Add($stampLabel) | Out-Null',
    '$headlineLabel = New-Object System.Windows.Controls.TextBlock',
    '$headlineLabel.Text = $headlineText',
    '$headlineLabel.FontSize = 14',
    '$headlineLabel.FontWeight = [System.Windows.FontWeights]::SemiBold',
    "$headlineLabel.Foreground = $brushConverter.ConvertFromString('#1F2024')",
    '$headlineLabel.TextWrapping = [System.Windows.TextWrapping]::Wrap',
    '$headlineLabel.Margin = New-Object System.Windows.Thickness -ArgumentList 0,6,0,0',
    '$detailLabel = New-Object System.Windows.Controls.TextBlock',
    '$detailLabel.Text = $detailText',
    '$detailLabel.FontSize = 12',
    "$detailLabel.Foreground = $brushConverter.ConvertFromString('#5F6168')",
    '$detailLabel.TextWrapping = [System.Windows.TextWrapping]::Wrap',
    '$detailLabel.Margin = New-Object System.Windows.Thickness -ArgumentList 0,4,0,0',
    '$detailLabel.Visibility = if ([string]::IsNullOrWhiteSpace($detailText)) { [System.Windows.Visibility]::Collapsed } else { [System.Windows.Visibility]::Visible }',
    '$contentStack.Children.Add($metaGrid) | Out-Null',
    '$contentStack.Children.Add($headlineLabel) | Out-Null',
    '$contentStack.Children.Add($detailLabel) | Out-Null',
    '[System.Windows.Controls.Grid]::SetColumn($contentStack, 1)',
    '$grid.Children.Add($iconHolder) | Out-Null',
    '$grid.Children.Add($contentStack) | Out-Null',
    '$root.Child = $grid',
    '$window.Content = $root',
    '$workArea = [System.Windows.SystemParameters]::WorkArea',
    '$window.Left = $workArea.Right - $window.Width - 18',
    '$window.Top = $workArea.Top + 18',
    '$frame = New-Object System.Windows.Threading.DispatcherFrame',
    '$window.Add_Closed({ $frame.Continue = $false })',
    '$closeTimer = New-Object System.Windows.Threading.DispatcherTimer',
    '$closeTimer.Interval = [TimeSpan]::FromMilliseconds(4600)',
    '$closeTimer.Add_Tick({',
    '  $closeTimer.Stop()',
    '  $fadeOut = New-Object System.Windows.Media.Animation.DoubleAnimation',
    '  $fadeOut.From = $window.Opacity',
    '  $fadeOut.To = 0',
    '  $fadeOut.Duration = [TimeSpan]::FromMilliseconds(220)',
    '  $fadeOut.Add_Completed({ $window.Close() })',
    '  $window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fadeOut)',
    '})',
    '$window.Show()',
    '$fadeIn = New-Object System.Windows.Media.Animation.DoubleAnimation',
    '$fadeIn.From = 0',
    '$fadeIn.To = 1',
    '$fadeIn.Duration = [TimeSpan]::FromMilliseconds(180)',
    '$window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fadeIn)',
    '$closeTimer.Start()',
    '[System.Windows.Threading.Dispatcher]::PushFrame($frame)',
    '} catch {',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$form = New-Object System.Windows.Forms.Form',
    '$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
    '$form.BackColor = [System.Drawing.Color]::FromArgb(247, 247, 250)',
    '$form.Width = 360',
    '$form.Height = 118',
    '$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual',
    '$form.ShowInTaskbar = $false',
    '$form.TopMost = $true',
    '$form.MaximizeBox = $false',
    '$form.MinimizeBox = $false',
    '$workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea',
    '$form.Location = New-Object System.Drawing.Point(($workingArea.Right - $form.Width - 18), ($workingArea.Top + 18))',
    '$iconPanel = New-Object System.Windows.Forms.Panel',
    '$iconPanel.Width = 34',
    '$iconPanel.Height = 34',
    '$iconPanel.BackColor = [System.Drawing.Color]::FromArgb(221, 235, 255)',
    '$iconPanel.Location = New-Object System.Drawing.Point(16, 18)',
    '$iconLabel = New-Object System.Windows.Forms.Label',
    '$iconLabel.Text = [char]0x2713',
    "$iconLabel.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)",
    '$iconLabel.ForeColor = [System.Drawing.Color]::FromArgb(10, 132, 255)',
    '$iconLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter',
    '$iconLabel.Dock = [System.Windows.Forms.DockStyle]::Fill',
    '$iconPanel.Controls.Add($iconLabel)',
    '$titleLabel = New-Object System.Windows.Forms.Label',
    '$titleLabel.Text = $titleText',
    "$titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)",
    '$titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(109, 110, 115)',
    '$titleLabel.AutoSize = $true',
    '$titleLabel.Location = New-Object System.Drawing.Point(60, 16)',
    '$headlineLabel = New-Object System.Windows.Forms.Label',
    '$headlineLabel.Text = $headlineText',
    "$headlineLabel.Font = New-Object System.Drawing.Font('Segoe UI', 10.5, [System.Drawing.FontStyle]::Bold)",
    '$headlineLabel.ForeColor = [System.Drawing.Color]::FromArgb(31, 32, 36)',
    '$headlineLabel.MaximumSize = New-Object System.Drawing.Size(272, 0)',
    '$headlineLabel.AutoSize = $true',
    '$headlineLabel.Location = New-Object System.Drawing.Point(60, 36)',
    '$detailLabel = New-Object System.Windows.Forms.Label',
    '$detailLabel.Text = $detailText',
    "$detailLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)",
    '$detailLabel.ForeColor = [System.Drawing.Color]::FromArgb(95, 97, 104)',
    '$detailLabel.MaximumSize = New-Object System.Drawing.Size(272, 0)',
    '$detailLabel.AutoSize = $true',
    '$detailLabel.Location = New-Object System.Drawing.Point(60, 60)',
    '$detailLabel.Visible = -not [string]::IsNullOrWhiteSpace($detailText)',
    '$form.Controls.Add($iconPanel)',
    '$form.Controls.Add($titleLabel)',
    '$form.Controls.Add($headlineLabel)',
    '$form.Controls.Add($detailLabel)',
    '$timer = New-Object System.Windows.Forms.Timer',
    '$timer.Interval = 4800',
    '$timer.Add_Tick({ $timer.Stop(); $form.Close() })',
    '$timer.Start()',
    '[void]$form.ShowDialog()',
    '}'
  ].join('; ')
  return script
}

function runWindowsPowerShellCommand(command) {
  // Invoke PowerShell directly so the styled popup script doesn't hit cmd.exe's 8191-char limit.
  execFileSync('powershell', ['-NoProfile', '-STA', '-Command', command], {
    stdio: 'ignore',
    windowsHide: true
  })
}
`;
}

function writeNotifyScript(remoteNotifications = {}) {
  ensureParentDir(PATHS.notifyHook);
  fs.writeFileSync(PATHS.notifyHook, generateNotifyScript(remoteNotifications), { mode: 0o755 });
}

function getClaudeHookStatus() {
  const settings = readClaudeSettings();
  const stopHooks = Array.isArray(settings?.hooks?.Stop) ? settings.hooks.Stop : [];
  let enabled = false;
  let external = false;
  let type = 'notification';

  stopHooks.forEach((group) => {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    hooks.forEach((hook) => {
      const command = String(hook?.command || '');
      if (!command) return;

      const isManaged = isManagedNotifyPath(command);
      if (isManaged) {
        enabled = true;
        type = parseManagedType(command) || type;
      } else {
        external = true;
      }
    });
  });

  return {
    enabled,
    external,
    type,
    method: 'Stop Hook'
  };
}

function saveClaudeHook(enabled, type) {
  const settings = readClaudeSettings();
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? { ...settings.hooks } : {};
  const currentGroups = Array.isArray(hooks.Stop) ? hooks.Stop : [];

  const filteredGroups = currentGroups.map((group) => {
    const groupHooks = Array.isArray(group?.hooks) ? group.hooks : [];
    const nextHooks = groupHooks.filter((hook) => !isManagedNotifyPath(hook?.command));
    if (nextHooks.length === 0) {
      return null;
    }
    return { ...group, hooks: nextHooks };
  }).filter(Boolean);

  if (enabled) {
    filteredGroups.push({
      hooks: [
        {
          name: MANAGED_HOOK_NAME,
          type: 'command',
          command: buildClaudeCommand(type)
        }
      ]
    });
  }

  if (filteredGroups.length > 0) {
    hooks.Stop = filteredGroups;
  } else {
    delete hooks.Stop;
  }

  if (Object.keys(hooks).length > 0) {
    settings.hooks = hooks;
  } else {
    delete settings.hooks;
  }

  writeClaudeSettings(settings);
}

function safeReadCodexConfig() {
  try {
    if (typeof codexSettingsManager.configExists === 'function' && !codexSettingsManager.configExists()) {
      return {};
    }
    return codexSettingsManager.readConfig();
  } catch (error) {
    return {};
  }
}

function isManagedCodexNotify(notify) {
  return Array.isArray(notify) && notify.some((part) => isManagedNotifyPath(part));
}

function parseCodexNotificationStatus(config = {}) {
  const notify = Array.isArray(config?.notify) ? config.notify : [];

  if (notify.length === 0) {
    return {
      enabled: false,
      external: false,
      type: 'notification',
      method: 'notify'
    };
  }

  const joined = notify.join(' ');
  const managed = isManagedCodexNotify(notify);

  return {
    enabled: managed,
    external: !managed,
    type: parseManagedType(joined) || 'notification',
    method: 'notify'
  };
}

function getCodexHookStatus() {
  return parseCodexNotificationStatus(safeReadCodexConfig());
}

function saveCodexHook(enabled, type) {
  const config = safeReadCodexConfig();
  const nextConfig = (config && typeof config === 'object') ? { ...config } : {};
  const managed = isManagedCodexNotify(nextConfig.notify);

  if (enabled) {
    nextConfig.notify = buildCodexNotifyCommand(type);
  } else if (managed) {
    delete nextConfig.notify;
  }

  ensureParentDir(NATIVE_PATHS.codex.config);
  codexSettingsManager.writeConfig(nextConfig);
}

function safeReadGeminiSettings() {
  try {
    if (typeof geminiSettingsManager.settingsExists === 'function' && !geminiSettingsManager.settingsExists()) {
      return {};
    }
    return geminiSettingsManager.readSettings();
  } catch (error) {
    return {};
  }
}

function isManagedGeminiHook(hook) {
  const command = String(hook?.command || '');
  const name = String(hook?.name || '');
  return name === MANAGED_HOOK_NAME || isManagedNotifyPath(command);
}

function parseGeminiNotificationStatus(settings = {}) {
  const afterAgentGroups = Array.isArray(settings?.hooks?.AfterAgent) ? settings.hooks.AfterAgent : [];
  let enabled = false;
  let external = false;
  let type = 'notification';

  afterAgentGroups.forEach((group) => {
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    hooks.forEach((hook) => {
      if (isManagedGeminiHook(hook)) {
        enabled = true;
        type = parseManagedType(hook.command) || type;
      } else {
        external = true;
      }
    });
  });

  return {
    enabled,
    external,
    type,
    method: 'AfterAgent Hook'
  };
}

function getGeminiHookStatus() {
  return parseGeminiNotificationStatus(safeReadGeminiSettings());
}

function saveGeminiHook(enabled, type) {
  const settings = safeReadGeminiSettings();
  const nextSettings = (settings && typeof settings === 'object') ? { ...settings } : {};
  const hooks = nextSettings.hooks && typeof nextSettings.hooks === 'object' ? { ...nextSettings.hooks } : {};
  const currentGroups = Array.isArray(hooks.AfterAgent) ? hooks.AfterAgent : [];

  const filteredGroups = currentGroups.map((group) => {
    const groupHooks = Array.isArray(group?.hooks) ? group.hooks : [];
    const nextHooks = groupHooks.filter((hook) => !isManagedGeminiHook(hook));
    if (nextHooks.length === 0) {
      return null;
    }
    return { ...group, hooks: nextHooks };
  }).filter(Boolean);

  if (enabled) {
    filteredGroups.push({
      matcher: '*',
      hooks: [
        {
          name: MANAGED_HOOK_NAME,
          type: 'command',
          command: buildGeminiCommand(type)
        }
      ]
    });
  }

  if (filteredGroups.length > 0) {
    hooks.AfterAgent = filteredGroups;
  } else {
    delete hooks.AfterAgent;
  }

  if (Object.keys(hooks).length > 0) {
    nextSettings.hooks = hooks;
  } else {
    delete nextSettings.hooks;
  }

  ensureParentDir(geminiSettingsManager.getSettingsPath());
  geminiSettingsManager.writeSettings(nextSettings);
}

function parseOpenCodeNotificationStatus(content = '') {
  if (!content) {
    return {
      enabled: false,
      external: false,
      type: 'notification',
      method: 'Plugin Events'
    };
  }

  return {
    enabled: true,
    external: false,
    type: parseManagedType(content) || 'notification',
    method: 'Plugin Events'
  };
}

function parseOmpNotificationStatus(content = '') {
  if (!content) {
    return {
      enabled: false,
      external: false,
      type: 'notification',
      method: 'Extension Events'
    };
  }

  return {
    enabled: true,
    external: false,
    type: parseManagedType(content) || 'notification',
    method: 'Extension Events'
  };
}

function getOpenCodeHookStatus() {
  const pluginPath = getOpenCodeManagedPluginPath();
  if (!fs.existsSync(pluginPath)) {
    return parseOpenCodeNotificationStatus('');
  }

  return parseOpenCodeNotificationStatus(fs.readFileSync(pluginPath, 'utf8'));
}

function getOmpHookStatus() {
  const extensionPath = getOmpManagedExtensionPath();
  if (!fs.existsSync(extensionPath)) {
    return parseOmpNotificationStatus('');
  }

  return parseOmpNotificationStatus(fs.readFileSync(extensionPath, 'utf8'));
}

function saveOpenCodeHook(enabled, type) {
  const pluginPath = getOpenCodeManagedPluginPath();
  const opencodeSettingsManager = require('./opencode-settings-manager');
  const configPath = opencodeSettingsManager.selectConfigPath();

  if (!enabled) {
    // Remove plugin file
    if (fs.existsSync(pluginPath)) {
      fs.unlinkSync(pluginPath);
    }

    // Remove from opencode.json plugins array
    if (fs.existsSync(configPath)) {
      try {
        const config = opencodeSettingsManager.readConfig(configPath);
        if (Array.isArray(config.plugins)) {
          config.plugins = config.plugins.filter(p => p !== './plugins/coding-tool-notify.js');
          if (config.plugins.length === 0) {
            delete config.plugins;
          }
          opencodeSettingsManager.writeConfig(configPath, config);
        }
      } catch (error) {
        console.error('Failed to update opencode.json:', error);
      }
    }
    return;
  }

  // Create plugin file
  ensureParentDir(pluginPath);
  fs.writeFileSync(pluginPath, buildOpenCodePluginContent(type), 'utf8');

  // Add to opencode.json plugins array
  try {
    const config = fs.existsSync(configPath)
      ? opencodeSettingsManager.readConfig(configPath)
      : {};

    if (!Array.isArray(config.plugins)) {
      config.plugins = [];
    }

    const pluginRef = './plugins/coding-tool-notify.js';
    if (!config.plugins.includes(pluginRef)) {
      config.plugins.push(pluginRef);
    }

    opencodeSettingsManager.writeConfig(configPath, config);
  } catch (error) {
    console.error('Failed to update opencode.json:', error);
  }
}

function saveOmpHook(enabled, type) {
  const extensionPath = getOmpManagedExtensionPath();

  if (!enabled) {
    if (fs.existsSync(extensionPath)) {
      fs.unlinkSync(extensionPath);
    }
    return;
  }

  ensureParentDir(extensionPath);
  fs.writeFileSync(extensionPath, buildOmpExtensionContent(type), 'utf8');
}

function getNotificationSettings() {
  const uiConfig = loadUIConfig();
  const remoteNotifications = getRemoteNotificationsConfig(uiConfig);
  return {
    success: true,
    platform: os.platform(),
    remoteNotifications,
    remoteProviderTypes: REMOTE_PROVIDER_TYPES.map((type) => ({
      type,
      label: REMOTE_PROVIDER_LABELS[type]
    })),
    platforms: {
      claude: getClaudeHookStatus(),
      codex: getCodexHookStatus(),
      gemini: getGeminiHookStatus(),
      opencode: getOpenCodeHookStatus(),
      omp: getOmpHookStatus()
    }
  };
}

function normalizePlatformInput(platform = {}) {
  return {
    enabled: platform.enabled === true,
    type: normalizeType(platform.type)
  };
}

function resolveBrowserNotificationTitle(source = 'claude') {
  switch (String(source || '').toLowerCase()) {
    case 'codex':
      return 'Codex CLI';
    case 'gemini':
      return 'Gemini CLI';
    case 'opencode':
      return 'OpenCode';
    case 'omp':
      return 'OMP';
    default:
      return 'Claude Code';
  }
}

function resolveBrowserNotificationUrl(source = 'claude') {
  switch (String(source || '').toLowerCase()) {
    case 'codex':
      return '/codex';
    case 'gemini':
      return '/gemini';
    case 'opencode':
      return '/opencode';
    case 'omp':
      return '/omp';
    default:
      return '/claude';
  }
}

function emitBrowserNotification(input = {}) {
  const source = String(input.source || 'claude').toLowerCase();
  const message = String(input.message || '').trim();
  if (!message) {
    throw createValidationError('缺少浏览器通知内容');
  }

  const payload = {
    type: 'browser-notification',
    id: input.id || `${source}-${Date.now()}`,
    source,
    eventType: String(input.eventType || '').trim(),
    title: String(input.title || resolveBrowserNotificationTitle(source)).trim(),
    message,
    url: String(input.url || resolveBrowserNotificationUrl(source)).trim(),
    timestamp: Date.now()
  };

  const { broadcastBrowserNotification } = require('../websocket-server');
  broadcastBrowserNotification(payload);
  return payload;
}

function saveNotificationSettings(input = {}) {
  const remoteNotifications = validateRemoteNotifications(
    input.remoteNotifications !== undefined
      ? input.remoteNotifications
      : {}
  );
  const platforms = {
    claude: normalizePlatformInput(input?.platforms?.claude),
    codex: normalizePlatformInput(input?.platforms?.codex),
    gemini: normalizePlatformInput(input?.platforms?.gemini),
    opencode: normalizePlatformInput(input?.platforms?.opencode),
    omp: normalizePlatformInput(input?.platforms?.omp)
  };

  saveNotificationUiConfig(remoteNotifications, platforms.claude.enabled);

  const hasManagedPlatform = Object.values(platforms).some((platform) => platform.enabled);
  if (hasManagedPlatform) {
    writeNotifyScript(remoteNotifications);
  }

  saveClaudeHook(platforms.claude.enabled, platforms.claude.type);
  saveCodexHook(platforms.codex.enabled, platforms.codex.type);
  saveGeminiHook(platforms.gemini.enabled, platforms.gemini.type);
  saveOpenCodeHook(platforms.opencode.enabled, platforms.opencode.type);
  saveOmpHook(platforms.omp.enabled, platforms.omp.type);

  if (!hasManagedPlatform) {
    removeNotifyScript();
  }

  return getNotificationSettings();
}

function parseNotifyTypeMarker(command) {
  const marker = String(command || '').match(/--cc-notify-type=(['"])?(dialog|notification|browser)\1/i);
  return marker?.[2] ? normalizeType(marker[2].toLowerCase()) : null;
}

function getStopHookCommand(settings = {}) {
  const hooks = settings?.hooks?.Stop;
  if (!Array.isArray(hooks) || hooks.length === 0) {
    return '';
  }

  let fallbackCommand = '';
  for (const group of hooks) {
    const groupHooks = Array.isArray(group?.hooks) ? group.hooks : [];
    for (const hook of groupHooks) {
      const command = String(hook?.command || '');
      if (!command) continue;
      if (!fallbackCommand) {
        fallbackCommand = command;
      }
      if (command.includes('notify-hook.js')) {
        return command;
      }
    }
  }

  return fallbackCommand;
}

function normalizePathForCompare(rawPath) {
  return String(rawPath || '').replace(/\\/g, '/');
}

function shouldRepairStopHook(settings, expectedScriptPath = PATHS.notifyHook, fileExists = fs.existsSync) {
  const command = getStopHookCommand(settings);
  if (!command || !command.includes('notify-hook.js')) {
    return false;
  }

  const normalizedCommand = normalizePathForCompare(command);
  const normalizedExpected = normalizePathForCompare(expectedScriptPath);
  if (!normalizedCommand.includes(normalizedExpected)) {
    return true;
  }

  const markerType = parseNotifyTypeMarker(command);
  if (!markerType) {
    return true;
  }

  return !fileExists(expectedScriptPath);
}

function buildStopHookCommand(type) {
  return buildClaudeCommand(type);
}

function parseStopHookStatus(settings = {}) {
  const stopGroups = Array.isArray(settings?.hooks?.Stop) ? settings.hooks.Stop : [];
  if (stopGroups.length === 0) {
    return { enabled: false, type: 'notification' };
  }

  let sawNotificationLikeCommand = false;
  for (const group of stopGroups) {
    const groupHooks = Array.isArray(group?.hooks) ? group.hooks : [];
    for (const hook of groupHooks) {
      const command = String(hook?.command || '');
      if (!command) continue;

      const markerType = parseNotifyTypeMarker(command) || parseManagedType(command);
      if (markerType) {
        return { enabled: true, type: markerType };
      }

      const isDialog = command.includes('display dialog') ||
        command.includes('MessageBox') ||
        command.includes('zenity --info');
      if (isDialog) {
        return { enabled: true, type: 'dialog' };
      }

      const isNotification = command.includes('display notification') ||
        command.includes('Popup') ||
        command.includes('GraphicsPath') ||
        command.includes('TransparencyKey') ||
        command.includes('FormBorderStyle]::None') ||
        command.includes('AllowsTransparency') ||
        command.includes('notify-send') ||
        command.includes('ToastNotificationManager') ||
        command.includes('CreateToastNotifier') ||
        command.includes('notify-hook.js');
      if (isNotification) {
        sawNotificationLikeCommand = true;
      }
    }
  }

  return sawNotificationLikeCommand
    ? { enabled: true, type: 'notification' }
    : { enabled: false, type: 'notification' };
}

function normalizeSavedPlatformStatus(platform = {}) {
  return {
    enabled: platform?.enabled === true,
    type: normalizeType(platform?.type)
  };
}

function buildLegacyClaudeSaveInput(input = {}, currentSettings = getNotificationSettings()) {
  return {
    platforms: {
      claude: input.stopHook !== undefined
        ? normalizePlatformInput(input.stopHook)
        : { enabled: false, type: 'notification' },
      codex: normalizeSavedPlatformStatus(currentSettings?.platforms?.codex),
      gemini: normalizeSavedPlatformStatus(currentSettings?.platforms?.gemini),
      opencode: normalizeSavedPlatformStatus(currentSettings?.platforms?.opencode),
      omp: normalizeSavedPlatformStatus(currentSettings?.platforms?.omp)
    },
    remoteNotifications: currentSettings?.remoteNotifications || { providers: [] }
  };
}

function getLegacyClaudeHookSettings() {
  return {
    success: true,
    stopHook: parseStopHookStatus(readClaudeSettings()),
    platform: os.platform()
  };
}

function saveLegacyClaudeHookSettings(input = {}) {
  const currentSettings = getNotificationSettings();
  saveNotificationSettings(buildLegacyClaudeSaveInput(input, currentSettings));
  return getLegacyClaudeHookSettings();
}

function initDefaultHooks() {
  try {
    const uiConfig = loadUIConfig();
    if (uiConfig.claudeNotificationDisabledByUser === true) {
      console.log('[Claude Hooks] 用户已主动关闭通知，跳过自动初始化');
      return;
    }

    const currentClaudeSettings = readClaudeSettings();
    const currentStatus = parseStopHookStatus(currentClaudeSettings);

    if (currentStatus.enabled) {
      if (shouldRepairStopHook(currentClaudeSettings)) {
        const currentSettings = getNotificationSettings();
        saveNotificationSettings({
          platforms: {
            claude: { enabled: true, type: currentStatus.type || 'notification' },
            codex: normalizeSavedPlatformStatus(currentSettings?.platforms?.codex),
            gemini: normalizeSavedPlatformStatus(currentSettings?.platforms?.gemini),
            opencode: normalizeSavedPlatformStatus(currentSettings?.platforms?.opencode),
            omp: normalizeSavedPlatformStatus(currentSettings?.platforms?.omp)
          },
          remoteNotifications: currentSettings?.remoteNotifications || { providers: [] }
        });
        console.log('[Claude Hooks] 检测到旧版 Stop hook 路径，已自动修复');
      } else {
        console.log('[Claude Hooks] 已存在 Stop hook 配置，跳过初始化');
      }
      return;
    }

    const currentSettings = getNotificationSettings();
    saveNotificationSettings({
      platforms: {
        claude: { enabled: true, type: 'notification' },
        codex: normalizeSavedPlatformStatus(currentSettings?.platforms?.codex),
        gemini: normalizeSavedPlatformStatus(currentSettings?.platforms?.gemini),
        opencode: normalizeSavedPlatformStatus(currentSettings?.platforms?.opencode),
        omp: normalizeSavedPlatformStatus(currentSettings?.platforms?.omp)
      },
      remoteNotifications: currentSettings?.remoteNotifications || { providers: [] }
    });
    console.log('[Claude Hooks] 已自动开启任务完成通知（右上角卡片）');
  } catch (error) {
    console.error('[Claude Hooks] 初始化默认配置失败:', error);
  }
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
            {
              tag: 'div',
              text: { tag: 'lark_md', content: '**状态**: 这是一条测试通知' }
            },
            {
              tag: 'div',
              text: { tag: 'lark_md', content: '**时间**: ' + new Date().toLocaleString('zh-CN') }
            }
          ]
        }
      });

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 10000
      };

      const requestModule = urlObj.protocol === 'https:' ? https : http;
      const request = requestModule.request(options, () => resolve());
      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy(new Error('飞书测试通知超时'));
      });
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
      }, (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`远程通知返回 HTTP ${response.statusCode}`));
        }
      });
      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy(new Error('远程通知测试超时'));
      });
      request.write(body);
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

function requestDingTalkAccessToken(config = {}) {
  if (!config.clientId || !config.clientSecret) {
    return Promise.resolve('');
  }
  return new Promise((resolve, reject) => {
    try {
      const body = JSON.stringify({ appKey: config.clientId, appSecret: config.clientSecret });
      const request = https.request({
        hostname: 'api.dingtalk.com',
        path: '/v1.0/oauth2/accessToken',
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { responseBody += chunk; });
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
      request.on('timeout', () => {
        request.destroy(new Error('钉钉 Access Token 获取超时'));
      });
      request.write(body);
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

function buildTestNotificationContext() {
  return {
    title: 'Coding Tool - 测试通知',
    message: '这是一条测试通知',
    source: 'test',
    eventType: 'test',
    timestamp: new Date().toLocaleString('zh-CN'),
    hostname: os.hostname()
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

async function sendRemoteProviderTest(providerInput = {}) {
  const provider = normalizeRemoteProvider(providerInput);
  if (!provider) {
    throw createValidationError('远程通知渠道类型不正确');
  }
  validateRemoteProviderConfig({ ...provider, enabled: true });

  const config = provider.config || {};
  const ctx = buildTestNotificationContext();
  switch (provider.type) {
    case 'feishuBot':
      return sendFeishuTest(config.webhookUrl);
    case 'qqBot': {
      const pathSuffix = config.targetType === 'group' ? '/send_group_msg' : '/send_private_msg';
      return requestJson(String(config.endpoint).replace(/\/$/, '') + pathSuffix, {
        [config.targetType === 'group' ? 'group_id' : 'user_id']: config.targetId,
        message: formatProviderText(ctx)
      }, config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {});
    }
    case 'wecomBot':
      return requestJson(config.webhookUrl, {
        msgtype: 'markdown',
        markdown: { content: `**${ctx.title}**\n> 状态: ${ctx.message}\n> 时间: ${ctx.timestamp}` }
      });
    case 'dingtalkBot':
      if (config.mode === 'app') {
        return sendDingTalkAppProviderTest(config, ctx);
      }
      return requestJson(config.webhookUrl, {
        msgtype: 'markdown',
        markdown: { title: ctx.title, text: `### ${ctx.title}\n\n- 状态: ${ctx.message}\n- 时间: ${ctx.timestamp}` }
      });
    case 'telegramBot':
      return requestTelegramMessage(config, ctx);
    case 'wechatBot':
      if (!config.botToken && config.tokenFile) {
        try {
          const raw = fs.readFileSync(config.tokenFile, 'utf8');
          const parsed = JSON.parse(raw);
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
    default:
      throw createValidationError('不支持的远程通知渠道');
  }
}

function requestTelegramMessage(config = {}, ctx) {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const payload = {
    chat_id: config.chatId,
    text: formatProviderText(ctx)
  };
  const agent = config.proxy ? new HttpsProxyAgent(config.proxy) : null;
  return requestJson(url, payload, {}, agent ? { agent } : {});
}

async function sendDingTalkAppProviderTest(config = {}, ctx) {
  const token = await requestDingTalkAccessToken(config);
  if (!token) {
    throw createValidationError('钉钉 App Access Token 获取失败');
  }
  const isGroup = config.targetType !== 'user';
  const payload = {
    robotCode: config.clientId,
    msgKey: 'sampleMarkdown',
    msgParam: JSON.stringify({
      title: ctx.title,
      text: `### ${ctx.title}\n\n- 状态: ${ctx.message}\n- 时间: ${ctx.timestamp}\n- 设备: ${ctx.hostname}`
    })
  };
  if (isGroup) {
    payload.openConversationId = config.targetId;
  } else {
    payload.userIds = [config.targetId];
  }
  return requestJson(
    'https://api.dingtalk.com/v1.0/robot/' + (isGroup ? 'groupMessages/send' : 'oToMessages/batchSend'),
    payload,
    { 'x-acs-dingtalk-access-token': token }
  );
}

function generateSystemNotificationCommand(type, message, platformOverride = os.platform()) {
  const normalizedType = normalizeType(type);
  const title = 'Coding Tool';
  const platform = platformOverride;

  if (platform === 'darwin') {
    if (normalizedType === 'dialog') {
      return `osascript -e 'display dialog "${escapeForAppleScript(message)}" with title "${escapeForAppleScript(title)}" buttons {"好的"} default button 1 with icon note'`;
    }
    return `if command -v terminal-notifier &>/dev/null; then terminal-notifier -title "${escapeForAppleScript(title)}" -message "${escapeForAppleScript(message)}" -sound Glass -activate com.apple.Terminal; else osascript -e 'display notification "${escapeForAppleScript(message)}" with title "${escapeForAppleScript(title)}" sound name "Glass"'; fi`;
  }

  if (platform === 'win32') {
    const popupCommand = buildWindowsPopupCommand(title, message);
    if (normalizedType === 'dialog') {
      return `powershell -NoProfile -STA -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${escapeForPowerShellSingleQuote(message)}', '${escapeForPowerShellSingleQuote(title)}', 'OK', 'Information')" || ${popupCommand}`;
    }
    return popupCommand;
  }

  if (normalizedType === 'dialog') {
    return `zenity --info --title="Coding Tool" --text="${String(message || '').replace(/"/g, '\\"')}" 2>/dev/null || notify-send "Coding Tool" "${String(message || '').replace(/"/g, '\\"')}"`;
  }

  return `notify-send "Coding Tool" "${String(message || '').replace(/"/g, '\\"')}"`;
}

function runSystemNotification(type, message, platformOverride = os.platform()) {
  const normalizedType = normalizeType(type);
  const title = 'Coding Tool';
  const platform = platformOverride;

  if (platform === 'darwin') {
    if (normalizedType === 'dialog') {
      const appleScript = 'display dialog "' + escapeForAppleScript(message) +
        '" with title "' + escapeForAppleScript(title) +
        '" buttons {"好的"} default button 1 with icon note';
      execSync('osascript -e ' + JSON.stringify(appleScript), { stdio: 'ignore', windowsHide: true });
    } else {
      const fallbackScript = 'display notification "' + escapeForAppleScript(message) +
        '" with title "' + escapeForAppleScript(title) + '" sound name "Glass"';
      const command = 'if command -v terminal-notifier >/dev/null 2>&1; then ' +
        'terminal-notifier -title ' + JSON.stringify(title) +
        ' -message ' + JSON.stringify(message) +
        ' -sound Glass -activate com.apple.Terminal; ' +
        'else osascript -e ' + JSON.stringify(fallbackScript) + '; fi';
      execSync(command, { stdio: 'ignore', windowsHide: true });
    }
    return;
  }

  if (platform === 'win32') {
    const popupCommand = buildWindowsPopupCommand(title, message);
    if (normalizedType === 'dialog') {
      const dialogScript = "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('" +
        escapeForPowerShellSingleQuote(message) + "', '" +
        escapeForPowerShellSingleQuote(title) + "', 'OK', 'Information')";
      try {
        runWindowsPowerShellCommand(dialogScript);
      } catch (dialogError) {
        runWindowsPowerShellCommand(popupCommand);
      }
    } else {
      runWindowsPowerShellCommand(popupCommand);
    }
    return;
  }

  const escapedMessage = String(message || '').replace(/"/g, '\\"');
  if (normalizedType === 'dialog') {
    execSync(
      `zenity --info --title="Coding Tool" --text="${escapedMessage}" 2>/dev/null || notify-send "Coding Tool" "${escapedMessage}"`,
      { stdio: 'ignore', windowsHide: true }
    );
    return;
  }

  execSync(`notify-send "Coding Tool" "${escapedMessage}"`, { stdio: 'ignore', windowsHide: true });
}

function syncManagedNotificationAssets() {
  const settings = getNotificationSettings();
  const hasManagedPlatform = Object.values(settings?.platforms || {}).some((platform) => platform?.enabled === true);

  if (hasManagedPlatform) {
    writeNotifyScript(settings.remoteNotifications || {});
  } else {
    removeNotifyScript();
  }

  return settings;
}

function testNotification({ type, provider } = {}) {
  if (provider) {
    return sendRemoteProviderTest(provider);
  }

  if (normalizeType(type) === 'browser') {
    emitBrowserNotification({
      source: 'claude',
      title: 'coding-tool-x',
      message: '这是一条浏览器测试通知'
    });
    return;
  }

  runSystemNotification(type || 'notification', '这是一条测试通知');
}

module.exports = {
  MANAGED_HOOK_NAME,
  getNotificationSettings,
  getLegacyClaudeHookSettings,
  saveNotificationSettings,
  saveLegacyClaudeHookSettings,
  testNotification,
  emitBrowserNotification,
  initDefaultHooks,
  syncManagedNotificationAssets,
  getOpenCodeManagedPluginPath,
  getOmpManagedExtensionPath,
  buildOpenCodePluginContent,
  buildOmpExtensionContent,
  buildCodexNotifyCommand,
  writeNotifyScript,
  generateNotifyScript,
  normalizeRemoteNotificationsConfig,
  validateRemoteProviderConfig,
  _test: {
    applyClaudeDisablePreference,
    getManagedCommandType,
    parseManagedType,
    parseNotifyTypeMarker,
    getClaudeHookStatus,
    getCodexHookStatus,
    getGeminiHookStatus,
    getOpenCodeHookStatus,
    getOmpHookStatus,
    parseCodexNotificationStatus,
    parseGeminiNotificationStatus,
    parseOpenCodeNotificationStatus,
    parseOmpNotificationStatus,
    validateFeishuWebhookUrl,
    normalizeRemoteNotificationsConfig,
    validateRemoteProviderConfig,
    buildCodexNotifyCommand,
    buildGeminiCommand,
    buildStopHookCommand,
    buildClaudeCommand,
    buildOpenCodePluginContent,
    buildOmpExtensionContent,
    getOpenCodeManagedPluginPath,
    getOmpManagedExtensionPath,
    generateNotifyScript,
    generateSystemNotificationCommand,
    emitBrowserNotification,
    parseStopHookStatus,
    shouldRepairStopHook
  }
};
