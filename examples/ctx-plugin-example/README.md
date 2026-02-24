# CTX Plugin Example Template

A comprehensive example plugin demonstrating the complete CTX plugin architecture. Use this as a template for developing your own plugins.

## Overview

This example plugin showcases:
- **Plugin Lifecycle**: Proper `activate()` and `deactivate()` functions
- **Hook System**: Subscribing to plugin system hooks
- **Command Registration**: Registering custom CLI commands
- **Configuration Management**: Accessing and managing plugin settings
- **Logging**: Proper error handling and logging
- **State Management**: Maintaining plugin-specific state

## Installation

### Local Development

```bash
# Clone or copy this directory to your plugins folder
cp -r ctx-plugin-example ~/.cc-tool/plugins/

# Or symlink for development
ln -s /path/to/examples/ctx-plugin-example ~/.cc-tool/plugins/
```

### Via NPM (when published)

```bash
npm install ctx-plugin-example -g
ctx plugin install ctx-plugin-example
```

## Plugin Activation

Plugins are automatically loaded from `~/.cc-tool/plugins/` on application startup.

To manually enable/disable:

```bash
ctx plugin enable ctx-plugin-example
ctx plugin disable ctx-plugin-example
ctx plugin list
```

## Available Commands

### `ctx hello [name]`

Say hello from the example plugin.

**Aliases:** `hi`, `greet`

**Examples:**
```bash
ctx hello
# Output: Hello, World!

ctx hello Alice
# Output: Hello, Alice!

ctx greet Bob
# Output: Hello, Bob!
```

**Configuration Impact:**
- Uses the `greeting` config option (default: "Hello")
- Respects the `language` config for localization (en, es, fr)

### `ctx config-demo`

Display current plugin configuration and state.

**Aliases:** `cfg`

**Example:**
```bash
ctx config-demo
# Displays:
# - Active configuration values
# - Feature flags status
# - Plugin state (activation time, command count)
```

## Configuration

Configure the plugin via `~/.cc-tool/ctx-config.json` or environment variables:

### `greeting` (string)
- **Default:** `"Hello"`
- **Description:** Custom greeting message used by the `hello` command
- **Example:** `"Howdy"`

### `language` (string)
- **Default:** `"en"`
- **Allowed:** `"en"`, `"es"`, `"fr"`
- **Description:** Plugin language setting for localized messages
- **Example:**
  ```json
  {
    "ctx-plugin-example": {
      "language": "es"
    }
  }
  ```

### `logLevel` (string)
- **Default:** `"info"`
- **Allowed:** `"debug"`, `"info"`, `"warn"`, `"error"`
- **Description:** Control verbosity of plugin logging
- **Example:**
  ```json
  {
    "ctx-plugin-example": {
      "logLevel": "debug"
    }
  }
  ```

### `enableFeatures` (object)
- **Default:** `{ "greetings": true, "analytics": false }`
- **Description:** Feature toggle flags
- **Example:**
  ```json
  {
    "ctx-plugin-example": {
      "enableFeatures": {
        "greetings": true,
        "analytics": true
      }
    }
  }
  ```

## Configuration File Example

Add to `~/.cc-tool/ctx-config.json`:

```json
{
  "plugins": {
    "ctx-plugin-example": {
      "greeting": "¡Hola",
      "language": "es",
      "logLevel": "debug",
      "enableFeatures": {
        "greetings": true,
        "analytics": true
      }
    }
  }
}
```

## Plugin Architecture

### File Structure

```
ctx-plugin-example/
├── plugin.json          # Plugin manifest with metadata
├── index.js             # Main plugin implementation
└── README.md            # This file
```

### Key Files Explained

#### `plugin.json`
Defines plugin metadata, configuration schema, hooks, and commands. The CTX system reads this to understand what your plugin provides.

**Key sections:**
- `name`, `version`, `description` - Basic metadata
- `ctx.apiVersion` - Required plugin API version
- `ctx.hooks` - List of hooks this plugin subscribes to
- `ctx.commands` - Command definitions
- `ctx.config` - Configuration schema with defaults
- `ctx.permissions` - Required permissions

#### `index.js`
Main plugin implementation containing:

