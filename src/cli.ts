#!/usr/bin/env node
import { promises as fs, mkdirSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { Command } from 'commander';
import dotenv from 'dotenv';
import { ImapService } from './services/imap-service.js';
import { AccountManager } from './services/account-manager.js';
import { SmtpService } from './services/smtp-service.js';
import { SpamService } from './services/spam-service.js';
import { ImapAccount, EmailAttachment, EmailComposer, SearchCriteria } from './types/index.js';

dotenv.config({ quiet: true });

const DOWNLOAD_DIR = process.env.IMAP_DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads', 'imap-attachments');

const accountManager = new AccountManager();
const imapService = new ImapService();
const smtpService = new SmtpService();
const spamService = new SpamService();
imapService.setAccountManager(accountManager);

type ExitCode = 0 | 1 | 2 | 3 | 4;

function emit(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

function fail(code: ExitCode, message: string, extra?: Record<string, unknown>): never {
  emit({ success: false, error: message, ...extra });
  process.exit(code);
}

function parseDateOnly(value: string): Date {
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return new Date(value);
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

function resolveAccount(accountIdOrName: string): ImapAccount {
  const byId = accountManager.getAccount(accountIdOrName);
  if (byId) return byId;
  const byName = accountManager.getAccountByName(accountIdOrName);
  if (byName) return byName;
  fail(4, `Account "${accountIdOrName}" not found (no match by ID or name)`);
}

function readBodyOrFile(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith('@')) {
    const filepath = value.slice(1);
    return readFileSync(filepath, 'utf8');
  }
  return value;
}

function collectAttach(value: string, prev: string[]): string[] {
  return prev.concat(value);
}

function buildAttachments(paths: string[]): EmailAttachment[] | undefined {
  if (!paths || paths.length === 0) return undefined;
  return paths.map(p => ({ filename: path.basename(p), path: p }));
}

async function withCleanup<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    smtpService.disconnectAll();
  }
}

const program = new Command();
program
  .name('imap')
  .description('IMAP CLI — read, search, send, attach, manage. Reuses imap-mcp-server services on the host.')
  .version('1.0.0');

// ---------- ACCOUNT VERBS ----------

program
  .command('accounts')
  .description('List configured accounts')
  .action(() => {
    const accounts = accountManager.getAllAccounts();
    emit({
      accounts: accounts.map(a => ({
        id: a.id,
        name: a.name,
        host: a.host,
        port: a.port,
        user: a.user,
        tls: a.tls,
        email: a.email,
      })),
    });
  });

program
  .command('add-account <name>')
  .description('Add a new account. Pass --pass or set IMAP_ADD_PASSWORD env var.')
  .requiredOption('--host <host>', 'IMAP host')
  .requiredOption('--user <user>', 'IMAP username')
  .option('--port <port>', 'IMAP port (default 993)', '993')
  .option('--pass <password>', 'Password (avoid for shell history; prefer IMAP_ADD_PASSWORD env)')
  .option('--no-tls', 'Disable TLS')
  .option('--email <email>', 'From: header address (defaults to user)')
  .option('--smtp-host <host>', 'SMTP host override')
  .option('--smtp-port <port>', 'SMTP port (465 or 587)')
  .option('--smtp-secure', 'Use implicit TLS for SMTP (port 465)')
  .action(async (name, opts) => {
    const password = opts.pass || process.env.IMAP_ADD_PASSWORD;
    if (!password) fail(2, 'Password required: pass --pass or set IMAP_ADD_PASSWORD env var');
    const smtp = (opts.smtpHost || opts.smtpPort || opts.smtpSecure) ? {
      host: opts.smtpHost || opts.host,
      port: opts.smtpPort ? Number(opts.smtpPort) : 587,
      secure: !!opts.smtpSecure,
    } : undefined;
    const account = await accountManager.addAccount({
      name,
      host: opts.host,
      port: Number(opts.port),
      user: opts.user,
      password,
      tls: opts.tls !== false,
      ...(opts.email ? { email: opts.email } : {}),
      ...(smtp ? { smtp } : {}),
    });
    emit({ success: true, accountId: account.id, name });
  });

