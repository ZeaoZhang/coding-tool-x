# Project-Scoped Config Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有项目历史会话页中，为每个项目提供原生项目指令、Skills 和 MCP 的读取、编辑、安装、测试与移除能力。

**Architecture:** 项目原生文件是事实来源，规范化 `realpath` 是项目配置身份；工作区只负责项目分组和路径白名单。新增 `ProjectConfigService` 作为深模块，使用平台 Manifest 声明项目文件和能力，并把格式差异隔离在项目配置适配器中。现有用户级服务和 API 语义保持不变。

**Tech Stack:** Node.js CommonJS、Express、`fs`、`@iarna/toml`、`js-yaml`、Vue 3、Naive UI、Pinia、Vitest、Vite。

---

**Spec:** `docs/superpowers/specs/2026-08-30-project-scoped-config-control-design.md`
The plan remains one end-to-end plan because all slices share the `ProjectConfigService` contract: the UI, templates and platform-specific resources cannot be independently complete without that seam. Each task still produces a focused, testable increment.

## File Map

### Platform metadata

- Modify `src/platforms/manifest-schema.js`: validate `projectResources` metadata.
- Modify `src/platforms/manifests/claude.json`: declare Claude project instruction, Skills and MCP locations.
- Modify `src/platforms/manifests/codex.json`: declare `AGENTS.md`, `.agents/skills/` and `.codex/config.toml`.
- Modify `src/platforms/manifests/gemini.json`: declare `GEMINI.md`, `.gemini/skills/` and `.gemini/settings.json`.
- Modify `src/platforms/manifests/opencode.json`: declare `.opencode/AGENTS.md`, `.opencode/skills/` and `.opencode/opencode.json`.
- Modify `src/platforms/manifests/omp.json`: declare `.omp/skills/`, `.omp/mcp.json` and no instruction file.
- Modify `src/platforms/registry.js`: expose only safe project-relative metadata through `getPublicDefinition()`.

### Project configuration module

- Create `src/server/services/project-config-adapters/shared.js`: safe project-root resolution, atomic text/JSON/TOML writes, and target containment checks.
- Create `src/server/services/project-config-adapters/index.js`: platform adapter registry.
- Create `src/server/services/project-config-adapters/claude.js`: Claude instruction, Skills and MCP format behavior.
- Create `src/server/services/project-config-adapters/codex.js`: Codex instruction, `.agents/skills/` and TOML MCP behavior.
- Create `src/server/services/project-config-adapters/gemini.js`: Gemini instruction, Skills and settings JSON behavior.
- Create `src/server/services/project-config-adapters/opencode.js`: OpenCode instruction, Skills and MCP schema behavior.
- Create `src/server/services/project-config-adapters/omp.js`: OMP Skills and MCP behavior, unsupported instruction.
- Create `src/server/services/project-config-service.js`: project-level application use cases and snapshot DTO.
- Create `tests/unit/services/project-config-service.test.js`: project path, instruction, adapter and snapshot contracts.

### Skills and MCP integration

- Modify `src/server/services/skill-service.js`: resolve project install roots and preserve scope through all Skill operations.
- Modify `src/server/api/skills.js`: validate and forward `scope=project&cwd` for every project Skill operation.
- Modify `src/web/src/api/skills.js`: send project scope options without changing user-level defaults.
- Modify `src/server/services/mcp-service.js`: consume extracted codecs while preserving existing global exports and behavior.
- Create `src/server/services/mcp-format.js`: shared generic/Codex/Gemini/OpenCode/OMP MCP conversion functions.
- Modify `tests/unit/services/skill-service.test.js`: project Skill scope and cache isolation.
- Modify `tests/unit/api/skills-api.test.js`: project Skill request validation.
- Modify `tests/unit/services/mcp-service.test.js`: codec compatibility and project test isolation.

### HTTP and workspace security

- Create `src/server/api/project-config.js`: aggregate, instruction and project MCP routes.
- Modify `src/server/index.js`: mount `/api/project-config`.
- Modify `src/server/services/project-path-validation.js`: lazy workspace lookup and file-under-known-root checks.
- Modify `src/server/api/workspaces.js`: constrain `/read-file` to known project/workspace roots.
- Create `tests/unit/api/project-config-api.test.js`: route status, validation and mutation contracts.
- Modify `tests/unit/api/workspaces-api.test.js`: reject allowed basenames outside known roots.

### Web UI

- Create `src/web/src/api/project-config.js`: aggregate, instruction and project MCP client functions.
- Create `src/web/src/components/ProjectConfigDrawer.vue`: project configuration shell and platform tabs.
- Create `src/web/src/components/ProjectInstructionPanel.vue`: instruction file editor.
- Create `src/web/src/components/ProjectMcpPanel.vue`: project MCP list, add/edit/test/remove actions.
- Modify `src/web/src/components/SkillsPanel.vue`: accept explicit `scope` and project path.
- Modify `src/web/src/components/SkillCreateModal.vue`: create Skills in project scope.
- Modify `src/web/src/components/SkillDetailDrawer.vue`: read/write project Skill files.
- Modify `src/web/src/components/McpFormDrawer.vue`: support a project save transport while preserving global mode.
- Modify `src/web/src/views/SessionList.vue`: add the project configuration entry and pass canonical project path.
- Create `src/web/src/components/__tests__/ProjectConfigDrawer.test.js`: drawer props, tabs and unsupported state.
- Create `src/web/src/components/__tests__/ProjectInstructionPanel.test.js`: instruction load/save behavior.

### Template and documentation integration

- Modify `src/server/services/config-templates-service.js`: route project template writes through `ProjectConfigService`.
- Modify `src/server/services/workspace-service.js`: make a newly created workspace visible to controlled template validation before applying a template, with rollback on fatal failure.
- Modify `tests/unit/services/config-templates-service.test.js`: template calls use project resource semantics.
- Modify `tests/unit/services/workspace-service.test.js`: workspace template registration and rollback.
- Modify `README.md`: document the project configuration entry and native project file locations.

## Shared Contracts

All tasks use these contracts. Do not introduce a second naming scheme.

```js
const PROJECT_SCOPES = new Set(['user', 'project']);

// projectPath is always the canonical realpath after service validation.
const projectOptions = {
  scope: 'project',
  cwd: '/absolute/canonical/project'
};

// Every project resource operation returns one of these statuses.
const RESOURCE_STATUSES = new Set(['ok', 'unsupported', 'invalid', 'failed']);
```

The aggregate response is:

