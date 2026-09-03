const fs = require('fs');
const os = require('os');
const path = require('path');

let testDir;
let globalClaudeDir;
let ConfigSyncService;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-sync-'));
  globalClaudeDir = path.join(testDir, 'custom-claude');

  const pathsModulePath = require.resolve('../../../src/config/paths');
  require.cache[pathsModulePath] = {
    id: pathsModulePath,
    filename: pathsModulePath,
    loaded: true,
    exports: {
      HOME_DIR: testDir,
      NATIVE_PATHS: {
        claude: {
          dir: globalClaudeDir,
          settings: path.join(globalClaudeDir, 'settings.json')
        }
      }
    }
  };

  delete require.cache[require.resolve('../../../src/platforms/drivers/claude/config-sync')];
  ({ ConfigSyncService } = require('../../../src/platforms/drivers/claude/config-sync'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  delete require.cache[require.resolve('../../../src/platforms/drivers/claude/config-sync')];
  delete require.cache[require.resolve('../../../src/config/paths')];
});

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

describe('ConfigSyncService scanning and stats', () => {
  test('scans global skills, agents and commands with metadata', () => {
    writeFile(path.join(globalClaudeDir, 'skills', 'review-skill', 'SKILL.md'), '---\nname: "Review Skill"\ndescription: "Helpful"\n---\nBody');
    writeFile(path.join(globalClaudeDir, 'skills', 'review-skill', 'docs', 'guide.md'), '# Guide');
    writeFile(path.join(globalClaudeDir, 'agents', 'helper.md'), '---\nname: "Helper"\ndescription: "Agent"\n---\nbody');
    writeFile(path.join(globalClaudeDir, 'commands', 'review.md'), '---\nname: "Review"\ndescription: "Command"\n---\nbody');

    const service = new ConfigSyncService();
    expect(service.globalConfigDir).toBe(globalClaudeDir);

    const result = service.getAvailableConfigs('global');

    expect(result.skills[0]).toMatchObject({
      name: 'Review Skill',
      directory: 'review-skill',
      files: 2
    });
    expect(result.agents[0]).toMatchObject({
      name: 'Helper',
      path: 'helper.md'
    });
    expect(result.commands[0]).toMatchObject({
      name: 'Review',
      path: 'review.md'
    });
  });

  test('getStats counts global and workspace configs', () => {
    const projectPath = path.join(testDir, 'project');
    writeFile(path.join(globalClaudeDir, 'agents', 'helper.md'), '---\nname: "Helper"\n---\nbody');
    writeFile(path.join(globalClaudeDir, 'commands', 'review.md'), '---\nname: "Review"\n---\nbody');
    writeFile(path.join(projectPath, '.claude', 'agents', 'local.md'), '---\nname: "Local"\n---\nbody');

    const service = new ConfigSyncService();
    const stats = service.getStats(projectPath);

    expect(stats.global.agents).toBe(1);
    expect(stats.global.commands).toBe(1);
    expect(stats.workspace.agents).toBe(1);
  });
});

describe('ConfigSyncService preview and execution', () => {
  test('previewSync reports same-source error and skills-to-workspace error', () => {
    const service = new ConfigSyncService();

    const sameSource = service.previewSync({
      source: 'global',
      target: 'global',
      configTypes: ['agents']
    });
    const invalidSkillsTarget = service.previewSync({
      source: 'global',
      target: 'workspace',
      projectPath: '/tmp/project',
      configTypes: ['skills'],
      selectedItems: { skills: [{ directory: 'review-skill' }] }
    });

    expect(sameSource.errors).toContain('源和目标不能相同');
    expect(invalidSkillsTarget.errors).toContain('Skills 不支持同步到工作区级别');
  });

  test('previewSync distinguishes create vs overwrite targets', () => {
    const projectPath = path.join(testDir, 'project');
    writeFile(path.join(projectPath, '.claude', 'agents', 'existing.md'), 'body');

    const service = new ConfigSyncService();
    const preview = service.previewSync({
      source: 'global',
      target: 'workspace',
      projectPath,
      configTypes: ['agents'],
      selectedItems: {
        agents: [
          { name: 'Existing', path: 'existing.md' },
          { name: 'New Agent', path: 'new.md' }
        ]
      }
    });

    expect(preview.willOverwrite[0].name).toBe('Existing');
    expect(preview.willCreate[0].name).toBe('New Agent');
  });

  test('executeSync copies directories and files and skips existing targets by default', () => {
    const projectPath = path.join(testDir, 'project');
    writeFile(path.join(globalClaudeDir, 'skills', 'review-skill', 'SKILL.md'), '---\nname: "Review Skill"\n---\nbody');
    writeFile(path.join(globalClaudeDir, 'agents', 'helper.md'), 'helper');
    writeFile(path.join(projectPath, '.claude', 'agents', 'helper.md'), 'existing');

    const service = new ConfigSyncService();
    const result = service.executeSync({
      source: 'global',
      target: 'workspace',
      projectPath,
      configTypes: ['skills', 'agents'],
      selectedItems: {
        skills: [{ directory: 'review-skill', name: 'Review Skill' }],
        agents: [{ path: 'helper.md', name: 'Helper Agent' }]
      }
    });

    expect(result.failed[0]).toMatchObject({
      type: 'skills'
    });
    expect(result.skipped[0]).toMatchObject({
      type: 'agents',
      reason: '已存在'
    });
  });

  test('executeSync overwrites existing file when overwrite is true', () => {
    const projectPath = path.join(testDir, 'project');
    writeFile(path.join(globalClaudeDir, 'commands', 'review.md'), 'new-body');
    writeFile(path.join(projectPath, '.claude', 'commands', 'review.md'), 'old-body');

    const service = new ConfigSyncService();
    const result = service.executeSync({
      source: 'global',
      target: 'workspace',
      projectPath,
      configTypes: ['commands'],
      selectedItems: {
        commands: [{ path: 'review.md', name: 'Review Command' }]
      },
      overwrite: true
    });

    expect(result.success[0]).toMatchObject({
      type: 'commands',
      name: 'Review Command'
    });
    expect(fs.readFileSync(path.join(projectPath, '.claude', 'commands', 'review.md'), 'utf8')).toBe('new-body');
  });
});
