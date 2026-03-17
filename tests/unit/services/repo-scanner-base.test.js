const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

let testDir;
let consoleErrorSpy;
let consoleWarnSpy;

function loadRepoScannerBase() {
  delete require.cache[require.resolve('../../../src/server/services/repo-scanner-base')];
  return require('../../../src/server/services/repo-scanner-base');
}

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-scanner-base-'));

  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      PATHS: {
        config: path.join(testDir, 'config')
      },
      getRepoScannerReposPath: (type) => path.join(testDir, 'repos', `${type}.json`),
      getRepoScannerCachePath: (type) => path.join(testDir, 'cache', `${type}.json`)
    }
  };

  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  fs.rmSync(testDir, { recursive: true, force: true });

  [
    '../../../src/server/services/repo-scanner-base',
    '../../../src/config/paths'
  ].forEach((mod) => {
    try {
      delete require.cache[require.resolve(mod)];
    } catch (_) {}
  });
});

function createScanner(defaultRepos = [{ owner: 'alpha', name: 'one', branch: 'main', enabled: true }]) {
  const { RepoScannerBase } = loadRepoScannerBase();

  return new class extends RepoScannerBase {
    constructor() {
      super({
        type: 'test-items',
        installDir: path.join(testDir, 'installed'),
        markerFile: 'ITEM.md',
        defaultRepos
      });
      this.itemsByRepo = {};
    }

    async fetchRepoItems(repo) {
      return this.itemsByRepo[`${repo.owner}/${repo.name}`] || [];
    }
  }();
}

describe('repo-scanner-base repository config and caching', () => {
  test('loads default repos and supports add, toggle, update, and remove', () => {
    const scanner = createScanner();

    expect(scanner.loadRepos()).toEqual([{ owner: 'alpha', name: 'one', branch: 'main', enabled: true }]);

    scanner.addRepo({ owner: 'beta', name: 'two', branch: 'dev', enabled: true, directory: 'nested' });
    scanner.addRepo({ owner: 'beta', name: 'two', branch: 'release', enabled: true, directory: 'nested' });
    scanner.toggleRepo('beta', 'two', 'nested', false);

    expect(scanner.loadRepos()).toEqual([
      { owner: 'alpha', name: 'one', branch: 'main', enabled: true },
      { owner: 'beta', name: 'two', branch: 'release', enabled: false, directory: 'nested' }
    ]);

    scanner.removeRepo('alpha', 'one');
    expect(scanner.loadRepos()).toEqual([
      { owner: 'beta', name: 'two', branch: 'release', enabled: false, directory: 'nested' }
    ]);
  });

  test('listRemoteItems deduplicates, sorts, and reuses memory and file caches', async () => {
    const scanner = createScanner([
      { owner: 'alpha', name: 'one', branch: 'main', enabled: true },
      { owner: 'beta', name: 'two', branch: 'main', enabled: true }
    ]);
    const fetchSpy = vi.spyOn(scanner, 'fetchRepoItems');

    scanner.itemsByRepo = {
      'alpha/one': [
        { name: 'Zulu', installed: false },
        { name: 'alpha', installed: false }
      ],
      'beta/two': [
        { name: 'alpha', installed: true },
        { name: 'beta', installed: false }
      ]
    };

    const firstPass = await scanner.listRemoteItems();
    const secondPass = await scanner.listRemoteItems();

    expect(firstPass).toEqual([
      { name: 'alpha', installed: true },
      { name: 'beta', installed: false },
      { name: 'Zulu', installed: false }
    ]);
    expect(secondPass).toEqual(firstPass);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const scannerFromFileCache = createScanner([
      { owner: 'alpha', name: 'one', branch: 'main', enabled: true },
      { owner: 'beta', name: 'two', branch: 'main', enabled: true }
    ]);
    const fileCacheSpy = vi.spyOn(scannerFromFileCache, 'fetchRepoItems');

    const cachedItems = await scannerFromFileCache.listRemoteItems();

    expect(cachedItems).toEqual(firstPass);
    expect(fileCacheSpy).not.toHaveBeenCalled();
  });
});

describe('repo-scanner-base install and utility helpers', () => {
  test('installFromRepo downloads and copies a file into the install directory', async () => {
    const scanner = createScanner([]);
    const repo = { owner: 'demo', name: 'repo', branch: 'main' };
    vi.spyOn(scanner, 'downloadFile').mockImplementation(async (_url, zipPath) => {
      const zip = new AdmZip();
      zip.addFile('repo-main/items/hello.md', Buffer.from('# hello world'));
      zip.writeZip(zipPath);
    });

    const result = await scanner.installFromRepo('items/hello.md', repo, 'hello.md');

    expect(result).toEqual({ success: true, message: 'Installed successfully' });
    expect(fs.readFileSync(path.join(testDir, 'installed', 'hello.md'), 'utf8')).toBe('# hello world');
  });

  test('installFromRepo rejects unsafe source paths before downloading', async () => {
    const scanner = createScanner([]);

    await expect(
      scanner.installFromRepo('../secrets.txt', { owner: 'demo', name: 'repo', branch: 'main' }, 'hello.md')
    ).rejects.toThrow('Invalid item path');
  });

  test('uninstall removes directories and reports missing targets as not installed', () => {
    const scanner = createScanner([]);
    const installedDir = path.join(testDir, 'installed', 'bundle');
    fs.mkdirSync(installedDir, { recursive: true });
    fs.writeFileSync(path.join(installedDir, 'index.js'), 'module.exports = {};', 'utf8');

    expect(scanner.uninstall('bundle')).toEqual({ success: true, message: 'Uninstalled successfully' });
    expect(fs.existsSync(installedDir)).toBe(false);
    expect(scanner.uninstall('bundle')).toEqual({ success: true, message: 'Not installed' });
  });

  test('parseFrontmatter strips BOM and returns metadata plus trimmed body', () => {
    const scanner = createScanner([]);
    const parsed = scanner.parseFrontmatter('\uFEFF---\ntitle: "Demo"\nauthor: tester\n---\n\nBody text\n');

    expect(parsed).toEqual({
      frontmatter: {
        title: 'Demo',
        author: 'tester'
      },
      body: 'Body text'
    });
  });
});