```js
{
  success: true,
  projectPath: '/absolute/canonical/project',
  platform: 'codex',
  instruction: {
    supported: true,
    path: 'AGENTS.md',
    exists: true,
    content: '# Project rules',
    updatedAt: 1730000000000
  },
  skills: {
    supported: true,
    project: [],
    inherited: []
  },
  mcp: {
    supported: true,
    path: '.codex/config.toml',
    servers: []
  },
  capabilities: {
    instruction: true,
    skills: true,
    mcp: true
  }
}
```

Every implementation task follows this local loop: add a behavior test, run the focused test and observe the expected failure, implement only that behavior, rerun the focused test, then commit the task. Do not run formatters, linters, or the project-wide suite inside an individual task.

### Task 1: Add project resource metadata to platform manifests

**Files:**
- Modify: `src/platforms/manifest-schema.js`
- Modify: `src/platforms/manifests/claude.json`
- Modify: `src/platforms/manifests/codex.json`
- Modify: `src/platforms/manifests/gemini.json`
- Modify: `src/platforms/manifests/opencode.json`
- Modify: `src/platforms/manifests/omp.json`
- Modify: `src/platforms/registry.js`
- Test: `tests/unit/platforms/manifest-schema.test.js`
- Test: `tests/unit/platforms/registry.test.js`

- [ ] **Step 1: Write failing manifest validation tests.** Add these cases to `tests/unit/platforms/manifest-schema.test.js`:

```js
test('accepts project resource metadata with safe relative paths', () => {
  const result = validateManifest({
    key: 'demo-cli',
    label: 'Demo CLI',
    command: 'demo',
    projectResources: {
      instruction: { path: 'AGENTS.md' },
      skills: { canonicalRoot: '.agents/skills', readRoots: ['.agents/skills'] },
      mcp: { path: '.codex/config.toml', format: 'codex-toml' }
    },
    capabilities: {}
  });

  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
});

test('rejects malformed project resource metadata', () => {
  const result = validateManifest({
    key: 'unsafe-cli',
    label: 'Unsafe CLI',
    command: 'unsafe',
    projectResources: {
      instruction: { path: '../AGENTS.md' },
      skills: { canonicalRoot: '.agents/skills', readRoots: ['.agents/skills'] },
      mcp: { path: '.mcp.json', format: 'unknown-format' }
    },
    capabilities: {}
  });

  expect(result.valid).toBe(false);
  expect(normalizeManifestError(result.errors)).toContain('projectResources');
});
```

- [ ] **Step 2: Run the focused schema test and verify it fails.**

```bash
npx vitest run tests/unit/platforms/manifest-schema.test.js
```

Expected: FAIL because `projectResources` is currently rejected as an unknown manifest field.

- [ ] **Step 3: Add the schema contract.** In `src/platforms/manifest-schema.js`, add `projectResources` to the top-level properties with this exact shape:

```js
projectResources: {
  type: 'object',
  additionalProperties: false,
  required: ['instruction', 'skills', 'mcp'],
  properties: {
    instruction: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: ['string', 'null'] }
      }
    },
    skills: {
      type: 'object',
      additionalProperties: false,
      required: ['canonicalRoot', 'readRoots'],
      properties: {
        canonicalRoot: { type: 'string', minLength: 1 },
        readRoots: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 }
        }
      }
    },
    mcp: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'format'],
      properties: {
        path: { type: ['string', 'null'] },
        format: { enum: ['none', 'claude-json', 'codex-toml', 'gemini-json', 'opencode-json', 'omp-json'] }
      }
    }
  }
}
```

Validate every non-null path with a manifest-level relative-path check in `validateManifest`; reject absolute paths, NUL bytes, `..` segments and Windows drive paths. `instruction.path` may be null only when the platform has no standalone instruction file. `mcp.path` may be null only with `format: 'none'`.

- [ ] **Step 4: Add the five built-in metadata objects.** Add these exact top-level fields to the corresponding manifest files:

```json
"projectResources": {
  "instruction": { "path": "CLAUDE.md" },
  "skills": { "canonicalRoot": ".claude/skills", "readRoots": [".claude/skills"] },
  "mcp": { "path": ".mcp.json", "format": "claude-json" }
}
```

```json
"projectResources": {
  "instruction": { "path": "AGENTS.md" },
  "skills": { "canonicalRoot": ".agents/skills", "readRoots": [".agents/skills", ".codex/skills"] },
  "mcp": { "path": ".codex/config.toml", "format": "codex-toml" }
}
```

```json
"projectResources": {
  "instruction": { "path": "GEMINI.md" },
  "skills": { "canonicalRoot": ".gemini/skills", "readRoots": [".gemini/skills"] },
  "mcp": { "path": ".gemini/settings.json", "format": "gemini-json" }
}
```

```json
"projectResources": {
  "instruction": { "path": ".opencode/AGENTS.md" },
  "skills": { "canonicalRoot": ".opencode/skills", "readRoots": [".opencode/skills", ".claude/skills", ".agents/skills"] },
  "mcp": { "path": ".opencode/opencode.json", "format": "opencode-json" }
}
```

```json
"projectResources": {
  "instruction": { "path": null },
  "skills": { "canonicalRoot": ".omp/skills", "readRoots": [".omp/skills"] },
  "mcp": { "path": ".omp/mcp.json", "format": "omp-json" }
}
```

- [ ] **Step 5: Expose safe metadata from the registry.** Extend `getPublicDefinition()` in `src/platforms/registry.js` so it returns `projectResources` with only relative paths and format names. It must not return resolved home paths, driver IDs, environment values or absolute paths.

- [ ] **Step 6: Verify schema and registry tests.**

```bash
npx vitest run tests/unit/platforms/manifest-schema.test.js tests/unit/platforms/registry.test.js
```

Expected: PASS; the five built-in manifests load and the public definition contains no absolute path.

- [ ] **Step 7: Commit.**

```bash
git add src/platforms/manifest-schema.js src/platforms/manifests src/platforms/registry.js tests/unit/platforms/manifest-schema.test.js tests/unit/platforms/registry.test.js
git commit -m "feat: declare project resource mappings"
```

### Task 2: Build the project configuration service and safe adapters

**Files:**
- Create: `src/server/services/project-config-adapters/shared.js`
- Create: `src/server/services/project-config-adapters/index.js`
- Create: `src/server/services/project-config-adapters/claude.js`
- Create: `src/server/services/project-config-adapters/codex.js`
- Create: `src/server/services/project-config-adapters/gemini.js`
- Create: `src/server/services/project-config-adapters/opencode.js`
- Create: `src/server/services/project-config-adapters/omp.js`
- Create: `src/server/services/project-config-service.js`
- Modify: `src/server/services/project-path-validation.js`
- Test: `tests/unit/services/project-config-service.test.js`

- [ ] **Step 1: Write failing service tests for canonical paths and instruction files.** Use injected dependencies so tests never touch the real home directory:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BUILT_IN_MANIFESTS, createPlatformRegistry } = require('../../../src/platforms/registry');
const { ProjectConfigService } = require('../../../src/server/services/project-config-service');

