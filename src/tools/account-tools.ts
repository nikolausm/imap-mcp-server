import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DatabaseService } from '../services/database-service.js';
import { ImapService } from '../services/imap-service.js';
import { z } from 'zod';
import { withErrorHandling, AccountNotFoundError, validateOneOf } from '../utils/error-handler.js';
import { withUserAuthorization } from './tool-context.js';

export function accountTools(
  server: McpServer,
  db: DatabaseService,
  imapService: ImapService
): void {
  // Add account tool - DEPRECATED: Use imap_db_add_account instead
  server.registerTool('imap_add_account', {
    description: 'Add a new IMAP account for current user (from MCP_USER_ID environment variable)',
    inputSchema: {
      name: z.string().describe('Friendly name for the account'),
      host: z.string().describe('IMAP server hostname'),
      port: z.number().default(993).describe('IMAP server port (default: 993)'),
      user: z.string().describe('Username for authentication'),
      password: z.string().describe('Password for authentication'),
      tls: z.boolean().default(true).describe('Use TLS/SSL (default: true)'),
    }
  }, withErrorHandling(withUserAuthorization(db, async ({ name, host, port, user, password, tls }, context) => {
    // Create account for the authenticated user from context
    const account = db.createAccount({
      user_id: context.userId,
      name,
      host,
      port,
      username: user,
      password,
      tls,
      is_active: true
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          user: context.username,
          accountId: account.account_id,
          message: `Account "${name}" added successfully for user ${context.username} (encrypted in database)`,
        }, null, 2)
      }]
    };
  })));

  // List accounts tool
  server.registerTool('imap_list_accounts', {
    description: 'List all IMAP accounts for current user (from MCP_USER_ID environment variable)',
    inputSchema: {}
  }, withErrorHandling(withUserAuthorization(db, async (params, context) => {
    // Get accounts for the authenticated user from context
    const accounts = db.listDecryptedAccountsForUser(context.userId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          user: context.username,
          accounts: accounts.map(acc => ({
            id: acc.account_id,
            name: acc.name,
            host: acc.host,
            port: acc.port,
            user: acc.username,
            tls: acc.tls,
          })),
        }, null, 2)
      }]
    };
  })));

  // Remove account tool
  server.registerTool('imap_remove_account', {
    description: 'Remove an IMAP account from database',
    inputSchema: {
      accountId: z.string().describe('ID of the account to remove'),
    }
  }, withErrorHandling(async ({ accountId }) => {
    await imapService.disconnect(accountId);
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

  // Connect to account tool
  server.registerTool('imap_connect', {
    description: 'Connect to an IMAP account',
    inputSchema: {
      accountId: z.string().describe('Account ID to connect to'),
    }
  }, withErrorHandling(async ({ accountId }) => {
    const account = db.getDecryptedAccount(accountId);

    if (!account) {
      throw new AccountNotFoundError(accountId);
    }

    // Convert database account to ImapAccount format
    await imapService.connect({
      id: account.account_id,
      name: account.name,
      host: account.host,
      port: account.port,
      user: account.username,
      password: account.password,
      tls: account.tls
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Connected to account "${account.name}"`,
          accountId: account.account_id,
        }, null, 2)
      }]
    };
  }));

  // Disconnect from account tool
  server.registerTool('imap_disconnect', {
    description: 'Disconnect from an IMAP account',
    inputSchema: {
      accountId: z.string().describe('Account ID to disconnect from'),
    }
  }, withErrorHandling(async ({ accountId }) => {
    await imapService.disconnect(accountId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Disconnected from account ${accountId}`,
        }, null, 2)
      }]
    };
  }));
}