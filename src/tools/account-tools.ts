import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AccountManager } from '../services/account-manager.js';
import { ImapService } from '../services/imap-service.js';
import { SmtpService } from '../services/smtp-service.js';
import { z } from 'zod';

export function accountTools(
  server: McpServer,
  accountManager: AccountManager,
  imapService: ImapService,
  smtpService: SmtpService
): void {
  // Add account tool
  server.registerTool('imap_add_account', {
    description: 'Add a new IMAP account configuration',
    inputSchema: {
      name: z.string().describe('Friendly name for the account'),
      host: z.string().describe('IMAP server hostname'),
      port: z.coerce.number().default(993).describe('IMAP server port (default: 993)'),
      user: z.string().describe('Username for authentication'),
      password: z.string().describe('Password for authentication'),
      tls: z.boolean().default(true).describe('Use TLS/SSL (default: true)'),
      email: z.string().optional().describe('Email address (From: header). Defaults to user if omitted'),
      smtpHost: z.string().optional().describe('SMTP server hostname. Defaults to IMAP host with imap.→smtp. rewrite'),
      smtpPort: z.coerce.number().optional().describe('SMTP server port (465 for SMTPS, 587 for STARTTLS). Defaults to 587'),
      smtpSecure: z.boolean().optional().describe('Use implicit TLS (SMTPS). Ignored for port 587/25 which always use STARTTLS, and for port 465 which always uses implicit TLS'),
    }
  }, async ({ name, host, port, user, password, tls, email, smtpHost, smtpPort, smtpSecure }) => {
    const smtp = (smtpHost || smtpPort !== undefined || smtpSecure !== undefined)
      ? {
          host: smtpHost || host,
          port: smtpPort ?? 587,
          secure: smtpSecure ?? false,
        }
      : undefined;

    const account = await accountManager.addAccount({
      name,
      host,
      port,
      user,
      password,
      tls,
      ...(email ? { email } : {}),
      ...(smtp ? { smtp } : {}),
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

  // Update account tool — lets callers fix SMTP config (and other fields) on existing accounts
  server.registerTool('imap_update_account', {
    description: 'Update an existing IMAP account. Useful for fixing SMTP settings without removing and re-adding the account.',
    inputSchema: {
      accountId: z.string().describe('ID of the account to update'),
      name: z.string().optional().describe('New friendly name'),
      host: z.string().optional().describe('IMAP host'),
      port: z.coerce.number().optional().describe('IMAP port'),
      user: z.string().optional().describe('IMAP username'),
      password: z.string().optional().describe('New password'),
      tls: z.boolean().optional().describe('Use TLS for IMAP'),
      email: z.string().optional().describe('Email address (From: header)'),
      smtpHost: z.string().optional().describe('SMTP hostname'),
      smtpPort: z.coerce.number().optional().describe('SMTP port (465 for SMTPS, 587 for STARTTLS)'),
      smtpSecure: z.boolean().optional().describe('Use implicit TLS (SMTPS). Port 587/25 always use STARTTLS regardless'),
      smtpUser: z.string().optional().describe('SMTP username (if different from IMAP user)'),
      smtpPassword: z.string().optional().describe('SMTP password (if different from IMAP password)'),
      saveToSent: z.boolean().optional().describe('Save sent emails to the Sent folder'),
    }
  }, async ({ accountId, name, host, port, user, password, tls, email, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword, saveToSent }) => {
    const existing = accountManager.getAccount(accountId);
    if (!existing) {
      throw new Error(`Account ${accountId} not found`);
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (host !== undefined) updates.host = host;
    if (port !== undefined) updates.port = port;
    if (user !== undefined) updates.user = user;
    if (password !== undefined) updates.password = password;
    if (tls !== undefined) updates.tls = tls;
    if (email !== undefined) updates.email = email;
    if (saveToSent !== undefined) updates.saveToSent = saveToSent;

    const smtpTouched = [smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword].some(v => v !== undefined);
    if (smtpTouched) {
      const current = existing.smtp;
      updates.smtp = {
        host: smtpHost ?? current?.host ?? existing.host,
        port: smtpPort ?? current?.port ?? 587,
        secure: smtpSecure ?? current?.secure ?? false,
        ...(smtpUser !== undefined ? { user: smtpUser } : current?.user ? { user: current.user } : {}),
        ...(smtpPassword !== undefined ? { password: smtpPassword } : {}),
      };
    }

    // Invalidate any cached SMTP transporter so the next send picks up new config
    if (smtpTouched) {
      smtpService.disconnect(accountId);
    }

    const updated = await accountManager.updateAccount(accountId, updates);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          accountId: updated.id,
          message: `Account "${updated.name}" updated`,
          smtp: updated.smtp ? { host: updated.smtp.host, port: updated.smtp.port, secure: updated.smtp.secure } : undefined,
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