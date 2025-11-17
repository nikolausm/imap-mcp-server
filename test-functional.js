#!/usr/bin/env node

/**
 * Functional Integration Test for IMAP MCP Pro
 *
 * Author: Colin Bitterfield
 * Email: colin@bitterfield.com
 * Version: 0.1.0
 * Date Created: 2025-11-17
 * Date Updated: 2025-11-17
 *
 * This script performs functional testing of the IMAP MCP server:
 * - Database operations
 * - Account management
 * - Service initialization
 * - Tool availability
 */

import { DatabaseService } from './dist/services/database-service.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

async function asyncTest(name, fn) {
  try {
    await fn();
    results.passed.push(name);
    console.log(`✅ ${name}`);
  } catch (error) {
    results.failed.push({ name, error: error.message });
    console.log(`❌ ${name}: ${error.message}`);
  }
}

console.log('🧪 IMAP MCP Pro - Functional Integration Test\n');
console.log('='.repeat(60));
console.log('Test Suite: Database & Account Operations');
console.log('='.repeat(60) + '\n');

// Test 1: Database Initialization
console.log('📦 Testing Database Service...');
let db;
test('Initialize DatabaseService', () => {
  db = new DatabaseService();
  if (!db) throw new Error('DatabaseService instance is null');
});

// Test 2: Database File Exists
const dbPath = path.join(os.homedir(), '.imap-mcp', 'data.db');
test('Database file created', () => {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found at ${dbPath}`);
  }
});

// Test 3: Encryption Key
const keyPath = path.join(os.homedir(), '.imap-mcp', '.encryption-key');
test('Encryption key exists', () => {
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Encryption key not found at ${keyPath}`);
  }
});

test('Encryption key permissions are secure', () => {
  const stats = fs.statSync(keyPath);
  const mode = stats.mode & parseInt('777', 8);
  const expectedMode = parseInt('600', 8);
  if (mode !== expectedMode) {
    throw new Error(`Insecure permissions: ${mode.toString(8)}, expected 600`);
  }
});

// Test 4: Database Schema
console.log('\n📦 Testing Database Schema...');

// Test users table
await asyncTest('Create test user', async () => {
  const testUserId = `test-user-${Date.now()}`;
  const user = db.createUser(testUserId, `Test User ${Date.now()}`, 'user');
  if (!user) throw new Error('Failed to create user');
  if (user.id !== testUserId) throw new Error('User ID mismatch');

  // Cleanup
  db.deleteUser(testUserId);
});

// Test accounts
await asyncTest('Account CRUD operations', async () => {
  const testAccountId = `test-account-${Date.now()}`;

  // Create account
  const account = db.createAccount(
    testAccountId,
    'Test Account',
    'test@example.com',
    {
      host: 'imap.example.com',
      port: 993,
      secure: true
    },
    'testpassword123',
    {
      host: 'smtp.example.com',
      port: 587,
      secure: false
    }
  );

  if (!account) throw new Error('Failed to create account');
  if (account.id !== testAccountId) throw new Error('Account ID mismatch');

  // Read account
  const retrieved = db.getAccount(testAccountId);
  if (!retrieved) throw new Error('Failed to retrieve account');
  if (retrieved.id !== testAccountId) throw new Error('Retrieved account ID mismatch');

  // List accounts
  const accounts = db.getAllAccounts();
  if (!Array.isArray(accounts)) throw new Error('getAllAccounts did not return array');

  const found = accounts.find(a => a.id === testAccountId);
  if (!found) throw new Error('Created account not in list');

  // Delete account
  db.deleteAccount(testAccountId);

  const deletedCheck = db.getAccount(testAccountId);
  if (deletedCheck) throw new Error('Account was not deleted');
});

// Test 5: User-Account sharing
console.log('\n📦 Testing User-Account Sharing...');
await asyncTest('Share and unshare account', async () => {
  const userId = `test-user-share-${Date.now()}`;
  const accountId = `test-account-share-${Date.now()}`;

  // Create user and account
  db.createUser(userId, 'Share Test User', 'user');
  db.createAccount(
    accountId,
    'Share Test Account',
    'share@example.com',
    { host: 'imap.example.com', port: 993, secure: true },
    'password123'
  );

  // Share account
  const share = db.shareAccountWithUser(userId, accountId, 'read');
  if (!share) throw new Error('Failed to share account');

  // Get shared accounts
  const sharedAccounts = db.getUserAccounts(userId);
  if (!Array.isArray(sharedAccounts)) throw new Error('getUserAccounts did not return array');
  if (sharedAccounts.length === 0) throw new Error('No shared accounts found');

  const foundShare = sharedAccounts.find(a => a.accountId === accountId);
  if (!foundShare) throw new Error('Shared account not in list');
  if (foundShare.permission !== 'read') throw new Error('Permission mismatch');

  // Unshare
  db.unshareAccountFromUser(userId, accountId);

  const afterUnshare = db.getUserAccounts(userId);
  const stillShared = afterUnshare.find(a => a.accountId === accountId);
  if (stillShared) throw new Error('Account still shared after unshare');

  // Cleanup
  db.deleteAccount(accountId);
  db.deleteUser(userId);
});