function makeRegistry() {
  return createPlatformRegistry({ builtIns: BUILT_IN_MANIFESTS, userFile: { platforms: [] } });
}

let projectDir;
let service;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-config-'));
  service = new ProjectConfigService({
    validateProjectPath: vi.fn(async () => fs.realpathSync(projectDir)),
    registry: makeRegistry(),
    fsImpl: fs
  });
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('writes and reads the Codex project instruction file', async () => {
  await service.writeInstruction(projectDir, 'codex', '# Rules');

  await expect(service.readInstruction(projectDir, 'codex')).resolves.toEqual(expect.objectContaining({
    supported: true,
    path: 'AGENTS.md',
    exists: true,
    content: '# Rules'
  }));
});

test('rejects a path outside the validated project root', async () => {
  await expect(service.writeInstruction('/tmp/other-project', 'codex', '# Rules'))
    .rejects.toThrow('Invalid project path');
});

test('returns unsupported for OMP instruction files', async () => {
  await expect(service.readInstruction(projectDir, 'omp')).resolves.toEqual(expect.objectContaining({
    supported: false,
    path: null
  }));
});
```

`ProjectConfigService` must normalize validator failures to an `Invalid project path` error prefix. The registry fixture must load the five built-in manifests and no filesystem paths outside the temporary project.


- [ ] **Step 2: Run the focused service test and verify it fails.**

```bash
npx vitest run tests/unit/services/project-config-service.test.js
```

Expected: FAIL because the service and adapter registry do not exist.

- [ ] **Step 3: Remove the path-validation cycle before wiring the service.** Change `src/server/services/project-path-validation.js` to load `workspace-service` lazily inside `getKnownProjectPaths()`:

```js
function getWorkspaceService() {
  return require('./workspace-service');
}

async function getKnownProjectPaths() {
  const workspaceService = getWorkspaceService();
  const known = new Set();
  const add = candidate => {
    const resolved = realDirectory(candidate);
    if (resolved) known.add(resolved);
  };

  add(process.cwd());
  for (const workspace of workspaceService.listWorkspaces()) {
    add(workspace.path);
    for (const project of workspace.projects || []) {
      add(project.sourcePath);
      if (workspace.path && project.name) add(path.join(workspace.path, project.name));
    }
  }

  try {
    const projects = await workspaceService.getAllAvailableProjects();
    for (const project of projects || []) add(project.fullPath || project.path);
  } catch {
    // Workspace configuration remains an authoritative fallback.
  }

  return known;
}
```

Do not retain a top-level `require('./workspace-service')` binding.

- [ ] **Step 4: Implement safe shared adapter helpers.** `shared.js` must export these functions:

```js
function resolveProjectTarget(projectRoot, relativePath) {}
function assertExistingProjectRoot(projectRoot) {}
function readTextFile(projectRoot, relativePath) {}
function writeTextFileAtomic(projectRoot, relativePath, content) {}
function deleteProjectFile(projectRoot, relativePath) {}
function redactSecrets(value) {}
```

`resolveProjectTarget` must use `normalizeSafeRelativePath(..., { allowHiddenSegments: true })`, resolve under `projectRoot`, reject root itself, and reject a symlink in any existing path component. `writeTextFileAtomic` must create only the parent directory under the project root, write `${target}.tmp-${process.pid}-${Date.now()}`, then rename it to the target. It must remove the temporary file when the write fails.

- [ ] **Step 5: Implement the adapter registry and instruction behavior.** Each platform module exports `createAdapter({ manifest, fsImpl })` and implements the same interface:

```js
{
  describe(),
  readInstruction(projectRoot),
  writeInstruction(projectRoot, content),
  deleteInstruction(projectRoot),
  listSkillRoots(projectRoot),
  readProjectMcp(projectRoot),
  upsertProjectMcp(projectRoot, id, spec),
  removeProjectMcp(projectRoot, id)
}
```

Task 2 only needs the instruction methods and a `listSkillRoots` descriptor. MCP methods may return `unsupported` until Task 4 adds format handlers. The OMP adapter must return `{ supported: false, path: null }` for instruction reads and reject instruction writes with status `unsupported`.

- [ ] **Step 6: Implement `ProjectConfigService` with injected dependencies.** The constructor must accept:

```js
new ProjectConfigService({
  registry,
  adapters,
  validateProjectPath,
  skillServiceFactory,
  mcpClientFactory,
  fsImpl
})
```

Use `validateKnownProjectCwd` by default and normalize validator failures to an `Invalid project path` error prefix. Public methods must canonicalize the returned path once and pass that same path to the adapter. Implement these methods with the exact names used by later tasks:

```text
getAdapter
getSnapshot
readInstruction
writeInstruction
deleteInstruction
listProjectSkills
installProjectSkill
removeProjectSkill
listProjectMcp
upsertProjectMcp
removeProjectMcp
testProjectMcp
```

Task 2 implements `readInstruction`, `writeInstruction`, `deleteInstruction`, `getSnapshot`, and `getAdapter`. The initial snapshot returns instruction state plus empty supported/unsupported Skills and MCP sections without throwing on a supported empty project; Tasks 3–4 fill those sections through the same service.

- [ ] **Step 7: Run the focused service test.**

```bash
npx vitest run tests/unit/services/project-config-service.test.js
```

Expected: PASS, including path rejection, atomic instruction write and OMP unsupported behavior.

- [ ] **Step 8: Commit.**

```bash
git add src/server/services/project-config-adapters src/server/services/project-config-service.js src/server/services/project-path-validation.js tests/unit/services/project-config-service.test.js
git commit -m "feat: add project config service"
```

### Task 3: Add project-scoped Skills without changing user scope

**Files:**
- Modify: `src/server/services/skill-service.js`
- Modify: `src/server/services/project-config-service.js`
- Modify: `src/server/api/skills.js`
- Modify: `src/web/src/api/skills.js`
- Test: `tests/unit/services/skill-service.test.js`
- Test: `tests/unit/services/project-config-service.test.js`
- Test: `tests/unit/api/skills-api.test.js`

- [ ] **Step 1: Add failing tests for target roots and cache isolation.** Add a temporary project fixture and assert the existing user install directory remains empty:

```js
test('installs and lists a Skill in project scope', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-project-'));
  const service = makeSkillService({
    platform: 'codex',
    projectRoot,
    userInstallDir: path.join(projectRoot, 'fake-user-skills')
  });
  const repo = makeLocalSkillRepo(projectRoot, 'repo-skill');

  await service.installSkill('repo-skill', { provider: 'local', localPath: repo }, null, {
    scope: 'project',
    cwd: projectRoot
  });

  expect(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'repo-skill', 'SKILL.md'))).toBe(true);
  expect(fs.existsSync(path.join(projectRoot, 'fake-user-skills', 'repo-skill'))).toBe(false);
  await expect(service.listSkills(false, { scope: 'project', cwd: projectRoot }))
    .resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ directory: 'repo-skill', sourceScope: 'project', installed: true })
    ]));
});

