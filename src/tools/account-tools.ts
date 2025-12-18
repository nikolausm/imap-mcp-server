import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AccountManager } from '../services/account-manager.js';
import { ImapService } from '../services/imap-service.js';
import { z } from 'zod';

export function accountTools(
  server: McpServer,
  accountManager: AccountManager,
  imapService: ImapService
): void {
  // Add account tool
  server.registerTool('imap_add_account', {
    description: 'Add a new IMAP account configuration',
    inputSchema: {
      name: z.string().describe('Friendly name for the account'),
      host: z.string().describe('IMAP server hostname'),
      port: z.number().default(993).describe('IMAP server port (default: 993)'),
      user: z.string().describe('Username for authentication'),
      password: z.string().describe('Password for authentication'),
      tls: z.boolean().default(true).describe('Use TLS/SSL (default: true)'),
    }
  }, async ({ name, host, port, user, password, tls }) => {
    const account = await accountManager.addAccount({
      name,
      host,
      port,
      user,
      password,
      tls,
    });
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          accountId: account.id,
          message: `Account "${name}" added successfully`,
        }, null, 2)
      }]
    };
  });

  // List accounts tool
  server.registerTool('imap_list_accounts', {
    description: 'List all configured IMAP accounts',
    inputSchema: {}
  }, async () => {
    const accounts = accountManager.getAllAccounts();
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          accounts: accounts.map(acc => ({
            id: acc.id,
            name: acc.name,
            host: acc.host,
            port: acc.port,
            user: acc.user,
            tls: acc.tls,
          })),
        }, null, 2)
      }]
    };
  });

  // Remove account tool
  server.registerTool('imap_remove_account', {
    description: 'Remove an IMAP account configuration',
    inputSchema: {
      accountId: z.string().describe('ID of the account to remove'),
    }
  }, async ({ accountId }) => {
    await imapService.disconnect(accountId);
    await accountManager.removeAccount(accountId);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Account ${accountId} removed successfully`,
        }, null, 2)
      }]
    };
  });

  // Connect to account tool
  server.registerTool('imap_connect', {
    description: 'Connect to an IMAP account',
    inputSchema: {
      accountId: z.string().optional().describe('Account ID to connect to'),
      accountName: z.string().optional().describe('Account name to connect to'),
    }
  }, async ({ accountId, accountName }) => {
    let account;
    
    if (accountId) {
      account = accountManager.getAccount(accountId);
    } else if (accountName) {
      account = accountManager.getAccountByName(accountName);
    } else {
      throw new Error('Either accountId or accountName must be provided');
    }
    
    if (!account) {
      throw new Error('Account not found');
    }
    
    await imapService.connect(account);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Connected to account "${account.name}"`,
          accountId: account.id,
        }, null, 2)
      }]
    };
  });

  // Disconnect from account tool
  server.registerTool('imap_disconnect', {
    description: 'Disconnect from an IMAP account',
    inputSchema: {
      accountId: z.string().describe('Account ID to disconnect from'),
    }
  }, async ({ accountId }) => {
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
  });

  // Test account connection tool (without re-entering password)
  server.registerTool('imap_test_account', {
    description: 'Test an existing account connection without re-entering credentials. Validates IMAP connectivity and returns folder count and message count.',
    inputSchema: {
      accountId: z.string().describe('Account ID to test'),
    }
  }, async ({ accountId }) => {
    const account = accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const result = await imapService.testConnection(account);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          accountId,
          accountName: account.name,
          host: account.host,
          ...result,
        }, null, 2)
      }]
    };
  });
}