program
  .command('remove-account <accountId>')
  .description('Delete an account')
  .action(async accountId => {
    const account = resolveAccount(accountId);
    await imapService.disconnect(account.id);
    await accountManager.removeAccount(account.id);
    emit({ success: true, accountId: account.id });
  });

program
  .command('connect <accountId>')
  .description('Sanity-check the IMAP connection')
  .action(async accountId => {
    const account = resolveAccount(accountId);
    try {
      await imapService.connect(account);
      emit({ success: true, accountId: account.id, name: account.name });
    } catch (err) {
      fail(3, err instanceof Error ? err.message : 'Connection failed');
    } finally {
      await imapService.disconnect(account.id).catch(() => {});
    }
  });

program
  .command('disconnect <accountId>')
  .description('Close any open IMAP connection for the account')
  .action(async accountId => {
    const account = resolveAccount(accountId);
    await imapService.disconnect(account.id);
    emit({ success: true, accountId: account.id });
  });

program
  .command('test-account <accountId>')
  .description('Test an account: list folders + INBOX count without changing state')
  .action(async accountId => {
    const account = resolveAccount(accountId);
    const result = await imapService.testConnection(account);
    emit({ accountId: account.id, name: account.name, host: account.host, ...result });
    if (!result.success) process.exit(3);
  });

// ---------- FOLDER VERBS ----------

