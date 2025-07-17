import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { accountTools } from './account-tools.js';
import { emailTools } from './email-tools.js';
import { folderTools } from './folder-tools.js';

export function registerTools(
  server: McpServer,
  imapService: ImapService,
  accountManager: AccountManager
): void {
  // Register account management tools
  accountTools(server, accountManager, imapService);
  
  // Register email operation tools
  emailTools(server, imapService, accountManager);
  
  // Register folder operation tools
  folderTools(server, imapService, accountManager);
}