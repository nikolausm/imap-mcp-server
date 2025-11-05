#!/usr/bin/env node

/**
 * Test script to verify all MCP tools are registered correctly
 *
 * Author: Colin Bitterfield
 * Email: colin@bitterfield.com
 * Version: 0.1.0
 * Date Created: 2025-01-05
 * Date Updated: 2025-01-05
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from './dist/services/imap-service.js';
import { AccountManager } from './dist/services/account-manager.js';
import { SmtpService } from './dist/services/smtp-service.js';
import { accountTools } from './dist/tools/account-tools.js';
import { emailTools } from './dist/tools/email-tools.js';
import { folderTools } from './dist/tools/folder-tools.js';

console.log('🧪 Testing IMAP MCP Pro Tool Registration\n');

// Create mock services
const server = new McpServer({
  name: 'imap-mcp-pro-test',
  version: '2.0.0',
});

const accountManager = new AccountManager();
const imapService = new ImapService(accountManager);
const smtpService = new SmtpService(accountManager);

// Register all tools
console.log('📦 Registering tools...\n');

let toolCount = 0;
const registeredTools = [];

// Wrap registerTool to count tools
const originalRegisterTool = server.registerTool.bind(server);
server.registerTool = function(name, ...args) {
  toolCount++;
  registeredTools.push(name);
  return originalRegisterTool(name, ...args);
};

accountTools(server, imapService, accountManager);
emailTools(server, imapService, accountManager, smtpService);
folderTools(server, imapService);

// Get registered tools
const tools = registeredTools;

// Expected tools by category
const expectedTools = {
  'Account Management': [
    'imap_add_account',
    'imap_list_accounts',
    'imap_remove_account',
    'imap_connect',
    'imap_disconnect',
  ],
  'Email Operations': [
    'imap_search_emails',
    'imap_get_email',
    'imap_mark_as_read',
    'imap_mark_as_unread',
    'imap_delete_email',
    'imap_get_latest_emails',
    'imap_send_email',
    'imap_reply_to_email',
    'imap_forward_email',
  ],
  'Bulk Operations': [
    'imap_bulk_delete_emails',
    'imap_bulk_get_emails',
    'imap_bulk_mark_emails',
  ],
  'Copy/Move Operations (Issue #4)': [
    'imap_copy_email',
    'imap_bulk_copy_emails',
    'imap_move_email',
    'imap_bulk_move_emails',
  ],
  'Folder Operations': [
    'imap_list_folders',
    'imap_folder_status',
    'imap_get_unread_count',
  ],
  'Metrics & Monitoring': [
    'imap_get_metrics',
    'imap_get_operation_metrics',
    'imap_reset_metrics',
  ],
};

// Flatten expected tools
const allExpectedTools = Object.values(expectedTools).flat();
const expectedCount = allExpectedTools.length;

// Print results by category
console.log('📋 Registered Tools by Category:\n');
for (const [category, categoryTools] of Object.entries(expectedTools)) {
  console.log(`\n${category} (${categoryTools.length}):`);
  for (const toolName of categoryTools) {
    const registered = tools.includes(toolName);
    const status = registered ? '✅' : '❌';
    console.log(`  ${status} ${toolName}`);
  }
}

// Check for extra tools
const extraTools = tools.filter(t => !allExpectedTools.includes(t));
if (extraTools.length > 0) {
  console.log('\n⚠️  Extra tools found (not in expected list):');
  extraTools.forEach(t => console.log(`  - ${t}`));
}

// Check for missing tools
const missingTools = allExpectedTools.filter(t => !tools.includes(t));
if (missingTools.length > 0) {
  console.log('\n❌ Missing tools:');
  missingTools.forEach(t => console.log(`  - ${t}`));
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('📊 Summary:');
console.log('='.repeat(50));
console.log(`Expected: ${expectedCount} tools`);
console.log(`Found: ${tools.length} tools`);
console.log(`Status: ${tools.length === expectedCount && missingTools.length === 0 ? '✅ PASS' : '❌ FAIL'}`);
console.log('='.repeat(50) + '\n');

// Exit with appropriate code
const exitCode = (tools.length === expectedCount && missingTools.length === 0) ? 0 : 1;
process.exit(exitCode);