program
  .command('folders <accountId>')
  .description('List IMAP folders')
  .action(async accountId => {
    const account = resolveAccount(accountId);
    const folders = await imapService.listFolders(account.id);
    emit({ folders: folders.map(f => ({ name: f.name, delimiter: f.delimiter, attributes: f.attributes })) });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('folder-status <accountId> <folder>')
  .description('Show message/unseen counts for a folder')
  .action(async (accountId, folder) => {
    const account = resolveAccount(accountId);
    const status = await imapService.getFolderStatus(account.id, folder);
    emit({ folder, ...status });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('create-folder <accountId> <folder>')
  .description('Create a new IMAP folder (parents auto-created on most servers)')
  .action(async (accountId, folder) => {
    const account = resolveAccount(accountId);
    const result = await imapService.createFolder(account.id, folder);
    emit({ success: true, ...result });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('unread-count <accountId>')
  .description('Get unread counts. Pass --folder for a single folder; otherwise sums all folders.')
  .option('--folder <folder>', 'Single folder to check')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    if (opts.folder) {
      const msgs = await imapService.searchEmails(account.id, opts.folder, { seen: false });
      emit({ folder: opts.folder, unread: msgs.length });
    } else {
      const folders = await imapService.listFolders(account.id);
      const byFolder: Record<string, number> = {};
      let total = 0;
      for (const f of folders) {
        try {
          const msgs = await imapService.searchEmails(account.id, f.name, { seen: false });
          byFolder[f.name] = msgs.length;
          total += msgs.length;
        } catch {
          byFolder[f.name] = 0;
        }
      }
      emit({ totalUnread: total, byFolder });
    }
    await imapService.disconnect(account.id).catch(() => {});
  });

// ---------- EMAIL READ/SEARCH ----------

program
  .command('search <accountId>')
  .description('Search emails by header/flag/date criteria. JSON output.')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .option('--from <addr>', 'From: address substring')
  .option('--to <addr>', 'To: address substring')
  .option('--subject <text>', 'Subject substring')
  .option('--body <text>', 'Body substring')
  .option('--since <date>', 'YYYY-MM-DD')
  .option('--before <date>', 'YYYY-MM-DD')
  .option('--seen', 'Only seen (read) messages')
  .option('--unseen', 'Only unseen (unread) messages')
  .option('--flagged', 'Only flagged messages')
  .option('--limit <n>', 'Max results', '50')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const criteria: SearchCriteria = {};
    if (opts.from) criteria.from = opts.from;
    if (opts.to) criteria.to = opts.to;
    if (opts.subject) criteria.subject = opts.subject;
    if (opts.body) criteria.body = opts.body;
    if (opts.since) criteria.since = parseDateOnly(opts.since);
    if (opts.before) criteria.before = parseDateOnly(opts.before);
    if (opts.seen) criteria.seen = true;
    if (opts.unseen) criteria.seen = false;
    if (opts.flagged) criteria.flagged = true;
    const limit = Number(opts.limit);
    const messages = await imapService.searchEmails(account.id, opts.folder, criteria);
    emit({ totalFound: messages.length, returned: Math.min(messages.length, limit), messages: messages.slice(0, limit) });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('get <accountId>')
  .description('Fetch full email content by UID')
  .requiredOption('--uid <n>', 'Email UID')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .option('--include-headers', 'Include raw headers in output')
  .option('--max-content <n>', 'Max chars of text/html body returned', '10000')
  .option('--max-attachment-text <n>', 'Max chars per text/PDF attachment preview', '100000')
  .option('--no-attachment-text', 'Skip attachment text extraction')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const maxContent = Number(opts.maxContent);
    const email = await imapService.getEmailContent(account.id, opts.folder, Number(opts.uid), {
      includeAttachmentText: opts.attachmentText !== false,
      maxAttachmentTextChars: Number(opts.maxAttachmentText),
    });
    const { headers, ...rest } = email;
    emit({
      email: {
        ...rest,
        textContent: email.textContent?.substring(0, maxContent),
        htmlContent: email.htmlContent?.substring(0, maxContent),
        ...(opts.includeHeaders ? { headers } : {}),
      },
    });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('latest <accountId>')
  .description('Get the latest N messages in a folder')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .option('--count <n>', 'Number of messages', '10')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const messages = await imapService.getLatestEmails(account.id, opts.folder, Number(opts.count));
    emit({ messages });
    await imapService.disconnect(account.id).catch(() => {});
  });

// ---------- EMAIL WRITE: SEND / REPLY / FORWARD / DRAFT ----------

program
  .command('send <accountId>')
  .description('Send an email via SMTP. Use @file for body content. Host paths work directly for --attach.')
  .requiredOption('--to <addr>', 'Recipient address (comma-separated for multiple)')
  .requiredOption('--subject <text>', 'Subject')
  .option('--text <body>', 'Plain text body (prefix @ to read from file)')
  .option('--html <body>', 'HTML body (prefix @ to read from file)')
  .option('--cc <addr>', 'CC address(es)')
  .option('--bcc <addr>', 'BCC address(es)')
  .option('--reply-to <addr>', 'Reply-To address')
  .option('--attach <path>', 'Attachment path (repeatable)', collectAttach, [] as string[])
  .action(async (accountId, opts) => {
    await withCleanup(async () => {
      const account = resolveAccount(accountId);
      const composer: EmailComposer = {
        from: account.email || account.user,
        to: opts.to.split(',').map((s: string) => s.trim()),
        subject: opts.subject,
        text: readBodyOrFile(opts.text),
        html: readBodyOrFile(opts.html),
        cc: opts.cc ? opts.cc.split(',').map((s: string) => s.trim()) : undefined,
        bcc: opts.bcc ? opts.bcc.split(',').map((s: string) => s.trim()) : undefined,
        replyTo: opts.replyTo,
        attachments: buildAttachments(opts.attach),
      };
      const { messageId, rawMessage } = await smtpService.sendEmail(account.id, account, composer);
      let savedToSent = false;
      if (rawMessage && account.saveToSent !== false) {
        try { savedToSent = await imapService.appendToSentFolder(account.id, rawMessage); } catch {}
      }
      emit({ success: true, messageId, savedToSent });
      await imapService.disconnect(account.id).catch(() => {});
    });
  });

program
  .command('reply <accountId>')
  .description('Reply to an existing message')
  .requiredOption('--uid <n>', 'UID of the original message')
  .option('--folder <folder>', 'Folder containing original', 'INBOX')
  .option('--text <body>', 'Plain text reply (prefix @ to read from file)')
  .option('--html <body>', 'HTML reply (prefix @ to read from file)')
  .option('--reply-all', 'Reply to all recipients')
  .option('--attach <path>', 'Attachment path (repeatable)', collectAttach, [] as string[])
  .action(async (accountId, opts) => {
    await withCleanup(async () => {
      const account = resolveAccount(accountId);
      const original = await imapService.getEmailContent(account.id, opts.folder, Number(opts.uid));
      const accountEmail = account.email || account.user;
      const recipients: string[] = [original.from];
      if (opts.replyAll) recipients.push(...original.to.filter(a => a !== accountEmail));
      const composer: EmailComposer = {
        from: accountEmail,
        to: recipients,
        subject: original.subject.startsWith('Re: ') ? original.subject : `Re: ${original.subject}`,
        text: readBodyOrFile(opts.text),
        html: readBodyOrFile(opts.html),
        inReplyTo: original.messageId,
        references: original.messageId,
        attachments: buildAttachments(opts.attach),
      };
      const { messageId, rawMessage } = await smtpService.sendEmail(account.id, account, composer);
      let savedToSent = false;
      if (rawMessage && account.saveToSent !== false) {
        try { savedToSent = await imapService.appendToSentFolder(account.id, rawMessage); } catch {}
      }
      emit({ success: true, messageId, savedToSent });
      await imapService.disconnect(account.id).catch(() => {});
    });
  });

program
  .command('forward <accountId>')
  .description('Forward a message')
  .requiredOption('--uid <n>', 'UID of message to forward')
  .requiredOption('--to <addr>', 'Recipient address(es), comma-separated')
  .option('--folder <folder>', 'Folder containing original', 'INBOX')
  .option('--text <body>', 'Extra body to prepend (prefix @ to read from file)')
  .option('--include-attachments', 'Include original attachments (default: omitted; not yet supported)')
  .action(async (accountId, opts) => {
    await withCleanup(async () => {
      const account = resolveAccount(accountId);
      const original = await imapService.getEmailContent(account.id, opts.folder, Number(opts.uid));
      const header = `\n\n---------- Forwarded message ----------\nFrom: ${original.from}\nDate: ${original.date.toLocaleString()}\nSubject: ${original.subject}\nTo: ${original.to.join(', ')}\n\n`;
      const composer: EmailComposer = {
        from: account.email || account.user,
        to: opts.to.split(',').map((s: string) => s.trim()),
        subject: original.subject.startsWith('Fwd: ') ? original.subject : `Fwd: ${original.subject}`,
        text: (readBodyOrFile(opts.text) || '') + header + (original.textContent || ''),
        html: original.htmlContent,
        references: original.messageId,
      };
      const { messageId, rawMessage } = await smtpService.sendEmail(account.id, account, composer);
      let savedToSent = false;
      if (rawMessage && account.saveToSent !== false) {
        try { savedToSent = await imapService.appendToSentFolder(account.id, rawMessage); } catch {}
      }
      emit({ success: true, messageId, savedToSent });
      await imapService.disconnect(account.id).catch(() => {});
    });
  });

program
  .command('save-draft <accountId>')
  .description('Compose and save a draft (no send)')
  .option('--to <addr>', 'Recipient address(es), comma-separated')
  .option('--subject <text>', 'Subject')
  .option('--text <body>', 'Plain text body (prefix @ to read from file)')
  .option('--html <body>', 'HTML body (prefix @ to read from file)')
  .option('--cc <addr>', 'CC address(es)')
  .option('--bcc <addr>', 'BCC address(es)')
  .option('--reply-to <addr>', 'Reply-To address')
  .option('--in-reply-to <id>', 'Message-Id being replied to')
  .option('--attach <path>', 'Attachment path (repeatable)', collectAttach, [] as string[])
  .option('--folder <folder>', 'Drafts folder override')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const composer: EmailComposer = {
      from: account.email || account.user,
      to: opts.to ? opts.to.split(',').map((s: string) => s.trim()) : '',
      subject: opts.subject || '',
      text: readBodyOrFile(opts.text),
      html: readBodyOrFile(opts.html),
      cc: opts.cc ? opts.cc.split(',').map((s: string) => s.trim()) : undefined,
      bcc: opts.bcc ? opts.bcc.split(',').map((s: string) => s.trim()) : undefined,
      replyTo: opts.replyTo,
      inReplyTo: opts.inReplyTo,
      attachments: buildAttachments(opts.attach),
    };
    const raw = await smtpService.composeRaw(account, composer);
    const drafts = opts.folder || await imapService.findDraftsFolder(account.id);
    if (!drafts) fail(4, 'No Drafts folder found. Pass --folder to override.');
    const ok = await imapService.appendMessage(account.id, drafts, raw, ['\\Draft', '\\Seen']);
    if (!ok) fail(1, `Failed to append draft to "${drafts}"`);
    emit({ success: true, folder: drafts });
    await imapService.disconnect(account.id).catch(() => {});
  });

