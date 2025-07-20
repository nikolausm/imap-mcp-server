import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { SmtpService } from '../services/smtp-service.js';
import { z } from 'zod';

export function emailTools(
  server: McpServer,
  imapService: ImapService,
  accountManager: AccountManager,
  smtpService: SmtpService
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

  // Send email tool
  server.registerTool('imap_send_email', {
    description: 'Send an email using SMTP',
    inputSchema: {
      accountId: z.string().describe('Account ID to send from'),
      to: z.union([z.string(), z.array(z.string())]).describe('Recipient email address(es)'),
      subject: z.string().describe('Email subject'),
      text: z.string().optional().describe('Plain text content'),
      html: z.string().optional().describe('HTML content'),
      cc: z.union([z.string(), z.array(z.string())]).optional().describe('CC recipients'),
      bcc: z.union([z.string(), z.array(z.string())]).optional().describe('BCC recipients'),
      replyTo: z.string().optional().describe('Reply-to address'),
      attachments: z.array(z.object({
        filename: z.string().describe('Attachment filename'),
        content: z.string().optional().describe('Base64 encoded content'),
        path: z.string().optional().describe('File path to attach'),
        contentType: z.string().optional().describe('MIME type'),
      })).optional().describe('Email attachments'),
    }
  }, async ({ accountId, to, subject, text, html, cc, bcc, replyTo, attachments }) => {
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const emailComposer = {
      from: account.user,
      to,
      subject,
      text,
      html,
      cc,
      bcc,
      replyTo,
      attachments: attachments?.map(att => ({
        filename: att.filename,
        content: att.content ? Buffer.from(att.content, 'base64') : undefined,
        path: att.path,
        contentType: att.contentType,
      })),
    };

    const messageId = await smtpService.sendEmail(accountId, account, emailComposer);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          messageId,
          message: 'Email sent successfully',
        }, null, 2)
      }]
    };
  });

  // Reply to email tool
  server.registerTool('imap_reply_to_email', {
    description: 'Reply to an existing email',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder containing the original email'),
      uid: z.number().describe('UID of the email to reply to'),
      text: z.string().optional().describe('Plain text reply content'),
      html: z.string().optional().describe('HTML reply content'),
      replyAll: z.boolean().default(false).describe('Reply to all recipients'),
      attachments: z.array(z.object({
        filename: z.string().describe('Attachment filename'),
        content: z.string().optional().describe('Base64 encoded content'),
        path: z.string().optional().describe('File path to attach'),
        contentType: z.string().optional().describe('MIME type'),
      })).optional().describe('Email attachments'),
    }
  }, async ({ accountId, folder, uid, text, html, replyAll, attachments }) => {
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Get original email
    const originalEmail = await imapService.getEmailContent(accountId, folder, uid);
    
    // Prepare reply
    const recipients = [originalEmail.from];
    if (replyAll) {
      recipients.push(...originalEmail.to.filter(addr => addr !== account.user));
    }

    const emailComposer = {
      from: account.user,
      to: recipients,
      subject: originalEmail.subject.startsWith('Re: ') ? originalEmail.subject : `Re: ${originalEmail.subject}`,
      text,
      html,
      inReplyTo: originalEmail.messageId,
      references: originalEmail.messageId,
      attachments: attachments?.map(att => ({
        filename: att.filename,
        content: att.content ? Buffer.from(att.content, 'base64') : undefined,
        path: att.path,
        contentType: att.contentType,
      })),
    };

    const messageId = await smtpService.sendEmail(accountId, account, emailComposer);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          messageId,
          message: 'Reply sent successfully',
        }, null, 2)
      }]
    };
  });

  // Forward email tool
  server.registerTool('imap_forward_email', {
    description: 'Forward an existing email',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder containing the original email'),
      uid: z.number().describe('UID of the email to forward'),
      to: z.union([z.string(), z.array(z.string())]).describe('Forward to email address(es)'),
      text: z.string().optional().describe('Additional text to include'),
      includeAttachments: z.boolean().default(true).describe('Include original attachments'),
    }
  }, async ({ accountId, folder, uid, to, text, includeAttachments }) => {
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Get original email
    const originalEmail = await imapService.getEmailContent(accountId, folder, uid);
    
    // Prepare forwarded content
    const forwardHeader = `\n\n---------- Forwarded message ----------\nFrom: ${originalEmail.from}\nDate: ${originalEmail.date.toLocaleString()}\nSubject: ${originalEmail.subject}\nTo: ${originalEmail.to.join(', ')}\n\n`;
    
    const emailComposer = {
      from: account.user,
      to,
      subject: originalEmail.subject.startsWith('Fwd: ') ? originalEmail.subject : `Fwd: ${originalEmail.subject}`,
      text: (text || '') + forwardHeader + (originalEmail.textContent || ''),
      html: originalEmail.htmlContent,
      references: originalEmail.messageId,
    };

    const messageId = await smtpService.sendEmail(accountId, account, emailComposer);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          messageId,
          message: 'Email forwarded successfully',
        }, null, 2)
      }]
    };
  });
}