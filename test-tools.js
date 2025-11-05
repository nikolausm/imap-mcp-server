#!/usr/bin/env node

/**
 * Test script to verify all MCP tools are available
 * Tests Level 1, Level 2, and Level 3 features
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  console.log('🧪 Testing IMAP MCP Server Tools\n');

  // Create client
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0',
  }, {
    capabilities: {},
  });

  try {
    await client.connect(transport);
    console.log('✅ Connected to MCP server\n');

    // List all tools
    const response = await client.listTools();
    const tools = response.tools;

    console.log(`📊 Total tools found: ${tools.length}\n`);

    // Expected new tools
    const expectedNewTools = [
      'imap_bulk_delete_emails',
      'imap_bulk_get_emails',
      'imap_bulk_mark_emails',
      'imap_get_metrics',
      'imap_get_operation_metrics',
      'imap_reset_metrics',
    ];

    // Check for new tools
    console.log('🔍 Checking for new tools:\n');
    let foundCount = 0;
    for (const expectedTool of expectedNewTools) {
      const found = tools.find(t => t.name === expectedTool);
      if (found) {
        console.log(`  ✅ ${expectedTool}`);
        console.log(`     ${found.description}`);
        foundCount++;
      } else {
        console.log(`  ❌ ${expectedTool} - NOT FOUND`);
      }
    }

    console.log(`\n📈 New tools found: ${foundCount}/${expectedNewTools.length}\n`);

    // List all tools by category
    console.log('📋 All Available Tools:\n');

    const categories = {
      'Account Management': ['imap_add_account', 'imap_list_accounts', 'imap_remove_account', 'imap_connect', 'imap_disconnect'],
      'Email Operations': ['imap_search_emails', 'imap_get_email', 'imap_get_latest_emails', 'imap_mark_as_read', 'imap_mark_as_unread', 'imap_delete_email'],
      'Bulk Operations': ['imap_bulk_delete_emails', 'imap_bulk_get_emails', 'imap_bulk_mark_emails'],
      'Email Sending': ['imap_send_email', 'imap_reply_to_email', 'imap_forward_email'],
      'Folder Management': ['imap_list_folders', 'imap_folder_status', 'imap_get_unread_count'],
      'Metrics & Monitoring': ['imap_get_metrics', 'imap_get_operation_metrics', 'imap_reset_metrics'],
    };

    for (const [category, expectedTools] of Object.entries(categories)) {
      console.log(`\n${category}:`);
      for (const toolName of expectedTools) {
        const found = tools.find(t => t.name === toolName);
        if (found) {
          console.log(`  ✅ ${toolName}`);
        } else {
          console.log(`  ❌ ${toolName}`);
        }
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));

    const expectedTotal = 23;
    if (tools.length === expectedTotal && foundCount === expectedNewTools.length) {
      console.log(`✅ SUCCESS: All ${expectedTotal} tools are available!`);
      console.log('✅ All Level 2 and Level 3 features loaded correctly');
      console.log('\n🎉 IMAP MCP Server is fully operational!');
      process.exit(0);
    } else {
      console.log(`⚠️  WARNING: Expected ${expectedTotal} tools, found ${tools.length}`);
      console.log(`⚠️  New tools: ${foundCount}/${expectedNewTools.length} found`);
      if (tools.length < expectedTotal) {
        console.log('\n💡 Tip: Make sure you restarted Claude Desktop to load new code');
      }
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
