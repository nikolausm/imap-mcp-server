import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AccountManager } from '../services/account-manager.js';
import type { ImapService } from '../services/imap-service.js';
import type { SmtpService } from '../services/smtp-service.js';
import { DraftService } from '../services/draft-service.js';

export const draftReferenceSchema = z.object({
  accountId: z.string().min(1).describe('Account ID returned by save/list drafts; never substitute a different account.'),
  mailbox: z.string().min(1).describe('Exact mailbox name returned with this draft.'),
  uid: z.number().int().positive().describe('IMAP UID, not a message sequence number.'),
  uidValidity: z.string().regex(/^\d+$/).describe('UIDVALIDITY returned with this draft, as a decimal string.'),
  messageId: z.string().nullable().describe('Exact RFC Message-ID returned with the draft; null when absent.'),
}).describe('Complete saved draft reference returned by save/list/read. All fields must match.');
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/).describe('SHA-256 contentHash from the last reviewed draft; rejects changed content.');

export function draftTools(server: McpServer, imap: ImapService, accounts: AccountManager, smtp: SmtpService, service = new DraftService(smtp, imap)) {
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
  async function account(id: string) {
    const found = await accounts.getAccount(id);
    if (!found || found.id !== id) throw new Error('Draft account not found');
    return found;
  }
  server.registerTool('imap_list_drafts', {
    description: 'List active drafts with stable account/mailbox/UID/UIDVALIDITY/Message-ID references and content hashes. Does not mark messages read.',
    inputSchema: {
      accountId: z.string().describe('Account ID from imap_list_accounts.'),
      mailbox: z.string().optional().describe('Exact Drafts mailbox; defaults to special-use Drafts detection.'),
      limit: z.number().int().min(1).max(100).default(50).describe('Maximum newest drafts to return (1–100).'),
    },
  }, async ({ accountId, mailbox, limit }) => {
    const selected = await account(accountId);
    const folder = mailbox ?? await imap.findDraftsFolder(accountId);
    if (!folder) throw new Error('No Drafts mailbox found; provide mailbox');
    return result(await service.list(selected, folder, limit));
  });
  server.registerTool('imap_read_draft', {
    description: 'Read an exact saved draft for review, including recipients, bodies, attachment metadata, raw MIME base64, contentHash and prior send attempt. No Seen flag changes.',
    inputSchema: { draft: draftReferenceSchema },
  }, async ({ draft }) => result(await service.read(await account(draft.accountId), draft)));
  server.registerTool('imap_update_draft', {
    description: 'Update reviewed draft fields with required version check. Preserves attachments/inline images and threading. Appends replacement, then removes Draft flag from exact original (retained, never expunged). Use returned replacement reference and review again. Omitted fields remain unchanged; empty recipient arrays clear recipients.',
    inputSchema: {
      draft: draftReferenceSchema, contentHash: hashSchema,
      patch: z.object({
        subject: z.string().optional().describe('New subject; omitted preserves existing subject.'),
        text: z.string().optional().describe('New text/plain body; omitted preserves existing text.'),
        html: z.string().optional().describe('New HTML body; omitted preserves existing HTML and inline images.'),
        to: z.array(z.string()).optional().describe('Replacement To recipients; omitted preserves existing recipients.'),
        cc: z.array(z.string()).optional().describe('Replacement Cc recipients; empty array clears Cc.'),
        bcc: z.array(z.string()).optional().describe('Replacement Bcc recipients; empty array clears Bcc. Account defaults are not reapplied.'),
      }).strict().refine(p => Object.keys(p).length > 0, 'At least one patch field required').describe('Fields to replace; attachments and thread headers are preserved.'),
    },
  }, async ({ draft, contentHash, patch }) => result(await service.update(await account(draft.accountId), draft, contentHash, patch)));
  server.registerTool('imap_send_draft', {
    description: 'Send the exact reviewed saved MIME using its original recipients, attachments, inline images and threading. Requires contentHash. Durably records attempt before SMTP; never retries an existing attempt. SMTP cannot guarantee exactly-once delivery. Only after confirmed acceptance removes Draft flag (no deletion). Bcc is envelope-only on wire; account defaults are not reapplied.',
    inputSchema: { draft: draftReferenceSchema, contentHash: hashSchema },
  }, async ({ draft, contentHash }) => result(await service.send(await account(draft.accountId), draft, contentHash)));
  server.registerTool('imap_get_draft_send_attempt', {
    description: 'Read local durable send-attempt status by original draft reference, including Message-ID for manual Sent/provider-log reconciliation. Does not retry SMTP or change status.',
    inputSchema: { draft: draftReferenceSchema },
  }, async ({ draft }) => { await account(draft.accountId); return result({ attempt: await service.journal.get(draft) }); });
}
