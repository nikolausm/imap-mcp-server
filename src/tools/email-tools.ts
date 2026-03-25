import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { SmtpService } from '../services/smtp-service.js';
import { z } from 'zod';
import { join } from 'path';
import { homedir } from 'os';

const DOWNLOAD_DIR = process.env.IMAP_DOWNLOAD_DIR || join(homedir(), 'Downloads', 'imap-attachments');

export function emailTools(
  server: McpServer,
  imapService: ImapService,
  accountManager: AccountManager,
  smtpService: SmtpService
): void {
  const parseDateOnly = (value: string): Date => {
    const parts = value.split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
      return new Date(value);
    }
    const [year, month, day] = parts;
    return new Date(year, month - 1, day);
  };

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
    if (searchCriteria.since) criteria.since = parseDateOnly(searchCriteria.since);
    if (searchCriteria.before) criteria.before = parseDateOnly(searchCriteria.before);
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
    description: 'Get the full content of an email, with optional text attachment previews',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
      maxContentLength: z.number().default(10000).describe('Maximum characters to return for text and HTML body content'),
      includeAttachmentText: z.boolean().default(true).describe('Include text attachment previews when available'),
      maxAttachmentTextChars: z.number().default(100000).describe('Maximum characters to return per text attachment'),
      includeHeaders: z.boolean().default(false).describe('Include raw email headers (e.g. List-Unsubscribe, List-Unsubscribe-Post)'),
    }
  }, async ({ accountId, folder, uid, maxContentLength, includeAttachmentText, maxAttachmentTextChars, includeHeaders }) => {
    const email = await imapService.getEmailContent(accountId, folder, uid, {
      includeAttachmentText,
      maxAttachmentTextChars,
    });
    const textTruncated = email.textContent ? email.textContent.length > maxContentLength : false;
    const htmlTruncated = email.htmlContent ? email.htmlContent.length > maxContentLength : false;
    const contentTruncated = (textTruncated || htmlTruncated)
      ? { text: textTruncated || undefined, html: htmlTruncated || undefined }
      : undefined;
    
    const { headers: rawHeaders, ...emailWithoutHeaders } = email;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          email: {
            ...emailWithoutHeaders,
            textContent: email.textContent?.substring(0, maxContentLength),
            htmlContent: email.htmlContent?.substring(0, maxContentLength),
            contentTruncated,
            ...(includeHeaders ? { headers: rawHeaders } : {}),
          },
        }, null, 2)
      }]
    };
  });

  // Download attachment tool
  server.registerTool('imap_download_attachment', {
    description: 'Download an attachment from an email. Returns image content directly for image attachments, extracts text from PDFs, or saves to a shared downloads directory accessible from the host.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
      filename: z.string().describe('Attachment filename or contentId'),
      savePath: z.string().optional().describe('Optional file path to save the attachment to. If not provided, files are saved to the shared downloads directory.'),
      extractText: z.boolean().default(true).describe('For PDFs, extract and return text content inline'),
    }
  }, async ({ accountId, folder, uid, filename, savePath, extractText }) => {
    const { content, contentType, filename: resolvedFilename } = await imapService.getAttachmentContent(accountId, folder, uid, filename);

    const isImage = contentType.startsWith('image/');
    const isPdf = contentType === 'application/pdf' || resolvedFilename.toLowerCase().endsWith('.pdf');

    if (isImage && !savePath) {
      // Return image inline as base64 for Claude to view
      return {
        content: [
          {
            type: 'text' as const,
            text: `Attachment: ${resolvedFilename} (${contentType}, ${content.length} bytes)`,
          },
          {
            type: 'image' as const,
            data: content.toString('base64'),
            mimeType: contentType,
          },
        ]
      };
    }

    // For PDFs, try to extract text inline
    if (isPdf && extractText) {
      try {
        const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
        const pdfData = await pdfParse(content);

        // Also save the file for binary access
        const fs = await import('fs');
        const path = await import('path');
        const downloadDir = savePath ? path.dirname(savePath) : DOWNLOAD_DIR;
        fs.mkdirSync(downloadDir, { recursive: true });
        const targetPath = savePath || path.join(DOWNLOAD_DIR, resolvedFilename);
        fs.writeFileSync(targetPath, content);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              saved: true,
              path: targetPath,
              filename: resolvedFilename,
              contentType,
              size: content.length,
              pages: pdfData.numpages,
              textContent: pdfData.text,
            }, null, 2)
          }]
        };
      } catch (err) {
        // Fall through to save-only if PDF parsing fails
        console.error('PDF text extraction failed:', err);
      }
    }

    // Save to shared downloads directory
    const fs = await import('fs');
    const path = await import('path');
    const downloadDir = savePath ? path.dirname(savePath) : DOWNLOAD_DIR;
    fs.mkdirSync(downloadDir, { recursive: true });
    const targetPath = savePath || path.join(DOWNLOAD_DIR, resolvedFilename);
    fs.writeFileSync(targetPath, content);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          saved: true,
          path: targetPath,
          filename: resolvedFilename,
          contentType,
          size: content.length,
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
      uid: z.coerce.number().describe('Email UID'),
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
      uid: z.coerce.number().describe('Email UID'),
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
      uid: z.coerce.number().describe('Email UID'),
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

  // Move email to another folder
  server.registerTool('imap_move_email', {
    description: 'Move an email from one folder to another (e.g., INBOX to Taxes, or INBOX to Archive)',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Source folder name'),
      uid: z.coerce.number().describe('Email UID'),
      targetFolder: z.string().describe('Destination folder name'),
    }
  }, async ({ accountId, folder, uid, targetFolder }) => {
    await imapService.moveEmail(accountId, folder, uid, targetFolder);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Email ${uid} moved from ${folder} to ${targetFolder}`,
        }, null, 2)
      }]
    };
  });

  // Bulk delete emails tool
  server.registerTool('imap_bulk_delete', {
    description: 'Delete multiple emails at once with chunking and auto-reconnection. Processes deletions in batches to prevent connection timeouts.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uids: z.array(z.coerce.number()).describe('Array of email UIDs to delete'),
      chunkSize: z.number().default(50).describe('Number of emails to delete per batch (default: 50)'),
    }
  }, async ({ accountId, folder, uids, chunkSize }) => {
    const result = await imapService.bulkDelete(accountId, folder, uids, chunkSize);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.failed === 0,
          totalRequested: uids.length,
          deleted: result.deleted,
          failed: result.failed,
          errors: result.errors.length > 0 ? result.errors : undefined,
          message: result.failed === 0
            ? `Successfully deleted ${result.deleted} emails`
            : `Deleted ${result.deleted} emails, ${result.failed} failed`,
        }, null, 2)
      }]
    };
  });

  // Bulk delete by search criteria tool
  server.registerTool('imap_bulk_delete_by_search', {
    description: 'Search for emails matching criteria and delete them all. Useful for cleaning up spam or unwanted emails.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      from: z.string().optional().describe('Delete emails from this sender'),
      to: z.string().optional().describe('Delete emails to this recipient'),
      subject: z.string().optional().describe('Delete emails with this subject'),
      before: z.string().optional().describe('Delete emails before this date (YYYY-MM-DD)'),
      since: z.string().optional().describe('Delete emails since this date (YYYY-MM-DD)'),
      chunkSize: z.number().default(50).describe('Number of emails to delete per batch'),
      dryRun: z.boolean().default(false).describe('If true, only return what would be deleted without actually deleting'),
    }
  }, async ({ accountId, folder, from, to, subject, before, since, chunkSize, dryRun }) => {
    const criteria: any = {};
    if (from) criteria.from = from;
    if (to) criteria.to = to;
    if (subject) criteria.subject = subject;
    if (before) criteria.before = parseDateOnly(before);
    if (since) criteria.since = parseDateOnly(since);

    // First search for matching emails
    const messages = await imapService.searchEmails(accountId, folder, criteria);

    if (messages.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            found: 0,
            deleted: 0,
            message: 'No emails matched the search criteria',
          }, null, 2)
        }]
      };
    }

    if (dryRun) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            dryRun: true,
            found: messages.length,
            wouldDelete: messages.length,
            samples: messages.slice(0, 10).map(m => ({
              uid: m.uid,
              from: m.from,
              subject: m.subject,
              date: m.date,
            })),
            message: `Would delete ${messages.length} emails (dry run)`,
          }, null, 2)
        }]
      };
    }

    // Delete all matching emails
    const uids = messages.map(m => m.uid);
    const result = await imapService.bulkDelete(accountId, folder, uids, chunkSize);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.failed === 0,
          found: messages.length,
          deleted: result.deleted,
          failed: result.failed,
          errors: result.errors.length > 0 ? result.errors : undefined,
          message: result.failed === 0
            ? `Successfully deleted ${result.deleted} emails matching criteria`
            : `Deleted ${result.deleted} emails, ${result.failed} failed`,
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
    const sortedMessages = await imapService.getLatestEmails(accountId, folder, count);
    
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
      uid: z.coerce.number().describe('UID of the email to reply to'),
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
      uid: z.coerce.number().describe('UID of the email to forward'),
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