test('separates user and project Skill cache entries', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cache-project-'));
  const service = makeSkillService({ platform: 'claude', projectRoot });

  await service.listSkills(false, { scope: 'user' });
  await service.listSkills(false, { scope: 'project', cwd: projectRoot });

  expect([...service._preparedSkillsCache.keys()]).toEqual(expect.arrayContaining(['', projectRoot]));
});
```

- [ ] **Step 2: Run the focused Skill test and verify it fails.**

```bash
npx vitest run tests/unit/services/skill-service.test.js
```

Expected: FAIL because install and list currently resolve only `this.installDir`, and `scope` is not propagated through project operations.

- [ ] **Step 3: Add one manifest-backed target resolver to `SkillService`.** Extend the constructor to accept an optional `{ registry }` second argument while preserving `new SkillService(platform)`, and read `projectResources.skills` from `registry.resolve(this.platform)`. Add this method adjacent to `resolveInstallPath`:

```js
resolveScopeOptions(options = {}) {
  const scope = options.scope || 'user';
  if (scope === 'user') return { scope, roots: [this.installDir], writeRoot: this.installDir };
  if (scope !== 'project') throw new Error('Invalid scope: expected "user" or "project"');
  if (!options.cwd) throw new Error('Project scope requires a valid cwd');

  const projectRoot = path.resolve(options.cwd);
  const mapping = this.registry.resolve(this.platform)?.projectResources?.skills;
  if (!mapping) throw new Error(`Project Skills are not supported for ${this.platform}`);

  const roots = mapping.readRoots.map(relativeRoot =>
    resolveInsideRoot(projectRoot, relativeRoot, 'project skill root', {
      allowHiddenSegments: true,
      allowRoot: true
    })
  );
  const writeRoot = resolveInsideRoot(projectRoot, mapping.canonicalRoot, 'project skill root', {
    allowHiddenSegments: true,
    allowRoot: true
  });
  return { scope, roots, writeRoot };
}
```

Use `roots` for reads and `writeRoot` for create/install/remove. `resolveScopeOptions` must also check the canonical project root with the same realpath/symlink rules as `ProjectConfigService`. The implementation must not contain a second platform-to-path mapping.

- [ ] **Step 4: Thread `{ scope, cwd }` through all Skill operations and the project service facade.** Preserve existing argument order and add an optional final `options` object to `installSkill`, `installLocalSkill`, `createCustomSkill`, `createSkillWithFiles`, `getSkillFiles`, `getSkillFileContent`, `addSkillFiles`, `deleteSkillFile`, `updateSkillFile`, `getSkillDetail`, and `uninstallSkill`. Every call to `resolveInstallPath` must use the same scope options. `scanLocalDir` must set `sourceScope` to the actual scope instead of hard-coding `'user'`.

`ProjectConfigService.listProjectSkills()` must call the SkillService with `{ scope: 'project', cwd: canonicalProjectPath }` and return `project` plus `inherited` arrays. `installProjectSkill()` must choose `installLocalSkill` when the template or UI item has no repository source and choose `installSkill` when it has `repo/fullDirectory`. `removeProjectSkill()` must call only the project-scoped uninstall path. No facade method may call a user-scoped install or remove operation for a project request.

`listSkills` must use `platform + scope + canonical cwd` for its prepared and inflight keys. It must return project resources with `scope: 'project'`, keep user resources as `scope: 'user'`, and preserve project-over-user deduplication metadata.

- [ ] **Step 5: Extend API validation without changing defaults.** In `src/server/api/skills.js`, validate `scope` and `cwd` for list, install, install-local, create, create-with-files, detail, and every file CRUD route. A missing scope remains user scope. A project scope without a valid `cwd` returns a 400 error. Pass `{ scope, cwd }` to the service for both project and user requests so the service owns target resolution.

- [ ] **Step 6: Extend the Web API helper.** In `src/web/src/api/skills.js`, add an options argument to every affected function and serialize only present fields:

```js
function scopeParams(options = {}) {
  return {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.scope ? { scope: options.scope } : {})
  };
}
```

Keep existing calls with no options byte-for-byte equivalent at the HTTP level.

- [ ] **Step 7: Run service and API tests.**

```bash
npx vitest run tests/unit/services/skill-service.test.js tests/unit/services/project-config-service.test.js tests/unit/api/skills-api.test.js
```

Expected: PASS; user-scope tests still pass, project Skills write only under the canonical project root, the project facade never calls a user target, and traversal requests return 400.

- [ ] **Step 8: Commit.**

```bash
git add src/server/services/skill-service.js src/server/services/project-config-service.js src/server/api/skills.js src/web/src/api/skills.js tests/unit/services/skill-service.test.js tests/unit/services/project-config-service.test.js tests/unit/api/skills-api.test.js
git commit -m "feat: support project-scoped skills"
```

### Task 4: Extract MCP codecs and implement project MCP operations

**Files:**
- Create: `src/server/services/mcp-format.js`
- Modify: `src/server/services/mcp-service.js`
- Modify: `src/server/services/project-config-adapters/claude.js`
- Modify: `src/server/services/project-config-adapters/codex.js`
- Modify: `src/server/services/project-config-adapters/gemini.js`
- Modify: `src/server/services/project-config-adapters/opencode.js`
- Modify: `src/server/services/project-config-adapters/omp.js`
- Modify: `src/server/services/project-config-service.js`
- Test: `tests/unit/services/mcp-service.test.js`
- Test: `tests/unit/services/project-config-service.test.js`

- [ ] **Step 1: Write failing codec and project MCP tests.** Add tests for all native containers:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const toml = require('@iarna/toml');
const { BUILT_IN_MANIFESTS, createPlatformRegistry } = require('../../../src/platforms/registry');
const { ProjectConfigService } = require('../../../src/server/services/project-config-service');

const projectRoots = [];
let service;

function makeRegistry() {
  return createPlatformRegistry({ builtIns: BUILT_IN_MANIFESTS, userFile: { platforms: [] } });
}

function makeProjectRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-mcp-'));
  projectRoots.push(root);
  return root;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function makeProjectConfigService(overrides = {}) {
  return new ProjectConfigService({
    registry: makeRegistry(),
    validateProjectPath: async projectPath => fs.realpathSync(projectPath),
    ...overrides
  });
}

beforeEach(() => {
  service = makeProjectConfigService();
});

afterEach(() => {
  for (const root of projectRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
```

