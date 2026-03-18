const { spawnSync } = require('child_process');

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function getWindowsPowerShellCommand() {
  return process.env.ComSpec && process.env.ComSpec.toLowerCase().includes('powershell')
    ? process.env.ComSpec
    : 'powershell.exe';
}

function runPowerShell(script, env = {}) {
  return runCommand(getWindowsPowerShellCommand(), [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script
  ], {
    env: {
      ...process.env,
      ...env
    }
  });
}

function isSupported() {
  if (process.platform === 'darwin') return true;
  if (process.platform === 'win32') return true;

  if (process.platform === 'linux') {
    try {
      const result = runCommand('secret-tool', ['--help']);
      return result.status === 0 || result.status === 1;
    } catch {
      return false;
    }
  }

  return false;
}

function getPassword(service, account) {
  if (!service || !account) {
    return null;
  }

  try {
    if (process.platform === 'darwin') {
      const result = runCommand('security', [
        'find-generic-password',
        '-a',
        String(account),
        '-w',
        '-s',
        String(service)
      ]);

      if (result.status !== 0) {
        return null;
      }

      return String(result.stdout || '').trim() || null;
    }

    if (process.platform === 'linux') {
      const result = runCommand('secret-tool', [
        'lookup',
        'service',
        String(service),
        'account',
        String(account)
      ]);

      if (result.status !== 0) {
        return null;
      }

      return String(result.stdout || '').trim() || null;
    }

    if (process.platform === 'win32') {
      const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$vault = New-Object Windows.Security.Credentials.PasswordVault
try {
  $cred = $vault.Retrieve($env:CC_TOOL_SERVICE, $env:CC_TOOL_ACCOUNT)
  $cred.RetrievePassword()
  [Console]::Out.Write($cred.Password)
  exit 0
} catch {
  exit 2
}
`;
      const result = runPowerShell(script, {
        CC_TOOL_SERVICE: String(service),
        CC_TOOL_ACCOUNT: String(account)
      });

      if (result.status !== 0) {
        return null;
      }

      return String(result.stdout || '').trim() || null;
    }
  } catch {
    return null;
  }

  return null;
}

function setPassword(service, account, password) {
  if (!service || !account) {
    return false;
  }

  try {
    if (process.platform === 'darwin') {
      const result = runCommand('security', [
        'add-generic-password',
        '-U',
        '-a',
        String(account),
        '-s',
        String(service),
        '-w',
        String(password ?? '')
      ]);
      return result.status === 0;
    }

    if (process.platform === 'linux') {
      deletePassword(service, account);
      const result = runCommand('secret-tool', [
        'store',
        '--label',
        String(service),
        'service',
        String(service),
        'account',
        String(account)
      ], {
        input: String(password ?? '')
      });
      return result.status === 0;
    }

    if (process.platform === 'win32') {
      const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$vault = New-Object Windows.Security.Credentials.PasswordVault
try {
  $existing = $vault.Retrieve($env:CC_TOOL_SERVICE, $env:CC_TOOL_ACCOUNT)
  $vault.Remove($existing)
} catch {}
$credential = New-Object Windows.Security.Credentials.PasswordCredential($env:CC_TOOL_SERVICE, $env:CC_TOOL_ACCOUNT, $env:CC_TOOL_PASSWORD)
$vault.Add($credential)
exit 0
`;
      const result = runPowerShell(script, {
        CC_TOOL_SERVICE: String(service),
        CC_TOOL_ACCOUNT: String(account),
        CC_TOOL_PASSWORD: String(password ?? '')
      });
      return result.status === 0;
    }
  } catch {
    return false;
  }

  return false;
}

function deletePassword(service, account) {
  if (!service || !account) {
    return false;
  }

  try {
    if (process.platform === 'darwin') {
      const result = runCommand('security', [
        'delete-generic-password',
        '-a',
        String(account),
        '-s',
        String(service)
      ]);
      return result.status === 0;
    }

    if (process.platform === 'linux') {
      const result = runCommand('secret-tool', [
        'clear',
        'service',
        String(service),
        'account',
        String(account)
      ]);
      return result.status === 0;
    }

    if (process.platform === 'win32') {
      const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$vault = New-Object Windows.Security.Credentials.PasswordVault
try {
  $credential = $vault.Retrieve($env:CC_TOOL_SERVICE, $env:CC_TOOL_ACCOUNT)
  $vault.Remove($credential)
  exit 0
} catch {
  exit 2
}
`;
      const result = runPowerShell(script, {
        CC_TOOL_SERVICE: String(service),
        CC_TOOL_ACCOUNT: String(account)
      });
      return result.status === 0;
    }
  } catch {
    return false;
  }

  return false;
}

module.exports = {
  isSupported,
  getPassword,
  setPassword,
  deletePassword
};
