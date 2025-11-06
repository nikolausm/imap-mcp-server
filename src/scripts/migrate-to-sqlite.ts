#!/usr/bin/env tsx
/**
 * Migration Script: JSON to SQLite
 *
 * Migrates IMAP account data from JSON file storage to SQLite database
 * with encryption at rest.
 *
 * Author: Colin Bitterfield
 * Email: colin.bitterfield@templeofepiphany.com
 * Version: 1.0.0
 * Date: 2025-11-05
 *
 * Usage: tsx src/scripts/migrate-to-sqlite.ts
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { DatabaseService } from '../services/database-service.js';

interface OldImapAccount {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
  };
}

interface OldAccountStore {
  accounts: OldImapAccount[];
  encryptionKey?: string;
}

async function migrate() {
  console.log('🔄 Starting migration from JSON to SQLite...\n');

  const accountsPath = path.join(os.homedir(), '.imap-mcp', 'accounts.json');

  // Check if old accounts file exists
  if (!fs.existsSync(accountsPath)) {
    console.log('✅ No accounts.json file found - nothing to migrate');
    return;
  }

  // Read old accounts file
  let oldData: OldAccountStore;
  try {
    const fileContent = fs.readFileSync(accountsPath, 'utf-8');
    oldData = JSON.parse(fileContent);
    console.log(`📋 Found ${oldData.accounts.length} accounts to migrate\n`);
  } catch (error) {
    console.error('❌ Failed to read accounts.json:', error);
    process.exit(1);
  }

  // Initialize database service
  const db = new DatabaseService();

  // Create default user if none exists
  let defaultUser = db.getUserByUsername('default');
  if (!defaultUser) {
    console.log('👤 Creating default user...');
    defaultUser = db.createUser({
      user_id: crypto.randomUUID(),
      username: 'default',
      email: undefined,
      organization: 'Personal',
      is_active: true
    });
    console.log(`   ✅ Created user: ${defaultUser.username} (${defaultUser.user_id})\n`);
  }

  // Migrate each account
  let migratedCount = 0;
  let skippedCount = 0;

  for (const oldAccount of oldData.accounts) {
    try {
      // Check if account already exists (by username and host)
      const existingAccounts = db.listDecryptedAccountsForUser(defaultUser.user_id);
      const exists = existingAccounts.some(
        acc => acc.username === oldAccount.user && acc.host === oldAccount.host
      );

      if (exists) {
        console.log(`⏭️  Skipped: ${oldAccount.name} (already exists)`);
        skippedCount++;
        continue;
      }

      // Create new account in database
      db.createAccount({
        user_id: defaultUser.user_id,
        name: oldAccount.name,
        host: oldAccount.host,
        port: oldAccount.port,
        username: oldAccount.user,
        password: oldAccount.password,
        tls: oldAccount.tls,
        smtp_host: oldAccount.smtp?.host,
        smtp_port: oldAccount.smtp?.port,
        smtp_secure: oldAccount.smtp?.secure,
        smtp_username: oldAccount.smtp?.user,
        smtp_password: oldAccount.smtp?.password,
        is_active: true
      });

      console.log(`✅ Migrated: ${oldAccount.name} (${oldAccount.user}@${oldAccount.host})`);
      migratedCount++;
    } catch (error) {
      console.error(`❌ Failed to migrate ${oldAccount.name}:`, error);
    }
  }

  // Close database
  db.close();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Migration Summary:');
  console.log('='.repeat(60));
  console.log(`Total accounts:     ${oldData.accounts.length}`);
  console.log(`Successfully migrated:  ${migratedCount}`);
  console.log(`Skipped (existing): ${skippedCount}`);
  console.log('='.repeat(60));

  if (migratedCount > 0) {
    // Backup old file
    const backupPath = accountsPath + '.backup';
    fs.copyFileSync(accountsPath, backupPath);
    console.log(`\n✅ Backup created: ${backupPath}`);
    console.log(`📝 You can safely delete ${accountsPath} after verifying migration`);
  }

  console.log('\n🎉 Migration complete!');
}

// Run migration
migrate().catch(error => {
  console.error('\n❌ Migration failed:', error);
  process.exit(1);
});
