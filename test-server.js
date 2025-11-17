#!/usr/bin/env node

/**
 * Comprehensive test script for IMAP MCP Pro server
 *
 * Author: Colin Bitterfield
 * Email: colin@bitterfield.com
 * Version: 0.1.0
 * Date Created: 2025-11-17
 * Date Updated: 2025-11-17
 *
 * This script tests:
 * - Server initialization
 * - Service instantiation
 * - Tool registration
 * - Database connectivity
 * - Basic functionality
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DatabaseService } from './dist/services/database-service.js';
import { ImapService } from './dist/services/imap-service.js';
import { SmtpService } from './dist/services/smtp-service.js';
import { registerTools } from './dist/tools/index.js';

// Test results tracking
const results = {
  passed: [],
  failed: [],
  warnings: []
};

function test(name, fn) {
  try {
    fn();
    results.passed.push(name);
    console.log(`✅ ${name}`);
  } catch (error) {
    results.failed.push({ name, error: error.message });
    console.log(`❌ ${name}: ${error.message}`);
  }
}

console.log('🧪 IMAP MCP Pro - Comprehensive Server Test\n');
console.log('='.repeat(60));
console.log('Test Suite: Server Initialization & Functionality');
console.log('='.repeat(60) + '\n');

// Test 1: MCP Server Creation
console.log('📦 Testing MCP Server Creation...');
let server;
test('Create MCP Server instance', () => {
  server = new McpServer({
    name: 'imap-mcp-pro-test',
    version: '2.12.0',
  });
  if (!server) throw new Error('Server instance is null');
});

// Test 2: Database Service
console.log('\n📦 Testing Database Service...');
let db;
test('Initialize DatabaseService', () => {
  db = new DatabaseService();
  if (!db) throw new Error('DatabaseService instance is null');
});

test('Database connection exists', () => {
  if (!db.db) throw new Error('Database connection not established');
});

// Test 3: IMAP Service
console.log('\n📦 Testing IMAP Service...');
let imapService;
test('Initialize ImapService', () => {
  imapService = new ImapService(db);
  if (!imapService) throw new Error('ImapService instance is null');
});

test('ImapService has connections Map', () => {
  if (!imapService.connections) throw new Error('Connections Map not found');
  if (!(imapService.connections instanceof Map)) {
    throw new Error('Connections is not a Map');
  }
});

test('ImapService has operation queue', () => {
  if (!imapService.operationQueue) throw new Error('Operation queue not found');
  if (!Array.isArray(imapService.operationQueue)) {
    throw new Error('Operation queue is not an array');
  }
});

// Test 4: SMTP Service
console.log('\n📦 Testing SMTP Service...');
let smtpService;
test('Initialize SmtpService', () => {
  smtpService = new SmtpService();
  if (!smtpService) throw new Error('SmtpService instance is null');
});

// Test 5: Tool Registration
console.log('\n📦 Testing Tool Registration...');
let toolCount = 0;
const registeredTools = [];

// Wrap registerTool to count
const originalRegisterTool = server.registerTool.bind(server);
server.registerTool = function(name, ...args) {
  toolCount++;
  registeredTools.push(name);
  return originalRegisterTool(name, ...args);
};

test('Register all tools', () => {
  registerTools(server, imapService, db, smtpService);
  if (toolCount === 0) throw new Error('No tools registered');
});

test('Verify minimum tool count', () => {
  // We expect at least 32 tools based on test-tools.js
  if (toolCount < 32) {
    throw new Error(`Only ${toolCount} tools registered, expected at least 32`);
  }
});

// Test 6: Database Schema
console.log('\n📦 Testing Database Schema...');
test('Accounts table exists', () => {
  const result = db.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'"
  ).get();
  if (!result) throw new Error('Accounts table not found');
});

test('Capabilities table exists', () => {
  const result = db.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='capabilities'"
  ).get();
  if (!result) throw new Error('Capabilities table not found');
});

test('Schema version table exists', () => {
  const result = db.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();
  if (!result) throw new Error('Schema version table not found');
});

// Test 7: Account Manager Functions
console.log('\n📦 Testing Account Manager Functions...');
test('DatabaseService has listAccounts method', () => {
  if (typeof db.listAccounts !== 'function') {
    throw new Error('listAccounts method not found');
  }
});

test('DatabaseService has addAccount method', () => {
  if (typeof db.addAccount !== 'function') {
    throw new Error('addAccount method not found');
  }
});

test('DatabaseService has removeAccount method', () => {
  if (typeof db.removeAccount !== 'function') {
    throw new Error('removeAccount method not found');
  }
});

// Test 8: List existing accounts
console.log('\n📦 Testing Account Listing...');
let accounts;
test('List existing accounts', () => {
  accounts = db.listAccounts();
  if (!Array.isArray(accounts)) {
    throw new Error('listAccounts did not return an array');
  }
});

if (accounts && accounts.length > 0) {
  console.log(`ℹ️  Found ${accounts.length} existing account(s) in database`);
  results.warnings.push(`${accounts.length} account(s) in database`);
}

// Test 9: Tool Categories
console.log('\n📦 Testing Tool Categories...');
const expectedCategories = {
  account: ['imap_add_account', 'imap_list_accounts', 'imap_remove_account', 'imap_connect', 'imap_disconnect'],
  email: ['imap_search_emails', 'imap_get_email', 'imap_send_email'],
  folder: ['imap_list_folders', 'imap_folder_status'],
  metrics: ['imap_get_metrics', 'imap_get_operation_metrics'],
  meta: ['imap_about', 'imap_list_tools']
};

for (const [category, tools] of Object.entries(expectedCategories)) {
  test(`Category '${category}' tools present`, () => {
    const missing = tools.filter(t => !registeredTools.includes(t));
    if (missing.length > 0) {
      throw new Error(`Missing tools: ${missing.join(', ')}`);
    }
  });
}

// Print detailed tool list
console.log('\n📋 All Registered Tools (' + toolCount + '):');
console.log('-'.repeat(60));
const sortedTools = registeredTools.sort();
sortedTools.forEach((tool, index) => {
  console.log(`${String(index + 1).padStart(3, ' ')}. ${tool}`);
});

// Final Summary
console.log('\n' + '='.repeat(60));
console.log('📊 Test Results Summary');
console.log('='.repeat(60));
console.log(`✅ Passed: ${results.passed.length}`);
console.log(`❌ Failed: ${results.failed.length}`);
console.log(`⚠️  Warnings: ${results.warnings.length}`);
console.log('='.repeat(60));

if (results.failed.length > 0) {
  console.log('\n❌ Failed Tests:');
  results.failed.forEach(({ name, error }) => {
    console.log(`  - ${name}: ${error}`);
  });
}

if (results.warnings.length > 0) {
  console.log('\n⚠️  Warnings:');
  results.warnings.forEach(warning => {
    console.log(`  - ${warning}`);
  });
}

// Environment Info
console.log('\n' + '='.repeat(60));
console.log('🖥️  Environment Information');
console.log('='.repeat(60));
console.log(`Node.js Version: ${process.version}`);
console.log(`Platform: ${process.platform}`);
console.log(`Architecture: ${process.arch}`);
console.log(`Working Directory: ${process.cwd()}`);
console.log(`Database Path: ${process.env.HOME || '.'}/.imap-mcp/data.db`);
console.log('='.repeat(60));

// Exit with appropriate code
const exitCode = results.failed.length === 0 ? 0 : 1;
console.log(`\n${exitCode === 0 ? '✅' : '❌'} Test suite ${exitCode === 0 ? 'PASSED' : 'FAILED'}\n`);

// Cleanup
if (db && db.db) {
  db.db.close();
}

process.exit(exitCode);
