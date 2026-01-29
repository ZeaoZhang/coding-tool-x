# TASK B2 - Implementation Summary

## Completed: getServerTools() method in mcp-service.js

### Location
`/Users/zhangzeao/workspace/coding-tool/src/server/services/mcp-service.js`

### Implementation Details

#### 1. Module Import (Line 14)
```javascript
const { McpClient } = require('./mcp-client');
```

#### 2. Connection Pool (Lines 25-28)
```javascript
// MCP 客户端连接池
// serverId -> { client, timestamp }
const mcpClientPool = new Map();
const POOL_TTL = 5 * 60 * 1000; // 5 minutes
```

#### 3. getServerTools() Method (Lines 1062-1146)
```javascript
async function getServerTools(serverId) {
  const server = getServer(serverId);
  if (!server) {
    throw new Error(`MCP 服务器 "${serverId}" 不存在`);
  }

  const startTime = Date.now();
  const spec = server.server;

  try {
    // Check if we have a cached connection
    const cached = mcpClientPool.get(serverId);
    const now = Date.now();

    let client;
    let needsInitialization = false;

    if (cached && now - cached.timestamp < POOL_TTL && cached.client.connected) {
      // Reuse existing connection
      client = cached.client;
      console.log(`[MCP] Reusing pooled connection for "${serverId}"`);
    } else {
      // Create new connection
      if (cached) {
        // Clean up expired connection
        try {
          await cached.client.disconnect();
        } catch (err) {
          console.error(`[MCP] Error disconnecting expired client: ${err.message}`);
        }
        mcpClientPool.delete(serverId);
      }

      // Create new client with 10s timeout
      client = new McpClient(spec, { timeout: 10000 });
      needsInitialization = true;
      console.log(`[MCP] Creating new connection for "${serverId}"`);
    }

    // Connect and initialize if needed
    if (needsInitialization) {
      await client.connect();
      await client.initialize();

      // Cache the connection
      mcpClientPool.set(serverId, {
        client,
        timestamp: Date.now()
      });
    }

    // Get tools list
    const tools = await client.listTools();

    return {
      tools,
      duration: Date.now() - startTime,
      status: 'online'
    };

  } catch (err) {
    // Clean up failed connection from pool
    const cached = mcpClientPool.get(serverId);
    if (cached) {
      try {
        await cached.client.disconnect();
      } catch (e) {
        // ignore
      }
      mcpClientPool.delete(serverId);
    }

    return {
      tools: [],
      duration: Date.now() - startTime,
      status: 'error',
      error: err.message
    };
  }
}
```

#### 4. Module Export (Line 1386)
```javascript
module.exports = {
  // ... existing exports
  getServerTools,
  callServerTool,  // Bonus: also added by system
  // ... other exports
};
```

### Features Implemented

✅ **Connection Pooling**: Connections are cached for 5 minutes, reducing overhead for repeated calls
✅ **Error Handling**: Gracefully handles connection failures and invalid server IDs
✅ **Timeout Protection**: 10-second timeout prevents hanging connections
✅ **Automatic Cleanup**: Expired or failed connections are automatically removed from pool
✅ **Status Reporting**: Returns detailed status including duration, online/error state, and error messages
✅ **Connection Reuse**: Subsequent calls within 5 minutes reuse the existing connection

### Return Value Schema
```javascript
{
  tools: Array,      // Array of tool definitions from MCP server
  duration: number,  // Operation duration in milliseconds
  status: string,    // 'online' or 'error'
  error?: string     // Error message (only present if status is 'error')
}
```

### Error Handling
- Throws error for unknown serverId
- Returns error status (not throw) for connection failures
- Cleans up failed connections from pool
- Logs connection lifecycle events to console

### Test Script
Created test script at `/Users/zhangzeao/workspace/coding-tool/test-get-server-tools.js` for manual verification.

Usage:
```bash
# List available servers
node test-get-server-tools.js

# Test specific server
node test-get-server-tools.js <serverId>
```

### Verification
✓ JavaScript syntax validated with `node -c`
✓ Module exports correctly updated
✓ Connection pooling logic implemented as specified
✓ Error handling follows existing patterns in the file
