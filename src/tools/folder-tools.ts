import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { z } from 'zod';

export function folderTools(
  server: McpServer,
  imapService: ImapService,
  accountManager: AccountManager
): void {
  // List folders tool
  server.registerTool('imap_list_folders', {
    description: 'List all folders/mailboxes in an IMAP account',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
    }
  }, async ({ accountId }) => {
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
      accountId: z.string().describe('Account ID'),
      folder: z.string().describe('Folder name'),
    }
  }, async ({ accountId, folder }) => {
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

  // Get unread count tool
  server.registerTool('imap_get_unread_count', {
    description: 'Get the count of unread emails in specified folders',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folders: z.array(z.string()).optional().describe('List of folders to check (default: all)'),
    }
  }, async ({ accountId, folders }) => {
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

  // Create folder tool
  server.registerTool('imap_create_folder', {
    description: 'Create a new folder/mailbox in an IMAP account',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folderName: z.string().describe('Name of the folder to create (use "/" for hierarchy, e.g., "Archive/2024")'),
    }
  }, async ({ accountId, folderName }) => {
    await imapService.createFolder(accountId, folderName);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Folder "${folderName}" created successfully`,
        }, null, 2)
      }]
    };
  });

  // Delete folder tool
  server.registerTool('imap_delete_folder', {
    description: 'Delete a folder/mailbox from an IMAP account',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folderName: z.string().describe('Name of the folder to delete'),
    }
  }, async ({ accountId, folderName }) => {
    await imapService.deleteFolder(accountId, folderName);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Folder "${folderName}" deleted successfully`,
        }, null, 2)
      }]
    };
  });

  // Rename folder tool
  server.registerTool('imap_rename_folder', {
    description: 'Rename a folder/mailbox in an IMAP account',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      oldName: z.string().describe('Current name of the folder'),
      newName: z.string().describe('New name for the folder'),
    }
  }, async ({ accountId, oldName, newName }) => {
    await imapService.renameFolder(accountId, oldName, newName);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Folder renamed from "${oldName}" to "${newName}" successfully`,
        }, null, 2)
      }]
    };
  });
}