```js
test('project MCP updates only the target Codex server and preserves other config', async () => {
  const projectRoot = makeProjectRoot();
  writeFile(path.join(projectRoot, '.codex', 'config.toml'), [
    'model = "gpt-5"',
    '',
    '[mcp_servers.existing]',
    'command = "existing"',
    '',
    '[custom]',
    'value = "preserve"',
    ''
  ].join('\n'));

  const result = await service.upsertProjectMcp(projectRoot, 'codex', 'new-server', {
    type: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { TOKEN: 'secret' }
  });

  expect(result).toEqual(expect.objectContaining({ id: 'new-server', scope: 'project' }));
  const config = toml.parse(fs.readFileSync(path.join(projectRoot, '.codex', 'config.toml'), 'utf8'));
  expect(config.model).toBe('gpt-5');
  expect(config.custom.value).toBe('preserve');
  expect(config.mcp_servers.existing.command).toBe('existing');
  expect(config.mcp_servers['new-server'].command).toBe('node');
});

test('project MCP testing uses project cwd and returns no secret values', async () => {
  const projectRoot = makeProjectRoot();
  const client = { connect: vi.fn(), listTools: vi.fn(async () => [{ name: 'tool' }]), close: vi.fn() };
  const service = makeProjectConfigService({
    mcpClientFactory: (spec) => {
      expect(spec.cwd).toBe(projectRoot);
      expect(spec.env.TOKEN).toBe('secret');
      return client;
    }
  });

  await service.upsertProjectMcp(projectRoot, 'claude', 'local', {
    type: 'stdio',
    command: 'node',
    env: { TOKEN: 'secret' }
  });
  const result = await service.testProjectMcp(projectRoot, 'claude', 'local');

  expect(result).toEqual(expect.objectContaining({ success: true }));
  expect(JSON.stringify(result)).not.toContain('secret');
});
```

- [ ] **Step 2: Run the focused tests and verify they fail.**

```bash
npx vitest run tests/unit/services/mcp-service.test.js tests/unit/services/project-config-service.test.js
```

Expected: FAIL because codecs are private to `mcp-service.js` and project MCP methods do not exist.

- [ ] **Step 3: Extract shared conversion functions without breaking `_test`.** Create `mcp-format.js` with these exports:

```js
module.exports = {
  extractServerSpec,
  convertToCodexFormat,
  convertFromCodexFormat,
  convertToOpenCodeFormat,
  convertFromOpenCodeFormat,
  convertToOmpMcpFormat,
  convertFromOmpMcpFormat
};
```

Move the existing function bodies from `mcp-service.js` into this module. Import the module from `mcp-service.js` and keep the current `_test` object delegating to the extracted functions. Existing global Claude/Gemini/Codex/OpenCode/OMP sync functions must call the same extracted implementations after the move.

- [ ] **Step 4: Implement native project MCP adapter rules.** Use the manifest format and these exact containers:

```text
claude-json:    file root .mcp.json, servers at config.mcpServers
codex-toml:     file root .codex/config.toml, servers at config.mcp_servers
                stdio fields command/args/env/cwd; HTTP fields url/http_headers
                project config is trusted-project local configuration
                enabled_tools/disabled_tools/timeouts remain intact
gemini-json:   file root .gemini/settings.json, servers at config.mcpServers
opencode-json: file root .opencode/opencode.json
                preserve existing mcp.servers shape when present
                otherwise preserve the legacy direct mcp shape used by this repo
omp-json:      file root .omp/mcp.json, servers at config.mcpServers
```

Each adapter must:

- read a missing file as an empty native config;
- validate IDs with the existing MCP name rules where the platform has them;
- use `extractServerSpec` before writing generic server specs;
- use the platform codec before writing Codex/OpenCode/OMP specs;
- update only the named server key;
- retain `$schema`, unrelated settings, existing servers and unknown fields;
- write atomically through the shared adapter helper;
- return a project-scoped DTO with redacted secret fields.

- [ ] **Step 5: Add project MCP methods to `ProjectConfigService`.** Implement:

```js
listProjectMcp(projectPath, platform)
upsertProjectMcp(projectPath, platform, id, spec)
removeProjectMcp(projectPath, platform, id)
testProjectMcp(projectPath, platform, id)
```

`upsertProjectMcp` validates `mcp-service.validateServerSpec` before writing. It never calls `saveServer`, `toggleServerApp`, `deleteServer` or any global center-record writer. `testProjectMcp` reads the project spec, injects `cwd=projectPath` only for stdio specs that do not already define `cwd`, constructs `McpClient`, calls `connect`, optionally calls `listTools`, then closes the client in `finally`.

- [ ] **Step 6: Complete the aggregate snapshot.** `getSnapshot` must call the project MCP adapter and project Skill listing, include `inherited` user Skills without granting project delete rights, and return platform capability metadata. A missing project MCP file is a supported empty list, not a failure.

- [ ] **Step 7: Run the focused tests.**

```bash
npx vitest run tests/unit/services/mcp-service.test.js tests/unit/services/project-config-service.test.js
```

Expected: PASS; old global MCP tests remain green, project writes preserve unrelated data, project testing uses cwd, and serialized responses contain no raw secret.

- [ ] **Step 8: Commit.**

```bash
git add src/server/services/mcp-format.js src/server/services/mcp-service.js src/server/services/project-config-adapters src/server/services/project-config-service.js tests/unit/services/mcp-service.test.js tests/unit/services/project-config-service.test.js
git commit -m "feat: add project-scoped mcp configuration"
```

### Task 5: Expose project configuration through HTTP API

**Files:**
- Create: `src/server/api/project-config.js`
- Modify: `src/server/index.js`
- Create: `tests/unit/api/project-config-api.test.js`

- [ ] **Step 1: Write failing route tests.** Use the existing Express/http helper pattern from `tests/unit/api/workspaces-api.test.js`. Stub `ProjectConfigService` with these methods and assert route payloads:

```js
test('returns the project configuration snapshot', async () => {
  const res = await request(buildApp()).get('/?projectPath=%2Ftmp%2Fproject&platform=codex');

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.projectPath).toBe('/tmp/project');
  expect(res.body.platform).toBe('codex');
  expect(projectConfigService.getSnapshot).toHaveBeenCalledWith('/tmp/project', 'codex');
});

test('rejects project MCP mutation without projectPath', async () => {
  const res = await request(buildApp()).put('/mcp/demo', {
    platform: 'claude',
    server: { type: 'stdio', command: 'node' }
  });

  expect(res.status).toBe(400);
  expect(res.body.success).toBe(false);
});

test('returns structured unsupported instruction state', async () => {
  projectConfigService.readInstruction.mockResolvedValue({ supported: false, path: null });
  const res = await request(buildApp()).get('/instruction?projectPath=%2Ftmp%2Fproject&platform=omp');

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.instruction.supported).toBe(false);
});
```

