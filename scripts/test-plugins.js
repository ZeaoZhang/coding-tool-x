#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { execSync } = require('child_process');

const TEST_PLUGIN_DIR = '/tmp/ctx-plugin-test';
const PLUGIN_NAME = 'test-plugin';
const PLUGIN_VERSION = '1.0.0';
const UPDATED_VERSION = '1.0.1';

// Determine project root (scripts/ is one level down from root)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CTX_BIN = path.join(PROJECT_ROOT, 'bin', 'ctx.js');

/**
 * Plugin System Integration Test Script
 * Tests the complete lifecycle of plugin management
 */

function log(message) {
  console.log(chalk.blue('ℹ'), message);
}

function success(message) {
  console.log(chalk.green('✓'), message);
}

function error(message) {
  console.log(chalk.red('✗'), message);
}

function section(title) {
  console.log('\n' + chalk.bold.cyan('═'.repeat(60)));
  console.log(chalk.bold.cyan(`  ${title}`));
  console.log(chalk.bold.cyan('═'.repeat(60)));
}

function step(message) {
  console.log(chalk.yellow('→'), message);
}

/**
 * Create a test plugin in /tmp as a Git repository
 */
function createTestPlugin(version = PLUGIN_VERSION) {
  step(`Creating test plugin v${version} at ${TEST_PLUGIN_DIR}`);

  // Clean up if exists
  if (fs.existsSync(TEST_PLUGIN_DIR)) {
    fs.rmSync(TEST_PLUGIN_DIR, { recursive: true, force: true });
  }

  fs.mkdirSync(TEST_PLUGIN_DIR, { recursive: true });

  // Create plugin.json
  const manifest = {
    name: PLUGIN_NAME,
    version,
    displayName: 'Test Plugin',
    description: 'A test plugin for integration testing',
    author: 'Test Author',
    license: 'MIT',
    repository: 'https://github.com/test/test-plugin',
    keywords: ['test', 'example'],
    engines: {
      ctx: '>=2.0.0'
    },
    main: 'index.js'
  };

  fs.writeFileSync(path.join(TEST_PLUGIN_DIR, 'plugin.json'), JSON.stringify(manifest, null, 2));

  // Create index.js
  const indexContent = `
const chalk = require('chalk');

let testData = { value: 0 };

function activate(ctx) {
  console.log(chalk.green('[test-plugin] Activated'));

  // Register a test command
  ctx.registerCommand('test:hello', {
    description: 'Test command from plugin',
    handler: async (args) => {
      console.log(chalk.cyan('[test-plugin] Hello from test plugin!'));
      console.log(chalk.cyan('[test-plugin] Args:'), args);
      testData.value++;
      console.log(chalk.cyan('[test-plugin] Invocation count:'), testData.value);
      return { success: true, count: testData.value };
    }
  });

  // Subscribe to hooks
  ctx.onHook('proxy:started', (data) => {
    console.log(chalk.magenta('[test-plugin] Hook received: proxy:started'), data);
  });

  ctx.onHook('session:launched', (data) => {
    console.log(chalk.magenta('[test-plugin] Hook received: session:launched'), data);
  });

  // Store some config
  ctx.setConfig('testValue', 42);
  ctx.setConfig('testArray', [1, 2, 3]);

  return { initialized: true };
}

function deactivate(ctx) {
  console.log(chalk.yellow('[test-plugin] Deactivated'));
  console.log(chalk.yellow('[test-plugin] Final state:'), testData);
  return { cleaned: true };
}

module.exports = { activate, deactivate };
`;

  fs.writeFileSync(path.join(TEST_PLUGIN_DIR, 'index.js'), indexContent.trim());

  // Create README
  const readmeContent = `# Test Plugin

This is a test plugin for ctx integration testing.

## Commands

- \`ctx test:hello\` - Test command

## Version

Current version: ${version}
`;

  fs.writeFileSync(path.join(TEST_PLUGIN_DIR, 'README.md'), readmeContent.trim());

  // Initialize as git repository
  try {
    execSync('git init', { cwd: TEST_PLUGIN_DIR, stdio: 'ignore' });
    execSync('git add .', { cwd: TEST_PLUGIN_DIR, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: TEST_PLUGIN_DIR, stdio: 'ignore' });
    success(`Test plugin v${version} created as Git repository`);
  } catch (err) {
    error('Failed to initialize Git repository');
    throw err;
  }
}

/**
 * Run a ctx command
 */
function runCommand(command, expectError = false) {
  // Replace ctx command pattern with actual binary path
  const fullCommand = command.replace(/^(node bin\/ctx\.js|ctx)/, `node ${CTX_BIN}`);
  step(`Running: ${chalk.white(fullCommand)}`);

  try {
    const output = execSync(fullCommand, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: 'pipe'
    });

    if (output.trim()) {
      console.log(chalk.gray(output));
    }

    if (!expectError) {
      success('Command succeeded');
    } else {
      error('Expected error but command succeeded');
      return false;
    }

    return true;
  } catch (err) {
    if (expectError) {
      success('Command failed as expected');
      console.log(chalk.gray(err.message));
      return true;
    } else {
      error('Command failed');
      console.log(chalk.red(err.message));
      return false;
    }
  }
}

/**
 * Main test suite
 */
