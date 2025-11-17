#!/usr/bin/env node

/**
 * Simple Integration Test for IMAP MCP Pro
 *
 * Author: Colin Bitterfield
 * Email: colin@bitterfield.com
 * Version: 0.1.0
 * Date Created: 2025-11-17
 * Date Updated: 2025-11-17
 *
 * This script tests core server functionality:
 * - Database initialization
 * - Account creation and retrieval
 * - User management
 * - Tool registration
 */

import { DatabaseService } from './dist/services/database-service.js';
import { ImapService } from './dist/services/imap-service.js';
import { SmtpService } from './dist/services/smtp-service.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './dist/tools/index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  errors: []
};

function test(name, fn) {
  try {
    fn();
    results.passed++;
    console.log(`✅ ${name}`);
    return true;
  } catch (error) {
    results.failed++;
    results.errors.push({ name, error: error.message });
    console.log(`❌ ${name}: ${error.message}`);
    return false;
  }
}

console.log('🧪 IMAP MCP Pro - Simple Integration Test\n');
console.log('='.repeat(70));
console.log('Testing core server functionality');
console.log('='.repeat(70) + '\n');

// Test 1: Database & File System
console.log('📂 File System Tests:');
const dbPath = path.join(os.homedir(), '.imap-mcp', 'data.db');
const keyPath = path.join(os.homedir(), '.imap-mcp', '.encryption-key');

test('Database directory exists', () => {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    throw new Error(`Database directory not found: ${dbDir}`);
  }
});

// Test 2: Database Service
console.log('\n📦 Database Service Tests:');
let db;
test('Initialize DatabaseService', () => {
  db = new DatabaseService();
  if (!db) throw new Error('Failed to initialize DatabaseService');
});

test('Database file created', () => {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found at ${dbPath}`);
  }
});

test('Encryption key created with secure permissions', () => {
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Encryption key not found at ${keyPath}`);
  }
  const stats = fs.statSync(keyPath);
  const mode = stats.mode & parseInt('777', 8);
  const expectedMode = parseInt('600', 8);
  if (mode !== expectedMode) {
    throw new Error(`Insecure permissions: ${mode.toString(8)}, expected 600`);
  }
});

// Test 3: User Management
console.log('\n👤 User Management Tests:');
const testUserId = `test-user-${Date.now()}`;

test('Create user with all required fields', () => {
  const user = db.createUser({
    user_id: testUserId,
    username: 'testuser',
    email: 'test@example.com',
    organization: 'Test Org',
    is_active: true
  });
  if (!user) throw new Error('Failed to create user');
  if (user.user_id !== testUserId) throw new Error('User ID mismatch');
});

test('Retrieve user by ID', () => {
  const user = db.getUser(testUserId);
  if (!user) throw new Error('Failed to retrieve user');
  if (user.user_id !== testUserId) throw new Error('User ID mismatch');
  if (user.username !== 'testuser') throw new Error('Username mismatch');
});

test('List all users', () => {
  const users = db.listUsers();
  if (!Array.isArray(users)) throw new Error('listUsers did not return array');
  const found = users.find(u => u.user_id === testUserId);
  if (!found) throw new Error('Created user not in list');
});

test('Update user', () => {
  db.updateUser(testUserId, { email: 'updated@example.com' });
  const user = db.getUser(testUserId);
  if (user.email !== 'updated@example.com') throw new Error('User not updated');
});

// Test 4: Account Management
console.log('\n📧 Account Management Tests:');
let testAccountId;

test('Create account with encryption', () => {
  const account = db.createAccount({
    user_id: testUserId,
    name: 'Test Account',
    host: 'imap.example.com',
    port: 993,
    username: 'user@example.com',
    password: 'secret123',
    tls: true,
    is_active: true
  });
  if (!account) throw new Error('Failed to create account');
  if (!account.account_id) throw new Error('Account ID not generated');
  testAccountId = account.account_id; // Store the generated ID
  // Verify password was encrypted
  if (!account.password_encrypted) throw new Error('Password not encrypted');
  if (!account.encryption_iv) throw new Error('Encryption IV not set');
});