// ---------- ATTACHMENTS ----------

program
  .command('upload-file <localPath>')
  .description('Stage a file under the uploads dir and print its path (host CLI: returns the source path verbatim since host paths are reachable)')
  .action(async localPath => {
    const abs = path.resolve(localPath);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) fail(4, `Not a regular file: ${abs}`);
    const uploadDir = path.join(DOWNLOAD_DIR, 'uploads');
    mkdirSync(uploadDir, { recursive: true });
    const target = path.join(uploadDir, path.basename(abs));
    if (path.resolve(target) !== abs) {
      const buf = await fs.readFile(abs);
      writeFileSync(target, buf);
    }
    emit({ success: true, path: target, originalPath: abs, size: stat.size });
  });

program
  .command('download-attachment <accountId>')
  .description('Download an attachment to disk')
  .requiredOption('--uid <n>', 'Email UID')
  .requiredOption('--filename <name>', 'Attachment filename or contentId')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .option('--save-path <path>', 'Output path (default: ~/Downloads/imap-attachments/<filename>)')
  .option('--extract-text', 'For PDFs, extract text content and include in JSON')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const { content, contentType, filename } = await imapService.getAttachmentContent(account.id, opts.folder, Number(opts.uid), opts.filename);
    const target = opts.savePath || path.join(DOWNLOAD_DIR, filename);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    let pdfText: { pages: number; textContent: string } | undefined;
    if (opts.extractText && (contentType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf'))) {
      try {
        const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
        const data = await pdfParse(content);
        pdfText = { pages: data.numpages, textContent: data.text };
      } catch (err) {
        pdfText = undefined;
      }
    }
    emit({ saved: true, path: target, filename, contentType, size: content.length, ...(pdfText || {}) });
    await imapService.disconnect(account.id).catch(() => {});
  });

