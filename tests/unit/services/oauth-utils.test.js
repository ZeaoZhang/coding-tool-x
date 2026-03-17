const { maskToken, decodeJwtPayload, removeFileIfExists, sha256 } = require('../../../src/server/services/oauth-utils');

describe('maskToken', () => {
  it('returns empty string for empty input', () => {
    expect(maskToken('')).toBe('');
  });

  it('returns empty string for null', () => {
    expect(maskToken(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(maskToken(undefined)).toBe('');
  });

  it('masks a short token (<=8 chars) as first2 + ***', () => {
    expect(maskToken('abcdefgh')).toBe('ab***');
  });

  it('masks a single-char token', () => {
    expect(maskToken('x')).toBe('x***');
  });

  it('masks an 8-char token (boundary)', () => {
    expect(maskToken('12345678')).toBe('12***');
  });

  it('masks a long token as first4 + ... + last4', () => {
    const token = 'abcdefghijklmnop';
    expect(maskToken(token)).toBe('abcd...mnop');
  });

  it('masks a 9-char token (just above boundary)', () => {
    expect(maskToken('abcdefghi')).toBe('abcd...fghi');
  });

  it('trims whitespace before masking', () => {
    expect(maskToken('  ab  ')).toBe('ab***');
  });
});

describe('decodeJwtPayload', () => {
  it('decodes a valid JWT and returns the payload object', () => {
    // Build a minimal valid JWT: header.payload.signature
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: '1234', name: 'Alice' })).toString('base64url');
    const token = `${header}.${payload}.fakesignature`;

    const result = decodeJwtPayload(token);
    expect(result).toEqual({ sub: '1234', name: 'Alice' });
  });

  it('returns null for a plain string without dots', () => {
    expect(decodeJwtPayload('notajwt')).toBeNull();
  });

  it('returns null for an invalid base64 payload', () => {
    expect(decodeJwtPayload('header.!!!invalid!!!.sig')).toBeNull();
  });

  it('returns null for a non-string value (number)', () => {
    expect(decodeJwtPayload(12345)).toBeNull();
  });

  it('returns null for null', () => {
    expect(decodeJwtPayload(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(decodeJwtPayload(undefined)).toBeNull();
  });
});

describe('removeFileIfExists', () => {
  it('calls fs.unlinkSync when the file exists', () => {
    const fs = require('fs');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    removeFileIfExists('/tmp/test-file.txt');

    expect(fs.existsSync).toHaveBeenCalledWith('/tmp/test-file.txt');
    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/test-file.txt');

    vi.restoreAllMocks();
  });

  it('does not call fs.unlinkSync when the file does not exist', () => {
    const fs = require('fs');
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    removeFileIfExists('/tmp/nonexistent.txt');

    expect(fs.unlinkSync).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('does nothing for a null path', () => {
    const fs = require('fs');
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    removeFileIfExists(null);

    expect(fs.unlinkSync).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('silently ignores unlink errors', () => {
    const fs = require('fs');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('permission denied'); });

    expect(() => removeFileIfExists('/tmp/locked.txt')).not.toThrow();

    vi.restoreAllMocks();
  });
});

describe('sha256', () => {
  it('returns a 64-char hex string for a known input', () => {
    // echo -n "hello" | sha256sum → 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(sha256('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('returns the SHA256 of an empty string for empty input', () => {
    // echo -n "" | sha256sum → e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('returns the SHA256 of an empty string for null input', () => {
    expect(sha256(null)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('returns different hashes for different inputs', () => {
    expect(sha256('foo')).not.toBe(sha256('bar'));
  });

  it('returns a 64-character lowercase hex string', () => {
    const result = sha256('test');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});
