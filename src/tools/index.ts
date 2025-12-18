import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { SmtpService } from '../services/smtp-service.js';
import { SpamService } from '../services/spam-service.js';
import { accountTools } from './account-tools.js';
import { emailTools } from './email-tools.js';
import { folderTools } from './folder-tools.js';
import { spamTools } from './spam-tools.js';

export function registerTools(
  server: McpServer,
  imapService: ImapService,
  accountManager: AccountManager,
  smtpService: SmtpService,
  spamService: SpamService
): void {
  // Register account management tools
  accountTools(server, accountManager, imapService);

  // Register email operation tools
  emailTools(server, imapService, accountManager, smtpService);

  // Register folder operation tools
  folderTools(server, imapService, accountManager);

  // Register spam detection and management tools
  spamTools(server, imapService, spamService);
}
