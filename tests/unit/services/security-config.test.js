const fs = require('fs');
const { getSecurityStatus, verifySecurityPassword, setSecurityPassword } = require('../../../src/server/services/security-config');

// In-memory store replacing the real security file for each test
let virtualFile = null; // null = does not exist, string = file contents

beforeEach(() => {
  virtualFile = null;

  vi.spyOn(fs, 'existsSync').mockImplementation(() => virtualFile !== null);
  vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
  vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
    if (virtualFile === null) throw new Error('ENOENT');
    return virtualFile;
  });
  vi.spyOn(fs, 'writeFileSync').mockImplementation((_path, data) => {
    virtualFile = data;
  });
  vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getSecurityStatus
// ---------------------------------------------------------------------------

describe('getSecurityStatus', () => {
  it('returns { hasPassword: false } when no security file exists', () => {
    expect(getSecurityStatus()).toEqual({ hasPassword: false });
  });

  it('returns { hasPassword: false } when file exists but has no passwordHash', () => {
    virtualFile = JSON.stringify({ passwordHash: '', salt: '' });
    expect(getSecurityStatus()).toEqual({ hasPassword: false });
  });

  it('returns { hasPassword: true } after a password has been set', () => {
    setSecurityPassword({ newPassword: 'abcd' });
    expect(getSecurityStatus()).toEqual({ hasPassword: true });
  });

  it('returns { hasPassword: false } when file content is invalid JSON', () => {
    virtualFile = 'not-json';
    expect(getSecurityStatus()).toEqual({ hasPassword: false });
  });
});

// ---------------------------------------------------------------------------
// verifySecurityPassword
// ---------------------------------------------------------------------------

describe('verifySecurityPassword', () => {
  it('returns { ok: false, reason: "not_set" } when no password is configured', () => {
    expect(verifySecurityPassword('anypassword')).toEqual({ ok: false, reason: 'not_set' });
  });

  it('returns { ok: true } for the correct password', () => {
    setSecurityPassword({ newPassword: 'correct1' });
    expect(verifySecurityPassword('correct1')).toEqual({ ok: true });
  });

  it('returns { ok: false } (no reason) for a wrong password', () => {
    setSecurityPassword({ newPassword: 'correct1' });
    const result = verifySecurityPassword('wrong');
    expect(result.ok).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('is case-sensitive', () => {
    setSecurityPassword({ newPassword: 'Secret1' });
    expect(verifySecurityPassword('secret1').ok).toBe(false);
    expect(verifySecurityPassword('Secret1').ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setSecurityPassword
// ---------------------------------------------------------------------------

describe('setSecurityPassword', () => {
  it('throws WEAK_PASSWORD when newPassword is fewer than 4 characters', () => {
    const fn = () => setSecurityPassword({ newPassword: 'abc' });
    expect(fn).toThrow(expect.objectContaining({ code: 'WEAK_PASSWORD' }));
  });

  it('throws WEAK_PASSWORD when newPassword is an empty string', () => {
    const fn = () => setSecurityPassword({ newPassword: '' });
    expect(fn).toThrow(expect.objectContaining({ code: 'WEAK_PASSWORD' }));
  });

  it('throws WEAK_PASSWORD when newPassword is null', () => {
    const fn = () => setSecurityPassword({ newPassword: null });
    expect(fn).toThrow(expect.objectContaining({ code: 'WEAK_PASSWORD' }));
  });

  it('throws WEAK_PASSWORD when newPassword is undefined', () => {
    const fn = () => setSecurityPassword({ newPassword: undefined });
    expect(fn).toThrow(expect.objectContaining({ code: 'WEAK_PASSWORD' }));
  });

  it('sets a password for the first time with no currentPassword required', () => {
    const result = setSecurityPassword({ newPassword: 'newpass1' });
    expect(result).toEqual({ hasPassword: true });
  });

  it('writes a non-empty passwordHash and salt to the file after first set', () => {
    setSecurityPassword({ newPassword: 'newpass1' });
    const stored = JSON.parse(virtualFile);
    expect(stored.passwordHash).toBeTruthy();
    expect(stored.salt).toBeTruthy();
  });

  it('sets password exactly 4 characters (boundary) without throwing', () => {
    expect(() => setSecurityPassword({ newPassword: 'abcd' })).not.toThrow();
  });

  it('throws CURRENT_REQUIRED when a password already exists and no currentPassword is provided', () => {
    setSecurityPassword({ newPassword: 'first1' });
    const fn = () => setSecurityPassword({ newPassword: 'second1' });
    expect(fn).toThrow(expect.objectContaining({ code: 'CURRENT_REQUIRED' }));
  });

  it('throws CURRENT_REQUIRED when currentPassword is an empty string', () => {
    setSecurityPassword({ newPassword: 'first1' });
    const fn = () => setSecurityPassword({ currentPassword: '', newPassword: 'second1' });
    expect(fn).toThrow(expect.objectContaining({ code: 'CURRENT_REQUIRED' }));
  });

  it('throws INVALID_PASSWORD when currentPassword is wrong', () => {
    setSecurityPassword({ newPassword: 'first1' });
    const fn = () => setSecurityPassword({ currentPassword: 'wrongpass', newPassword: 'second1' });
    expect(fn).toThrow(expect.objectContaining({ code: 'INVALID_PASSWORD' }));
  });

  it('changes the password successfully with the correct currentPassword', () => {
    setSecurityPassword({ newPassword: 'first1' });
    const result = setSecurityPassword({ currentPassword: 'first1', newPassword: 'second1' });
    expect(result).toEqual({ hasPassword: true });
  });

  it('new password works after a successful change', () => {
    setSecurityPassword({ newPassword: 'first1' });
    setSecurityPassword({ currentPassword: 'first1', newPassword: 'second1' });
    expect(verifySecurityPassword('second1')).toEqual({ ok: true });
  });

  it('old password no longer works after a successful change', () => {
    setSecurityPassword({ newPassword: 'first1' });
    setSecurityPassword({ currentPassword: 'first1', newPassword: 'second1' });
    expect(verifySecurityPassword('first1').ok).toBe(false);
  });

  it('updates updatedAt on each set', () => {
    setSecurityPassword({ newPassword: 'first1' });
    const first = JSON.parse(virtualFile).updatedAt;

    setSecurityPassword({ currentPassword: 'first1', newPassword: 'second1' });
    const second = JSON.parse(virtualFile).updatedAt;

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
  });
});
