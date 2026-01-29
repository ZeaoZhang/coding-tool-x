#!/usr/bin/env node
/**
 * Test script for getServerTools() method
 *
 * Usage: node test-get-server-tools.js [serverId]
 */

const { getServerTools, getAllServers } = require('./src/server/services/mcp-service');

async function test(serverId) {
  console.log(`Testing getServerTools() for serverId: "${serverId}"`);
  console.log('='.repeat(60));

  try {
    const result = await getServerTools(serverId);

    console.log('\n✓ Success!');
    console.log(`Status: ${result.status}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Tools count: ${result.tools.length}`);

    if (result.error) {
      console.log(`Error: ${result.error}`);
    }

    if (result.tools.length > 0) {
      console.log('\nTools:');
      result.tools.forEach((tool, idx) => {
        console.log(`  ${idx + 1}. ${tool.name}`);
        if (tool.description) {
          console.log(`     ${tool.description}`);
        }
      });
    }

    // Test connection reuse by calling again
    console.log('\n' + '='.repeat(60));
    console.log('Testing connection reuse (should be faster)...');
    console.log('='.repeat(60));

    const result2 = await getServerTools(serverId);
    console.log(`\n✓ Second call completed`);
    console.log(`Duration: ${result2.duration}ms`);
    console.log(`Tools count: ${result2.tools.length}`);

  } catch (err) {
    console.error('\n✗ Error:', err.message);
    process.exit(1);
  }
}

// Main
const serverId = process.argv[2];

if (!serverId) {
  console.log('Available servers:');
  const servers = getAllServers();
  Object.keys(servers).forEach(id => {
    console.log(`  - ${id}`);
  });
  console.log('\nUsage: node test-get-server-tools.js <serverId>');
  process.exit(0);
}

test(serverId);
