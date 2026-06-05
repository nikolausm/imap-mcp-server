import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { SmtpService } from '../services/smtp-service.js';
import { z } from 'zod';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

// Reusable, backward-compatible account selector. accountId stays accepted as
// before; accountName and the single-account default are additive conveniences.
const accountSelector = {
  accountId: z.string().optional().describe('Account ID (from imap_list_accounts). Optional if accountName is given or only one account is configured.'),
  accountName: z.string().optional().describe('Account name instead of accountId. Optional if accountId is given or only one account is configured.'),
};

const DOWNLOAD_DIR = process.env.IMAP_DOWNLOAD_DIR || join(homedir(), 'Downloads', 'imap-attachments');
const MAX_UPLOAD_SIZE = parseInt(process.env.IMAP_MAX_UPLOAD_SIZE ?? '', 10) || 25 * 1024 * 1024;
const UPLOAD_TTL_MS = parseInt(process.env.IMAP_UPLOAD_TTL_MS ?? '', 10) || 24 * 60 * 60 * 1000;

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
    description: 'Search a mailbox folder for emails matching criteria (sender, recipient, subject, body text, date range, read/flagged status). Use this to FIND messages when you know something about them but not their UID — e.g. "emails from amazon last week", "unread invoices". Returns lightweight headers (uid, from, subject, date); call imap_get_email with a returned uid to read full content. For the newest messages without criteria, prefer imap_get_latest_emails.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name (default: INBOX)'),
      from: z.string().optional().describe('Search by sender'),
      to: z.string().optional().describe('Search by recipient'),
      subject: z.string().optional().describe('Search by subject'),
      body: z.string().optional().describe('Search in body text'),
      since: z.string().optional().describe('Search emails since date (YYYY-MM-DD)'),
      before: z.string().optional().describe('Search emails before date (YYYY-MM-DD)'),
      seen: z.boolean().optional().describe('Filter by read/unread status'),
      flagged: z.boolean().optional().describe('Filter by flagged status'),
      limit: z.coerce.number().optional().default(50).describe('Maximum number of results'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, limit, ...searchCriteria }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
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
    description: 'Read the FULL content of a single email by its UID (plain text + HTML body, sender/recipients, date, attachment list, optional raw headers and text-attachment previews). Use after imap_search_emails or imap_get_latest_emails gives you a uid. Body text is truncated to maxContentLength to protect the context window — raise it for long messages. To fetch attachment bytes, use imap_download_attachment.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
      maxContentLength: z.coerce.number().default(10000).describe('Maximum characters to return for text and HTML body content'),
      includeAttachmentText: z.boolean().default(true).describe('Include text attachment previews when available'),
      maxAttachmentTextChars: z.coerce.number().default(100000).describe('Maximum characters to return per text attachment'),
      includeHeaders: z.boolean().default(false).describe('Include raw email headers (e.g. List-Unsubscribe, List-Unsubscribe-Post)'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid, maxContentLength, includeAttachmentText, maxAttachmentTextChars, includeHeaders }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
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

  // Upload file tool - writes a file to the server for use as an email attachment
  server.registerTool('imap_upload_file', {
    description: `Upload a file to the server for use as an email attachment. Returns a path that can be used with imap_send_email attachments. This allows sending large attachments without hitting context window limits. Max size: ${MAX_UPLOAD_SIZE} bytes (configurable via IMAP_MAX_UPLOAD_SIZE). Uploads are auto-deleted after ${UPLOAD_TTL_MS} ms (configurable via IMAP_UPLOAD_TTL_MS).`,
    inputSchema: {
      filename: z.string().describe('Filename to save as'),
      content: z.string().describe('Base64 encoded file content'),
      contentType: z.string().optional().describe('MIME type (optional, used for metadata only)'),
    }
  }, async ({ filename, content, contentType }) => {
    const fs = await import('fs');
    const path = await import('path');

    const uploadDir = path.join(DOWNLOAD_DIR, 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });

    // TTL cleanup: remove stale uploads on each call
    const now = Date.now();
    try {
      for (const entry of fs.readdirSync(uploadDir)) {
        const entryPath = path.join(uploadDir, entry);
        try {
          const stat = fs.statSync(entryPath);
          if (stat.isFile() && now - stat.mtimeMs > UPLOAD_TTL_MS) {
            fs.unlinkSync(entryPath);
          }
        } catch {
          // ignore individual file errors
        }
      }
    } catch {
      // ignore directory read errors
    }

    const buffer = Buffer.from(content, 'base64');
    if (buffer.length > MAX_UPLOAD_SIZE) {
      throw new Error(`File exceeds max upload size of ${MAX_UPLOAD_SIZE} bytes (got ${buffer.length}). Increase IMAP_MAX_UPLOAD_SIZE if needed.`);
    }

    const sanitizedFilename = path.basename(filename);
    const uniquePrefix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    const targetPath = path.join(uploadDir, `${uniquePrefix}-${sanitizedFilename}`);

    fs.writeFileSync(targetPath, buffer);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          path: targetPath,
          filename: sanitizedFilename,
          size: buffer.length,
          contentType: contentType || 'application/octet-stream',
          expiresAt: new Date(Date.now() + UPLOAD_TTL_MS).toISOString(),
          message: `File uploaded successfully. Use this path in imap_send_email attachments: ${targetPath}`,
        }, null, 2)
      }]
    };
  });

  // Download attachment tool
  server.registerTool('imap_download_attachment', {
    description: 'Download a single attachment from an email (folder + uid + attachment filename/contentId, as listed by imap_get_email). Images are returned inline for viewing; PDFs are saved and their text is extracted inline (extractText); other files are saved to the shared downloads directory (or savePath). Use when the user wants the actual file contents, not just the message body.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
      filename: z.string().describe('Attachment filename or contentId'),
      savePath: z.string().optional().describe('Optional file path to save the attachment to. If not provided, files are saved to the shared downloads directory.'),
      extractText: z.boolean().default(true).describe('For PDFs, extract and return text content inline'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid, filename, savePath, extractText }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
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
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
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
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
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
    description: 'Delete ONE email by folder + uid (moves to Trash or expunges, server-dependent). Destructive and not easily undone — confirm the user means this specific message. To remove many at once use imap_bulk_delete (known uids) or imap_bulk_delete_by_search (by criteria, supports dryRun). To file an email away instead of deleting, use imap_move_email.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
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
    description: 'Move an email from one folder to another (e.g., INBOX to Taxes, or INBOX to Archive). Optionally creates the destination folder if it does not exist.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Source folder name'),
      uid: z.coerce.number().describe('Email UID'),
      targetFolder: z.string().describe('Destination folder name'),
      createDestinationIfMissing: z.boolean().optional().describe('If true, create the destination folder before moving when it does not exist (default: false)'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid, targetFolder, createDestinationIfMissing }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    try {
      const result = await imapService.moveEmail(accountId, folder, uid, targetFolder, {
        createDestinationIfMissing,
      });

      const uidMapObj: Record<string, number> = {};
      if (result.uidMap) {
        for (const [srcUid, destUid] of result.uidMap) {
          uidMapObj[String(srcUid)] = destUid;
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Email ${uid} moved from ${folder} to ${targetFolder}`,
            destination: result.destination,
            destinationCreated: result.destinationCreated,
            uidMap: Object.keys(uidMapObj).length > 0 ? uidMapObj : undefined,
          }, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: `Failed to move email ${uid} from ${folder} to ${targetFolder}`,
            error: err instanceof Error ? err.message : 'Unknown error',
          }, null, 2)
        }]
      };
    }
  });

  // Bulk delete emails tool
  server.registerTool('imap_bulk_delete', {
    description: 'Delete multiple emails at once with chunking and auto-reconnection. Processes deletions in batches to prevent connection timeouts.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uids: z.array(z.coerce.number()).describe('Array of email UIDs to delete'),
      chunkSize: z.coerce.number().default(50).describe('Number of emails to delete per batch (default: 50)'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uids, chunkSize }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
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
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      from: z.string().optional().describe('Delete emails from this sender'),
      to: z.string().optional().describe('Delete emails to this recipient'),
      subject: z.string().optional().describe('Delete emails with this subject'),
      before: z.string().optional().describe('Delete emails before this date (YYYY-MM-DD)'),
      since: z.string().optional().describe('Delete emails since this date (YYYY-MM-DD)'),
      chunkSize: z.coerce.number().default(50).describe('Number of emails to delete per batch'),
      dryRun: z.boolean().default(false).describe('If true, only return what would be deleted without actually deleting'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, from, to, subject, before, since, chunkSize, dryRun }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
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
    description: 'Get the most recent emails from a folder, newest first. Use this for "what just came in?" / "show my latest inbox messages" when no search filter is needed. Returns lightweight headers (uid, from, subject, date); read a specific one with imap_get_email. To filter by sender/subject/date instead, use imap_search_emails.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      count: z.coerce.number().default(10).describe('Number of emails to retrieve'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, count }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
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
    description: 'Compose and send a NEW email via the account\'s SMTP server (a copy is saved to Sent unless disabled). Use for fresh outbound messages. To respond to an existing message use imap_reply_to_email (keeps threading); to pass a message on use imap_forward_email; to store without sending use imap_save_draft. Supports to/cc/bcc, text and/or HTML, and attachments by base64 content or by file path (see imap_upload_file for large files).',
    inputSchema: {
      ...accountSelector,
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
  }, async ({ accountId: rawAccountId, accountName, to, subject, text, html, cc, bcc, replyTo, attachments }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const emailComposer = {
      from: account.email || account.user,
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

    const { messageId, rawMessage } = await smtpService.sendEmail(accountId, account, emailComposer);

    // Save copy to Sent folder
    let savedToSent = false;
    if (rawMessage && account.saveToSent !== false) {
      try {
        savedToSent = await imapService.appendToSentFolder(accountId, rawMessage);
      } catch { /* non-critical */ }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          messageId,
          savedToSent,
          message: savedToSent ? 'Email sent successfully (saved to Sent folder)' : 'Email sent successfully',
        }, null, 2)
      }]
    };
  });

  // Save draft tool — composes a message and appends it to the Drafts folder with the \Draft flag
  server.registerTool('imap_save_draft', {
    description: 'Save an email as a draft in the Drafts folder (no send). Takes the same fields as imap_send_email.',
    inputSchema: {
      ...accountSelector,
      to: z.union([z.string(), z.array(z.string())]).optional().describe('Recipient email address(es)'),
      subject: z.string().optional().describe('Email subject'),
      text: z.string().optional().describe('Plain text content'),
      html: z.string().optional().describe('HTML content'),
      cc: z.union([z.string(), z.array(z.string())]).optional().describe('CC recipients'),
      bcc: z.union([z.string(), z.array(z.string())]).optional().describe('BCC recipients'),
      replyTo: z.string().optional().describe('Reply-to address'),
      inReplyTo: z.string().optional().describe('Message-Id being replied to'),
      references: z.union([z.string(), z.array(z.string())]).optional().describe('References header value(s)'),
      attachments: z.array(z.object({
        filename: z.string().describe('Attachment filename'),
        content: z.string().optional().describe('Base64 encoded content'),
        path: z.string().optional().describe('File path to attach'),
        contentType: z.string().optional().describe('MIME type'),
      })).optional().describe('Email attachments'),
      folder: z.string().optional().describe('Override the Drafts folder name (defaults to auto-detected Drafts folder)'),
    }
  }, async ({ accountId: rawAccountId, accountName, to, subject, text, html, cc, bcc, replyTo, inReplyTo, references, attachments, folder }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const emailComposer = {
      from: account.email || account.user,
      to: to ?? '',
      subject: subject ?? '',
      text,
      html,
      cc,
      bcc,
      replyTo,
      inReplyTo,
      references,
      attachments: attachments?.map(att => ({
        filename: att.filename,
        content: att.content ? Buffer.from(att.content, 'base64') : undefined,
        path: att.path,
        contentType: att.contentType,
      })),
    };

    const rawMessage = await smtpService.composeRaw(account, emailComposer);

    const draftsFolder = folder ?? await imapService.findDraftsFolder(accountId);
    if (!draftsFolder) {
      throw new Error('No Drafts folder found. Tried: Drafts, Draft, INBOX.Drafts, INBOX.Draft, [Gmail]/Drafts. Pass `folder` to override.');
    }

    const appended = await imapService.appendMessage(accountId, draftsFolder, rawMessage, ['\\Draft', '\\Seen']);
    if (!appended) {
      throw new Error(`Failed to append draft to folder "${draftsFolder}"`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          folder: draftsFolder,
          message: `Draft saved to "${draftsFolder}"`,
        }, null, 2)
      }]
    };
  });

  // Reply to email tool
  server.registerTool('imap_reply_to_email', {
    description: 'Reply to an existing email identified by folder + uid. Automatically sets the recipient to the original sender, prefixes the subject with "Re:", and preserves threading (In-Reply-To/References). Set replyAll to also include the original recipients. Use this instead of imap_send_email whenever the user is responding to a message already in a mailbox.',
    inputSchema: {
      ...accountSelector,
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
  }, async ({ accountId: rawAccountId, accountName, folder, uid, text, html, replyAll, attachments }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Get original email
    const originalEmail = await imapService.getEmailContent(accountId, folder, uid);

    // Extract the bare email address from a header value that may include a
    // display name (e.g. 'Alice <alice@example.com>' → 'alice@example.com').
    // Returns lowercase for case-insensitive comparison per RFC 5321 §2.4.
    const extractEmail = (addr: string): string => {
      const match = addr.match(/<([^>]+)>/);
      return (match ? match[1] : addr).trim().toLowerCase();
    };

    // Prepare reply. replyAll: include original To recipients but EXCLUDE
    // our own address (otherwise the SMTP server delivers a copy back to
    // our INBOX). Use extracted lowercase address for comparison so it works
    // when the To header includes display names like 'Us <us@example.com>'.
    const accountEmail = extractEmail(account.email || account.user);
    const recipients = [originalEmail.from];
    if (replyAll) {
      const seen = new Set<string>([accountEmail, ...recipients.map(extractEmail)]);
      for (const addr of originalEmail.to) {
        const normalized = extractEmail(addr);
        if (!seen.has(normalized)) {
          recipients.push(addr);
          seen.add(normalized);
        }
      }
    }

    const emailComposer = {
      from: account.email || account.user,
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

    const { messageId, rawMessage } = await smtpService.sendEmail(accountId, account, emailComposer);

    // Save copy to Sent folder
    let savedToSent = false;
    if (rawMessage && account.saveToSent !== false) {
      try {
        savedToSent = await imapService.appendToSentFolder(accountId, rawMessage);
      } catch { /* non-critical */ }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          messageId,
          savedToSent,
          message: savedToSent ? 'Reply sent successfully (saved to Sent folder)' : 'Reply sent successfully',
        }, null, 2)
      }]
    };
  });

  // Forward email tool
  server.registerTool('imap_forward_email', {
    description: 'Forward an existing email (folder + uid) to new recipients, quoting the original message and headers. Optionally include the original attachments. Use when the user wants to pass an existing message on to someone else; use imap_reply_to_email instead to respond to the sender.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder containing the original email'),
      uid: z.coerce.number().describe('UID of the email to forward'),
      to: z.union([z.string(), z.array(z.string())]).describe('Forward to email address(es)'),
      text: z.string().optional().describe('Additional text to include'),
      includeAttachments: z.boolean().default(true).describe('Include original attachments'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid, to, text, includeAttachments }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Get original email
    const originalEmail = await imapService.getEmailContent(accountId, folder, uid);
    
    // Prepare forwarded content
    const forwardHeader = `\n\n---------- Forwarded message ----------\nFrom: ${originalEmail.from}\nDate: ${originalEmail.date.toLocaleString()}\nSubject: ${originalEmail.subject}\nTo: ${originalEmail.to.join(', ')}\n\n`;
    
    const emailComposer = {
      from: account.email || account.user,
      to,
      subject: originalEmail.subject.startsWith('Fwd: ') ? originalEmail.subject : `Fwd: ${originalEmail.subject}`,
      text: (text || '') + forwardHeader + (originalEmail.textContent || ''),
      html: originalEmail.htmlContent,
      references: originalEmail.messageId,
    };

    const { messageId, rawMessage } = await smtpService.sendEmail(accountId, account, emailComposer);

    // Save copy to Sent folder
    let savedToSent = false;
    if (rawMessage && account.saveToSent !== false) {
      try {
        savedToSent = await imapService.appendToSentFolder(accountId, rawMessage);
      } catch { /* non-critical */ }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          messageId,
          savedToSent,
          message: savedToSent ? 'Email forwarded successfully (saved to Sent folder)' : 'Email forwarded successfully',
        }, null, 2)
      }]
    };
  });

  // Find thread messages tool
  server.registerTool('imap_find_thread_messages', {
    description:
      'Find messages in `searchFolder` that belong to the same conversation threads as messages already in `sourceFolder`. ' +
      'Useful for catching replies that arrived after a thread was sorted. Works on any IMAP server (uses RFC 3501 HEADER search on In-Reply-To and References).',
    inputSchema: {
      ...accountSelector,
      sourceFolder: z.string().describe('Folder containing the already-sorted thread messages (e.g. "Review.Articles")'),
      searchFolder: z.string().default('INBOX').describe('Folder to search for related thread messages (default: INBOX)'),
      searchReferences: z.boolean().optional().describe('Also search the References header for multi-level threads (default: true)'),
    }
  }, async ({ accountId: rawAccountId, accountName, sourceFolder, searchFolder, searchReferences }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    try {
      const result = await imapService.findThreadMessages(accountId, sourceFolder, searchFolder, {
        searchReferences,
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            sourceFolder,
            searchFolder,
            sourceMessageIdCount: result.messageIds.length,
            threadMessageCount: result.uids.length,
            uids: result.uids,
          }, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            sourceFolder,
            searchFolder,
            error: err instanceof Error ? err.message : 'Unknown error',
          }, null, 2)
        }]
      };
    }
  });
}