// ---------- FLAGS / STATE CHANGES ----------

program
  .command('mark-read <accountId>')
  .requiredOption('--uid <n>', 'Email UID')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    await imapService.markAsRead(account.id, opts.folder, Number(opts.uid));
    emit({ success: true });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('mark-unread <accountId>')
  .requiredOption('--uid <n>', 'Email UID')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    await imapService.markAsUnread(account.id, opts.folder, Number(opts.uid));
    emit({ success: true });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('delete <accountId>')
  .description('Move a message to Trash (or expunge if already in Trash)')
  .requiredOption('--uid <n>', 'Email UID')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    await imapService.deleteEmail(account.id, opts.folder, Number(opts.uid));
    emit({ success: true });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('move <accountId>')
  .description('Move a message to another folder')
  .requiredOption('--uid <n>', 'Email UID')
  .requiredOption('--to-folder <folder>', 'Destination folder')
  .option('--folder <folder>', 'Source folder', 'INBOX')
  .option('--create-destination', 'Create destination folder if missing')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const result = await imapService.moveEmail(account.id, opts.folder, Number(opts.uid), opts.toFolder, {
      createDestinationIfMissing: !!opts.createDestination,
    });
    const uidMap: Record<string, number> = {};
    if (result.uidMap) for (const [src, dest] of result.uidMap) uidMap[String(src)] = dest;
    emit({ success: true, destination: result.destination, destinationCreated: result.destinationCreated, uidMap: Object.keys(uidMap).length ? uidMap : undefined });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('bulk-delete <accountId>')
  .description('Delete multiple UIDs in chunks')
  .requiredOption('--uids <csv>', 'Comma-separated UIDs')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .option('--chunk-size <n>', 'Per-batch size', '50')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const uids = opts.uids.split(',').map((s: string) => Number(s.trim())).filter((n: number) => !Number.isNaN(n));
    const result = await imapService.bulkDelete(account.id, opts.folder, uids, Number(opts.chunkSize));
    emit({ success: result.failed === 0, totalRequested: uids.length, ...result });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('bulk-delete-by-search <accountId>')
  .description('Search and delete in one shot. Defaults to --dry-run.')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .option('--from <addr>', 'From: substring')
  .option('--to <addr>', 'To: substring')
  .option('--subject <text>', 'Subject substring')
  .option('--since <date>', 'YYYY-MM-DD')
  .option('--before <date>', 'YYYY-MM-DD')
  .option('--chunk-size <n>', 'Per-batch size', '50')
  .option('--commit', 'Actually delete (default is dry-run)')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const criteria: SearchCriteria = {};
    if (opts.from) criteria.from = opts.from;
    if (opts.to) criteria.to = opts.to;
    if (opts.subject) criteria.subject = opts.subject;
    if (opts.since) criteria.since = parseDateOnly(opts.since);
    if (opts.before) criteria.before = parseDateOnly(opts.before);
    const messages = await imapService.searchEmails(account.id, opts.folder, criteria);
    if (messages.length === 0) {
      emit({ success: true, found: 0, deleted: 0 });
      await imapService.disconnect(account.id).catch(() => {});
      return;
    }
    if (!opts.commit) {
      emit({
        success: true,
        dryRun: true,
        found: messages.length,
        samples: messages.slice(0, 10).map(m => ({ uid: m.uid, from: m.from, subject: m.subject, date: m.date })),
      });
      await imapService.disconnect(account.id).catch(() => {});
      return;
    }
    const uids = messages.map(m => m.uid);
    const result = await imapService.bulkDelete(account.id, opts.folder, uids, Number(opts.chunkSize));
    emit({ success: result.failed === 0, found: messages.length, ...result });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('thread <accountId>')
  .description('Find messages in --search-folder that belong to threads in --source-folder')
  .requiredOption('--source-folder <folder>', 'Folder with already-sorted thread messages')
  .option('--search-folder <folder>', 'Folder to scan for related messages', 'INBOX')
  .option('--no-references', 'Skip References header search')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const result = await imapService.findThreadMessages(account.id, opts.sourceFolder, opts.searchFolder, {
      searchReferences: opts.references !== false,
    });
    emit({
      success: true,
      sourceFolder: opts.sourceFolder,
      searchFolder: opts.searchFolder,
      sourceMessageIdCount: result.messageIds.length,
      threadMessageCount: result.uids.length,
      uids: result.uids,
    });
    await imapService.disconnect(account.id).catch(() => {});
  });

