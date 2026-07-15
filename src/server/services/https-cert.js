'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { randomBytes } = require('crypto');
const { PATHS } = require('../../config/paths');

const HTTPS_DIR = path.join(PATHS.config, 'https');
const HTTPS_KEY_FILE = path.join(HTTPS_DIR, 'localhost-key.pem');
const HTTPS_CERT_FILE = path.join(HTTPS_DIR, 'localhost-cert.pem');
const HTTPS_PFX_FILE = path.join(HTTPS_DIR, 'localhost.pfx');
const HTTPS_META_FILE = path.join(HTTPS_DIR, 'meta.json');

function ensureHttpsDir() {
  if (!fs.existsSync(HTTPS_DIR)) {
    fs.mkdirSync(HTTPS_DIR, { recursive: true });
  }
}

function readMeta() {
  if (!fs.existsSync(HTTPS_META_FILE)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(HTTPS_META_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeMeta(meta) {
  ensureHttpsDir();
  fs.writeFileSync(HTTPS_META_FILE, JSON.stringify(meta, null, 2), 'utf8');
}

function resolveOpenSslCommand() {
  const commands = process.platform === 'win32'
    ? ['openssl.exe', 'openssl']
    : ['openssl'];

  for (const command of commands) {
    try {
      execFileSync(command, ['version'], { stdio: 'ignore', windowsHide: true });
      return command;
    } catch {
      // Try next candidate.
    }
  }

  return '';
}

function buildOpenSslConfig() {
  return [
    '[req]',
    'default_bits = 2048',
    'distinguished_name = req_distinguished_name',
    'prompt = no',
    'x509_extensions = v3_req',
    '',
    '[req_distinguished_name]',
    'CN = localhost',
    '',
    '[v3_req]',
    'subjectAltName = @alt_names',
    'keyUsage = digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    '',
    '[alt_names]',
    'DNS.1 = localhost',
    'IP.1 = 127.0.0.1',
    'IP.2 = ::1'
  ].join('\n');
}

function generatePemCertificateWithOpenSsl(command) {
  ensureHttpsDir();
  const configPath = path.join(HTTPS_DIR, 'openssl.cnf');
  fs.writeFileSync(configPath, buildOpenSslConfig(), 'utf8');

  execFileSync(command, [
    'req',
    '-x509',
    '-nodes',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-days',
    '825',
    '-keyout',
    HTTPS_KEY_FILE,
    '-out',
    HTTPS_CERT_FILE,
    '-config',
    configPath
  ], {
    stdio: 'ignore',
    windowsHide: true
  });

  writeMeta({
    generator: 'openssl',
    createdAt: new Date().toISOString()
  });
}

function buildWindowsPfxGenerationScript(outputPath, passphrase) {
  return [
    '$ErrorActionPreference = "Stop"',
    '$rsa = [System.Security.Cryptography.RSA]::Create(2048)',
    '$req = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(',
    '  "CN=localhost",',
    '  $rsa,',
    '  [System.Security.Cryptography.HashAlgorithmName]::SHA256,',
    '  [System.Security.Cryptography.RSASignaturePadding]::Pkcs1',
    ')',
    '$san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()',
    '$san.AddDnsName("localhost")',
    '$san.AddIpAddress([System.Net.IPAddress]::Parse("127.0.0.1"))',
    '$req.CertificateExtensions.Add($san.Build($false))',
    '$req.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))',
    '$req.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment, $true))',
    '$req.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($req.PublicKey, $false))',
    '$notBefore = [DateTimeOffset]::UtcNow.AddDays(-1)',
    '$notAfter = $notBefore.AddYears(2)',
    '$cert = $req.CreateSelfSigned($notBefore, $notAfter)',
    `$bytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ${JSON.stringify(passphrase)})`,
    `[System.IO.Directory]::CreateDirectory(${JSON.stringify(HTTPS_DIR)}) | Out-Null`,
    `[System.IO.File]::WriteAllBytes(${JSON.stringify(outputPath)}, $bytes)`,
    '$cert.Dispose()',
    '$rsa.Dispose()'
  ].join('; ');
}

function generatePfxCertificateOnWindows() {
  ensureHttpsDir();
  const passphrase = randomBytes(18).toString('base64url');

  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    buildWindowsPfxGenerationScript(HTTPS_PFX_FILE, passphrase)
  ], {
    stdio: 'ignore',
    windowsHide: true
  });

  writeMeta({
    generator: 'powershell-pfx',
    passphrase,
    createdAt: new Date().toISOString()
  });
}

function ensureHttpsCredentials() {
  ensureHttpsDir();

  if (fs.existsSync(HTTPS_KEY_FILE) && fs.existsSync(HTTPS_CERT_FILE)) {
    return {
      key: fs.readFileSync(HTTPS_KEY_FILE),
      cert: fs.readFileSync(HTTPS_CERT_FILE)
    };
  }

  const meta = readMeta();
  if (fs.existsSync(HTTPS_PFX_FILE) && meta.passphrase) {
    return {
      pfx: fs.readFileSync(HTTPS_PFX_FILE),
      passphrase: meta.passphrase
    };
  }

  const openSslCommand = resolveOpenSslCommand();
  if (openSslCommand) {
    generatePemCertificateWithOpenSsl(openSslCommand);
    return {
      key: fs.readFileSync(HTTPS_KEY_FILE),
      cert: fs.readFileSync(HTTPS_CERT_FILE)
    };
  }

  if (process.platform === 'win32') {
    generatePfxCertificateOnWindows();
    const nextMeta = readMeta();
    return {
      pfx: fs.readFileSync(HTTPS_PFX_FILE),
      passphrase: nextMeta.passphrase
    };
  }

  throw new Error('无法生成 HTTPS 本地证书，请先安装 openssl 后重试');
}

module.exports = {
  ensureHttpsCredentials,
  _test: {
    buildOpenSslConfig,
    buildWindowsPfxGenerationScript,
    resolveOpenSslCommand
  }
};
