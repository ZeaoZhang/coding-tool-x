const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateProjectApplyTarget } = require('../../../src/server/services/project-path-validation');

describe('validateProjectApplyTarget', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-target-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null for an empty target', () => {
    expect(validateProjectApplyTarget('')).toBeNull();
    expect(validateProjectApplyTarget('   ')).toBeNull();
    expect(validateProjectApplyTarget(null)).toBeNull();
  });

  it('accepts any existing absolute directory outside the registered workspaces', () => {
    expect(validateProjectApplyTarget(tempDir)).toBe(fs.realpathSync(tempDir));
  });

  it('rejects a relative path', () => {
    expect(() => validateProjectApplyTarget('relative/dir')).toThrow('目标路径必须是绝对路径');
  });

  it('rejects a missing directory', () => {
    expect(() => validateProjectApplyTarget(path.join(tempDir, 'missing'))).toThrow('目标路径不存在或不是目录');
  });

  it('rejects a file', () => {
    const filePath = path.join(tempDir, 'file.txt');
    fs.writeFileSync(filePath, 'x');
    expect(() => validateProjectApplyTarget(filePath)).toThrow('目标路径不存在或不是目录');
  });

  it('rejects the filesystem root', () => {
    expect(() => validateProjectApplyTarget(path.parse(tempDir).root)).toThrow('不能把模板应用到文件系统根目录');
  });
});
