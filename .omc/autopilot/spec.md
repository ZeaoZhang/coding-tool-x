# Configuration Export Optimization - Plugin Export Feature

## Requirements Analysis

### Functional Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| FR-1 | Export must include legacy plugin directory (`~/.claude/cc-tool/plugins/`) | Explicit |
| FR-2 | Export must include Claude native plugin directory (`~/.claude/plugins/`) | Implicit (both systems exist) |
| FR-3 | Plugin export should use same format as existing export (JSON/ZIP with base64) | Implicit (consistency) |
| FR-4 | Export should capture full directory structure of each plugin | Implicit (skills use this approach) |
| FR-5 | Export metadata should indicate plugin count and total size | Implicit (UX) |

### Non-Functional Requirements

| ID | Requirement | Rationale |
|----|-------------|-----------|
| NFR-1 | Export should complete in reasonable time (<60s for typical configs) | UX - users won't wait indefinitely |
| NFR-2 | Memory usage should not exceed 512MB during export | Stability - prevent OOM crashes |
| NFR-3 | Sensitive files (.env, credentials) should be excluded or warned | Security |
| NFR-4 | Export format must be backward compatible with v1.1.0 imports | Compatibility |
| NFR-5 | Progress feedback should be provided for large exports | UX |

### Out of Scope

- Plugin import functionality (separate feature)
- Plugin dependency resolution (npm handles this)
- Cross-platform plugin portability
- Plugin marketplace integration
- Plugin version management

## Technical Specification

### Architecture Overview

The plugin export feature extends the existing `config-export-service.js` by adding plugin directory scanning similar to the skills export pattern. It will:

1. Scan both legacy (`~/.claude/cc-tool/plugins/`) and native (`~/.claude/plugins/`) plugin directories
2. Collect plugin metadata from registry files
3. Snapshot plugin files using base64 encoding (excluding node_modules)
4. Add plugin data to export JSON under new `plugins` field
5. Increment export version from 1.1.0 to 1.2.0

### File Structure

Files to modify:
- `src/server/services/config-export-service.js` - Add plugin export logic
- `src/web/src/components/ConfigExportDrawer.vue` - Show plugin count in UI

### Data Schema

Export format v1.2.0 adds:

```json
{
  "version": "1.2.0",
  "exportedAt": "2026-02-01T...",
  "data": {
    "plugins": [
      {
        "type": "legacy" | "native",
        "name": "plugin-name",
        "version": "1.0.0",
        "enabled": true,
        "source": "github:user/repo",
        "manifest": { /* plugin.json or package.json */ },
        "files": [
          {
            "path": "relative/path/to/file.js",
            "content": "base64-encoded-content",
            "encoding": "base64"
          }
        ]
      }
    ]
  }
}
```

### Implementation Approach

#### Step 1: Add Plugin Directory Constants

Add to `config-export-service.js`:

```javascript
const LEGACY_PLUGINS_DIR = path.join(CC_TOOL_DIR, 'plugins');
const NATIVE_PLUGINS_DIR = path.join(os.homedir(), '.claude', 'plugins');
const PLUGIN_IGNORE_DIRS = new Set(['.git', 'node_modules', '.npm', 'dist', 'build']);
const PLUGIN_IGNORE_FILES = new Set(['.DS_Store', '.gitignore', 'package-lock.json']);
```

#### Step 2: Create Plugin File Collector

Similar to `collectSkillFiles()`:

```javascript
function collectPluginFiles(pluginDir, basePath = '') {
  const files = [];
  const entries = fs.readdirSync(pluginDir, { withFileTypes: true });

  for (const entry of entries) {
    if (PLUGIN_IGNORE_FILES.has(entry.name)) continue;

    const fullPath = path.join(pluginDir, entry.name);
    const relativePath = path.join(basePath, entry.name);

    if (entry.isDirectory()) {
      if (PLUGIN_IGNORE_DIRS.has(entry.name)) continue;
      files.push(...collectPluginFiles(fullPath, relativePath));
    } else {
      const content = fs.readFileSync(fullPath);
      files.push({
        path: relativePath,
        content: content.toString('base64'),
        encoding: 'base64'
      });
    }
  }

  return files;
}
```

#### Step 3: Create Plugin Export Function

```javascript
function exportPluginsSnapshot() {
  const plugins = [];

  // Export legacy plugins
  const legacyInstalledDir = path.join(LEGACY_PLUGINS_DIR, 'installed');
  if (fs.existsSync(legacyInstalledDir)) {
    const legacyRegistry = readJsonFileSafe(path.join(LEGACY_PLUGINS_DIR, 'registry.json'));
    const entries = fs.readdirSync(legacyInstalledDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(legacyInstalledDir, entry.name);
      const manifest = readJsonFileSafe(path.join(pluginDir, 'plugin.json'));
      const registryInfo = legacyRegistry?.plugins?.[entry.name] || {};

      plugins.push({
        type: 'legacy',
        name: entry.name,
        version: manifest?.version || registryInfo.version || '1.0.0',
        enabled: registryInfo.enabled !== false,
        source: registryInfo.source || '',
        manifest: manifest,
        files: collectPluginFiles(pluginDir)
      });
    }
  }

  // Export native plugins
  const nativeInstalledFile = path.join(NATIVE_PLUGINS_DIR, 'installed_plugins.json');
  const nativeInstalled = readJsonFileSafe(nativeInstalledFile);
  if (nativeInstalled?.plugins) {
    for (const [key, installations] of Object.entries(nativeInstalled.plugins)) {
      if (!installations?.length) continue;
      const install = installations[0];
      const [name] = key.split('@');

      if (install.installPath && fs.existsSync(install.installPath)) {
        const manifest = readJsonFileSafe(path.join(install.installPath, 'package.json'));

        plugins.push({
          type: 'native',
          name: name,
          version: install.version || manifest?.version || '1.0.0',
          enabled: true,
          source: install.source || '',
          manifest: manifest,
          files: collectPluginFiles(install.installPath)
        });
      }
    }
  }

  return plugins;
}
```

#### Step 4: Integrate into Main Export

Modify `exportConfig()` function to include plugins:

```javascript
async function exportConfig(options = {}) {
  // ... existing code ...

  const data = {
    // ... existing exports ...
    plugins: exportPluginsSnapshot()
  };

  return {
    version: '1.2.0',  // Increment version
    exportedAt: new Date().toISOString(),
    data
  };
}
```

#### Step 5: Update UI to Show Plugin Count

In `ConfigExportDrawer.vue`, add plugin count display:

```vue
<n-statistic label="插件" :value="exportData?.plugins?.length || 0" />
```

### Security Considerations

1. **Exclude sensitive files**: Skip `.env`, `*_key`, `*_secret` files
2. **Validate paths**: Prevent directory traversal attacks
3. **Size limits**: Warn if total export exceeds 100MB
4. **Permissions**: Preserve file permissions metadata for Unix systems

### Testing Checklist

- [ ] Export with no plugins installed
- [ ] Export with only legacy plugins
- [ ] Export with only native plugins
- [ ] Export with both plugin types
- [ ] Export with large plugins (>10MB)
- [ ] Verify backward compatibility (v1.1.0 imports still work)
- [ ] Check UI displays plugin count correctly
- [ ] Verify sensitive files are excluded
