const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');
const { PATHS, NATIVE_PATHS } = require('../config/paths');
const { loadUIConfig, saveUIConfig } = require('../server/services/ui-config');
const remoteProviderRegistry = require('./remote-notification-providers');
const {
  getRemoteProviderTypes,
  normalizeRemoteProvider,
  normalizeRemoteNotificationsConfig,
  validateRemoteProviderConfig,
  validateRemoteNotifications,
  sendRemoteProviderTest,
  validateFeishuWebhookUrl
} = remoteProviderRegistry;
const { getPlatformCatalog } = require('../server/services/platform-catalog');
const notificationHooksDriver = require('./drivers/notification-hooks');
const {
  buildClaudeCommand,
  buildCodexNotifyCommand,
  buildGeminiCommand,
  buildOpenCodePluginContent,
  buildOmpExtensionContent,
  getOpenCodeManagedPluginPath,
  getOmpManagedExtensionPath,
  getClaudeHookStatus,
  getCodexHookStatus,
  getGeminiHookStatus,
  getOpenCodeHookStatus,
  getOmpHookStatus,
  parseCodexNotificationStatus,
  parseGeminiNotificationStatus,
  parseOpenCodeNotificationStatus,
  parseOmpNotificationStatus
} = notificationHooksDriver;

const MANAGED_HOOK_NAME = notificationHooksDriver.MANAGED_HOOK_NAME;


function normalizeType(type) {
  return type === 'dialog' || type === 'browser' ? type : 'notification';
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


function getHookPlatformEntries(catalog = getPlatformCatalog()) {
  const manifests = typeof catalog?.list === 'function'
    ? catalog.list({ capability: 'hooks' })
    : [];
  const entries = [];
  for (const manifest of manifests) {
    const driver = typeof catalog.driver === 'function'
      ? catalog.driver(manifest.key, 'hooks')
      : null;
    if (!driver
      || typeof driver.getHooks !== 'function'
      || typeof driver.saveHooks !== 'function'
      || typeof driver.testHooks !== 'function'
      || typeof driver.getDefinition !== 'function') {
      continue;
    }
    const definition = driver.getDefinition();
    if (!definition || typeof definition !== 'object') continue;
    entries.push({ manifest, driver, definition });
  }
  return entries;
}

function toPublicHookDefinition({ manifest, definition }) {
  return {
    key: manifest.key,
    label: manifest.label || definition.label || manifest.key,
    description: typeof definition.description === 'string' ? definition.description : '',
    implementation: typeof definition.implementation === 'string' ? definition.implementation : '',
    externalMessage: typeof definition.externalMessage === 'string' ? definition.externalMessage : '',
    hints: Array.isArray(definition.hints) ? [...definition.hints] : []
  };
}

function getNotificationSettings({ catalog } = {}) {
  const entries = getHookPlatformEntries(catalog);
  const uiConfig = loadUIConfig();
  const remoteNotifications = getRemoteNotificationsConfig(uiConfig);
  const platforms = {};
  const platformDefinitions = [];
  for (const entry of entries) {
    platforms[entry.manifest.key] = entry.driver.getHooks();
    platformDefinitions.push(toPublicHookDefinition(entry));
  }
  const claudeStatus = platforms.claude || { enabled: false, type: 'notification' };
  return {
    success: true,
    platform: os.platform(),
    remoteNotifications,
    remoteProviderTypes: getRemoteProviderTypes(),
    platformDefinitions,
    platforms,
    stopHook: {
      enabled: claudeStatus.enabled === true,
      type: normalizeType(claudeStatus.type)
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

  const { broadcastBrowserNotification } = require('../server/websocket-server');
  broadcastBrowserNotification(payload);
  return payload;
}
function saveNotificationSettings(input = {}, { catalog } = {}) {
  const remoteNotifications = validateRemoteNotifications(
    input.remoteNotifications !== undefined
      ? input.remoteNotifications
      : {}
  );
  const entries = getHookPlatformEntries(catalog);
  const inputPlatforms = input.platforms && typeof input.platforms === 'object' && !Array.isArray(input.platforms)
    ? input.platforms
    : {};
  const platforms = Object.fromEntries(entries.map(entry => {
    const key = entry.manifest.key;
    const platformInput = Object.prototype.hasOwnProperty.call(inputPlatforms, key)
      ? inputPlatforms[key]
      : Object.prototype.hasOwnProperty.call(input, key)
        ? input[key]
        : key === 'claude'
          ? input.stopHook
          : undefined;
    return [key, normalizePlatformInput(platformInput)];
  }));

  const claudeEntry = entries.find(entry => entry.manifest.key === 'claude');
  saveNotificationUiConfig(remoteNotifications, claudeEntry ? platforms.claude.enabled : undefined);

  const hasManagedPlatform = Object.values(platforms).some(platform => platform.enabled);
  for (const entry of entries) {
    entry.driver.saveHooks(platforms[entry.manifest.key]);
  }

  if (hasManagedPlatform) writeNotifyScript(remoteNotifications);
  else removeNotifyScript();

  return getNotificationSettings({ catalog });
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
  const platforms = {
    ...(currentSettings?.platforms && typeof currentSettings.platforms === 'object'
      ? currentSettings.platforms
      : {})
  };
  platforms.claude = input.stopHook !== undefined
    ? normalizePlatformInput(input.stopHook)
    : { enabled: false, type: 'notification' };
  return {
    platforms,
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

    const entries = getHookPlatformEntries();
    const claudeEntry = entries.find(entry => entry.manifest.key === 'claude');
    if (!claudeEntry) return;

    const currentClaudeSettings = readClaudeSettings();
    const currentStatus = parseStopHookStatus(currentClaudeSettings);
    const currentSettings = getNotificationSettings();
    const platforms = { ...currentSettings.platforms };

    if (currentStatus.enabled) {
      if (shouldRepairStopHook(currentClaudeSettings)) {
        platforms.claude = { enabled: true, type: currentStatus.type || 'notification' };
        saveNotificationSettings({
          platforms,
          remoteNotifications: currentSettings.remoteNotifications || { providers: [] }
        });
        console.log('[Claude Hooks] 检测到旧版 Stop hook 路径，已自动修复');
      } else {
        console.log('[Claude Hooks] 已存在 Stop hook 配置，跳过初始化');
      }
      return;
    }

    platforms.claude = { enabled: true, type: 'notification' };
    saveNotificationSettings({
      platforms,
      remoteNotifications: currentSettings.remoteNotifications || { providers: [] }
    });
    console.log('[Claude Hooks] 已自动开启任务完成通知（右上角卡片）');
  } catch (error) {
    console.error('[Claude Hooks] 初始化默认配置失败:', error);
  }
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

function testNotification({ type, provider, source = 'claude' } = {}) {
  if (provider) {
    return sendRemoteProviderTest(provider);
  }

  if (normalizeType(type) === 'browser') {
    emitBrowserNotification({
      source,
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
    getHookPlatformEntries,
    toPublicHookDefinition,
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
