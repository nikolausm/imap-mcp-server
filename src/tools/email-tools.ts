import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { SmtpService } from '../services/smtp-service.js';
import { selectSearchFolders } from '../utils/search-folders.js';
import type { EmailMessage } from '../types/index.js';
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

// Attachment payload as accepted by the send/draft/reply/forward tool schemas.
// Typed explicitly because the MCP SDK's deep tool-schema inference (the TS2589
// suppressions below) widens the handler's `attachments` arg to an untyped shape.
type AttachmentInput = {
  filename: string;
  content?: string;
  path?: string;
  contentType?: string;
  contentDisposition?: 'attachment' | 'inline';
  cid?: string;
};
const buildAttachments = (atts?: AttachmentInput[]) =>
  atts?.map(att => ({
    filename: att.filename,
    content: att.content ? Buffer.from(att.content, 'base64') : undefined,
    path: att.path,
    contentType: att.contentType,
    contentDisposition: att.contentDisposition,
    cid: att.cid,
  }));

// Shared Zod shape for the attachments arrays on send/save_draft/reply — keeps
// the three tool schemas (and their .describe() text) in sync.
const attachmentSchema = z.object({
  filename: z.string().describe('Attachment filename'),
  content: z.string().optional().describe('Base64 encoded content'),
  path: z.string().optional().describe('File path to attach'),
  contentType: z.string().optional().describe('MIME type'),
  contentDisposition: z.enum(['attachment', 'inline']).optional().describe(
    'How the attachment is presented. Use "inline" for images referenced from the HTML body via cid: (e.g. a signature/footer banner); omit or use "attachment" for regular downloadable files.'
  ),
  cid: z.string().optional().describe(
    'Content-ID for inline attachments. Required when contentDisposition is "inline" and the HTML references the image as <img src="cid:THIS_VALUE">. Must match exactly (without the "cid:" prefix or angle brackets).'
  ),
});

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
    description: 'Note: on some servers a \'flagged\' or starred message carries a custom keyword (e.g. an Open-Xchange color label or Apple\'s $MailFlagBit*) instead of, or in addition to, the \\Flagged system flag. After any flagged search, inspect each result\'s customKeywords field before concluding a message is or isn\'t flagged — do not rely on the flagged filter alone. Search for emails matching criteria (sender, recipient, subject, body text, date range, read/flagged status). Use this to FIND messages when you know something about them but not their UID — e.g. "emails from amazon last week", "unread invoices". By default searches a single folder (INBOX). Set searchAllFolders=true to scan every mailbox at once — this catches messages filed away by rules (e.g. a receipt routed to a custom folder); Trash/Spam/Drafts are skipped unless you opt in. By default returns lightweight headers (uid, from, subject, date, and folder when searching across folders); set `includeBody=true` to also return the parsed body in one round-trip instead of paying the N+1 cost of calling imap_get_email per match. For the newest messages without criteria, prefer imap_get_latest_emails.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name to search (default: INBOX). Ignored when searchAllFolders is true.'),
      searchAllFolders: z.boolean().default(false).describe('Search across ALL folders instead of just `folder`. Skips Trash/Spam/Drafts and non-selectable folders by default. Use when a message might have been filed/archived/moved and you do not know which folder it is in.'),
      includeTrash: z.boolean().default(false).describe('When searchAllFolders is true, also search Trash/Bin/Deleted folders (off by default — noisy).'),
      includeSpam: z.boolean().default(false).describe('When searchAllFolders is true, also search Spam/Junk folders (off by default — noisy).'),
      includeDrafts: z.boolean().default(false).describe('When searchAllFolders is true, also search the Drafts folder (off by default).'),
      from: z.string().optional().describe('Search by sender'),
      to: z.string().optional().describe('Search by recipient'),
      subject: z.string().optional().describe('Search by subject'),
      body: z.string().optional().describe('Search in body text'),
      since: z.string().optional().describe('Search emails since date (YYYY-MM-DD)'),
      before: z.string().optional().describe('Search emails before date (YYYY-MM-DD)'),
      seen: z.boolean().optional().describe('Filter by read/unread status'),
      flagged: z.boolean().optional().describe('Filter by flagged status'),
      messageId: z.string().optional().describe('Search by RFC822 Message-ID header (substring match)'),
      keywords: z.array(z.string()).optional().describe('Match messages that have ANY of these CUSTOM keywords (server-side OR; not system flags like \\Seen/\\Flagged). Read a mailbox\'s available custom keywords from imap_folder_status\'s customKeywords field, then pass the ones you want here.'),
      unKeywords: z.array(z.string()).optional().describe('Exclude messages that have ANY of these CUSTOM keywords (server-side; result has NONE of them). Same keyword source as `keywords` — check imap_folder_status first.'),
      limit: z.coerce.number().optional().default(50).describe('Maximum number of results'),
      includeBody: z.boolean().default(false).describe('If true, also fetch the parsed message body in the same round-trip and return it alongside headers (avoids the N+1 cost of calling imap_get_email per match). Body is rendered per `bodyFormat` and capped at `bodyMaxLength` characters per field. Off by default to preserve lightweight behavior.'),
      bodyFormat: z.enum(['markdown', 'text', 'html', 'auto']).default('markdown').describe('How to render the body when `includeBody` is true. Mirrors `imap_get_email` — "markdown" (default) returns clean Markdown and omits raw HTML so it never crosses the MCP boundary; "text" returns plain text; "html" returns raw HTML; "auto" prefers substantive text/plain, else Markdown.'),
      bodyMaxLength: z.coerce.number().default(10000).describe('Per-message cap (in characters) for each rendered body field when `includeBody` is true. Defaults to 10000 to match `imap_get_email`.'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, limit, searchAllFolders, includeTrash, includeSpam, includeDrafts, includeBody = false, bodyFormat = 'markdown', bodyMaxLength = 10000, ...searchCriteria }) => {
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
    if (searchCriteria.messageId) criteria.messageId = searchCriteria.messageId;
    if (searchCriteria.keywords && searchCriteria.keywords.length > 0) criteria.keywords = searchCriteria.keywords;
    if (searchCriteria.unKeywords && searchCriteria.unKeywords.length > 0) criteria.unKeywords = searchCriteria.unKeywords;

    // #106: cross-folder search also supports includeBody, but we deliberately
    // do not pass includeBody through here — pulling RFC822 source for every
    // match across many folders multiplies bandwidth and parse cost. Callers
    // wanting bodies in a cross-folder sweep should follow up with imap_get_email
    // for the specific uids they care about. Documented limitation.
    // Always pass concrete defaults so the service receives stable values.
    const searchOptions = searchAllFolders ? undefined : { includeBody, bodyFormat, bodyMaxLength };

    // Cross-folder search: scan every selectable mailbox (minus the noisy ones,
    // unless opted in). A folder that fails to open is surfaced in foldersErrored
    // rather than silently swallowed, so a 0-result answer is never ambiguous.
    if (searchAllFolders) {
      const allFolders = await imapService.listFolders(accountId);
      const targets = selectSearchFolders(allFolders, { includeTrash, includeSpam, includeDrafts });

      const collected: Array<EmailMessage & { folder: string }> = [];
      const foldersSearched: string[] = [];
      const foldersErrored: Array<{ folder: string; error: string }> = [];

      for (const folderName of targets) {
        try {
          const part = await imapService.searchEmails(accountId, folderName, criteria);
          foldersSearched.push(folderName);
          for (const message of part) {
            collected.push({ ...message, folder: folderName });
          }
        } catch (err) {
          foldersErrored.push({
            folder: folderName,
            error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
          });
        }
      }

      // Newest first across all folders, then cap to limit.
      collected.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const limitedMessages = collected.slice(0, limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            totalFound: collected.length,
            returned: limitedMessages.length,
            foldersSearched,
            ...(foldersErrored.length > 0 ? { foldersErrored } : {}),
            messages: limitedMessages,
          }, null, 2)
        }]
      };
    }

    const messages = await imapService.searchEmails(accountId, folder, criteria, searchOptions);

    // Sort by internalDate DESC before applying limit so callers get the
    // newest matches, mirroring the searchAllFolders path above (#107).
    const sortedMessages = messages.sort((a, b) => b.date.getTime() - a.date.getTime());
    const limitedMessages = sortedMessages.slice(0, limit);

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
    description: 'Read the FULL content of a single email by its UID (body, sender/recipients, date, attachment list, optional raw headers and text-attachment previews). By default the body is returned as clean Markdown in markdownContent and raw HTML is omitted so it never crosses the boundary; set bodyFormat to "html" for the legacy raw htmlContent, or "text" for plain text only. Use after imap_search_emails or imap_get_latest_emails gives you a uid. Body text is truncated to maxContentLength to protect the context window — raise it for long messages. To fetch attachment bytes, use imap_download_attachment.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
      maxContentLength: z.coerce.number().default(10000).describe('Maximum characters to return for each body field (text/markdown/html)'),
      bodyFormat: z.enum(['markdown', 'text', 'html', 'auto']).default('markdown').describe('How to return the body. "markdown" (default): clean Markdown via Turndown in markdownContent, raw htmlContent omitted so HTML never crosses the boundary. "text": plain text only in textContent. "html": legacy raw htmlContent. "auto": substantive text/plain if available, else Markdown.'),
      includeAttachmentText: z.boolean().default(true).describe('Include text attachment previews when available'),
      maxAttachmentTextChars: z.coerce.number().default(100000).describe('Maximum characters to return per text attachment'),
      includeHeaders: z.boolean().default(false).describe('Include raw email headers (e.g. List-Unsubscribe, List-Unsubscribe-Post)'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid, maxContentLength, bodyFormat, includeAttachmentText, maxAttachmentTextChars, includeHeaders }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const email = await imapService.getEmailContent(accountId, folder, uid, {
      includeAttachmentText,
      maxAttachmentTextChars,
      bodyFormat,
    });
    const cap = (s?: string) => (s === undefined ? undefined : s.substring(0, maxContentLength));
    const textTruncated = email.textContent ? email.textContent.length > maxContentLength : false;
    const htmlTruncated = email.htmlContent ? email.htmlContent.length > maxContentLength : false;
    const markdownTruncated = email.markdownContent ? email.markdownContent.length > maxContentLength : false;
    const contentTruncated = (textTruncated || htmlTruncated || markdownTruncated)
      ? { text: textTruncated || undefined, html: htmlTruncated || undefined, markdown: markdownTruncated || undefined }
      : undefined;

    const { headers: rawHeaders, ...emailWithoutHeaders } = email;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          email: {
            ...emailWithoutHeaders,
            textContent: cap(email.textContent),
            htmlContent: cap(email.htmlContent),
            markdownContent: cap(email.markdownContent),
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
        const { PDFParse } = await import('pdf-parse');
        const pdfParser = new PDFParse({ data: content });
        let pdfText: string;
        let pdfPages: number;
        try {
          const pdfData = await pdfParser.getText({ pageJoiner: '' });
          pdfText = pdfData.text;
          pdfPages = pdfData.total;
        } finally {
          await pdfParser.destroy();
        }

        // Also save the file for binary access
        const fs = await import('fs');
        const path = await import('path');
        const downloadDir = savePath ? path.dirname(savePath) : DOWNLOAD_DIR;
        fs.mkdirSync(downloadDir, { recursive: true });
        // resolvedFilename comes from the (sender-controlled) MIME headers, so it
        // may contain path-traversal segments like "../../". Confine the default
        // save to DOWNLOAD_DIR via basename; an explicit savePath is caller-chosen.
        const targetPath = savePath || path.join(DOWNLOAD_DIR, path.basename(resolvedFilename));
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
              pages: pdfPages,
              textContent: pdfText,
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
    // Confine the default save to DOWNLOAD_DIR: resolvedFilename is sender-
    // controlled and may contain "../" traversal (savePath is caller-chosen).
    const targetPath = savePath || path.join(DOWNLOAD_DIR, path.basename(resolvedFilename));
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
    description: 'Mark one or many emails as read. Accepts a single UID or an array — pass an array to flag N messages in one IMAP STORE round-trip (useful when triaging).',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.union([z.coerce.number(), z.array(z.coerce.number())]).describe('Email UID, or array of UIDs to mark as read in one call (avoids N round-trips when triaging). All listed UIDs share the same IMAP STORE command, so the operation is atomic at the server level.'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const result = await imapService.markAsRead(accountId, folder, uid);

    const isBatch = Array.isArray(uid);
    if (!isBatch) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Email ${uid} marked as read`,
          }, null, 2)
        }]
      };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.failed.length === 0,
          batch: true,
          message: `Marked ${result.marked.length}/${uid.length} emails as read`,
          marked: result.marked,
          failed: result.failed,
          ...(result.errors ? { errors: result.errors } : {}),
        }, null, 2)
      }]
    };
  });

  // Mark email as unread tool
  server.registerTool('imap_mark_as_unread', {
    description: 'Mark one or many emails as unread. Accepts a single UID or an array — pass an array to flag N messages in one IMAP STORE round-trip.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.union([z.coerce.number(), z.array(z.coerce.number())]).describe('Email UID, or array of UIDs to mark as unread in one call (avoids N round-trips when triaging). All listed UIDs share the same IMAP STORE command, so the operation is atomic at the server level.'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const result = await imapService.markAsUnread(accountId, folder, uid);

    const isBatch = Array.isArray(uid);
    if (!isBatch) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Email ${uid} marked as unread`,
          }, null, 2)
        }]
      };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.failed.length === 0,
          batch: true,
          message: `Marked ${result.marked.length}/${uid.length} emails as unread`,
          marked: result.marked,
          failed: result.failed,
          ...(result.errors ? { errors: result.errors } : {}),
        }, null, 2)
      }]
    };
  });

  // Flag email tool
  server.registerTool('imap_flag_email', {
    description: 'Flag an email — sets the IMAP \\Flagged system flag (shows as a star in Gmail / a flag in Apple Mail). Use this tool when a user asks to star, flag, or mark a message as important.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    await imapService.flagEmail(accountId, folder, uid);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Email ${uid} flagged`,
        }, null, 2)
      }]
    };
  });

  // Unflag email tool
  server.registerTool('imap_unflag_email', {
    description: 'Unflag an email — removes the IMAP \\Flagged system flag (the star in Gmail, the flag in Apple Mail). Note: some servers (e.g. Open-Xchange / Network Solutions) and Apple Mail also write a separate custom keyword such as $cl_N or $MailFlagBit* when a message is flagged in their client. Removing \\Flagged alone does not clear that keyword, so the message may still display as flagged. If it does, check the message\'s customKeywords via imap_get_email and remove the lingering label with imap_remove_keyword.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    await imapService.unflagEmail(accountId, folder, uid);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Email ${uid} unflagged`,
        }, null, 2)
      }]
    };
  });

  // Add keyword tool
  server.registerTool('imap_add_keyword', {
    description: 'Set an arbitrary custom (non-system) IMAP keyword/label on an email — e.g. a provider color label like Open-Xchange\'s $cl_1..$cl_10, Apple Mail\'s $MailFlagBit0..$MailFlagBit2, or an app tag such as $promotion. Unlike imap_flag_email (which only ever sets the system \\Flagged flag), this passes the keyword through verbatim, but rejects backslash-prefixed system flags (e.g. \\Flagged, \\Seen, \\Deleted) — use the dedicated flag/read tools for those. Not every IMAP server permits custom keywords (see the mailbox\'s PERMANENTFLAGS) — if the server rejects or silently ignores the change, this call fails rather than reporting success.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
      keyword: z.string().describe('IMAP keyword to set, passed through verbatim (e.g. "$cl_3", "$MailFlagBit0", "$Junk")'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid, keyword }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    await imapService.addKeyword(accountId, folder, uid, keyword);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Keyword "${keyword}" added to email ${uid}`,
        }, null, 2)
      }]
    };
  });

  // Remove keyword tool
  server.registerTool('imap_remove_keyword', {
    description: 'Remove an arbitrary custom (non-system) IMAP keyword/label from an email — e.g. a provider color label like Open-Xchange\'s $cl_1..$cl_10, Apple Mail\'s $MailFlagBit0..$MailFlagBit2, or an app tag such as $promotion. Unlike imap_unflag_email (which only ever clears the system \\Flagged flag), this passes the keyword through verbatim, but rejects backslash-prefixed system flags (e.g. \\Flagged, \\Seen, \\Deleted) — use the dedicated flag/read tools for those. Not every IMAP server permits custom keywords (see the mailbox\'s PERMANENTFLAGS) — if the server rejects or silently ignores the change, this call fails rather than reporting success.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.coerce.number().describe('Email UID'),
      keyword: z.string().describe('IMAP keyword to remove, passed through verbatim (e.g. "$cl_3", "$MailFlagBit0", "$Junk")'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid, keyword }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    await imapService.removeKeyword(accountId, folder, uid, keyword);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Keyword "${keyword}" removed from email ${uid}`,
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
      uid: z.union([z.coerce.number(), z.array(z.coerce.number())]).describe('Single email UID or array of UIDs to move in one call. Pass an array when triaging many messages at once (e.g. "move the 10 invoices I just classified to Archive") to avoid N round-trips.'),
      targetFolder: z.string().describe('Destination folder name'),
      createDestinationIfMissing: z.boolean().optional().describe('If true, create the destination folder before moving when it does not exist (default: false)'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid, targetFolder, createDestinationIfMissing }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const isBatch = Array.isArray(uid);
    try {
      const result = await imapService.moveEmail(accountId, folder, uid, targetFolder, {
        createDestinationIfMissing,
      });

      // Single-uid legacy response shape (uidMap at top level).
      if (!isBatch) {
        const single = result as { destination: string; destinationCreated?: boolean; uidMap?: Map<number, number> };
        const uidMapObj: Record<string, number> = {};
        if (single.uidMap) {
          for (const [srcUid, destUid] of single.uidMap) {
            uidMapObj[String(srcUid)] = destUid;
          }
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Email ${uid} moved from ${folder} to ${targetFolder}`,
              destination: single.destination,
              destinationCreated: single.destinationCreated,
              uidMap: Object.keys(uidMapObj).length > 0 ? uidMapObj : undefined,
            }, null, 2)
          }]
        };
      }

      // Batch response shape (#106): per-uid results + aggregate counts.
      const batch = result as { destination: string; destinationCreated?: boolean; results: Array<{ uid: number; destination: string; uidMap?: Record<number, number>; error?: string }> };
      const succeeded = batch.results.filter(r => !r.error);
      const failed = batch.results.filter(r => r.error);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: failed.length === 0,
            batch: true,
            message: `Moved ${succeeded.length}/${batch.results.length} emails from ${folder} to ${targetFolder}`,
            destination: batch.destination,
            destinationCreated: batch.destinationCreated,
            movedCount: succeeded.length,
            failedCount: failed.length,
            results: batch.results,
            ...(failed.length > 0 ? { errors: failed.map(f => ({ uid: f.uid, error: f.error })) } : {}),
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
    description: 'Search for emails matching criteria and delete them all. Useful for cleaning up spam or unwanted emails. At least one concrete criterion (from, to, subject, before, or since) is REQUIRED — a call with no criteria is refused so it can never wipe an entire folder. Supports dryRun to preview matches first.',
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

    // Guard: never run with an empty criteria set. imapflow compiles an empty
    // search to IMAP "SEARCH ALL", which would match — and then delete — every
    // message in the folder. Require at least one concrete criterion (this also
    // covers dryRun, so a preview can never imply a whole-folder wipe).
    if (Object.keys(criteria).length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            found: 0,
            deleted: 0,
            error: 'Refusing to bulk-delete without criteria. Specify at least one of from, to, subject, before, or since — an empty criteria set would match and delete the entire folder.',
          }, null, 2)
        }]
      };
    }

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
    description: 'Get the most recent emails from a folder, newest first. Use this for "what just came in?" / "show my latest inbox messages" when no search filter is needed. By default returns lightweight headers (uid, from, subject, date); set `includeBody=true` to also return the parsed body in one round-trip instead of paying the N+1 cost of calling imap_get_email per message. To filter by sender/subject/date instead, use imap_search_emails.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder name'),
      count: z.coerce.number().default(10).describe('Number of emails to retrieve'),
      includeBody: z.boolean().default(false).describe('If true, also fetch the parsed message body in the same round-trip and return it alongside headers (avoids the N+1 cost of calling imap_get_email per message). Body is rendered per `bodyFormat` and capped at `bodyMaxLength` characters per field. Off by default to preserve lightweight behavior.'),
      bodyFormat: z.enum(['markdown', 'text', 'html', 'auto']).default('markdown').describe('How to render the body when `includeBody` is true. Mirrors `imap_get_email` — "markdown" (default) returns clean Markdown; "text" returns plain text; "html" returns raw HTML; "auto" prefers substantive text/plain, else Markdown.'),
      bodyMaxLength: z.coerce.number().default(10000).describe('Per-message cap (in characters) for each rendered body field when `includeBody` is true. Defaults to 10000 to match `imap_get_email`.'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, count, includeBody = false, bodyFormat = 'markdown', bodyMaxLength = 10000 }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const sortedMessages = await imapService.getLatestEmails(accountId, folder, count, { includeBody, bodyFormat, bodyMaxLength });
    
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
      body: z.string().optional().describe("Alias for 'text' (backward-compat with clients that pass 'body')"),
      cc: z.union([z.string(), z.array(z.string())]).optional().describe('CC recipients'),
      bcc: z.union([z.string(), z.array(z.string())]).optional().describe('BCC recipients'),
      replyTo: z.string().optional().describe('Reply-to address'),
      attachments: z.array(attachmentSchema).optional().describe('Email attachments'),
    }
  }, async ({ accountId: rawAccountId, accountName, to, subject, text, html, body, cc, bcc, replyTo, attachments }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const emailComposer = {
      from: account.email || account.user,
      to,
      subject,
      text: text ?? body,
      html,
      cc,
      bcc,
      replyTo,
      attachments: buildAttachments(attachments as AttachmentInput[] | undefined),
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
      body: z.string().optional().describe("Alias for 'text' (backward-compat)"),
      cc: z.union([z.string(), z.array(z.string())]).optional().describe('CC recipients'),
      bcc: z.union([z.string(), z.array(z.string())]).optional().describe('BCC recipients'),
      replyTo: z.string().optional().describe('Reply-to address'),
      inReplyTo: z.string().optional().describe('Message-Id being replied to'),
      references: z.union([z.string(), z.array(z.string())]).optional().describe('References header value(s)'),
      attachments: z.array(attachmentSchema).optional().describe('Email attachments'),
      folder: z.string().optional().describe('Override the Drafts folder name (defaults to auto-detected Drafts folder)'),
    }
  }, async ({ accountId: rawAccountId, accountName, to, subject, text, html, body, cc, bcc, replyTo, inReplyTo, references, attachments, folder }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const emailComposer = {
      from: account.email || account.user,
      to: to ?? '',
      subject: subject ?? '',
      text: text ?? body,
      html,
      cc,
      bcc,
      replyTo,
      inReplyTo,
      references,
      attachments: buildAttachments(attachments as AttachmentInput[] | undefined),
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
      body: z.string().optional().describe("Alias for 'text' (backward-compat)"),
      replyAll: z.boolean().default(false).describe('Reply to all recipients'),
      attachments: z.array(attachmentSchema).optional().describe('Email attachments'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid, text, html, body, replyAll, attachments }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Get original email (envelope only is needed here; skip body conversion)
    const originalEmail = await imapService.getEmailContent(accountId, folder, uid, { bodyFormat: 'text' });

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
      text: text ?? body,
      html,
      inReplyTo: originalEmail.messageId,
      references: originalEmail.messageId,
      attachments: buildAttachments(attachments as AttachmentInput[] | undefined),
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
      body: z.string().optional().describe("Alias for 'text' (backward-compat)"),
      includeAttachments: z.boolean().default(true).describe('Include original attachments'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid, to, text, body, includeAttachments }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Get original email (needs both plain text and raw HTML to reconstruct the forward)
    const originalEmail = await imapService.getEmailContent(accountId, folder, uid, { bodyFormat: 'html' });

    // Prepare forwarded content
    const forwardHeader = `\n\n---------- Forwarded message ----------\nFrom: ${originalEmail.from}\nDate: ${originalEmail.date.toLocaleString()}\nSubject: ${originalEmail.subject}\nTo: ${originalEmail.to.join(', ')}\n\n`;
    
    const emailComposer = {
      from: account.email || account.user,
      to,
      subject: originalEmail.subject.startsWith('Fwd: ') ? originalEmail.subject : `Fwd: ${originalEmail.subject}`,
      text: (text ?? body ?? '') + forwardHeader + (originalEmail.textContent || ''),
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
      'Useful for catching replies that arrived after a thread was sorted. Works on any IMAP server (uses RFC 3501 HEADER search on In-Reply-To and References). ' +
      'Set `includeBody=true` to also return the parsed body for each found thread message in one round-trip — avoids the N+1 cost of calling imap_get_email per thread member.',
    inputSchema: {
      ...accountSelector,
      sourceFolder: z.string().describe('Folder containing the already-sorted thread messages (e.g. "Review.Articles")'),
      searchFolder: z.string().default('INBOX').describe('Folder to search for related thread messages (default: INBOX)'),
      searchReferences: z.boolean().optional().describe('Also search the References header for multi-level threads (default: true)'),
      includeBody: z.boolean().default(false).describe('If true, also fetch the parsed message body for each found thread message in the same round-trip and return it alongside headers (avoids the N+1 cost of calling imap_get_email per thread member). Body is rendered per `bodyFormat` and capped at `bodyMaxLength` characters per field.'),
      bodyFormat: z.enum(['markdown', 'text', 'html', 'auto']).default('markdown').describe('How to render the body when `includeBody` is true. Mirrors `imap_get_email` — "markdown" (default) returns clean Markdown; "text" returns plain text; "html" returns raw HTML; "auto" prefers substantive text/plain, else Markdown.'),
      bodyMaxLength: z.coerce.number().default(10000).describe('Per-message cap (in characters) for each rendered body field when `includeBody` is true. Defaults to 10000 to match `imap_get_email`.'),
    }
  }, async ({ accountId: rawAccountId, accountName, sourceFolder, searchFolder, searchReferences = true, includeBody = false, bodyFormat = 'markdown', bodyMaxLength = 10000 }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    try {
      const result = await imapService.findThreadMessages(accountId, sourceFolder, searchFolder, {
        searchReferences,
        includeBody,
        bodyFormat,
        bodyMaxLength,
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
            ...(result.messages ? { messages: result.messages } : {}),
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

  server.registerTool('imap_find_email_by_message_id', {
    description:
      'Locate an email by its RFC822 Message-ID across folders and return its current { folder, uid } plus basic envelope. ' +
      'Robust to the message having been moved or archived (IMAP UIDs are folder-relative). ' +
      'Pass the returned folder + uid to imap_reply_to_email or imap_get_email. ' +
      'Without `folders`, searches Gmail \\All Mail when present, else INBOX → Archive → Sent → remaining folders.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      messageId: z.string().describe('RFC822 Message-ID, with or without angle brackets'),
      folders: z.array(z.string()).optional().describe('Explicit folders to search, in order (overrides the default order)'),
    }
  }, async ({ accountId, messageId, folders }) => {
    const result = await imapService.findEmailByMessageId(accountId, messageId, folders);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}