- [ ] **Step 2: Run the route test and verify it fails.**

```bash
npx vitest run tests/unit/api/project-config-api.test.js
```

Expected: FAIL because the route and server mount do not exist.

- [ ] **Step 3: Implement `src/server/api/project-config.js`.** Export an Express router with these routes:

```text
GET    /                         -> getSnapshot(projectPath, platform)
GET    /instruction              -> readInstruction(projectPath, platform)
PUT    /instruction              -> writeInstruction(projectPath, platform, content)
DELETE /instruction              -> deleteInstruction(projectPath, platform)
GET    /mcp                      -> listProjectMcp(projectPath, platform)
PUT    /mcp/:id                  -> upsertProjectMcp(projectPath, platform, id, server)
DELETE /mcp/:id                  -> removeProjectMcp(projectPath, platform, id)
POST   /mcp/:id/test             -> testProjectMcp(projectPath, platform, id)
```

The router must require non-empty `projectPath` and valid `platform` for every route, require string `content` for instruction PUT, require an object `server` for MCP PUT, and map service errors to `sendApiError`. `unsupported` remains a successful structured response; invalid path/spec is 400; path containment failure is 403.

- [ ] **Step 4: Mount the route.** Add this line near the existing resource routes in `src/server/index.js`:

```js
app.use('/api/project-config', require('./api/project-config'));
```

- [ ] **Step 5: Run API tests.**

```bash
npx vitest run tests/unit/api/project-config-api.test.js tests/unit/api/skills-api.test.js
```

Expected: PASS; all route parameters reach the service, project scope is explicit, and old Skills routes retain their behavior.

- [ ] **Step 6: Commit.**

```bash
git add src/server/api/project-config.js src/server/index.js tests/unit/api/project-config-api.test.js
git commit -m "feat: expose project config api"
```

### Task 6: Build the project configuration Web UI shell and panels

**Files:**
- Create: `src/web/src/api/project-config.js`
- Create: `src/web/src/components/ProjectConfigDrawer.vue`
- Create: `src/web/src/components/ProjectInstructionPanel.vue`
- Create: `src/web/src/components/ProjectMcpPanel.vue`
- Modify: `src/web/src/components/SkillsPanel.vue`
- Modify: `src/web/src/components/SkillCreateModal.vue`
- Modify: `src/web/src/components/SkillDetailDrawer.vue`
- Modify: `src/web/src/components/McpFormDrawer.vue`
- Create: `src/web/src/components/__tests__/ProjectConfigDrawer.test.js`
- Create: `src/web/src/components/__tests__/ProjectInstructionPanel.test.js`

- [ ] **Step 1: Write failing Web tests.** Use `@vue/test-utils` in the existing Web Vitest environment. Stub network API functions and child resource panels:

```js
import { mount } from '@vue/test-utils';
import ProjectConfigDrawer from '../ProjectConfigDrawer.vue';

vi.mock('../../api/project-config', () => ({
  getProjectConfig: vi.fn(async () => ({
    success: true,
    projectPath: '/tmp/project',
    platform: 'codex',
    instruction: { supported: true, path: 'AGENTS.md', exists: false, content: '' },
    skills: { supported: true, project: [], inherited: [] },
    mcp: { supported: true, path: '.codex/config.toml', servers: [] },
    capabilities: { instruction: true, skills: true, mcp: true }
  }))
}));

test('renders project configuration tabs with the canonical path', async () => {
  const wrapper = mount(ProjectConfigDrawer, {
    props: { show: true, projectPath: '/tmp/project', platform: 'codex' },
    global: { stubs: { SkillsPanel: true, ProjectMcpPanel: true } }
  });

  await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain('项目指令');
  expect(wrapper.text()).toContain('Skills');
  expect(wrapper.text()).toContain('MCP');
  expect(wrapper.text()).toContain('/tmp/project');
});
```

For `ProjectInstructionPanel.test.js`, assert `saveInstruction('/tmp/project', 'codex', '# Rules')` receives the exact path and content and that a disabled state is rendered when `supported` is false.

- [ ] **Step 2: Run the Web tests and verify they fail.**

```bash
cd src/web && npx vitest run src/components/__tests__/ProjectConfigDrawer.test.js src/components/__tests__/ProjectInstructionPanel.test.js
```

Expected: FAIL because the Web API module and components do not exist.

- [ ] **Step 3: Add the Web API module.** `src/web/src/api/project-config.js` must export:

```js
export async function getProjectConfig(projectPath, platform) {}
export async function getProjectInstruction(projectPath, platform) {}
export async function saveProjectInstruction(projectPath, platform, content) {}
export async function deleteProjectInstruction(projectPath, platform) {}
export async function getProjectMcp(projectPath, platform) {}
export async function saveProjectMcp(projectPath, platform, id, server) {}
export async function deleteProjectMcp(projectPath, platform, id) {}
export async function testProjectMcp(projectPath, platform, id) {}
```

Use `client` exactly as the other API modules do. Query functions send `projectPath` and `platform`; mutation bodies always include both. Do not reuse global `saveServer`, `toggleServerApp` or `deleteServer` for project MCP.

- [ ] **Step 4: Implement the drawer shell.** `ProjectConfigDrawer.vue` accepts:

```js
{
  show: Boolean,
  projectPath: String,
  platform: String
}
```

When opened or when either prop changes, load `getProjectConfig`. Render `n-tabs` with `项目指令`, `Skills`, and `MCP`. Pass the current platform and canonical path to child panels. Abort or ignore stale responses with a monotonically increasing request ID so opening a second project cannot display the first project’s snapshot. Render capability-disabled content instead of save controls for unsupported resources.

- [ ] **Step 5: Implement the instruction panel.** `ProjectInstructionPanel.vue` must display the native relative path, current content, save button, explicit delete button, loading state, and an unsupported message. Save uses `saveProjectInstruction`; empty content writes an empty file, while delete calls `deleteProjectInstruction` only after confirmation. Never call the Agents API.

- [ ] **Step 6: Reuse Skills UI with an explicit project scope.** Add a `scope` prop to `SkillsPanel.vue` with default `'user'`. For project mode:

```vue
<SkillsPanel
  :platform="platform"
  :project-path="projectPath"
  scope="project"
  in-drawer
/>
```

Thread `scope` and `projectPath` into `getSkills`, install, local install, create, detail, file CRUD and uninstall calls. Add matching props to `SkillCreateModal.vue` and `SkillDetailDrawer.vue`. Keep existing global drawer calls unchanged by retaining `scope='user'` as the default.