// ---------- SPAM ----------

program
  .command('list-spam-domains')
  .description('Show built-in + custom spam domains and the whitelist')
  .action(() => {
    const spam = spamService.getKnownSpamDomains();
    const whitelist = spamService.getWhitelistDomains();
    emit({ spamDomainsCount: spam.length, whitelistDomainsCount: whitelist.length, spamDomains: spam, whitelistDomains: whitelist });
  });

program
  .command('add-spam-domain <domain>')
  .description('Add a custom spam domain (in-memory; lost on next CLI run)')
  .action(domain => { spamService.addSpamDomain(domain); emit({ success: true, domain }); });

program
  .command('remove-spam-domain <domain>')
  .action(domain => { spamService.removeSpamDomain(domain); emit({ success: true, domain }); });

program
  .command('add-whitelist-domain <domain>')
  .action(domain => { spamService.addWhitelistDomain(domain); emit({ success: true, domain }); });

program
  .command('check-spam <accountId>')
  .description('Scan a folder for likely spam (disposable / suspicious domains)')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .option('--limit <n>', 'Max messages to scan', '100')
  .option('--from <addr>', 'Pre-filter by sender')
  .option('--since <date>', 'YYYY-MM-DD')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const criteria: SearchCriteria = {};
    if (opts.from) criteria.from = opts.from;
    if (opts.since) criteria.since = parseDateOnly(opts.since);
    const messages = (await imapService.searchEmails(account.id, opts.folder, criteria)).slice(0, Number(opts.limit));
    const data = messages.map(m => ({ uid: m.uid, from: m.from, subject: m.subject }));
    const result = spamService.checkEmails(data);
    emit({
      totalChecked: messages.length,
      spamCount: result.spam.length,
      cleanCount: result.clean.length,
      spamEmails: result.spam.map((s: any) => ({ uid: s.uid, from: s.email, subject: s.subject, domain: s.domain, reason: s.reason, confidence: s.confidence })),
      topDomains: result.domainStats.slice(0, 20),
    });
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('delete-spam <accountId>')
  .description('Find and delete spam (default: dry-run). Pass --commit to actually delete.')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .option('--limit <n>', 'Max messages to scan', '500')
  .option('--min-confidence <level>', 'high|medium|low', 'high')
  .option('--commit', 'Actually delete')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const messages = (await imapService.searchEmails(account.id, opts.folder, {})).slice(0, Number(opts.limit));
    const data = messages.map(m => ({ uid: m.uid, from: m.from, subject: m.subject }));
    const result = spamService.checkEmails(data);
    const levels = ['high', 'medium', 'low'];
    const minIdx = levels.indexOf(opts.minConfidence);
    const toDelete = result.spam.filter(s => levels.indexOf(s.confidence) <= minIdx);
    if (toDelete.length === 0) {
      emit({ success: true, found: 0, deleted: 0 });
    } else if (!opts.commit) {
      emit({
        success: true,
        dryRun: true,
        found: toDelete.length,
        samples: toDelete.slice(0, 20).map((s: any) => ({ uid: s.uid, from: s.email, subject: s.subject, domain: s.domain, confidence: s.confidence })),
      });
    } else {
      const uids = toDelete.map((s: any) => s.uid as number);
      const r = await imapService.bulkDelete(account.id, opts.folder, uids);
      emit({ success: r.failed === 0, found: toDelete.length, ...r });
    }
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('delete-by-domain <accountId> <domain>')
  .description('Delete every message from a domain (default: dry-run). Pass --commit to actually delete.')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .option('--commit', 'Actually delete')
  .action(async (accountId, domain, opts) => {
    const account = resolveAccount(accountId);
    const messages = await imapService.searchEmails(account.id, opts.folder, { from: `@${domain}` });
    if (messages.length === 0) {
      emit({ success: true, found: 0, deleted: 0, domain });
    } else if (!opts.commit) {
      emit({
        success: true,
        dryRun: true,
        domain,
        found: messages.length,
        samples: messages.slice(0, 10).map(m => ({ uid: m.uid, from: m.from, subject: m.subject, date: m.date })),
      });
    } else {
      const uids = messages.map(m => m.uid);
      const r = await imapService.bulkDelete(account.id, opts.folder, uids);
      emit({ success: r.failed === 0, domain, found: messages.length, ...r });
    }
    await imapService.disconnect(account.id).catch(() => {});
  });

