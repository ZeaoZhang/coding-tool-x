const fs = require('fs');
const os = require('os');
const path = require('path');
const { LocalResourceIndex } = require('../../../src/server/services/local-resource-index');

describe('LocalResourceIndex', () => {
  let root;
  let indexes;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-resource-index-'));
    indexes = [];
    fs.writeFileSync(path.join(root, 'zeta.md'), 'zeta body');
    fs.writeFileSync(path.join(root, 'alpha.md'), 'alpha body');
  });

  afterEach(() => {
    indexes.forEach(index => index.dispose());
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('separates summaries from details and sorts by name', async () => {
    let scans = 0;
    let details = 0;
    const index = new LocalResourceIndex({
      key: 'test',
      roots: [root],
      scanFile: ({ fullPath, relativePath, stat }) => {
        scans += 1;
        return { name: path.basename(relativePath, '.md'), fullPath, updatedAt: stat.mtimeMs };
      },
      detailFile: ({ fullPath }) => {
        details += 1;
        return { fullContent: fs.readFileSync(fullPath, 'utf8') };
      }
    });
    indexes.push(index);

    const summaries = await index.list();
    expect(summaries.map((item) => item.name)).toEqual(['alpha', 'zeta']);
    expect(summaries[0]).not.toHaveProperty('fullContent');
    expect(details).toBe(0);
    expect(await index.get('alpha')).toEqual(expect.objectContaining({ fullContent: 'alpha body' }));
    expect(details).toBe(1);
    expect(scans).toBe(2);
  });

  test('coalesces concurrent force lists and invalidates immediately', async () => {
    let scans = 0;
    const index = new LocalResourceIndex({
      key: 'test', roots: [root], ttlMs: 10,
      scanFile: async ({ fullPath, relativePath }) => {
        scans += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { name: path.basename(relativePath, '.md'), fullPath };
      },
      detailFile: async () => ({})
    });
    indexes.push(index);

    await Promise.all(Array.from({ length: 20 }, () => index.list({ force: true })));
    expect(scans).toBe(2);
    fs.writeFileSync(path.join(root, 'new.md'), 'new');
    index.invalidate();
    expect((await index.list()).map((item) => item.name)).toContain('new');
  });

  test('skips scan failures and missing roots', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const index = new LocalResourceIndex({
      key: 'missing', roots: [path.join(root, 'missing')],
      scanFile: () => { throw new Error('bad parse'); },
      detailFile: () => ({})
    });
    indexes.push(index);
    await expect(index.list()).resolves.toEqual([]);
    warn.mockRestore();
  });

  test('uses TTL even when watcher exists', async () => {
    const index = new LocalResourceIndex({
      key: 'ttl', roots: [root], ttlMs: 5,
      scanFile: ({ fullPath, relativePath }) => ({ name: path.basename(relativePath, '.md'), fullPath }),
      detailFile: () => ({})
    });
    indexes.push(index);

    await index.list();
    await new Promise((resolve) => setTimeout(resolve, 10));
    fs.writeFileSync(path.join(root, 'after.md'), 'after');
    expect((await index.list()).map((item) => item.name)).toContain('after');
  });
});
