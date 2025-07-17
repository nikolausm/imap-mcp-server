import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { z } from 'zod';

export function emailTools(
  server: McpServer,
  imapService: ImapService,
  accountManager: AccountManager
): void {
  // Search emails tool
  server.registerTool('imap_search_emails', {
    description: 'Search for emails in a folder',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name (default: INBOX)'),
      from: z.string().optional().describe('Search by sender'),
      to: z.string().optional().describe('Search by recipient'),
      subject: z.string().optional().describe('Search by subject'),
      body: z.string().optional().describe('Search in body text'),
      since: z.string().optional().describe('Search emails since date (YYYY-MM-DD)'),
      before: z.string().optional().describe('Search emails before date (YYYY-MM-DD)'),
      seen: z.boolean().optional().describe('Filter by read/unread status'),
      flagged: z.boolean().optional().describe('Filter by flagged status'),
      limit: z.number().optional().default(50).describe('Maximum number of results'),
    }
  }, async ({ accountId, folder, limit, ...searchCriteria }) => {
    const criteria: any = {};
    
    if (searchCriteria.from) criteria.from = searchCriteria.from;
    if (searchCriteria.to) criteria.to = searchCriteria.to;
    if (searchCriteria.subject) criteria.subject = searchCriteria.subject;
    if (searchCriteria.body) criteria.body = searchCriteria.body;
    if (searchCriteria.since) criteria.since = new Date(searchCriteria.since);
    if (searchCriteria.before) criteria.before = new Date(searchCriteria.before);
    if (searchCriteria.seen !== undefined) criteria.seen = searchCriteria.seen;
    if (searchCriteria.flagged !== undefined) criteria.flagged = searchCriteria.flagged;
    
    const messages = await imapService.searchEmails(accountId, folder, criteria);
    const limitedMessages = messages.slice(0, limit);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalFound: messages.length,
          returned: limitedMessages.length,
          messages: limitedMessages,
        }, null, 2)
      }]
    };
  });

  // Get email content tool
  server.registerTool('imap_get_email', {
    description: 'Get the full content of an email',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.number().describe('Email UID'),
    }
  }, async ({ accountId, folder, uid }) => {
    const email = await imapService.getEmailContent(accountId, folder, uid);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          email: {
            ...email,
            textContent: email.textContent?.substring(0, 10000), // Limit text content
            htmlContent: email.htmlContent?.substring(0, 10000), // Limit HTML content
          },
        }, null, 2)
      }]
    };
  });

  // Mark email as read tool
  server.registerTool('imap_mark_as_read', {
    description: 'Mark an email as read',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.number().describe('Email UID'),
    }
  }, async ({ accountId, folder, uid }) => {
    await imapService.markAsRead(accountId, folder, uid);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Email ${uid} marked as read`,
        }, null, 2)
      }]
    };
  });

  // Mark email as unread tool
  server.registerTool('imap_mark_as_unread', {
    description: 'Mark an email as unread',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.number().describe('Email UID'),
    }
  }, async ({ accountId, folder, uid }) => {
    await imapService.markAsUnread(accountId, folder, uid);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Email ${uid} marked as unread`,
        }, null, 2)
      }]
    };
  });

  // Delete email tool
  server.registerTool('imap_delete_email', {
    description: 'Delete an email (moves to trash or expunges)',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.number().describe('Email UID'),
    }
  }, async ({ accountId, folder, uid }) => {
    await imapService.deleteEmail(accountId, folder, uid);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Email ${uid} deleted`,
        }, null, 2)
      }]
    };
  });

  // Get latest emails tool
  server.registerTool('imap_get_latest_emails', {
    description: 'Get the latest emails from a folder',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      count: z.number().default(10).describe('Number of emails to retrieve'),
    }
  }, async ({ accountId, folder, count }) => {
    const messages = await imapService.searchEmails(accountId, folder, {});
    
    // Sort by date descending and take the latest
    const sortedMessages = messages
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, count);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          messages: sortedMessages,
        }, null, 2)
      }]
    };
  });
}