- [ ] **Step 7: Implement the project MCP panel and form transport.** `ProjectMcpPanel.vue` lists project servers, shows the native target path and redacted values, and supports add/edit/test/remove. Extend `McpFormDrawer.vue` with `scope='user'` and `projectPath` props. In user mode it keeps calling `saveServer`; in project mode it calls `saveProjectMcp` and hides platform toggles. The project panel passes `scope='project'` and the canonical path. Removing a server calls only the project DELETE route.

- [ ] **Step 8: Run Web tests.**

```bash
cd src/web && npx vitest run src/components/__tests__/ProjectConfigDrawer.test.js src/components/__tests__/ProjectInstructionPanel.test.js
```

Expected: PASS; tabs use the supplied project path, unsupported resources cannot be submitted, and project Skills/MCP transports are distinct from global transports.

- [ ] **Step 9: Commit.**

```bash
git add src/web/src/api/project-config.js src/web/src/components/ProjectConfigDrawer.vue src/web/src/components/ProjectInstructionPanel.vue src/web/src/components/ProjectMcpPanel.vue src/web/src/components/SkillsPanel.vue src/web/src/components/SkillCreateModal.vue src/web/src/components/SkillDetailDrawer.vue src/web/src/components/McpFormDrawer.vue src/web/src/components/__tests__
git commit -m "feat: add project config panels"
```

### Task 7: Add the project configuration entry to the history page

**Files:**
- Modify: `src/web/src/views/SessionList.vue`
- Create: `src/web/src/views/__tests__/SessionListProjectConfig.test.js`

- [ ] **Step 1: Write the failing integration assertion.** Extend the Web component test with a mocked sessions store whose `currentProjectInfo` is `{ fullPath: '/tmp/project', displayName: 'project-display-name' }`, mount `SessionList` with `projectName: 'project-display-name'`, and stub `ProjectConfigDrawer`. Inspect the child component directly:

```js
const drawer = wrapper.findComponent(ProjectConfigDrawer);
expect(drawer.props('projectPath')).toBe('/tmp/project');
expect(drawer.props('projectPath')).not.toBe('project-display-name');
```

- [ ] **Step 2: Run the focused Web test and verify it fails.**

```bash
cd src/web && npx vitest run src/components/__tests__/ProjectConfigDrawer.test.js
```

Expected: FAIL because `SessionList.vue` has no project configuration state or button.

- [ ] **Step 3: Add the history-page entry.** In `SessionList.vue`, add `ProjectConfigDrawer` beside the existing history UI and add a button next to the current “管理” action:

```vue
<n-button
  v-else
  size="small"
  type="primary"
  secondary
  :disabled="!displayProjectPath"
  @click="showProjectConfig = true"
>
  项目配置
</n-button>
```

Use `displayProjectPath`, which already resolves `store.currentProjectInfo.fullPath`, as the drawer prop:

```vue
<ProjectConfigDrawer
  v-model:show="showProjectConfig"
  :project-path="displayProjectPath"
  :platform="currentChannel"
/>
```

The project configuration button must not trigger session selection or deletion. Keep `ProjectCard` as a navigation surface until a later shortcut can reuse this same drawer.

- [ ] **Step 4: Handle stale project state.** Reset or close the drawer when `props.projectName` or `currentChannel` changes. Do not render a request until `ensureProjectNameResolved()` has populated `store.currentProjectInfo`; the drawer receives the full path, not `effectiveProjectName`.

- [ ] **Step 5: Run Web tests and build.**

```bash
cd src/web && npx vitest run src/components/__tests__/ProjectConfigDrawer.test.js && npm run build
```

Expected: PASS and a successful Vite production build.

- [ ] **Step 6: Commit.**

```bash
git add src/web/src/views/SessionList.vue src/web/src/components/__tests__/ProjectConfigDrawer.test.js
git commit -m "feat: add project config entry to history"
```

### Task 8: Route templates through project semantics and fix workspace file boundaries

**Files:**
- Modify: `src/server/services/config-templates-service.js`
- Modify: `src/server/services/workspace-service.js`
- Modify: `src/server/services/project-path-validation.js`
- Modify: `src/server/api/config-templates.js`
- Modify: `src/server/api/workspaces.js`
- Modify: `src/commands/workspace.js`
- Modify: `tests/unit/services/config-templates-service.test.js`
- Modify: `tests/unit/services/workspace-service.test.js`
- Modify: `tests/unit/api/config-templates-api.test.js`
- Modify: `tests/unit/api/workspaces-api.test.js`

- [ ] **Step 1: Write failing template and path-boundary tests.** Add assertions that a template uses the project service and that an allowed basename outside a known root is rejected:

```js
test('workspace file route rejects an allowed basename outside known roots', async () => {
  const outside = path.join(testDir, 'outside', 'AGENTS.md');
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, '# outside', 'utf8');

  const res = await request(buildApp()).get(`/read-file?path=${encodeURIComponent(outside)}`);

  expect(res.status).toBe(403);
  expect(res.body.success).toBe(false);
});
```

In `config-templates-service.test.js`, mock `ProjectConfigService` and assert `writeInstruction`, `installProjectSkill` and `upsertProjectMcp` receive the target project root. In `config-templates-api.test.js`, assert the apply route awaits an asynchronous `applyTemplateToProject` result. In `workspace-service.test.js`, await `createWorkspace()` and assert the provisional workspace record exists before the mocked template call.

- [ ] **Step 2: Run focused tests and verify they fail.**

```bash
npx vitest run tests/unit/services/config-templates-service.test.js tests/unit/services/workspace-service.test.js tests/unit/api/config-templates-api.test.js tests/unit/api/workspaces-api.test.js
```

Expected: FAIL because templates still write files directly, workspace/template calls are synchronous, and `/read-file` accepts any path with an allowed basename.

- [ ] **Step 3: Make template application asynchronous and preserve the workspace lifecycle.** Change `applyTemplate()` and `applyTemplateToProject()` in `config-templates-service.js` to return Promises. Iterate selected project Skills sequentially so one failed install produces one skipped result without preventing the remaining items from applying. Use `SkillService.installLocalSkill(directory, { scope: 'project', cwd: targetDir })` when a template item has no repository source, and `SkillService.installSkill(directory, repo, fullDirectory, { scope: 'project', cwd: targetDir })` when it does. Keep `results.skills.items`, `results.skipped` and `.ctx-config.json`.

Change `workspace-service.createWorkspace()` to `async`. After all project targets are created, construct and save the workspace record before awaiting template application. Keep the generated record in a local variable. If a later fatal operation fails, remove that record from `workspaces.json` before deleting the physical workspace directory. Template errors remain non-fatal as in the current behavior.

