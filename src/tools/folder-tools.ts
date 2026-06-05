import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { z } from 'zod';

// Backward-compatible account selector (accountId stays accepted; accountName
// and the single-account default are additive conveniences).
const accountSelector = {
  accountId: z.string().optional().describe('Account ID (from imap_list_accounts). Optional if accountName is given or only one account is configured.'),
  accountName: z.string().optional().describe('Account name instead of accountId. Optional if accountId is given or only one account is configured.'),
};

export function folderTools(
  server: McpServer,
  imapService: ImapService,
  accountManager: AccountManager
): void {
  // List folders tool
  server.registerTool('imap_list_folders', {
    description: 'List all folders/mailboxes for an account (names, hierarchy delimiter, attributes). Use this first to discover exact folder names before searching, moving, or creating subfolders — folder naming varies by provider (e.g. "Archive" vs "[Gmail]/All Mail" vs "INBOX.Archive").',
    inputSchema: {
      ...accountSelector,
    }
  }, async ({ accountId: rawAccountId, accountName }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const folders = await imapService.listFolders(accountId);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          folders: folders.map(folder => ({
            name: folder.name,
            delimiter: folder.delimiter,
            attributes: folder.attributes,
            hasChildren: !!folder.children && folder.children.length > 0,
          })),
        }, null, 2)
      }]
    };
  });

  // Get folder status tool
  server.registerTool('imap_folder_status', {
    description: 'Get status information about a folder',
    inputSchema: {
      ...accountSelector,
      folder: z.string().describe('Folder name'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const box = await imapService.selectFolder(accountId, folder);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          folder: folder,
          messages: {
            total: box.messages.total,
            new: box.messages.new,
            unseen: box.messages.unseen || 0,
          },
          uidvalidity: box.uidvalidity,
          uidnext: box.uidnext,
          flags: box.flags,
          permanentFlags: box.permanentFlags,
        }, null, 2)
      }]
    };
  });

  // Create folder tool
  server.registerTool('imap_create_folder', {
    description:
      'Create a new IMAP folder/mailbox. Most servers also create any missing parent folders ' +
      '(e.g. creating "Archives/2026/2026-05" auto-creates "Archives" and "Archives/2026"). ' +
      'Returns success even if the folder already exists.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().describe('Full folder path to create (e.g. "Archives/2026/2026-05" or "INBOX.Archive")'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    try {
      const result = await imapService.createFolder(accountId, folder);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            folder: result.path,
            created: result.created,
            alreadyExisted: result.alreadyExisted,
            message: result.alreadyExisted
              ? `Folder "${result.path}" already existed`
              : `Folder "${result.path}" created`,
          }, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            folder,
            error: err instanceof Error ? err.message : 'Unknown error',
          }, null, 2)
        }]
      };
    }
  });

  // Get unread count tool
  // @ts-expect-error TS2589: MCP SDK registerTool + zod v3 exceed TS's type instantiation depth. Runtime schema validation is unaffected.
  server.registerTool('imap_get_unread_count', {
    description: 'Count unread (unseen) emails per folder, plus a total. Use for "how many unread do I have?" overviews. Defaults to all folders; pass a folders list to limit scope and speed it up.',
    inputSchema: {
      ...accountSelector,
      folders: z.array(z.string()).optional().describe('List of folders to check (default: all)'),
    }
  }, async ({ accountId: rawAccountId, accountName, folders }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const allFolders = await imapService.listFolders(accountId);
    const foldersToCheck = folders || allFolders.map(f => f.name);
    
    const unreadCounts: Record<string, number> = {};
    let totalUnread = 0;
    
    for (const folderName of foldersToCheck) {
      try {
        const unreadMessages = await imapService.searchEmails(accountId, folderName, { seen: false });
        const count = unreadMessages.length;
        unreadCounts[folderName] = count;
        totalUnread += count;
      } catch (error) {
        // Skip folders that can't be accessed
        unreadCounts[folderName] = 0;
      }
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalUnread,
          byFolder: unreadCounts,
        }, null, 2)
      }]
    };
  });
}