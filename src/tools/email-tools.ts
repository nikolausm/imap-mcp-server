import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { DatabaseService } from '../services/database-service.js';
import { SmtpService } from '../services/smtp-service.js';
import { z } from 'zod';
import { withErrorHandling, AccountNotFoundError } from '../utils/error-handler.js';

export function emailTools(
  server: McpServer,
  imapService: ImapService,
  db: DatabaseService,
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
  }, withErrorHandling(async ({ accountId, folder, limit, ...searchCriteria }) => {
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
  }));

  // Get email content tool
  server.registerTool('imap_get_email', {
    description: 'Get the full content of an email or just headers',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.number().describe('Email UID'),
      headersOnly: z.boolean().optional().default(false).describe('Fetch only headers without body content (saves bandwidth and context space)')
    }
  }, withErrorHandling(async ({ accountId, folder, uid, headersOnly }) => {
    const email = await imapService.getEmailContent(accountId, folder, uid, headersOnly);

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
  }));

  // Mark email as read tool
  server.registerTool('imap_mark_as_read', {
    description: 'Mark an email as read',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.number().describe('Email UID'),
    }
  }, withErrorHandling(async ({ accountId, folder, uid }) => {
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
  }));

  // Mark email as unread tool
  server.registerTool('imap_mark_as_unread', {
    description: 'Mark an email as unread',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.number().describe('Email UID'),
    }
  }, withErrorHandling(async ({ accountId, folder, uid }) => {
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
  }));

  // Delete email tool
  server.registerTool('imap_delete_email', {
    description: 'Delete an email (moves to trash or expunges)',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.number().describe('Email UID'),
    }
  }, withErrorHandling(async ({ accountId, folder, uid }) => {
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
  }));

  // Bulk delete emails tool
  server.registerTool('imap_bulk_delete_emails', {
    description: 'Bulk delete multiple emails by UIDs. Emails are marked as deleted and optionally expunged.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uids: z.array(z.number()).describe('Array of email UIDs to delete'),
      expunge: z.boolean().default(false).describe('Permanently expunge deleted emails (default: false, just marks as deleted)'),
    }
  }, withErrorHandling(async ({ accountId, folder, uids, expunge }) => {
    if (uids.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'No emails to delete',
            deletedCount: 0,
          }, null, 2)
        }]
      };
    }

    await imapService.bulkDeleteEmails(accountId, folder, uids, expunge);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `${uids.length} email(s) ${expunge ? 'deleted and expunged' : 'marked as deleted'}`,
          deletedCount: uids.length,
          expunged: expunge,
        }, null, 2)
      }]
    };
  }));

  // Get latest emails tool
  server.registerTool('imap_get_latest_emails', {
    description: 'Get the latest emails from a folder',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      count: z.number().default(10).describe('Number of emails to retrieve'),
    }
  }, withErrorHandling(async ({ accountId, folder, count }) => {
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
  }));

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
  }, withErrorHandling(async ({ accountId, to, subject, text, html, cc, bcc, replyTo, attachments }) => {
    const dbAccount = db.getDecryptedAccount(accountId);
    if (!dbAccount) {
      throw new AccountNotFoundError(accountId);
    }

    // Convert database account to ImapAccount format
    const account = {
      id: dbAccount.account_id,
      name: dbAccount.name,
      host: dbAccount.host,
      port: dbAccount.port,
      user: dbAccount.username,
      password: dbAccount.password,
      tls: dbAccount.tls,
      smtp: dbAccount.smtp_host ? {
        host: dbAccount.smtp_host,
        port: dbAccount.smtp_port!,
        secure: dbAccount.smtp_secure || false,
        user: dbAccount.smtp_username,
        password: dbAccount.smtp_password
      } : undefined
    };

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
  }));

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
  }, withErrorHandling(async ({ accountId, folder, uid, text, html, replyAll, attachments }) => {
    const dbAccount = db.getDecryptedAccount(accountId);
    if (!dbAccount) {
      throw new AccountNotFoundError(accountId);
    }

    // Convert database account to ImapAccount format
    const account = {
      id: dbAccount.account_id,
      name: dbAccount.name,
      host: dbAccount.host,
      port: dbAccount.port,
      user: dbAccount.username,
      password: dbAccount.password,
      tls: dbAccount.tls,
      smtp: dbAccount.smtp_host ? {
        host: dbAccount.smtp_host,
        port: dbAccount.smtp_port!,
        secure: dbAccount.smtp_secure || false,
        user: dbAccount.smtp_username,
        password: dbAccount.smtp_password
      } : undefined
    };

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
  }));

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
  }, withErrorHandling(async ({ accountId, folder, uid, to, text, includeAttachments }) => {
    const dbAccount = db.getDecryptedAccount(accountId);
    if (!dbAccount) {
      throw new AccountNotFoundError(accountId);
    }

    // Convert database account to ImapAccount format
    const account = {
      id: dbAccount.account_id,
      name: dbAccount.name,
      host: dbAccount.host,
      port: dbAccount.port,
      user: dbAccount.username,
      password: dbAccount.password,
      tls: dbAccount.tls,
      smtp: dbAccount.smtp_host ? {
        host: dbAccount.smtp_host,
        port: dbAccount.smtp_port!,
        secure: dbAccount.smtp_secure || false,
        user: dbAccount.smtp_username,
        password: dbAccount.smtp_password
      } : undefined
    };

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
  }));

  // Level 2: Bulk get emails tool
  server.registerTool('imap_bulk_get_emails', {
    description: 'Bulk fetch multiple emails at once for better performance',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uids: z.array(z.number()).describe('Array of email UIDs to fetch'),
      fields: z.enum(['headers', 'full', 'body']).default('headers').describe('Fields to fetch: headers (metadata only), body (with text), or full (everything)'),
    }
  }, withErrorHandling(async ({ accountId, folder, uids, fields }) => {
    if (uids.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'No emails to fetch',
            emails: [],
            count: 0,
          }, null, 2)
        }]
      };
    }

    const emails = await imapService.bulkGetEmails(accountId, folder, uids, fields);

    // Limit content for response size
    const limitedEmails = emails.map((email: any) => ({
      ...email,
      textContent: email.textContent?.substring(0, 5000),
      htmlContent: email.htmlContent?.substring(0, 5000),
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          count: emails.length,
          emails: limitedEmails,
        }, null, 2)
      }]
    };
  }));

  // Level 2: Bulk mark emails tool (Issue #54: RFC 9051 extended flags)
  server.registerTool('imap_bulk_mark_emails', {
    description: 'Bulk mark multiple emails with standard IMAP flags (read, unread, flagged, unflagged, answered, unanswered, draft, not-draft, deleted, undeleted)',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uids: z.array(z.number()).describe('Array of email UIDs to mark'),
      operation: z.enum(['read', 'unread', 'flagged', 'unflagged', 'answered', 'unanswered', 'draft', 'not-draft', 'deleted', 'undeleted']).describe('Mark operation to perform'),
    }
  }, withErrorHandling(async ({ accountId, folder, uids, operation }) => {
    if (uids.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'No emails to mark',
            processedCount: 0,
          }, null, 2)
        }]
      };
    }

    await imapService.bulkMarkEmails(accountId, folder, uids, operation);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Successfully marked ${uids.length} email(s) as ${operation}`,
        }, null, 2)
      }]
    };
  }));

  // Issue #4: Copy email tool
  server.registerTool('imap_copy_email', {
    description: 'Copy an email to another folder',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      sourceFolder: z.string().default('INBOX').describe('Source folder name'),
      uid: z.number().describe('Email UID to copy'),
      targetFolder: z.string().describe('Target folder name'),
    }
  }, withErrorHandling(async ({ accountId, sourceFolder, uid, targetFolder }) => {
    await imapService.copyEmail(accountId, sourceFolder, uid, targetFolder);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Email ${uid} copied from ${sourceFolder} to ${targetFolder}`,
        }, null, 2)
      }]
    };
  }));

  // Issue #4: Bulk copy emails tool
  server.registerTool('imap_bulk_copy_emails', {
    description: 'Bulk copy multiple emails to another folder',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      sourceFolder: z.string().default('INBOX').describe('Source folder name'),
      uids: z.array(z.number()).describe('Array of email UIDs to copy'),
      targetFolder: z.string().describe('Target folder name'),
    }
  }, withErrorHandling(async ({ accountId, sourceFolder, uids, targetFolder }) => {
    if (uids.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'No emails to copy',
            processedCount: 0,
          }, null, 2)
        }]
      };
    }

    await imapService.bulkCopyEmails(accountId, sourceFolder, uids, targetFolder);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Successfully copied ${uids.length} email(s) from ${sourceFolder} to ${targetFolder}`,
        }, null, 2)
      }]
    };
  }));

  // Issue #4: Move email tool
  server.registerTool('imap_move_email', {
    description: 'Move an email to another folder (copy + delete)',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      sourceFolder: z.string().default('INBOX').describe('Source folder name'),
      uid: z.number().describe('Email UID to move'),
      targetFolder: z.string().describe('Target folder name'),
    }
  }, withErrorHandling(async ({ accountId, sourceFolder, uid, targetFolder }) => {
    await imapService.moveEmail(accountId, sourceFolder, uid, targetFolder);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Email ${uid} moved from ${sourceFolder} to ${targetFolder}`,
        }, null, 2)
      }]
    };
  }));

  // Issue #4: Bulk move emails tool
  server.registerTool('imap_bulk_move_emails', {
    description: 'Bulk move multiple emails to another folder (copy + delete)',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      sourceFolder: z.string().default('INBOX').describe('Source folder name'),
      uids: z.array(z.number()).describe('Array of email UIDs to move'),
      targetFolder: z.string().describe('Target folder name'),
    }
  }, withErrorHandling(async ({ accountId, sourceFolder, uids, targetFolder }) => {
    if (uids.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'No emails to move',
            processedCount: 0,
          }, null, 2)
        }]
      };
    }

    await imapService.bulkMoveEmails(accountId, sourceFolder, uids, targetFolder);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Successfully moved ${uids.length} email(s) from ${sourceFolder} to ${targetFolder}`,
        }, null, 2)
      }]
    };
  }));

  // Level 3: Get connection metrics
  server.registerTool('imap_get_metrics', {
    description: 'Get connection metrics and health information for an account',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
    }
  }, withErrorHandling(async ({ accountId }) => {
    const metrics = await imapService.getMetrics(accountId);

    if (!metrics) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: `No metrics found for account ${accountId}`,
          }, null, 2)
        }]
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          accountId,
          metrics: {
            ...metrics,
            lastOperationTime: metrics.lastOperationTime?.toISOString(),
          },
        }, null, 2)
      }]
    };
  }));

  // Level 3: Get operation metrics
  server.registerTool('imap_get_operation_metrics', {
    description: 'Get detailed metrics for IMAP operations',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      operationName: z.string().optional().describe('Specific operation name (optional, returns all if not specified)'),
    }
  }, withErrorHandling(async ({ accountId, operationName }) => {
    const metrics = imapService.getOperationMetrics(accountId, operationName);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          operations: metrics.map((m: any) => ({
            ...m,
            lastExecuted: m.lastExecuted?.toISOString(),
          })),
        }, null, 2)
      }]
    };
  }));

  // Level 3: Reset metrics
  server.registerTool('imap_reset_metrics', {
    description: 'Reset connection metrics for an account',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
    }
  }, withErrorHandling(async ({ accountId }) => {
    imapService.resetMetrics(accountId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Metrics reset for account ${accountId}`,
        }, null, 2)
      }]
    };
  }));

  // RFC 9051: Add keyword to emails (Issue #54)
  server.registerTool('imap_add_keyword', {
    description: 'Add a custom keyword to emails. RFC 9051 recommended keywords: $Forwarded, $MDNSent, $Junk, $NotJunk, $Phishing',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uids: z.array(z.number()).describe('Array of email UIDs'),
      keyword: z.string().describe('Keyword to add (e.g., $Forwarded, $Junk, or custom)'),
    }
  }, withErrorHandling(async ({ accountId, folder, uids, keyword }) => {
    if (uids.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'No emails to update',
            processedCount: 0,
          }, null, 2)
        }]
      };
    }

    await imapService.bulkAddKeyword(accountId, folder, uids, keyword);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Successfully added keyword "${keyword}" to ${uids.length} email(s)`,
        }, null, 2)
      }]
    };
  }));

  // RFC 9051: Remove keyword from emails (Issue #54)
  server.registerTool('imap_remove_keyword', {
    description: 'Remove a custom keyword from emails',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uids: z.array(z.number()).describe('Array of email UIDs'),
      keyword: z.string().describe('Keyword to remove (e.g., $Forwarded, $Junk, or custom)'),
    }
  }, withErrorHandling(async ({ accountId, folder, uids, keyword }) => {
    if (uids.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'No emails to update',
            processedCount: 0,
          }, null, 2)
        }]
      };
    }

    await imapService.bulkRemoveKeyword(accountId, folder, uids, keyword);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Successfully removed keyword "${keyword}" from ${uids.length} email(s)`,
        }, null, 2)
      }]
    };
  }));

  // RFC 9051: APPEND command - Upload a message to a mailbox (Issue #52)
  server.registerTool('imap_append_message', {
    description: 'Append a raw RFC822 message to a mailbox (useful for importing emails, saving drafts, or copying messages)',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      mailbox: z.string().default('INBOX').describe('Mailbox name to append to'),
      messageContent: z.string().describe('Raw RFC822 message content (headers + body)'),
      flags: z.array(z.string()).optional().describe('Initial flags for the message (e.g., ["\\Seen", "\\Flagged"])'),
      internalDate: z.string().optional().describe('Internal date for the message (ISO 8601 format)'),
    }
  }, withErrorHandling(async ({ accountId, mailbox, messageContent, flags, internalDate }) => {
    const options: { flags?: string[]; internalDate?: Date } = {};

    if (flags) {
      options.flags = flags;
    }

    if (internalDate) {
      options.internalDate = new Date(internalDate);
    }

    const result = await imapService.appendMessage(accountId, mailbox, messageContent, options);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Message appended to ${mailbox}`,
          uid: result.uid,
          uidValidity: result.uidValidity.toString(),
        }, null, 2)
      }]
    };
  }));

  // Chunked bulk operations for large-scale processing
  server.registerTool('imap_bulk_mark_emails_chunked', {
    description: 'Bulk mark emails with chunking for large operations (1000+ messages). Processes in chunks to avoid timeouts and circuit breaker trips. Returns progress summary.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uids: z.array(z.number()).describe('Array of email UIDs to mark'),
      operation: z.enum(['read', 'unread', 'flagged', 'unflagged', 'answered', 'unanswered', 'draft', 'not-draft', 'deleted', 'undeleted']).describe('Mark operation to perform'),
      chunkSize: z.number().optional().default(100).describe('Number of emails to process per chunk (default: 100)'),
    }
  }, withErrorHandling(async ({ accountId, folder, uids, operation, chunkSize }) => {
    if (uids.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'No emails to mark',
            processed: 0,
            failed: 0,
          }, null, 2)
        }]
      };
    }

    const result = await imapService.bulkMarkEmailsChunked(accountId, folder, uids, operation, {
      chunkSize,
      onProgress: (processed, total, failed) => {
        console.error(`[MCP] Progress: ${processed}/${total} processed, ${failed} failed`);
      }
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.failed === 0,
          message: `Marked ${result.processed} email(s) as ${operation} (${result.failed} failed)`,
          processed: result.processed,
          failed: result.failed,
          errors: result.errors.length > 0 ? result.errors : undefined,
        }, null, 2)
      }]
    };
  }));

  server.registerTool('imap_bulk_delete_emails_chunked', {
    description: 'Bulk delete emails with chunking for large operations (1000+ messages). Processes in chunks to avoid timeouts and circuit breaker trips. Returns progress summary.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uids: z.array(z.number()).describe('Array of email UIDs to delete'),
      expunge: z.boolean().default(false).describe('Permanently expunge deleted emails (default: false, just marks as deleted)'),
      chunkSize: z.number().optional().default(100).describe('Number of emails to process per chunk (default: 100)'),
    }
  }, withErrorHandling(async ({ accountId, folder, uids, expunge, chunkSize }) => {
    if (uids.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'No emails to delete',
            processed: 0,
            failed: 0,
          }, null, 2)
        }]
      };
    }

    const result = await imapService.bulkDeleteEmailsChunked(accountId, folder, uids, expunge, {
      chunkSize,
      onProgress: (processed, total, failed) => {
        console.error(`[MCP] Delete progress: ${processed}/${total} processed, ${failed} failed`);
      }
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.failed === 0,
          message: `Deleted ${result.processed} email(s) (${result.failed} failed)`,
          processed: result.processed,
          failed: result.failed,
          expunged: expunge,
          errors: result.errors.length > 0 ? result.errors : undefined,
        }, null, 2)
      }]
    };
  }));

  server.registerTool('imap_bulk_get_emails_chunked', {
    description: 'Bulk fetch emails with chunking for large operations (1000+ messages). Processes in chunks to avoid timeouts and circuit breaker trips.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uids: z.array(z.number()).describe('Array of email UIDs to fetch'),
      fields: z.enum(['headers', 'full', 'body']).default('headers').describe('Fields to fetch: headers (metadata only), body (with text), or full (everything)'),
      chunkSize: z.number().optional().default(100).describe('Number of emails to process per chunk (default: 100)'),
    }
  }, withErrorHandling(async ({ accountId, folder, uids, fields, chunkSize }) => {
    if (uids.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'No emails to fetch',
            emails: [],
            count: 0,
          }, null, 2)
        }]
      };
    }

    const emails = await imapService.bulkGetEmailsChunked(accountId, folder, uids, fields, {
      chunkSize,
      onProgress: (processed, total) => {
        console.error(`[MCP] Fetch progress: ${processed}/${total} processed`);
      }
    });

    // Limit content for response size
    const limitedEmails = emails.map((email: any) => ({
      ...email,
      textContent: email.textContent?.substring(0, 5000),
      htmlContent: email.htmlContent?.substring(0, 5000),
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          count: emails.length,
          totalRequested: uids.length,
          emails: limitedEmails,
        }, null, 2)
      }]
    };
  }));
}