Update every caller:

```js
// src/server/api/workspaces.js
router.post('/', async (req, res) => {
  const workspace = await workspaceService.createWorkspace({
    name,
    description,
    baseDir,
    projects,
    configTemplateId
  });
  res.json({ success: true, message: '工作区创建成功', data: workspace });
});

// src/server/api/config-templates.js
router.post('/:id/apply', async (req, res) => {
  const result = await templatesService.applyTemplateToProject(targetPath, req.params.id, options);
  res.json({ success: true, message: '模板应用成功', data: result });
});
```

`src/commands/workspace.js` is already asynchronous; add `await` to its `createWorkspace` call. Update all affected service tests to await the returned Promise. Do not add a public path-validation bypass option.

The controlled sequence is:

```text
create directory and project targets
-> validate project targets and symlink components
-> save provisional workspace record
-> await template through ProjectConfigService
-> update configTemplate and save workspace record
```

- [ ] **Step 4: Route project template writes through one service.** In `config-templates-service.js`, replace direct writes for the requested resources with the project service use cases:

```text
AI config       -> writeInstruction
project Skill  -> installProjectSkill
project MCP    -> upsertProjectMcp
```

Keep agent/command template behavior unchanged unless it is required to pass the project root through the same safe resolver. The record remains provenance only; reads still scan native files. Use a lazy `require('./project-config-service')` inside the application function to avoid module-load cycles with workspace validation.

- [ ] **Step 5: Add known-root file validation.** Add `isKnownProjectPath(candidate)` or an equivalent helper to `project-path-validation.js`. It must resolve the candidate’s existing parent path, reject symlink escape, and return true only when the candidate is inside a known project/workspace root. Convert `/api/workspaces/read-file` to async and require both:

```text
basename in ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.ctx-config.json']
AND
file path is inside a known project/workspace root
```

Do not accept arbitrary nested paths solely because the basename is allowed.

- [ ] **Step 6: Run focused tests.**

```bash
npx vitest run tests/unit/services/config-templates-service.test.js tests/unit/services/workspace-service.test.js tests/unit/api/config-templates-api.test.js tests/unit/api/workspaces-api.test.js
```

Expected: PASS; workspace creation still applies templates asynchronously, fatal rollback removes provisional metadata, and outside files return 403.

- [ ] **Step 7: Commit.**

```bash
git add src/server/services/config-templates-service.js src/server/services/workspace-service.js src/server/services/project-path-validation.js src/server/api/config-templates.js src/server/api/workspaces.js src/commands/workspace.js tests/unit/services/config-templates-service.test.js tests/unit/services/workspace-service.test.js tests/unit/api/config-templates-api.test.js tests/unit/api/workspaces-api.test.js
git commit -m "fix: enforce project config path ownership"
```

### Task 9: Update documentation and perform end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- No source files should be changed in this task unless a verification failure identifies a contract regression.

- [ ] **Step 1: Document the user flow.** Add a README subsection under configuration/workspace usage stating:

```text
在项目历史会话页点击“项目配置”，可管理当前项目的项目指令、Skills 和 MCP。
项目配置写入 CLI 原生文件；工作区只负责分组和发现项目。
```

Include the supported native paths from the spec, the distinction between `AGENTS.md` and Agents definitions, and the warning that static MCP secrets may enter Git.
In `CHANGELOG.md` under `## [Unreleased]` → `### Added`, add:

```text
- **项目级配置控制** - 在项目历史会话页管理原生项目指令、Skills 和 MCP，配置按项目 realpath 隔离并保留用户级配置。
```

- [ ] **Step 2: Run all changed backend unit/API tests.**

```bash
npx vitest run \
  tests/unit/platforms/manifest-schema.test.js \
  tests/unit/platforms/registry.test.js \
  tests/unit/services/project-config-service.test.js \
  tests/unit/services/skill-service.test.js \
  tests/unit/services/mcp-service.test.js \
  tests/unit/services/config-templates-service.test.js \
  tests/unit/services/workspace-service.test.js \
  tests/unit/api/project-config-api.test.js \
  tests/unit/api/skills-api.test.js \
  tests/unit/api/config-templates-api.test.js \
  tests/unit/api/workspaces-api.test.js
```

Expected: PASS with no changes to user-level global MCP/Skills assertions.

- [ ] **Step 3: Run Web tests and production build.**

```bash
cd src/web && npx vitest run src/components/__tests__/ProjectConfigDrawer.test.js src/components/__tests__/ProjectInstructionPanel.test.js src/views/__tests__/SessionListProjectConfig.test.js && npm run build
```

Expected: PASS and a successful Vite production build in `src/web/dist`.

- [ ] **Step 4: Run the actual smoke scenario.** Start the application with:

```bash
node bin/ctx.js ui
```

Open the Web UI, select a project with an existing history list, and verify:

```text
项目历史页 -> 项目配置 -> 项目指令
项目指令保存后，项目根目录文件内容改变
项目 Skills 安装后，Skill 目录位于项目 canonical root
项目 MCP 添加后，平台原生 project config 改变且全局 mcp-servers.json 不变
手动修改 native file -> 刷新项目配置 -> UI 显示手动修改
打开另一个项目 -> 旧项目内容不残留
```

Use temporary project directories and temporary native config paths for the smoke run. Do not use a real home directory with production credentials.

- [ ] **Step 5: Run the project’s existing regression suite once.**

```bash
npm test
```

Expected: PASS across basic, API, Codex Agents, Skills and plugin-market checks. If an existing test fails because it asserts an intentionally changed project-scope contract, update that test to the spec rather than adding a compatibility branch.

- [ ] **Step 6: Commit documentation and final verification changes.**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document project config control"
```

## Plan Self-Review

- **Spec coverage:** Manifest metadata is Task 1; path safety and adapters are Task 2; project Skills are Task 3; MCP codecs and project operations are Task 4; HTTP API is Task 5; Web UI and SessionList entry are Tasks 6–7; template integration and workspace file security are Task 8; documentation and full verification are Task 9.
- **No unresolved placeholders:** The plan contains concrete files, method names, request shapes, test assertions, commands and expected outcomes. No task depends on a later undefined symbol.
- **Type consistency:** `projectPath` means canonical absolute realpath in service responses; `cwd` is the incoming project-path field used by existing Skills APIs; `scope` is exactly `user` or `project`; `ProjectConfigService` uses `listProjectMcp`, `upsertProjectMcp`, `removeProjectMcp`, and `testProjectMcp` consistently.
- **Compatibility:** Existing global MCP endpoints, global Skill calls, Agents definitions and workspace JSON format remain unchanged. The only intentional behavior correction outside the new feature is rejecting workspace file reads outside known roots.
