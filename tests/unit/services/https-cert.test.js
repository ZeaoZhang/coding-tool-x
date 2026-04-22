'use strict';

const { _test } = require('../../../src/server/services/https-cert');

describe('https-cert helpers', () => {
  test('buildOpenSslConfig includes localhost subject alt names', () => {
    const config = _test.buildOpenSslConfig();

    expect(config).toContain('CN = localhost');
    expect(config).toContain('DNS.1 = localhost');
    expect(config).toContain('IP.1 = 127.0.0.1');
  });

  test('buildWindowsPfxGenerationScript includes certificate request and output path', () => {
    const script = _test.buildWindowsPfxGenerationScript('C:\\temp\\localhost.pfx', 'pass-123');

    expect(script).toContain('CertificateRequest');
    expect(script).toContain('localhost');
    expect(script).toContain('127.0.0.1');
    expect(script).toContain('pass-123');
    expect(script).toContain('localhost.pfx');
  });
});