// Test 6: Spam Cache
console.log('\n📦 Testing Spam Cache...');
await asyncTest('Spam cache operations', async () => {
  const email = `spam-test-${Date.now()}@example.com`;

  // Add to cache
  db.addSpamCache(email, true, 0.95, { reason: 'test' });

  // Check cache
  const cached = db.getSpamCache(email);
  if (!cached) throw new Error('Spam cache entry not found');
  if (cached.email !== email) throw new Error('Email mismatch');
  if (!cached.isSpam) throw new Error('isSpam should be true');
  if (cached.confidence !== 0.95) throw new Error('Confidence mismatch');

  // Cleanup old entries (this won't delete our fresh entry)
  const deleted = db.cleanupSpamCache(30);

  // Verify still exists
  const stillExists = db.getSpamCache(email);
  if (!stillExists) throw new Error('Fresh cache entry was deleted');
});

// Test 7: Unsubscribe Links
console.log('\n📦 Testing Unsubscribe Links...');
await asyncTest('Unsubscribe link tracking', async () => {
  const accountId = `test-account-unsub-${Date.now()}`;
  const messageId = `test-message-${Date.now()}`;

  // Create account first
  db.createAccount(
    accountId,
    'Unsubscribe Test',
    'unsub@example.com',
    { host: 'imap.example.com', port: 993, secure: true },
    'password123'
  );

  // Add unsubscribe link
  const link = db.addUnsubscribeLink(
    accountId,
    messageId,
    'sender@example.com',
    'Test Newsletter',
    'https://example.com/unsubscribe',
    'http',
    'active'
  );

  if (!link) throw new Error('Failed to add unsubscribe link');

  // Get subscription summary
  const summary = db.getSubscriptionSummary(accountId);
  if (!summary) throw new Error('Failed to get subscription summary');
  if (summary.totalSubscriptions === 0) throw new Error('Summary shows 0 subscriptions');

  // Get unsubscribe links
  const links = db.getUnsubscribeLinks(accountId);
  if (!Array.isArray(links)) throw new Error('getUnsubscribeLinks did not return array');
  if (links.length === 0) throw new Error('No unsubscribe links found');

  const foundLink = links.find(l => l.messageId === messageId);
  if (!foundLink) throw new Error('Created unsubscribe link not found');

  // Mark as unsubscribed
  db.markUnsubscribed(accountId, messageId);

  const updated = db.getUnsubscribeLinks(accountId).find(l => l.messageId === messageId);
  if (updated?.status !== 'unsubscribed') throw new Error('Status not updated to unsubscribed');

  // Cleanup
  db.deleteAccount(accountId);
});

// Test 8: Audit Logging
console.log('\n📦 Testing Audit Logging...');
await asyncTest('Audit log creation and retrieval', async () => {
  const userId = 'test-audit-user';
  const accountId = `test-audit-account-${Date.now()}`;

  // Create audit log entry
  db.addAuditLog(userId, accountId, 'test_action', { test: 'data' });

  // Get audit logs
  const logs = db.getAuditLogs();
  if (!Array.isArray(logs)) throw new Error('getAuditLogs did not return array');
  if (logs.length === 0) throw new Error('No audit logs found');

  const foundLog = logs.find(l => l.userId === userId && l.accountId === accountId);
  if (!foundLog) throw new Error('Created audit log not found');
  if (foundLog.action !== 'test_action') throw new Error('Action mismatch');
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
console.log(`Database Path: ${dbPath}`);
console.log(`Key Path: ${keyPath}`);
console.log('='.repeat(60));

// Exit with appropriate code
const exitCode = results.failed.length === 0 ? 0 : 1;
console.log(`\n${exitCode === 0 ? '✅' : '❌'} Test suite ${exitCode === 0 ? 'PASSED' : 'FAILED'}\n`);

// Cleanup
if (db) {
  db.close();
}

process.exit(exitCode);