test('Retrieve encrypted account', () => {
  const account = db.getAccount(testAccountId);
  if (!account) throw new Error('Failed to retrieve account');
  if (account.account_id !== testAccountId) throw new Error('Account ID mismatch');
  if (account.password_encrypted === 'secret123') throw new Error('Password not encrypted');
});

test('Retrieve and decrypt account', () => {
  const account = db.getDecryptedAccount(testAccountId);
  if (!account) throw new Error('Failed to retrieve decrypted account');
  if (account.password !== 'secret123') throw new Error('Password decryption failed');
});

test('List accounts for user', () => {
  const accounts = db.listAccountsForUser(testUserId);
  if (!Array.isArray(accounts)) throw new Error('listAccountsForUser did not return array');
  const found = accounts.find(a => a.account_id === testAccountId);
  if (!found) throw new Error('Created account not in list');
});

test('Update account', () => {
  db.updateAccount(testAccountId, { name: 'Updated Account' });
  const account = db.getAccount(testAccountId);
  if (account.name !== 'Updated Account') throw new Error('Account not updated');
});

test('Update last connected timestamp', () => {
  db.updateLastConnected(testAccountId);
  const account = db.getAccount(testAccountId);
  if (!account.last_connected) throw new Error('Last connected not set');
});

// Test 5: Services
console.log('\n⚙️  Service Initialization Tests:');
let imapService, smtpService;

test('Initialize ImapService', () => {
  imapService = new ImapService(db);
  if (!imapService) throw new Error('Failed to initialize ImapService');
});

test('Initialize SmtpService', () => {
  smtpService = new SmtpService();
  if (!smtpService) throw new Error('Failed to initialize SmtpService');
});

// Test 6: MCP Server
console.log('\n🖥️  MCP Server Tests:');
let server;

test('Create MCP Server', () => {
  server = new McpServer({
    name: 'imap-mcp-pro-test',
    version: '2.12.0',
  });
  if (!server) throw new Error('Failed to create MCP Server');
});

test('Register tools', () => {
  let toolCount = 0;
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = function(name, ...args) {
    toolCount++;
    return originalRegisterTool(name, ...args);
  };

  registerTools(server, imapService, db, smtpService);

  if (toolCount === 0) throw new Error('No tools registered');
  if (toolCount < 30) throw new Error(`Only ${toolCount} tools registered, expected at least 30`);

  console.log(`   ℹ️  Registered ${toolCount} tools`);
});

// Test 7: Cleanup
console.log('\n🧹 Cleanup Tests:');

test('Delete account', () => {
  db.deleteAccount(testAccountId);
  const account = db.getAccount(testAccountId);
  if (account) throw new Error('Account was not deleted');
});

test('Delete user', () => {
  db.deleteUser(testUserId);
  const user = db.getUser(testUserId);
  if (user) throw new Error('User was not deleted');
});

test('Close database connection', () => {
  db.close();
  // No error means success
});

// Summary
console.log('\n' + '='.repeat(70));
console.log('📊 Test Results Summary');
console.log('='.repeat(70));
console.log(`✅ Passed: ${results.passed}`);
console.log(`❌ Failed: ${results.failed}`);
console.log(`📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
console.log('='.repeat(70));

if (results.failed > 0) {
  console.log('\n❌ Failed Tests:');
  results.errors.forEach(({ name, error }) => {
    console.log(`   • ${name}: ${error}`);
  });
}

// Environment Info
console.log('\n' + '='.repeat(70));
console.log('🖥️  Environment Information');
console.log('='.repeat(70));
console.log(`Node.js: ${process.version}`);
console.log(`Platform: ${process.platform} (${process.arch})`);
console.log(`Database: ${dbPath}`);
console.log(`Key File: ${keyPath}`);
console.log('='.repeat(70));

const exitCode = results.failed === 0 ? 0 : 1;
console.log(`\n${exitCode === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}\n`);

process.exit(exitCode);
