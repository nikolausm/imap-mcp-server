/**
 * IMAP Capability Tools (Issue #55)
 *
 * MCP tools for querying IMAP server capabilities
 * Implements RFC 9051 CAPABILITY command support
 *
 * Author: Colin Bitterfield
 * Email: colin@bitterfield.com
 * Date Created: 2025-11-08
 * Version: 1.0
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { DatabaseService } from '../services/database-service.js';
import { z } from 'zod';
import { withErrorHandling } from '../utils/error-handler.js';

export function capabilityTools(
  server: McpServer,
  imapService: ImapService,
  db: DatabaseService
): void {
  // Get server capabilities
  server.registerTool('imap_get_capabilities', {
    description: 'Query IMAP server capabilities and supported extensions (RFC 9051 CAPABILITY command)',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      forceRefresh: z.boolean().optional().describe('Force refresh capabilities (bypass cache, default: false)'),
    }
  }, withErrorHandling(async ({ accountId, forceRefresh }) => {
    const capabilities = await imapService.getCapabilities(accountId, forceRefresh || false);

    // Build human-readable summary
    const imapVersion = capabilities.imap4rev2 ? 'IMAP4rev2 (RFC 9051)' :
                        capabilities.imap4rev1 ? 'IMAP4rev1 (RFC 3501)' :
                        'Unknown IMAP version';

    // Count supported IMAP4rev2 built-in extensions
    const builtInExtensions = [
      'namespace', 'unselect', 'uidplus', 'esearch', 'searchres',
      'enable', 'idle', 'saslir', 'listExtended', 'listStatus',
      'move', 'literalMinus', 'binary', 'specialUse'
    ];
    const supportedBuiltIns = builtInExtensions.filter(ext => capabilities.extensions[ext]).length;

    // Count optional extensions
    const optionalExtensions = ['quota', 'sort', 'thread', 'condstore', 'qresync', 'compress', 'notify', 'metadata'];
    const supportedOptional = optionalExtensions.filter(ext => capabilities.extensions[ext]).length;

    const summary = {
      imapVersion,
      compliance: capabilities.imap4rev2 ? 'RFC 9051 Compliant' : 'Legacy IMAP4rev1',
      authMethods: capabilities.authMethods,
      coreExtensions: `${supportedBuiltIns}/${builtInExtensions.length} IMAP4rev2 built-ins supported`,
      optionalExtensions: `${supportedOptional}/${optionalExtensions.length} optional extensions supported`,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          summary,
          capabilities: {
            raw: capabilities.raw,
            imap4rev2: capabilities.imap4rev2,
            imap4rev1: capabilities.imap4rev1,
            authMethods: capabilities.authMethods,
            extensions: capabilities.extensions,
          },
        }, null, 2)
      }]
    };
  }));
}