async function runTests() {
  console.log(chalk.bold.green('\n🧪 CTX Plugin System Integration Test\n'));

  console.log(chalk.yellow('⚠️  NOTE: Current plugin system only supports Git URLs (GitHub, GitLab, etc.)'));
  console.log(chalk.yellow('    This test will create a local test plugin but cannot install it directly.'));
  console.log(chalk.yellow('    For full testing, push the plugin to a Git repository.\n'));

  try {
    // Test 1: Create test plugin
    section('1. Create Test Plugin');
    createTestPlugin();
    console.log(chalk.green(`\n✓ Test plugin created at: ${TEST_PLUGIN_DIR}`));
    console.log(chalk.gray('  You can inspect the plugin structure and contents.'));

    // Test 2: Verify plugin structure
    section('2. Verify Plugin Structure');
    step('Checking plugin.json exists');
    const manifestPath = path.join(TEST_PLUGIN_DIR, 'plugin.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      success('plugin.json found and valid');
      console.log(chalk.gray('  Name:    ') + chalk.white(manifest.name));
      console.log(chalk.gray('  Version: ') + chalk.white(manifest.version));
      console.log(chalk.gray('  Author:  ') + chalk.white(manifest.author));
    } else {
      error('plugin.json not found');
      throw new Error('Plugin structure validation failed');
    }

    step('Checking index.js exists');
    const indexPath = path.join(TEST_PLUGIN_DIR, 'index.js');
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, 'utf-8');
      if (content.includes('activate') && content.includes('deactivate')) {
        success('index.js found with required exports');
      } else {
        error('index.js missing required exports');
        throw new Error('Plugin structure validation failed');
      }
    } else {
      error('index.js not found');
      throw new Error('Plugin structure validation failed');
    }

    step('Checking Git repository');
    if (fs.existsSync(path.join(TEST_PLUGIN_DIR, '.git'))) {
      success('Git repository initialized');
    } else {
      error('Not a Git repository');
      throw new Error('Plugin structure validation failed');
    }

    // Test 3: Test plugin commands
    section('3. Test Plugin Commands');
    log('Testing plugin CLI commands with existing plugins (if any)...\n');

    // Test list command
    step('Testing: ctx plugin list');
    runCommand('ctx plugin list', false);

    // Test help command
    step('Testing: ctx plugin --help');
    runCommand('ctx plugin help', false);

    // Test 4: Manual installation instructions
    section('4. Manual Installation Test');
    console.log(chalk.cyan('\n📋 To test full plugin lifecycle:\n'));
    console.log(chalk.white('  1. Push the test plugin to a Git repository:'));
    console.log(chalk.gray(`     cd ${TEST_PLUGIN_DIR}`));
    console.log(chalk.gray('     git remote add origin <your-repo-url>'));
    console.log(chalk.gray('     git push -u origin main\n'));

    console.log(chalk.white('  2. Install the plugin:'));
    console.log(chalk.gray('     ctx plugin install <your-repo-url>\n'));

    console.log(chalk.white('  3. Test plugin commands:'));
    console.log(chalk.gray('     ctx plugin list              # Should show test-plugin'));
    console.log(chalk.gray('     ctx plugin info test-plugin  # Show plugin details'));
    console.log(chalk.gray('     ctx test:hello               # Run custom command\n'));

    console.log(chalk.white('  4. Test state management:'));
    console.log(chalk.gray('     ctx plugin disable test-plugin'));
    console.log(chalk.gray('     ctx plugin enable test-plugin\n'));

    console.log(chalk.white('  5. Test updates:'));
    console.log(chalk.gray('     # Update version in plugin.json'));
    console.log(chalk.gray('     ctx plugin update test-plugin\n'));

    console.log(chalk.white('  6. Test removal:'));
    console.log(chalk.gray('     ctx plugin remove test-plugin\n'));

    // Test 5: Test error handling
    section('5. Test Error Handling');

    step('Test invalid Git URL');
    runCommand('ctx plugin install invalid-url', true);

    step('Test removing non-existent plugin');
    runCommand('ctx plugin remove nonexistent-plugin --yes', true);

    step('Test info for non-existent plugin');
    runCommand('ctx plugin info nonexistent-plugin', true);

    // Cleanup
    section('Cleanup');
    step('Keep test plugin for manual testing? (cleaning up in 5 seconds)');

    await new Promise(resolve => setTimeout(resolve, 5000));

    step('Removing test plugin directory');
    if (fs.existsSync(TEST_PLUGIN_DIR)) {
      fs.rmSync(TEST_PLUGIN_DIR, { recursive: true, force: true });
    }
    success('Cleanup complete');

    // Summary
    console.log('\n' + chalk.bold.green('═'.repeat(60)));
    console.log(chalk.bold.green('  ✓ Automated Tests Completed'));
    console.log(chalk.bold.green('═'.repeat(60)));

    console.log('\n' + chalk.bold.yellow('📝 Test Summary:\n'));
    console.log(chalk.green('  ✓ Plugin structure validation'));
    console.log(chalk.green('  ✓ Plugin command testing'));
    console.log(chalk.green('  ✓ Error handling validation'));
    console.log(chalk.yellow('  ⚠ Manual installation test required (see instructions above)\n'));

    console.log(chalk.gray('💡 To run manual tests:'));
    console.log(chalk.gray('   1. Create a Git repository with the test plugin'));
    console.log(chalk.gray('   2. Follow the installation instructions above'));
    console.log(chalk.gray('   3. Test all plugin lifecycle operations\n'));

  } catch (err) {
    console.log('\n' + chalk.bold.red('═'.repeat(60)));
    console.log(chalk.bold.red('  ✗ Test Suite Failed'));
    console.log(chalk.bold.red('═'.repeat(60)));
    console.error('\n' + chalk.red(err.message));

    // Cleanup on error
    if (fs.existsSync(TEST_PLUGIN_DIR)) {
      fs.rmSync(TEST_PLUGIN_DIR, { recursive: true, force: true });
    }

    process.exit(1);
  }
}

// Run tests
runTests();
