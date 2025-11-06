/**
 * User Management MCP Tools
 *
 * Provides user and account management for MSP multi-tenant architecture.
 * Uses DatabaseService with SQLite3 and AES-256-GCM encryption.
 *
 * Author: Colin Bitterfield
 * Email: colin.bitterfield@templeofepiphany.com
 * Version: 2.6.0
 * Date: 2025-11-05
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DatabaseService } from '../services/database-service.js';
import { z } from 'zod';
import { withErrorHandling } from '../utils/error-handler.js';

export function userTools(
  server: McpServer,
  db: DatabaseService
): void {
  // Create user
  server.registerTool('imap_create_user', {
    description: 'Create a new user (MSP multi-tenant support)',
    inputSchema: {
      username: z.string().describe('Username (unique identifier)'),
      email: z.string().optional().describe('User email address'),
      organization: z.string().optional().describe('Organization name'),
    }
  }, withErrorHandling(async ({ username, email, organization }) => {
    const crypto = await import('crypto');
    const user = db.createUser({
      user_id: crypto.randomUUID(),
      username,
      email: email || undefined,
      organization: organization || undefined,
      is_active: true
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          userId: user.user_id,
          username: user.username,
          message: `User "${username}" created successfully`,
        }, null, 2)
      }]
    };
  }));

  // List users
  server.registerTool('imap_list_users', {
    description: 'List all active users',
    inputSchema: {}
  }, withErrorHandling(async () => {
    const users = db.listUsers();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          users: users.map(u => ({
            userId: u.user_id,
            username: u.username,
            email: u.email,
            organization: u.organization,
            createdAt: u.created_at
          })),
        }, null, 2)
      }]
    };
  }));

  // Get user
  server.registerTool('imap_get_user', {
    description: 'Get user details by username',
    inputSchema: {
      username: z.string().describe('Username to lookup'),
    }
  }, withErrorHandling(async ({ username }) => {
    const user = db.getUserByUsername(username);

    if (!user) {
      throw new Error(`User not found: ${username}`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          user: {
            userId: user.user_id,
            username: user.username,
            email: user.email,
            organization: user.organization,
            isActive: user.is_active,
            createdAt: user.created_at,
            updatedAt: user.updated_at
          },
        }, null, 2)
      }]
    };
  }));

  // Add account to database
  server.registerTool('imap_db_add_account', {
    description: 'Add IMAP account to database (with encryption at rest)',
    inputSchema: {
      userId: z.string().describe('User ID who owns this account'),
      name: z.string().describe('Friendly name for the account'),
      host: z.string().describe('IMAP server hostname'),
      port: z.number().default(993).describe('IMAP server port'),
      username: z.string().describe('IMAP username'),
      password: z.string().describe('IMAP password (will be encrypted)'),
      tls: z.boolean().default(true).describe('Use TLS/SSL'),
      smtpHost: z.string().optional().describe('SMTP server hostname'),
      smtpPort: z.number().optional().describe('SMTP server port'),
      smtpSecure: z.boolean().optional().describe('SMTP use SSL/TLS'),
      smtpUsername: z.string().optional().describe('SMTP username'),
      smtpPassword: z.string().optional().describe('SMTP password (will be encrypted)'),
    }
  }, withErrorHandling(async ({ userId, name, host, port, username, password, tls, smtpHost, smtpPort, smtpSecure, smtpUsername, smtpPassword }) => {
    const account = db.createAccount({
      user_id: userId,
      name,
      host,
      port,
      username,
      password,
      tls,
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_secure: smtpSecure,
      smtp_username: smtpUsername,
      smtp_password: smtpPassword,
      is_active: true
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          accountId: account.account_id,
          message: `Account "${name}" added successfully (encrypted)`,
        }, null, 2)
      }]
    };
  }));

  // List accounts for user
  server.registerTool('imap_db_list_accounts', {
    description: 'List all IMAP accounts for a user',
    inputSchema: {
      userId: z.string().describe('User ID'),
    }
  }, withErrorHandling(async ({ userId }) => {
    const accounts = db.listDecryptedAccountsForUser(userId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          accounts: accounts.map(acc => ({
            accountId: acc.account_id,
            name: acc.name,
            host: acc.host,
            port: acc.port,
            username: acc.username,
            tls: acc.tls,
            hasSmtp: !!acc.smtp_host,
            lastConnected: acc.last_connected
          })),
        }, null, 2)
      }]
    };
  }));

  // Get account details (decrypted)
  server.registerTool('imap_db_get_account', {
    description: 'Get decrypted account details',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
    }
  }, withErrorHandling(async ({ accountId }) => {
    const account = db.getDecryptedAccount(accountId);

    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          account: {
            accountId: account.account_id,
            userId: account.user_id,
            name: account.name,
            host: account.host,
            port: account.port,
            username: account.username,
            password: account.password, // Decrypted
            tls: account.tls,
            smtpHost: account.smtp_host,
            smtpPort: account.smtp_port,
            smtpSecure: account.smtp_secure,
            smtpUsername: account.smtp_username,
            smtpPassword: account.smtp_password, // Decrypted
            lastConnected: account.last_connected,
            createdAt: account.created_at
          },
        }, null, 2)
      }]
    };
  }));

  // Remove account from database
  server.registerTool('imap_db_remove_account', {
    description: 'Remove IMAP account from database',
    inputSchema: {
      accountId: z.string().describe('Account ID to remove'),
    }
  }, withErrorHandling(async ({ accountId }) => {
    db.deleteAccount(accountId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Account ${accountId} removed successfully`,
        }, null, 2)
      }]
    };
  }));

  // Share account with another user
  server.registerTool('imap_share_account', {
    description: 'Share an account with another user (MSP feature)',
    inputSchema: {
      accountId: z.string().describe('Account ID to share'),
      targetUserId: z.string().describe('User ID to share with'),
      role: z.enum(['admin', 'user', 'readonly']).default('readonly').describe('Access role'),
    }
  }, withErrorHandling(async ({ accountId, targetUserId, role }) => {
    db.linkUserToAccount(targetUserId, accountId, role);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Account ${accountId} shared with user ${targetUserId} as ${role}`,
        }, null, 2)
      }]
    };
  }));

  // Unshare account
  server.registerTool('imap_unshare_account', {
    description: 'Revoke account access from a user',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      userId: z.string().describe('User ID to revoke access from'),
    }
  }, withErrorHandling(async ({ accountId, userId }) => {
    db.unlinkUserFromAccount(userId, accountId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Access revoked for user ${userId} on account ${accountId}`,
        }, null, 2)
      }]
    };
  }));
}
