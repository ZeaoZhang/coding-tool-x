const fs = require('fs');

const validator = require('../../../src/plugins/manifest-validator');

function createValidManifest() {
  return {
    name: 'ctx-plugin-demo',
    version: '1.0.0',
    description: 'Demo plugin manifest',
    main: 'index.js',
    ctx: {
      minVersion: '1.0.0',
      hooks: ['cli:init']
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('manifest-validator schema validation', () => {
  test('validateManifest accepts a valid manifest', () => {
    const result = validator.validateManifest(createValidManifest());

    expect(result).toEqual({
      valid: true,
      errors: []
    });
  });

  test('validateManifest reports user-friendly field errors for invalid manifests', () => {
    const result = validator.validateManifest({
      name: 'bad-plugin-name',
      version: '1',
      description: '',
      main: '../escape.js'
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((error) => String(error.field).includes('ctx'))).toBe(true);
    expect(result.errors.some((error) => String(error.field).includes('/name'))).toBe(true);
  });

  test('validateManifest returns a schema error when the schema file is missing', () => {
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      if (String(filePath).endsWith('plugin-manifest.json')) {
        return false;
      }
      return true;
    });

    const result = validator.validateManifest(createValidManifest());

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        field: 'schema',
        message: expect.stringContaining('Schema file not found')
      })
    ]);

    existsSyncSpy.mockRestore();
  });
});

describe('manifest-validator version compatibility', () => {
  test('checkVersionCompatibility rejects invalid minimum versions', () => {
    const result = validator.checkVersionCompatibility('not-semver');

    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('Invalid minVersion format');
  });

  test('checkVersionCompatibility reports when current version is too low', () => {
    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((filePath, encoding) => {
      if (String(filePath).endsWith('package.json')) {
        return JSON.stringify({ version: '0.9.0' });
      }
      return fs.readFileSync.wrappedMethod.call(fs, filePath, encoding);
    });

    const result = validator.checkVersionCompatibility('1.0.0');

    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('Plugin requires CTX >= 1.0.0');

    readFileSyncSpy.mockRestore();
  });

  test('checkVersionCompatibility reports missing package metadata', () => {
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      if (String(filePath).endsWith('package.json')) {
        return false;
      }
      return true;
    });

    const result = validator.checkVersionCompatibility('1.0.0');

    expect(result).toEqual({
      compatible: false,
      reason: 'Could not find CTX package.json to determine version'
    });

    existsSyncSpy.mockRestore();
  });
});