program
  .command('domain-stats <accountId>')
  .description('Group senders by domain to surface bulk mailers')
  .option('--folder <folder>', 'Folder name', 'INBOX')
  .option('--limit <n>', 'Max messages to analyse', '500')
  .option('--min-count <n>', 'Minimum count per domain', '2')
  .action(async (accountId, opts) => {
    const account = resolveAccount(accountId);
    const messages = (await imapService.searchEmails(account.id, opts.folder, {})).slice(0, Number(opts.limit));
    const data = messages.map(m => ({ uid: m.uid, from: m.from, subject: m.subject }));
    const result = spamService.checkEmails(data);
    const filtered = result.domainStats
      .filter(d => d.count >= Number(opts.minCount))
      .map(d => ({
        domain: d.domain,
        count: d.count,
        isKnownSpam: spamService.checkEmail(`test@${d.domain}`).isSpam,
        samples: d.emails.slice(0, 3).map(e => ({ from: e.from, subject: e.subject })),
      }));
    emit({ totalEmails: messages.length, uniqueDomains: result.domainStats.length, domains: filtered });
    await imapService.disconnect(account.id).catch(() => {});
  });

// ---------- Error / exit handling ----------

program.exitOverride();

async function main() {
  try {
    await program.parseAsync(process.argv);
    process.exit(0);
  } catch (err: any) {
    if (err && typeof err === 'object' && 'code' in err && String(err.code).startsWith('commander.')) {
      // Help / version / unknown — commander already printed
      process.exit(err.exitCode ?? 0);
    }
    const message = err instanceof Error ? err.message : String(err);
    let code: ExitCode = 1;
    if (/auth|password|login/i.test(message)) code = 2;
    else if (/network|connect|ENOTFOUND|ECONN|timeout/i.test(message)) code = 3;
    else if (/not found|no .* found/i.test(message)) code = 4;
    fail(code, message);
  }
}

main();
