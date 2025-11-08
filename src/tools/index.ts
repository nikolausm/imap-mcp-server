import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { DatabaseService } from '../services/database-service.js';
import { SmtpService } from '../services/smtp-service.js';
import { accountTools } from './account-tools.js';
import { emailTools } from './email-tools.js';
import { folderTools } from './folder-tools.js';
import { metaTools } from './meta-tools.js';
import { userTools } from './user-tools.js';
import { userCheckTools } from './usercheck-tools.js';
import { registerScoringTools } from './scoring-tools.js';
import { registerSubscriptionTools } from './subscription-tools.js';
import { capabilityTools } from './capability-tools.js';

export function registerTools(
  server: McpServer,
  imapService: ImapService,
  db: DatabaseService,
  smtpService: SmtpService
): void {
  // Register user & database management tools (v2.6.0 - SQLite3 integration)
  userTools(server, db);

  // Register account management tools (legacy - to be deprecated)
  accountTools(server, db, imapService);

  // Register email operation tools
  emailTools(server, imapService, db, smtpService);

  // Register folder operation tools
  folderTools(server, imapService, db);

  // Register capability tools (Issue #55 - RFC 9051 compliance)
  capabilityTools(server, imapService, db);

  // Register UserCheck SPAM detection tools (Issues #3, #17, #18)
  userCheckTools(server, db, imapService);

  // Register confidence scoring tools (Issue #42)
  registerScoringTools(server, imapService);

  // Register subscription management tools (Issue #45 Phase 4, Issue #47)
  registerSubscriptionTools(server, imapService, db, smtpService);

  // Register meta/discovery tools
  metaTools(server);
}