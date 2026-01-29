# Plugin System Integration Test

## Overview

`test-plugins.js` is a comprehensive integration test script for the CTX plugin system. It validates plugin structure, CLI commands, and error handling.

## Features

### Automated Tests

1. **Plugin Creation** - Creates a test plugin with all required files
   - `plugin.json` with valid manifest
   - `index.js` with activate/deactivate exports
   - `README.md` with documentation
   - Git repository initialization

2. **Structure Validation**
   - Verifies plugin.json exists and is valid JSON
   - Checks for required exports in index.js
   - Confirms Git repository is initialized

3. **CLI Command Testing**
   - Tests `ctx plugin list` command
   - Tests `ctx plugin help` command

4. **Error Handling**
   - Invalid Git URL validation
   - Non-existent plugin operations
   - Proper error messages

### Manual Tests

Due to the plugin system's Git URL requirement, full lifecycle testing requires manual steps:

1. **Installation** - Push test plugin to a Git repository and install
2. **Command Registration** - Test custom commands work
3. **Hook Emissions** - Verify hooks fire correctly
4. **State Management** - Test enable/disable functionality
5. **Updates** - Test plugin update mechanism
6. **Removal** - Test plugin uninstallation

## Usage

### Run Automated Tests

```bash
node scripts/test-plugins.js
```

### Manual Testing Workflow

1. **Create and push test plugin:**
   ```bash
   # Test script creates plugin at /tmp/ctx-plugin-test
   cd /tmp/ctx-plugin-test
   git remote add origin https://github.com/your-username/ctx-test-plugin.git
   git push -u origin main
   ```

2. **Install and test:**
   ```bash
   # Install
   ctx plugin install https://github.com/your-username/ctx-test-plugin.git

   # Verify installation
   ctx plugin list
   ctx plugin info test-plugin

   # Test custom command
   ctx test:hello --arg1 value1

   # Test state management
   ctx plugin disable test-plugin
   ctx plugin enable test-plugin

   # Test updates (after modifying version in plugin.json)
   ctx plugin update test-plugin

   # Test removal
   ctx plugin remove test-plugin
   ```

3. **Test hook emissions:**
   ```bash
   # Start proxy to test proxy:started hook
   ctx proxy start

   # Launch session to test session:launched hook
   # Check logs for hook messages
   ```

## Test Plugin Structure

The test plugin includes:

- **Custom Command**: `test:hello` - Demonstrates command registration
- **Hook Subscriptions**: Listens to `proxy:started` and `session:launched` events
- **Config Storage**: Saves test data to verify config persistence
- **Activation/Deactivation**: Proper lifecycle management

## Expected Output

### Successful Run

```
🧪 CTX Plugin System Integration Test

⚠️  NOTE: Current plugin system only supports Git URLs

════════════════════════════════════════════════════════════
  1. Create Test Plugin
════════════════════════════════════════════════════════════
✓ Test plugin v1.0.0 created as Git repository

════════════════════════════════════════════════════════════
  2. Verify Plugin Structure
════════════════════════════════════════════════════════════
✓ plugin.json found and valid
✓ index.js found with required exports
✓ Git repository initialized

[... additional tests ...]

════════════════════════════════════════════════════════════
  ✓ Automated Tests Completed
════════════════════════════════════════════════════════════

📝 Test Summary:
  ✓ Plugin structure validation
  ✓ Plugin command testing
  ✓ Error handling validation
```

## Test Coverage

- ✅ Plugin manifest validation
- ✅ File structure validation
- ✅ Git repository validation
- ✅ CLI command functionality
- ✅ Error handling and validation
- ⚠️ Installation (manual)
- ⚠️ Command registration (manual)
- ⚠️ Hook emissions (manual)
- ⚠️ Config persistence (manual)
- ⚠️ Updates and removal (manual)

## Troubleshooting

### Git not initialized

If you see "Not a Git repository" error:
```bash
cd /tmp/ctx-plugin-test
git init
git add .
git commit -m "Initial commit"
```

### Plugin already exists

If testing multiple times, remove existing plugin:
```bash
ctx plugin remove test-plugin --yes
```

### Hook messages not appearing

Ensure plugin is enabled and check logs:
```bash
ctx plugin enable test-plugin
ctx logs
```

## Notes

- Test plugin is created in `/tmp/ctx-plugin-test`
- Cleanup happens automatically after 5 seconds
- Test plugin persists for manual testing if needed
- All automated tests must pass for successful completion