- **`activate(ctx)`** - Initialization function
  - Called on plugin load
  - Subscribe to hooks
  - Register commands
  - Return lifecycle object with `deactivate` function

- **`deactivate()`** - Cleanup function
  - Called on plugin unload
  - Unsubscribe from hooks
  - Release resources

- **Command handlers** - Functions for registered commands
  - Receive parsed arguments
  - Can throw errors which are caught by the plugin system

- **Hook handlers** - Functions called at specific plugin system events
  - `init` - Plugin system initialization
  - `beforeCommand` - Before any command execution
  - `afterCommand` - After any command execution

## Hook System

The plugin can subscribe to these hooks:

| Hook | Timing | Callback Data |
|------|--------|---------------|
| `init` | Plugin system initializes | - |
| `beforeCommand` | Before command execution | `{ command, args, timestamp }` |
| `afterCommand` | After command execution | `{ command, status, result, timestamp }` |

**Usage:**
```javascript
hooks.on('beforeCommand', (data) => {
  console.log(`Executing: ${data.command}`);
});
```

## Development Workflow

### 1. Modify index.js
Add your logic to command handlers or hook handlers.

### 2. Test Commands
```bash
ctx hello test-name
ctx config-demo
```

### 3. View Logs
```bash
ctx logs          # View application logs
ctx logs -f       # Follow logs (tail -f style)
```

### 4. Debug
Enable debug logging:
```json
{
  "ctx-plugin-example": {
    "logLevel": "debug"
  }
}
```

Then check logs for detailed output.

### 5. Reload Plugin
```bash
ctx plugin disable ctx-plugin-example
ctx plugin enable ctx-plugin-example
```

## Creating Your Own Plugin

Use this template as a starting point:

1. **Copy this directory**
   ```bash
   cp -r ctx-plugin-example ~/my-ctx-plugin
   ```

2. **Update `plugin.json`**
   - Change `name`, `version`, `description`
   - Define your `ctx.commands` and `ctx.config`
   - Update `ctx.hooks` with only required hooks

3. **Implement `index.js`**
   - Rename command handlers
   - Add your business logic
   - Update configuration handling

4. **Update this README**
   - Document your plugin's purpose
   - List your commands with examples
   - Explain configuration options

5. **Test**
   ```bash
   ctx plugin enable ~/my-ctx-plugin
   ctx my-command
   ```

## Best Practices

- **Error Handling**: Always wrap logic in try/catch and log errors
- **Logging**: Use the provided `logger` object, not `console.log` (optional)
- **Configuration**: Validate config values before using them
- **Cleanup**: Properly unsubscribe from hooks in `deactivate()`
- **Documentation**: Include JSDoc comments for public functions
- **Backwards Compatibility**: Consider versioning for config schema changes
- **Permissions**: Declare all required permissions in `plugin.json`

## API Reference

### Plugin Context Object

```javascript
{
  config: Object,              // Loaded configuration for this plugin
  hooks: EventEmitter,         // Hook registry (on, off, emit)
  logger: Logger,              // Logger instance
  registerCommand: Function,   // Register new command
  unregisterCommand: Function  // Unregister command
}
```

### Command Handler Signature

```javascript
async function commandHandler(args, options) {
  // args._ = positional arguments
  // options = named flags
  // return result or throw error
}
```

### Hook Handler Signature

```javascript
function hookHandler(data) {
  // Handle hook event
  // Data varies by hook type
}
```

## Troubleshooting

### Plugin not loading
```bash
# Check plugin is in correct directory
ls ~/.cc-tool/plugins/ctx-plugin-example/

# View activation errors in logs
ctx logs
```

### Commands not found
```bash
# Check plugin is enabled
ctx plugin list

# Re-enable plugin
ctx plugin enable ctx-plugin-example
```

### Configuration not working
```bash
# Verify config file location
cat ~/.cc-tool/ctx-config.json

# Check plugin config section exists
# Check config key matches plugin.json schema
```

## Support

For issues or questions:
1. Check this README and troubleshooting section
2. Review the example code and comments
3. Check application logs: `ctx logs`
4. Open an issue on the CTX GitHub repository

## License

MIT - Use this template freely for your own plugins!
